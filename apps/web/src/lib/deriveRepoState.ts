export type RepoStateKind =
  | "git_not_installed"
  | "not_a_repo"
  | "rebase_in_progress"
  | "merge_in_progress"
  | "cherry_pick_in_progress"
  | "empty_repo"
  | "detached_head"
  | "no_remote"
  | "gh_not_authenticated"
  | "read_only_remote"
  | "diverged"
  | "behind_only"
  | "ahead_only"
  | "clean_ready";

export interface RepoNotice {
  id: string;
  severity: "warning" | "info";
  message: string;
  actionLabel?: string;
  actionType?: string;
}

export type RepoActionType =
  | "install_git"
  | "init_repo"
  | "resolve_conflicts"
  | "create_branch"
  | "add_remote"
  | "sign_in_gh"
  | "create_fork"
  | "pull_merge"
  | "push";

export interface RepoStateDetails {
  kind: RepoStateKind;
  severity: "error" | "warning" | "info" | "success";
  title: string;
  description: string;

  canCommitLocally: boolean;
  canPush: boolean;
  canForcePush: boolean;
  canPull: boolean;
  canCreatePR: boolean;

  commitButtonLabel: string;
  pushDisabledReason?: string;
  prDisabledReason?: string;

  primaryAction?: {
    label: string;
    actionType: RepoActionType;
  };

  secondaryNotices: RepoNotice[];
}

export interface DeriveRepoStateParams {
  isGitInstalled: boolean;
  isRepo: boolean;
  hasConflict: boolean;
  conflictedFilesCount?: number;
  stagedFilesCount?: number;
  unstagedFilesCount?: number;
  operationState?: "rebase" | "merge" | "cherry-pick" | "revert" | null;
  isEmptyRepo?: boolean;
  isDetached: boolean;
  hasRemote: boolean;
  remoteName: string;
  ghAuthed: boolean;
  pushAccess: "write" | "read_only" | "unknown";
  aheadCount: number;
  behindCount: number;
}

