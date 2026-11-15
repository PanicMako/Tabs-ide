import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { OvermindWorkspace } from "@tabs/shared/overmind";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

/**
 * Where Overmind sub-threads work, and how their work comes back.
 *
 * A writing task gets its own git worktree on its own branch, so parallel
 * siblings never share an index, a build directory or a half-edited file. When
 * the task finishes Overmind commits what is left, merges the branch into the
 * lead's checkout, and drops the worktree. A merge that cannot complete is
 * aborted and reported, so the lead's checkout is never left mid-merge.
 */
export interface OvermindWorkspaceHost {
  /** Null when this checkout cannot be isolated; the task then shares the lead's. */
  readonly provision: (input: {
    readonly planId: string;
    readonly taskId: string;
    readonly attempt: number;
  }) => Effect.Effect<OvermindWorkspace | null>;
  readonly integrate: (
    workspace: OvermindWorkspace,
    title: string,
  ) => Effect.Effect<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>;
  /** Best effort: removes the worktree and its branch. */
  readonly discard: (workspace: OvermindWorkspace) => Effect.Effect<void>;
  /** Uncommitted changes in the lead's checkout that sub-threads will not see. */
  readonly leadIsDirty: Effect.Effect<boolean>;
}

interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const GIT_TIMEOUT_MS = 120_000;

const runGit = (cwd: string, args: ReadonlyArray<string>): Promise<GitResult> =>
  new Promise((resolve) => {
    execFile(
      "git",
      [...args],
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true" },
      },
      (error, stdout, stderr) => {
        const code =
          error === null
            ? 0
            : typeof (error as { code?: unknown }).code === "number"
              ? (error as { code: number }).code
              : 1;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });

/** Merges run one at a time per process so two plans cannot interleave in one checkout. */
let mergeChain: Promise<unknown> = Promise.resolve();
const serialized = <T>(work: () => Promise<T>): Promise<T> => {
  const next = mergeChain.then(work, work);
  mergeChain = next.catch(() => undefined);
  return next;
};

const safeSegment = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 40);

export interface OvermindWorktreeCreator {
  readonly createWorktree: (input: {
    readonly cwd: string;
    readonly refName: string;
    readonly newRefName: string;
    readonly path: null;
  }) => Effect.Effect<
    { readonly worktree: { readonly path: string; readonly refName: string } },
    unknown
  >;
  readonly removeWorktree: (input: {
    readonly cwd: string;
    readonly path: string;
    readonly force?: boolean;
  }) => Effect.Effect<void, unknown>;
}

