// Adapted from Orca (MIT, (c) 2026 Lovecast Inc.) — src/main/workspaces/cleanup/workspace-cleanup-scan-snapshot.ts
import type {
  WorkspaceCleanupEvidence,
  WorkspaceCleanupReason,
  WorkspaceCleanupRules,
  WorkspaceCleanupVerdict,
} from "@tabs/contracts";

const DAY_MS = 86_400_000;

export interface WorkspaceCleanupClassification {
  readonly verdict: WorkspaceCleanupVerdict;
  readonly reasons: ReadonlyArray<WorkspaceCleanupReason>;
}

/** Newest sign of life: a commit, a thread turn or terminal output. */
export function lastActivityAt(evidence: WorkspaceCleanupEvidence): number | null {
  const times = [
    evidence.lastCommitAt,
    evidence.lastThreadActivityAt,
    evidence.lastTerminalActivityAt,
  ].filter((value): value is number => value !== null);
  return times.length === 0 ? null : Math.max(...times);
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Turns evidence into a verdict. Pure so every rule is unit-testable.
 *
 * - keep: something blocks removal, or no rule says this checkout is finished with.
 * - confirm: a rule says it is finished, but removal would lose work the user must approve per item.
 * - safe: a rule says it is finished and nothing would be lost.
 */
export function classifyWorktree(
  evidence: WorkspaceCleanupEvidence,
  rules: WorkspaceCleanupRules,
  now: number,
): WorkspaceCleanupClassification {
  const reasons: WorkspaceCleanupReason[] = [];
  const add = (
    kind: WorkspaceCleanupReason["kind"],
    code: WorkspaceCleanupReason["code"],
    detail: string,
  ) => reasons.push({ kind, code, detail });

  if (evidence.main) add("block", "main-checkout", "This is the main checkout of the repository.");
  if (evidence.projectRoot) add("block", "project-root", "A Tabs project is rooted here.");
  if (!evidence.managed && !evidence.main)
    add("block", "not-managed", "Tabs did not create this worktree, so it is left alone.");
  if (evidence.locked) add("block", "locked", "Git has this worktree locked.");
  if (evidence.error) add("block", "inspection-failed", `Could not inspect it: ${evidence.error}`);
  if (evidence.missing)
    add(
      "block",
      "missing-directory",
      "Git lists this worktree but its folder is missing. Run `git worktree prune`.",
    );
  if (evidence.openThreads > 0)
    add(
      "block",
      "active-thread",
      `${plural(evidence.openThreads, "open thread")} still use this worktree.`,
    );
  if (evidence.liveSessions > 0)
    add(
      "block",
      "live-session",
      `${plural(evidence.liveSessions, "agent session")} running in this worktree.`,
    );
  if (evidence.runningTerminals > 0)
    add(
      "block",
      "running-terminal",
      `${plural(evidence.runningTerminals, "terminal")} running in this worktree.`,
    );
  if (evidence.pullRequest === "open")
    add("keep", "pull-request-open", "Its pull request is still open.");

  const blocked = reasons.some((reason) => reason.kind === "block");
  const blockedByState = blocked || evidence.pullRequest === "open";

  if (evidence.dirty) {
    const detail = `${plural(evidence.dirtyFileCount, "file")} with uncommitted changes.`;
    if (rules.keepIfDirty) add("block", "dirty", `${detail} Kept by the keep-if-dirty rule.`);
    else add("risk", "dirty", detail);
  }
  if (evidence.unpushedCommits > 0) {
    const detail = `${plural(evidence.unpushedCommits, "commit")} not on any remote.`;
    if (rules.keepIfUnpushed)
      add("block", "unpushed", `${detail} Kept by the keep-if-unpushed rule.`);
    else add("risk", "unpushed", detail);
  }
  if (evidence.ignoredFiles)
    add("risk", "ignored-files", "Contains ignored files that are not reproducible dependencies.");

  const removeReasons: WorkspaceCleanupReason[] = [];
  if (rules.removeWhenPullRequestMerged && evidence.pullRequest === "merged")
    removeReasons.push({
      kind: "remove",
      code: "pull-request-merged",
      detail: "Its pull request was merged.",
    });
  if (rules.removeWhenPullRequestClosed && evidence.pullRequest === "closed")
    removeReasons.push({
      kind: "remove",
      code: "pull-request-closed",
      detail: "Its pull request was closed without merging.",
    });
  if (rules.removeWhenBranchMerged && evidence.branchMerged === true)
    removeReasons.push({
      kind: "remove",
      code: "branch-merged",
      detail: "Every commit is already on the default branch.",
    });
  const activity = lastActivityAt(evidence);
  let recent = false;
  if (rules.removeWhenStale) {
    if (activity !== null && now - activity >= rules.staleAfterDays * DAY_MS)
      removeReasons.push({
        kind: "remove",
        code: "stale",
        detail: `No activity for ${Math.floor((now - activity) / DAY_MS)} days (limit ${rules.staleAfterDays}).`,
      });
    else if (activity !== null) recent = true;
  }
  reasons.unshift(...removeReasons);

  if (removeReasons.length === 0 && !blockedByState) {
    if (recent) add("keep", "recent-activity", "Active within the stale limit.");
    else add("keep", "no-rule-matched", "No cleanup rule applies to this worktree.");
  }

  const kept =
    blockedByState ||
    removeReasons.length === 0 ||
    reasons.some((reason) => reason.kind === "block");
  if (kept) return { verdict: "keep", reasons };
  return {
    verdict: reasons.some((reason) => reason.kind === "risk") ? "confirm" : "safe",
    reasons,
  };
}
