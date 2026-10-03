import type { GitListBranchesResult, GitStackedAction, GitStatusResult } from "@tabs/contracts";

export type GitCommitComposerActionId = "commit" | "commit_push" | "commit_push_pr" | "open_pr";

export interface GitCommitComposerActionState {
  id: GitCommitComposerActionId;
  label: string;
  description: string;
  disabled: boolean;
  disabledReason: string | null;
  kind: "run_action" | "open_pr";
  action?: GitStackedAction;
  modeAvailability?: "basic" | "advanced" | "both";
  riskLevel?: "safe" | "risky" | "destructive";
  requiresTypedConfirm?: boolean;
}

export interface GitCommitComposerState {
  actions: [
    GitCommitComposerActionState,
    GitCommitComposerActionState,
    GitCommitComposerActionState,
  ];
  isDefaultBranch: boolean;
}

export interface GitPrimaryActionState {
  id: GitCommitComposerActionState["id"];
  label: string;
  disabled: boolean;
  disabledReason: string | null;
}

function resolveDefaultBranchStatus(
  gitStatus: GitStatusResult | null,
  branchList: GitListBranchesResult | null,
): boolean {
  const branchName = gitStatus?.branch;
  if (!branchName) return false;
  const currentBranch = branchList?.branches.find((branch) => branch.name === branchName);
  return currentBranch?.isDefault ?? (branchName === "main" || branchName === "master");
}

function resolveSharedDisabledReason(input: {
  gitStatus: GitStatusResult | null;
  isBusy: boolean;
}): string | null {
  if (input.isBusy) return "Git action in progress.";
  if (!input.gitStatus) return "Git status is unavailable.";
  if (input.gitStatus.operation) {
    return `A ${input.gitStatus.operation.kind} is in progress. Continue or abort it from the Git tab first.`;
  }
  if ((input.gitStatus.conflicted?.files.length ?? 0) > 0) {
    return "Resolve conflicted files before using commit, push, or PR actions.";
  }
  return null;
}

export function buildGitCommitComposerState(input: {
  gitStatus: GitStatusResult | null;
  branchList: GitListBranchesResult | null;
  isBusy: boolean;
  stagedCount: number;
}): GitCommitComposerState {
  const { gitStatus, branchList, isBusy, stagedCount } = input;
  const hasOriginRemote = branchList?.hasOriginRemote ?? false;
  const hasWorkingTreeChanges = gitStatus?.hasWorkingTreeChanges ?? false;
  const hasBranch = gitStatus?.branch !== null;
  const hasOpenPr = gitStatus?.pr?.state === "open";
  const isAhead = (gitStatus?.aheadCount ?? 0) > 0;
  const isBehind = (gitStatus?.behindCount ?? 0) > 0;
  const canPushWithoutUpstream = !!gitStatus && !gitStatus.hasUpstream && hasOriginRemote;
  const sharedDisabledReason = resolveSharedDisabledReason({ gitStatus, isBusy });
  const stageFirstReason =
    stagedCount === 0 && hasWorkingTreeChanges ? "Stage files in Changes first." : null;
  const isDefaultBranch = resolveDefaultBranchStatus(gitStatus, branchList);

  const commitDisabledReason =
    sharedDisabledReason ??
    (stagedCount > 0
      ? null
      : hasWorkingTreeChanges
        ? "Stage files in Changes first."
        : "Nothing staged for a commit.");

  const commitPushDisabledReason =
    sharedDisabledReason ??
    stageFirstReason ??
    (!hasBranch
      ? "Detached HEAD: checkout a branch before pushing."
      : isBehind
        ? "Branch is behind upstream. Pull, merge, or rebase before pushing."
        : !gitStatus?.hasUpstream && !hasOriginRemote
          ? 'Add an "origin" remote before pushing.'
          : stagedCount === 0 && !isAhead
            ? "No local commits to push."
            : null);

  const commitPrDisabledReason = hasOpenPr
    ? null
    : (sharedDisabledReason ??
      stageFirstReason ??
      (!hasBranch
        ? "Detached HEAD: checkout a branch before creating a PR."
        : isBehind
          ? "Branch is behind upstream. Pull, merge, or rebase before creating a PR."
          : !gitStatus?.hasUpstream && !hasOriginRemote
            ? 'Add an "origin" remote before creating a PR.'
            : stagedCount === 0 && !isAhead
              ? "No local commits to include in a PR."
              : null));

  return {
    isDefaultBranch,
    actions: [
      {
        id: "commit",
        label: stagedCount > 0 ? "Commit Staged" : "Commit Staged",
        description:
          stagedCount > 0
            ? `Create one commit from ${stagedCount} staged file${stagedCount === 1 ? "" : "s"}.`
            : "Create a commit from the staged set once files are added in Changes.",
        disabled: commitDisabledReason !== null,
        disabledReason: commitDisabledReason,
        kind: "run_action",
        action: "commit",
        modeAvailability: "both",
        riskLevel: "safe",
      },
      {
        id: "commit_push",
        label: stagedCount > 0 ? "Commit & Push" : "Push Branch",
        description:
          stagedCount > 0
            ? "Create a commit from the staged set, then push the branch."
            : "Push existing local commits to the tracked branch.",
        disabled: commitPushDisabledReason !== null,
        disabledReason: commitPushDisabledReason,
        kind: "run_action",
        action: "commit_push",
        modeAvailability: "both",
        riskLevel: "safe",
      },
      hasOpenPr
        ? {
            id: "open_pr",
            label: "View PR",
            description: gitStatus?.pr?.number
              ? `Open PR #${gitStatus.pr.number} for this branch.`
              : "Open the existing pull request for this branch.",
            disabled: sharedDisabledReason !== null,
            disabledReason: sharedDisabledReason,
            kind: "open_pr",
            modeAvailability: "both",
            riskLevel: "safe",
          }
        : {
            id: "commit_push_pr",
            label: stagedCount > 0 ? "Commit, Push & PR" : "Push & Create PR",
            description:
              stagedCount > 0
                ? "Commit the staged set, push the branch, and open a pull request."
                : "Push existing local commits and open a pull request.",
            disabled: commitPrDisabledReason !== null,
            disabledReason: commitPrDisabledReason,
            kind: "run_action",
            action: "commit_push_pr",
            modeAvailability: "both",
            riskLevel: "safe",
          },
    ],
  };
}

export function resolveGitPrimaryActionState(state: GitCommitComposerState): GitPrimaryActionState {
  const [commit, commitPush, commitPushPr] = state.actions;
  if (!commit.disabled) {
    return {
      id: commit.id,
      label: commit.label,
      disabled: false,
      disabledReason: null,
    };
  }
  if (!commitPush.disabled) {
    return {
      id: commitPush.id,
      label: commitPush.label,
      disabled: false,
      disabledReason: null,
    };
  }
  if (!commitPushPr.disabled) {
    return {
      id: commitPushPr.id,
      label: commitPushPr.label,
      disabled: false,
      disabledReason: null,
    };
  }
  return {
    id: commit.id,
    label: commit.label,
    disabled: true,
    disabledReason: commit.disabledReason,
  };
}
