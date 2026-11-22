// Adapted from Orca (MIT, (c) 2026 Lovecast Inc.) — src/main/workspaces/cleanup/workspace-cleanup-run-evidence.ts
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { WorkspaceCleanupEvidence, WorkspaceCleanupPullRequestState } from "@tabs/contracts";
import { usageFor, isInside, type WorkspaceUsageIndex } from "./usage.ts";

export interface GitResult {
  readonly code: number;
  readonly stdout: string;
}

/** Read-only git: no optional locks, no fsmonitor daemon. Never rejects on a non-zero exit. */
export const runGit = (cwd: string, args: ReadonlyArray<string>, timeout = 20_000) =>
  new Promise<GitResult>((resolve, reject) => {
    execFile(
      "git",
      ["-c", "core.fsmonitor=false", ...args],
      {
        cwd,
        timeout,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      },
      (error, stdout) => {
        if (!error) return resolve({ code: 0, stdout });
        const code = (error as NodeJS.ErrnoException & { code?: unknown }).code;
        if (typeof code === "number") return resolve({ code, stdout });
        reject(error);
      },
    );
  });

export const canonicalPath = (target: string) =>
  fs.realpath(target).then(
    (resolved) => resolved,
    () => path.resolve(target),
  );

export const toPosix = (target: string) => target.replaceAll("\\", "/");

export const worktreeId = (worktreePath: string, head: string) =>
  createHash("sha256").update(`${worktreePath}\0${head}`).digest("hex").slice(0, 24);

/** The ref other branches are compared against, or null when the repository has none. */
export async function resolveDefaultRef(cwd: string): Promise<string | null> {
  const origin = await runGit(cwd, ["symbolic-ref", "-q", "refs/remotes/origin/HEAD"]).catch(
    () => null,
  );
  const named = origin?.code === 0 ? origin.stdout.trim() : "";
  const candidates = [
    ...(named ? [named] : []),
    "refs/remotes/origin/main",
    "refs/remotes/origin/master",
    "refs/heads/main",
    "refs/heads/master",
  ];
  for (const ref of candidates) {
    const found = await runGit(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).catch(
      () => null,
    );
    if (found?.code === 0) return ref;
  }
  return null;
}

/** Size in bytes via `du`; null where unavailable or too slow. */
export async function diskUsageBytes(target: string): Promise<number | null> {
  if (process.platform === "win32") return null;
  const result = await new Promise<string | null>((resolve) => {
    execFile("du", ["-sk", target], { timeout: 15_000 }, (error, stdout) =>
      resolve(error ? null : stdout),
    );
  });
  const kilobytes = result ? Number.parseInt(result.split(/\s/)[0] ?? "", 10) : Number.NaN;
  return Number.isFinite(kilobytes) ? kilobytes * 1024 : null;
}

export interface WorktreeEntry {
  readonly path: string;
  readonly head: string;
  readonly branch: string | null;
  readonly main: boolean;
  readonly locked: boolean;
  readonly prunable: boolean;
}

export interface GatherContext {
  readonly defaultRef: string | null;
  readonly managedRoots: ReadonlyArray<string>;
  readonly usage: WorkspaceUsageIndex;
  readonly lookupPullRequest: (
    worktreePath: string,
    branch: string,
  ) => Promise<WorkspaceCleanupPullRequestState | null>;
  readonly includeDisk: boolean;
}

const countLines = (text: string) => (text === "" ? 0 : text.split("\n").filter(Boolean).length);

/** Dependency installs are reproducible; any other ignored path might hold secrets or datasets. */
export const hasIrreproducibleIgnored = (output: string) =>
  output.split("\0").some((entry) => entry !== "" && !/(^|\/)node_modules\/$/.test(entry));

export async function gatherEvidence(
  entry: WorktreeEntry,
  context: GatherContext,
): Promise<WorkspaceCleanupEvidence> {
  const root = await canonicalPath(entry.path);
  const posixRoot = toPosix(root);
  const usage = usageFor(context.usage, posixRoot);
  const managed =
    usage.openThreads + usage.settledThreads > 0 ||
    context.managedRoots.some((managedRoot) => isInside(toPosix(managedRoot), posixRoot));
  const base: WorkspaceCleanupEvidence = {
    managed,
    main: entry.main,
    locked: entry.locked,
    missing: false,
    projectRoot: usage.projectRoot,
    detached: entry.branch === null,
    error: null,
    branchMerged: null,
    pullRequest: null,
    lastCommitAt: null,
    lastThreadActivityAt: usage.lastThreadActivityAt,
    dirty: false,
    dirtyFileCount: 0,
    ignoredFiles: false,
    unpushedCommits: 0,
    openThreads: usage.openThreads,
    settledThreads: usage.settledThreads,
    liveSessions: usage.liveSessions,
    runningTerminals: usage.runningTerminals,
    lastTerminalActivityAt: usage.lastTerminalActivityAt,
    diskBytes: null,
  };
  // The main checkout is never a candidate; skip the expensive reads.
  if (entry.main) return base;
  try {
    const stat = await fs.lstat(entry.path);
    if (stat.isSymbolicLink()) return { ...base, error: "The worktree path is a symbolic link." };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { ...base, missing: true };
    return { ...base, error: String(cause) };
  }
  try {
    const [status, ignored, lastCommit, unpushed, merged, pullRequest, diskBytes] =
      await Promise.all([
        runGit(entry.path, [
          "status",
          "--porcelain",
          "--untracked-files=all",
          "--ignore-submodules=none",
        ]),
        runGit(entry.path, [
          "ls-files",
          "--others",
          "--ignored",
          "--exclude-standard",
          "--directory",
          "-z",
        ]),
        runGit(entry.path, ["log", "-1", "--format=%ct", "HEAD"]),
        // Commits on a remote, or already on the default branch, are not at risk.
        runGit(entry.path, [
          "rev-list",
          "--count",
          "HEAD",
          "--not",
          "--remotes",
          ...(context.defaultRef ? [context.defaultRef] : []),
        ]),
        context.defaultRef
          ? runGit(entry.path, ["merge-base", "--is-ancestor", "HEAD", context.defaultRef])
          : Promise.resolve<GitResult | null>(null),
        entry.branch
          ? context.lookupPullRequest(entry.path, entry.branch).catch(() => null)
          : Promise.resolve(null),
        context.includeDisk ? diskUsageBytes(entry.path) : Promise.resolve(null),
      ]);
    if (status.code !== 0) throw new Error("git status failed");
    if (unpushed.code !== 0) throw new Error("could not count unpushed commits");
    const seconds = Number.parseInt(lastCommit.stdout.trim(), 10);
    return {
      ...base,
      dirty: status.stdout !== "",
      dirtyFileCount: countLines(status.stdout),
      ignoredFiles: ignored.code === 0 && hasIrreproducibleIgnored(ignored.stdout),
      lastCommitAt: Number.isFinite(seconds) ? seconds * 1000 : null,
      unpushedCommits: unpushed.code === 0 ? Number.parseInt(unpushed.stdout.trim(), 10) || 0 : 0,
      branchMerged:
        merged === null ? null : merged.code === 0 ? true : merged.code === 1 ? false : null,
      pullRequest,
      diskBytes,
    };
  } catch (cause) {
    return { ...base, error: cause instanceof Error ? cause.message : String(cause) };
  }
}
