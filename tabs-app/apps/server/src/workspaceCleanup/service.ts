// Adapted from Orca (MIT, (c) 2026 Lovecast Inc.) — src/main/workspaces/cleanup/workspace-cleanup-runner.ts
import { randomUUID } from "node:crypto";
import type {
  WorkspaceCleanupApplyInput,
  WorkspaceCleanupItem,
  WorkspaceCleanupOutcome,
  WorkspaceCleanupPullRequestState,
  WorkspaceCleanupRun,
  WorkspaceCleanupScanInput,
  WorkspaceCleanupScanResult,
} from "@tabs/contracts";
import { classifyWorktree } from "./classification.ts";
import { mapWithConcurrency } from "./concurrency.ts";
import {
  canonicalPath,
  gatherEvidence,
  resolveDefaultRef,
  worktreeId,
  type WorktreeEntry,
} from "./gitEvidence.ts";
import { appendRun } from "./history.ts";
import type { WorkspaceUsageIndex } from "./usage.ts";

/** Parallel git processes per scan page. Each worktree already runs ~7 reads of its own. */
export const SCAN_CONCURRENCY = 4;

export interface WorkspaceCleanupDeps {
  readonly listWorktrees: (cwd: string) => Promise<ReadonlyArray<WorktreeEntry>>;
  readonly readUsage: () => Promise<WorkspaceUsageIndex>;
  readonly managedRoots: ReadonlyArray<string>;
  readonly lookupPullRequest: (
    worktreePath: string,
    branch: string,
  ) => Promise<WorkspaceCleanupPullRequestState | null>;
  /** Removes through git and the workspace lease; `force` only after a per-item confirm. */
  readonly removeWorktree: (input: { cwd: string; path: string; force: boolean }) => Promise<void>;
  readonly historyFile: string;
  readonly now: () => number;
}

const noPullRequest = async () => null;

async function prepare(deps: WorkspaceCleanupDeps, cwd: string, includePullRequests: boolean) {
  const [entries, usage, defaultRef, managedRoots] = await Promise.all([
    deps.listWorktrees(cwd),
    deps.readUsage(),
    resolveDefaultRef(cwd),
    Promise.all(deps.managedRoots.map(canonicalPath)),
  ]);
  return {
    // The main checkout is never a cleanup candidate and is not listed.
    entries: entries
      .filter((entry) => !entry.main)
      .toSorted((a, b) => a.path.localeCompare(b.path)),
    context: {
      defaultRef,
      managedRoots,
      usage,
      includeDisk: true,
      lookupPullRequest: includePullRequests ? deps.lookupPullRequest : noPullRequest,
    },
  };
}

async function evaluate(
  entry: WorktreeEntry,
  context: Awaited<ReturnType<typeof prepare>>["context"],
  rules: WorkspaceCleanupScanInput["rules"],
  now: number,
): Promise<WorkspaceCleanupItem> {
  const evidence = await gatherEvidence(entry, context);
  const { verdict, reasons } = classifyWorktree(evidence, rules, now);
  return {
    id: worktreeId(entry.path, entry.head),
    path: entry.path,
    branch: entry.branch,
    head: entry.head,
    verdict,
    reasons,
    evidence,
  };
}

/** One page of the scan. The caller loops on `nextOffset`, rendering pages as they arrive. */
export async function scanWorktrees(
  deps: WorkspaceCleanupDeps,
  input: WorkspaceCleanupScanInput,
): Promise<WorkspaceCleanupScanResult> {
  const { entries, context } = await prepare(deps, input.cwd, input.includePullRequests);
  const page = entries.slice(input.offset, input.offset + input.limit);
  const now = deps.now();
  const items = await mapWithConcurrency(page, SCAN_CONCURRENCY, (entry) =>
    evaluate(entry, context, input.rules, now),
  );
  const end = input.offset + page.length;
  return {
    items,
    total: entries.length,
    nextOffset: end < entries.length ? end : null,
    scannedAt: now,
  };
}

/**
 * Re-evaluates every selection from scratch: the preview the user saw is never trusted. A
 * checkout whose HEAD moved, or that gained work or an active user, is skipped, not removed.
 */
export async function applyCleanup(
  deps: WorkspaceCleanupDeps,
  input: WorkspaceCleanupApplyInput,
): Promise<WorkspaceCleanupRun> {
  const { entries, context } = await prepare(deps, input.cwd, true);
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const outcomes: WorkspaceCleanupOutcome[] = [];
  const seen = new Set<string>();
  for (const selection of input.selections) {
    if (seen.has(selection.path)) continue;
    seen.add(selection.path);
    const skipped = (detail: string, item?: WorkspaceCleanupItem): WorkspaceCleanupOutcome => ({
      id: selection.id,
      path: selection.path,
      branch: item?.branch ?? null,
      status: "skipped",
      forced: false,
      bytes: null,
      detail,
    });
    const entry = byPath.get(selection.path);
    if (!entry) {
      outcomes.push(skipped("No longer a worktree of this repository."));
      continue;
    }
    try {
      const item = await evaluate(entry, context, input.rules, deps.now());
      if (item.id !== selection.id) {
        outcomes.push(skipped("The checkout changed since the preview. Scan again.", item));
        continue;
      }
      if (item.verdict === "keep") {
        const why = item.reasons.find(
          (reason) => reason.kind === "block" || reason.kind === "keep",
        );
        outcomes.push(skipped(why?.detail ?? "Kept by the cleanup rules.", item));
        continue;
      }
      if (item.verdict === "confirm" && !selection.confirmed) {
        outcomes.push(skipped("Needs your confirmation because work could be lost.", item));
        continue;
      }
      // git refuses to remove a checkout with uncommitted work; only a confirmed item may be forced.
      const force = item.evidence.dirty && selection.confirmed;
      if (!input.dryRun) await deps.removeWorktree({ cwd: input.cwd, path: entry.path, force });
      outcomes.push({
        id: item.id,
        path: item.path,
        branch: item.branch,
        status: input.dryRun ? "would-remove" : "removed",
        forced: force && !input.dryRun,
        bytes: item.evidence.diskBytes,
        detail: null,
      });
    } catch (cause) {
      outcomes.push({
        ...skipped(cause instanceof Error ? cause.message : String(cause)),
        status: "failed",
      });
    }
  }
  const run: WorkspaceCleanupRun = {
    id: randomUUID(),
    at: deps.now(),
    cwd: input.cwd,
    dryRun: input.dryRun,
    outcomes,
    reclaimedBytes: outcomes
      .filter((outcome) => outcome.status === "removed")
      .reduce((total, outcome) => total + (outcome.bytes ?? 0), 0),
  };
  if (!input.dryRun && outcomes.some((outcome) => outcome.status !== "skipped"))
    await appendRun(deps.historyFile, run).catch(() => undefined);
  return run;
}
