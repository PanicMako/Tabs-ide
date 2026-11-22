import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { WorkspaceCompatibilityError } from "@tabs/contracts";
import * as ServerConfig from "../config.ts";
import * as GitManager from "../git/GitManager.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as Settings from "../serverSettings.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import { managedWorktreesDirectories } from "../worktreesDirectory.ts";
import { withWorkspaceLease } from "../workspace/workspaceLease.ts";
import { verifyWorktreeRemovalSafety, parseWorktrees } from "../workspaceMaintenance.ts";
import { canonicalPath, runGit, toPosix } from "./gitEvidence.ts";
import { listRuns } from "./history.ts";
import { applyCleanup, scanWorktrees, type WorkspaceCleanupDeps } from "./service.ts";
import type { WorkspaceUsageIndex } from "./usage.ts";

const PULL_REQUEST_TIMEOUT_MS = 4_000;
const HISTORY_FILE = "workspace-cleanup-history.json";

const cleanupError = (operation: string) => (error: unknown) =>
  new WorkspaceCompatibilityError({
    operation,
    detail: error instanceof Error ? error.message : String(error),
  });

const time = (value: string | null) => {
  const parsed = value === null ? Number.NaN : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** RPC handlers for `workspaceCleanup.*`, merged into the workspace compatibility group. */
export const makeWorkspaceCleanupHandlers = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const settings = yield* Settings.ServerSettingsService;
  const sql = yield* SqlClient.SqlClient;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const terminals = yield* TerminalManager.TerminalManager;
  const gitManager = yield* GitManager.GitManager;
  const path = yield* Path.Path;
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);

  const readUsage = Effect.fn("WorkspaceCleanup.readUsage")(function* () {
    const threadRows = yield* sql<{
      worktreePath: string | null;
      settledAt: string | null;
      activityAt: string | null;
    }>`
      SELECT json_extract(payload_json, '$.worktreePath') AS "worktreePath",
             json_extract(payload_json, '$.settledAt') AS "settledAt",
             COALESCE(
               json_extract(payload_json, '$.latestRunCompletedAt'),
               json_extract(payload_json, '$.latestRunStartedAt'),
               json_extract(payload_json, '$.latestUserMessageAt'),
               json_extract(payload_json, '$.createdAt')
             ) AS "activityAt"
      FROM orchestration_v2_projection_threads WHERE deleted_at IS NULL
    `;
    const sessions = yield* sql<{ cwd: string | null }>`
      SELECT json_extract(payload_json, '$.cwd') AS cwd
      FROM orchestration_v2_projection_provider_sessions WHERE status != 'stopped'
    `;
    const projectList = yield* projects.listShells();
    const terminalList = yield* terminals.list();
    const canon = (target: string) => canonicalPath(target).then(toPosix);
    const index: WorkspaceUsageIndex = yield* Effect.promise(async () => ({
      threads: await Promise.all(
        threadRows.flatMap((row) =>
          row.worktreePath
            ? [
                canon(row.worktreePath).then((resolved) => ({
                  path: resolved,
                  settled: row.settledAt !== null,
                  activityAt: time(row.activityAt),
                })),
              ]
            : [],
        ),
      ),
      sessionCwds: await Promise.all(sessions.flatMap((row) => (row.cwd ? [canon(row.cwd)] : []))),
      terminals: await Promise.all(
        terminalList.map(async (terminal) => ({
          cwd: await canon(terminal.worktreePath ?? terminal.cwd),
          running: terminal.status === "starting" || terminal.status === "running",
          updatedAt: time(terminal.updatedAt),
        })),
      ),
      projectRoots: await Promise.all(projectList.map((project) => canon(project.workspaceRoot))),
    }));
    return index;
  });

  const makeDeps = Effect.fn("WorkspaceCleanup.makeDeps")(function* () {
    const serverSettings = yield* settings.getSettings;
    const deps: WorkspaceCleanupDeps = {
      listWorktrees: async (cwd) => {
        const listed = await runGit(cwd, ["worktree", "list", "--porcelain", "-z"]);
        if (listed.code !== 0) throw new Error("Could not list worktrees for this project.");
        return parseWorktrees(listed.stdout);
      },
      readUsage: () => runPromise(readUsage()),
      managedRoots: managedWorktreesDirectories(serverSettings, config.worktreesDir, path),
      lookupPullRequest: (worktreePath, branch) =>
        runPromise(
          gitManager.branchPullRequest({ cwd: worktreePath, branch }).pipe(
            Effect.map((pullRequest) => pullRequest?.state ?? null),
            Effect.timeout(`${PULL_REQUEST_TIMEOUT_MS} millis`),
            Effect.orElseSucceed(() => null),
          ),
        ),
      removeWorktree: ({ cwd, path: worktreePath, force }) =>
        runPromise(
          withWorkspaceLease(
            worktreePath,
            Effect.gen(function* () {
              yield* Effect.promise(() => verifyWorktreeRemovalSafety(cwd));
              yield* Effect.tryPromise(async () => {
                const removed = await runGit(
                  cwd,
                  ["worktree", "remove", ...(force ? ["--force"] : []), "--", worktreePath],
                  60_000,
                );
                if (removed.code !== 0) throw new Error("git refused to remove the worktree.");
              });
              yield* gitManager.invalidateStatus(cwd);
            }),
          ),
        ),
      historyFile: path.join(config.stateDir, HISTORY_FILE),
      now: () => Date.now(),
    };
    return deps;
  });

  return {
    scan: (input: Parameters<typeof scanWorktrees>[1]) =>
      makeDeps().pipe(
        Effect.flatMap((deps) => Effect.tryPromise(() => scanWorktrees(deps, input))),
        Effect.mapError(cleanupError("workspaceCleanup.scan")),
      ),
    apply: (input: Parameters<typeof applyCleanup>[1]) =>
      makeDeps().pipe(
        Effect.flatMap((deps) => Effect.tryPromise(() => applyCleanup(deps, input))),
        Effect.mapError(cleanupError("workspaceCleanup.apply")),
      ),
    history: (input: { readonly limit?: number | undefined }) =>
      Effect.tryPromise(() =>
        listRuns(path.join(config.stateDir, HISTORY_FILE), input.limit ?? 20),
      ).pipe(Effect.mapError(cleanupError("workspaceCleanup.history"))),
  };
});
