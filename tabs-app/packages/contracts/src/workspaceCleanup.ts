// Adapted from Orca (MIT, (c) 2026 Lovecast Inc.) — src/main/workspaces/cleanup/*
import * as Schema from "effect/Schema";

/** Rules that turn worktree evidence into a verdict. Sent with every scan and apply. */
export const WorkspaceCleanupRules = Schema.Struct({
  /** A worktree with no commit or thread activity for this many days counts as stale. */
  staleAfterDays: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3650 })),
  removeWhenBranchMerged: Schema.Boolean,
  removeWhenPullRequestMerged: Schema.Boolean,
  removeWhenPullRequestClosed: Schema.Boolean,
  removeWhenStale: Schema.Boolean,
  /** When true uncommitted changes block removal outright; when false they need a per-item confirm. */
  keepIfDirty: Schema.Boolean,
  /** When true unpushed commits block removal outright; when false they need a per-item confirm. */
  keepIfUnpushed: Schema.Boolean,
});
export type WorkspaceCleanupRules = typeof WorkspaceCleanupRules.Type;

export const DEFAULT_WORKSPACE_CLEANUP_RULES: WorkspaceCleanupRules = {
  staleAfterDays: 14,
  removeWhenBranchMerged: true,
  removeWhenPullRequestMerged: true,
  removeWhenPullRequestClosed: true,
  removeWhenStale: true,
  keepIfDirty: true,
  keepIfUnpushed: true,
};

export const WorkspaceCleanupPullRequestState = Schema.Literals(["open", "closed", "merged"]);
export type WorkspaceCleanupPullRequestState = typeof WorkspaceCleanupPullRequestState.Type;

/** Raw facts about one worktree. Classification is a pure function of these and the rules. */
export const WorkspaceCleanupEvidence = Schema.Struct({
  /** Inside a Tabs worktrees directory or referenced by a Tabs thread. */
  managed: Schema.Boolean,
  main: Schema.Boolean,
  locked: Schema.Boolean,
  /** Git still lists the worktree but its directory is gone. */
  missing: Schema.Boolean,
  /** The path is, or contains, a project root. */
  projectRoot: Schema.Boolean,
  detached: Schema.Boolean,
  /** Evidence could not be read; never removable. */
  error: Schema.NullOr(Schema.String),
  /** null when no default branch could be resolved. */
  branchMerged: Schema.NullOr(Schema.Boolean),
  pullRequest: Schema.NullOr(WorkspaceCleanupPullRequestState),
  lastCommitAt: Schema.NullOr(Schema.Number),
  lastThreadActivityAt: Schema.NullOr(Schema.Number),
  dirty: Schema.Boolean,
  dirtyFileCount: Schema.Number,
  /** Ignored files other than reproducible dependency installs. */
  ignoredFiles: Schema.Boolean,
  unpushedCommits: Schema.Number,
  openThreads: Schema.Number,
  settledThreads: Schema.Number,
  liveSessions: Schema.Number,
  runningTerminals: Schema.Number,
  lastTerminalActivityAt: Schema.NullOr(Schema.Number),
  diskBytes: Schema.NullOr(Schema.Number),
});
export type WorkspaceCleanupEvidence = typeof WorkspaceCleanupEvidence.Type;

export const WorkspaceCleanupVerdict = Schema.Literals(["safe", "confirm", "keep"]);
export type WorkspaceCleanupVerdict = typeof WorkspaceCleanupVerdict.Type;

export const WorkspaceCleanupReasonCode = Schema.Literals([
  "branch-merged",
  "pull-request-merged",
  "pull-request-closed",
  "stale",
  "main-checkout",
  "locked",
  "project-root",
  "not-managed",
  "inspection-failed",
  "active-thread",
  "live-session",
  "running-terminal",
  "dirty",
  "unpushed",
  "ignored-files",
  "pull-request-open",
  "recent-activity",
  "no-rule-matched",
  "missing-directory",
]);
export type WorkspaceCleanupReasonCode = typeof WorkspaceCleanupReasonCode.Type;

/**
 * remove: evidence in favour of removal. block: never removable. risk: removable only with a
 * per-item confirm. keep: a rule or fact that argues for keeping it.
 */
export const WorkspaceCleanupReason = Schema.Struct({
  code: WorkspaceCleanupReasonCode,
  kind: Schema.Literals(["remove", "block", "risk", "keep"]),
  detail: Schema.String,
});
export type WorkspaceCleanupReason = typeof WorkspaceCleanupReason.Type;

export const WorkspaceCleanupItem = Schema.Struct({
  /** Binds the preview to the exact checkout state (path plus HEAD). */
  id: Schema.String,
  path: Schema.String,
  branch: Schema.NullOr(Schema.String),
  head: Schema.String,
  verdict: WorkspaceCleanupVerdict,
  reasons: Schema.Array(WorkspaceCleanupReason),
  evidence: WorkspaceCleanupEvidence,
});
export type WorkspaceCleanupItem = typeof WorkspaceCleanupItem.Type;

export const WorkspaceCleanupScanInput = Schema.Struct({
  cwd: Schema.String,
  rules: WorkspaceCleanupRules,
  /** Paging cursor: how many worktrees earlier pages already returned. */
  offset: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
  includePullRequests: Schema.Boolean,
});
export type WorkspaceCleanupScanInput = typeof WorkspaceCleanupScanInput.Type;

export const WorkspaceCleanupScanResult = Schema.Struct({
  items: Schema.Array(WorkspaceCleanupItem),
  total: Schema.Number,
  /** null when this was the last page. */
  nextOffset: Schema.NullOr(Schema.Number),
  scannedAt: Schema.Number,
});
export type WorkspaceCleanupScanResult = typeof WorkspaceCleanupScanResult.Type;

export const WorkspaceCleanupApplySelection = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  /** The user confirmed this item despite its risks. */
  confirmed: Schema.Boolean,
});

export const WorkspaceCleanupApplyInput = Schema.Struct({
  cwd: Schema.String,
  rules: WorkspaceCleanupRules,
  selections: Schema.Array(WorkspaceCleanupApplySelection).check(Schema.isMaxLength(500)),
  /** Evaluate and report what would happen without removing anything. */
  dryRun: Schema.Boolean,
});
export type WorkspaceCleanupApplyInput = typeof WorkspaceCleanupApplyInput.Type;

export const WorkspaceCleanupOutcome = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  branch: Schema.NullOr(Schema.String),
  status: Schema.Literals(["removed", "would-remove", "skipped", "failed"]),
  /** Removed with `git worktree remove --force` after a per-item confirm. */
  forced: Schema.Boolean,
  bytes: Schema.NullOr(Schema.Number),
  detail: Schema.NullOr(Schema.String),
});
export type WorkspaceCleanupOutcome = typeof WorkspaceCleanupOutcome.Type;

export const WorkspaceCleanupRun = Schema.Struct({
  id: Schema.String,
  at: Schema.Number,
  cwd: Schema.String,
  dryRun: Schema.Boolean,
  outcomes: Schema.Array(WorkspaceCleanupOutcome),
  reclaimedBytes: Schema.Number,
});
export type WorkspaceCleanupRun = typeof WorkspaceCleanupRun.Type;

export const WorkspaceCleanupHistoryInput = Schema.Struct({
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
});
export type WorkspaceCleanupHistoryInput = typeof WorkspaceCleanupHistoryInput.Type;
export const WorkspaceCleanupHistoryResult = Schema.Array(WorkspaceCleanupRun);
export type WorkspaceCleanupHistoryResult = typeof WorkspaceCleanupHistoryResult.Type;