export function deriveRepoState(params: DeriveRepoStateParams): RepoStateDetails {
  const secondaryNotices: RepoNotice[] = [];
  const totalChanged = (params.stagedFilesCount ?? 0) + (params.unstagedFilesCount ?? 0);

  // 1. Git binary missing
  if (!params.isGitInstalled) {
    return {
      kind: "git_not_installed",
      severity: "error",
      title: "Git isn't installed",
      description: "This project can't be tracked until Git is available on this machine.",
      canCommitLocally: false,
      canPush: false,
      canForcePush: false,
      canPull: false,
      canCreatePR: false,
      commitButtonLabel: "Commit staged",
      primaryAction: { label: "Install guide", actionType: "install_git" },
      secondaryNotices: [],
    };
  }

  // 2. Not a git repo
  if (!params.isRepo) {
    return {
      kind: "not_a_repo",
      severity: "info",
      title: "No repository here yet",
      description:
        "Start one to begin recording changes, or clone an existing project into this folder.",
      canCommitLocally: false,
      canPush: false,
      canForcePush: false,
      canPull: false,
      canCreatePR: false,
      commitButtonLabel: "Commit staged",
      primaryAction: { label: "Initialize repository", actionType: "init_repo" },
      secondaryNotices: [],
    };
  }

  // 3. Rebase in progress
  if (params.operationState === "rebase") {
    return {
      kind: "rebase_in_progress",
      severity: "error",
      title: "Rebase in progress",
      description: "Resolve any conflicts in the Changes tab to continue the rebase.",
      canCommitLocally: false,
      canPush: false,
      canForcePush: false,
      canPull: false,
      canCreatePR: false,
      commitButtonLabel: "Commit staged",
      primaryAction: { label: "Open conflicts", actionType: "resolve_conflicts" },
      secondaryNotices: [],
    };
  }

  // 4. Merge conflict in progress
  if (params.operationState === "merge" || params.hasConflict) {
    const conflictsCount = params.conflictedFilesCount ?? 1;
    const allConflictsResolved = conflictsCount === 0 && (params.stagedFilesCount ?? 0) > 0;
    return {
      kind: "merge_in_progress",
      severity: "error",
      title: `Merge in progress — ${conflictsCount} file${conflictsCount === 1 ? "" : "s"} need attention`,
      description: allConflictsResolved
        ? "All conflicts resolved and staged. Complete the merge commit."
        : "Resolve the conflicts in the Changes tab.",
      canCommitLocally: allConflictsResolved,
      canPush: false,
      canForcePush: false,
      canPull: false,
      canCreatePR: false,
      commitButtonLabel: allConflictsResolved ? "Complete merge" : "Commit staged",
      primaryAction: { label: "Open conflicts", actionType: "resolve_conflicts" },
      secondaryNotices: [],
    };
  }

  // 5. Cherry-pick / Revert in progress
  if (params.operationState === "cherry-pick" || params.operationState === "revert") {
    return {
      kind: "cherry_pick_in_progress",
      severity: "error",
      title: `${params.operationState === "revert" ? "Revert" : "Cherry-pick"} in progress`,
      description: "Resolve conflicts or complete the operation in the Changes tab.",
      canCommitLocally: false,
      canPush: false,
      canForcePush: false,
      canPull: false,
      canCreatePR: false,
      commitButtonLabel: "Commit staged",
      primaryAction: { label: "Open conflicts", actionType: "resolve_conflicts" },
      secondaryNotices: [],
    };
  }

  // 6. Empty Repo (0 commits)
  if (params.isEmptyRepo) {
    if (!params.hasRemote) {
      secondaryNotices.push({
        id: "no_remote_notice",
        severity: "warning",
        message: "No remote configured yet.",
        actionLabel: "Add remote",
        actionType: "add_remote",
      });
    }
    return {
      kind: "empty_repo",
      severity: "info",
      title: "Initial commit pending",
      description: "Stage your initial files and commit to create the first history point.",
      canCommitLocally: (params.stagedFilesCount ?? 0) > 0,
      canPush: false,
      canForcePush: false,
      canPull: false,
      canCreatePR: false,
      commitButtonLabel: "Commit staged",
      pushDisabledReason: "Cannot push from an empty repository with no commits",
      prDisabledReason: "Cannot create PR from an empty repository",
      secondaryNotices,
    };
  }

  // 7. Detached HEAD
  if (params.isDetached) {
    if (params.aheadCount > 0) {
      secondaryNotices.push({
        id: "unpushed_notice",
        severity: "warning",
        message: `${params.aheadCount} commit${params.aheadCount === 1 ? "" : "s"} made on detached HEAD`,
      });
    }
    return {
      kind: "detached_head",
      severity: "warning",
      title: "You're not on a branch",
      description:
        "Commits made here won't belong to any branch. Create one from this point to keep your work safe.",
      canCommitLocally: (params.stagedFilesCount ?? 0) > 0,
      canPush: false,
      canForcePush: false,
      canPull: false,
      canCreatePR: false,
      commitButtonLabel: "Commit staged",
      pushDisabledReason: "Cannot push directly from a detached HEAD",
      prDisabledReason: "Cannot create pull request from a detached HEAD",
      primaryAction: { label: "Create branch here", actionType: "create_branch" },
      secondaryNotices,
    };
  }

  // 8. No Remote Configured
  if (!params.hasRemote) {
    if (params.aheadCount > 0) {
      secondaryNotices.push({
        id: "unpushed_local_notice",
        severity: "info",
        message: `${params.aheadCount} unpushed commit${params.aheadCount === 1 ? "" : "s"} stored locally`,
      });
    }
    return {
      kind: "no_remote",
      severity: "warning",
      title: "No remote configured",
      description: "This repo isn't connected to GitHub, so push and pull requests are turned off.",
      canCommitLocally: (params.stagedFilesCount ?? 0) > 0,
      canPush: false,
      canForcePush: false,
      canPull: false,
      canCreatePR: false,
      commitButtonLabel: "Commit staged",
      pushDisabledReason: "No remote configured yet",
      prDisabledReason: "No remote configured yet",
      primaryAction: { label: "Add remote", actionType: "add_remote" },
      secondaryNotices,
    };
  }

  // 9. GitHub CLI Not Authenticated
  if (!params.ghAuthed) {
    if (params.pushAccess === "read_only") {
      // Defensive stale-cache notice
      secondaryNotices.push({
        id: "stale_read_only_notice",
        severity: "warning",
        message: `Cached permission for ${params.remoteName} was read-only`,
      });
    }
    return {
      kind: "gh_not_authenticated",
      severity: "warning",
      title: "Sign in to GitHub to continue",
      description:
        "Pushing, pulling from a remote, and pull requests all need a signed-in GitHub account.",
      canCommitLocally: (params.stagedFilesCount ?? 0) > 0,
      canPush: false,
      canForcePush: false,
      canPull: false,
      canCreatePR: false,
      commitButtonLabel: "Commit staged",
      pushDisabledReason: "Sign in to GitHub to enable remote push",
      prDisabledReason: "Sign in to GitHub to create pull requests",
      primaryAction: { label: "Sign in to GitHub", actionType: "sign_in_gh" },
      secondaryNotices,
    };
  }

  // 10. Read-Only Remote Access
  if (params.pushAccess === "read_only") {
    if (params.behindCount > 0) {
      secondaryNotices.push({
        id: "behind_read_only_notice",
        severity: "info",
        message: `Local branch is ${params.behindCount} commit${params.behindCount === 1 ? "" : "s"} behind ${params.remoteName}`,
      });
    }
    return {
      kind: "read_only_remote",
      severity: "warning",
      title: `Remote ${params.remoteName} (Read-Only)`,
      description: `You have read-only access to this remote. Pushing directly to ${params.remoteName} will fail — create a fork to push your changes.`,
      canCommitLocally: (params.stagedFilesCount ?? 0) > 0,
      canPush: false,
      canForcePush: false,
      canPull: true,
      canCreatePR: true,
      commitButtonLabel: "Commit staged",
      pushDisabledReason: `Push disabled: Read-only access to ${params.remoteName}`,
      primaryAction: { label: "Create Fork", actionType: "create_fork" },
      secondaryNotices,
    };
  }

  // 11. Diverged Branch (Ahead > 0 && Behind > 0)
  if (params.aheadCount > 0 && params.behindCount > 0) {
    if (totalChanged > 200) {
      secondaryNotices.push({
        id: "large_change_notice",
        severity: "info",
        message: `${totalChanged} files changed — staging runs in batches`,
      });
    }
    return {
      kind: "diverged",
      severity: "info",
      title: `Branch has diverged from ${params.remoteName}`,
      description: `You're ${params.aheadCount} commit${params.aheadCount === 1 ? "" : "s"} ahead and ${params.behindCount} behind. Pull before pushing.`,
      canCommitLocally: (params.stagedFilesCount ?? 0) > 0,
      canPush: true,
      canForcePush: true,
      canPull: true,
      canCreatePR: true,
      commitButtonLabel: "Commit staged",
      primaryAction: { label: "Pull", actionType: "pull_merge" },
      secondaryNotices,
    };
  }

  // 12. Behind Only (Ahead === 0 && Behind > 0)
  if (params.aheadCount === 0 && params.behindCount > 0) {
    return {
      kind: "behind_only",
      severity: "info",
      title: `Behind ${params.remoteName}`,
      description: `Your local branch is ${params.behindCount} commit${params.behindCount === 1 ? "" : "s"} behind ${params.remoteName}.`,
      canCommitLocally: (params.stagedFilesCount ?? 0) > 0,
      canPush: true,
      canForcePush: true,
      canPull: true,
      canCreatePR: true,
      commitButtonLabel: "Commit staged",
      primaryAction: { label: "Pull", actionType: "pull_merge" },
      secondaryNotices,
    };
  }

  // 13. Ahead Only (Ahead > 0 && Behind === 0)
  if (params.aheadCount > 0 && params.behindCount === 0) {
    return {
      kind: "ahead_only",
      severity: "info",
      title: `${params.aheadCount} unpushed commit${params.aheadCount === 1 ? "" : "s"}`,
      description: `Ready to push to ${params.remoteName}.`,
      canCommitLocally: (params.stagedFilesCount ?? 0) > 0,
      canPush: true,
      canForcePush: true,
      canPull: true,
      canCreatePR: true,
      commitButtonLabel: "Commit staged",
      primaryAction: { label: "Push", actionType: "push" },
      secondaryNotices,
    };
  }

  // 14. Clean & Ready
  if (totalChanged > 200) {
    secondaryNotices.push({
      id: "large_change_notice",
      severity: "info",
      message: `${totalChanged} files changed — staging runs in batches`,
    });
  }

  return {
    kind: "clean_ready",
    severity: "success",
    title: "Repository up to date",
    description: `Synced with ${params.remoteName}.`,
    canCommitLocally: (params.stagedFilesCount ?? 0) > 0,
    canPush: true,
    canForcePush: true,
    canPull: true,
    canCreatePR: true,
    commitButtonLabel: "Commit staged",
    secondaryNotices,
  };
}