export function makeOvermindWorkspaceHost(input: {
  /** The lead thread's checkout. */
  readonly leadCwd: string;
  readonly git: OvermindWorktreeCreator;
}): OvermindWorkspaceHost {
  const { leadCwd, git } = input;

  const commitLeftovers = async (workspace: OvermindWorkspace, title: string) => {
    const status = await runGit(workspace.path, ["status", "--porcelain"]);
    if (status.code !== 0)
      return `could not read the sub-thread's checkout: ${status.stderr.trim()}`;
    if (status.stdout.trim() === "") return null;
    const add = await runGit(workspace.path, ["add", "-A"]);
    if (add.code !== 0) return `could not stage the sub-thread's changes: ${add.stderr.trim()}`;
    const identity = await runGit(workspace.path, ["config", "user.email"]);
    const identityArgs =
      identity.stdout.trim() === ""
        ? ["-c", "user.name=Tabs Overmind", "-c", "user.email=overmind@tabs.local"]
        : [];
    const commit = await runGit(workspace.path, [
      ...identityArgs,
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      `Overmind: ${title}`,
    ]);
    return commit.code === 0
      ? null
      : `could not commit the sub-thread's changes: ${commit.stderr.trim()}`;
  };

  return {
    provision: ({ planId, taskId, attempt }) =>
      Effect.gen(function* () {
        const head = yield* Effect.promise(() =>
          runGit(leadCwd, ["rev-parse", "--verify", "HEAD"]),
        );
        if (head.code !== 0) return null;
        const branch = `overmind/${safeSegment(planId)}-${safeSegment(taskId)}-${attempt}`;
        const created = yield* git
          .createWorktree({
            cwd: leadCwd,
            refName: head.stdout.trim(),
            newRefName: branch,
            path: null,
          })
          .pipe(Effect.option);
        if (Option.isNone(created)) return null;
        return { path: created.value.worktree.path, branch: created.value.worktree.refName };
      }),

    integrate: (workspace, title) =>
      Effect.promise(() =>
        serialized(async () => {
          const leftoverError = await commitLeftovers(workspace, title);
          if (leftoverError !== null) return { ok: false as const, reason: leftoverError };
          const ahead = await runGit(leadCwd, ["rev-list", "--count", `HEAD..${workspace.branch}`]);
          if (ahead.code === 0 && ahead.stdout.trim() === "0") return { ok: true as const };
          const merge = await runGit(leadCwd, [
            "-c",
            "commit.gpgsign=false",
            "merge",
            "--no-edit",
            "--no-ff",
            "-m",
            `Overmind: ${title}`,
            workspace.branch,
          ]);
          if (merge.code === 0) return { ok: true as const };
          const conflicted = await runGit(leadCwd, ["diff", "--name-only", "--diff-filter=U"]);
          await runGit(leadCwd, ["merge", "--abort"]);
          const files = conflicted.stdout.split("\n").filter((line) => line.trim() !== "");
          const detail = (merge.stdout + merge.stderr).trim().replace(/\s+/g, " ").slice(0, 300);
          const named =
            files.length > 0
              ? `conflicting files: ${files.slice(0, 20).join(", ")}${files.length > 20 ? ", …" : ""}. `
              : "";
          return {
            ok: false as const,
            reason: `merge into the lead checkout failed: ${named}${detail}`,
          };
        }),
      ),

    discard: (workspace) =>
      Effect.gen(function* () {
        yield* git
          .removeWorktree({ cwd: leadCwd, path: workspace.path, force: true })
          .pipe(Effect.ignore);
        yield* Effect.promise(() => runGit(leadCwd, ["branch", "-D", workspace.branch])).pipe(
          Effect.ignore,
        );
      }),

    leadIsDirty: Effect.promise(() => runGit(leadCwd, ["status", "--porcelain"])).pipe(
      Effect.map((result) => result.code === 0 && result.stdout.trim() !== ""),
    ),
  };
}

/** What survives a restart. States are plain JSON; the plan is the lead's own words. */
export interface StoredOvermindPlan {
  readonly goal: string;
  readonly isolate: boolean;
  readonly tasks: ReadonlyArray<unknown>;
  readonly models: ReadonlyArray<readonly [string, string]>;
  /** Provider instance per task; absent in plans saved before cross-provider tasks. */
  readonly providers?: ReadonlyArray<readonly [string, string]> | undefined;
  readonly limits: unknown;
  readonly states: ReadonlyArray<readonly [string, unknown]>;
  readonly leadCwd: string | null;
}

export interface OvermindPlanStore {
  readonly load: (key: string) => Promise<StoredOvermindPlan | null>;
  readonly save: (key: string, plan: StoredOvermindPlan) => Promise<void>;
}

const fileName = (key: string) => `${key.replace(/[^A-Za-z0-9._-]/g, "_").slice(-120)}.json`;

export function makeFileOvermindPlanStore(directory: string): OvermindPlanStore {
  return {
    load: async (key) => {
      try {
        const parsed: unknown = JSON.parse(await readFile(join(directory, fileName(key)), "utf8"));
        if (typeof parsed !== "object" || parsed === null) return null;
        const record = parsed as Partial<StoredOvermindPlan>;
        if (
          typeof record.goal !== "string" ||
          !Array.isArray(record.tasks) ||
          !Array.isArray(record.states)
        ) {
          return null;
        }
        return record as StoredOvermindPlan;
      } catch {
        return null;
      }
    },
    save: async (key, plan) => {
      try {
        await mkdir(directory, { recursive: true });
        const target = join(directory, fileName(key));
        const temporary = `${target}.${process.pid}.tmp`;
        await writeFile(temporary, JSON.stringify(plan), "utf8");
        await rename(temporary, target);
      } catch {
        // Persistence is best effort; the in-memory plan still drives this run.
      }
    },
  };
}
