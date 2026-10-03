import * as Context from "effect/Context";
/**
 * GitCore - Effect service contract for low-level Git operations.
 *
 * Wraps core repository primitives used by higher-level orchestration
 * services and WebSocket routes.
 *
 * @module GitCore
 */
import type { Effect, Scope } from "effect";
import type {
  GitApplyHunkInput,
  GitApplyStashInput,
  GitAbortOperationInput,
  GitCheckoutInput,
  GitContinueOperationInput,
  GitConflictSnapshotInput,
  GitConflictSnapshotResult,
  GitCreateBranchInput,
  GitCreateForkInput,
  GitDiscardChangesInput,
  GitDiffInput,
  GitDiffResult,
  GitFetchInput,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitDropStashInput,
  GitHistoryInput,
  GitHistoryResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitListWorkflowRunsInput,
  GitListWorkflowRunsResult,
  GitMergeInput,
  GitPullResult,
  GitRebaseInput,
  GitResolveConflictInput,
  GitRemoveWorktreeInput,
  GitSkipRebaseInput,
  GitStashListInput,
  GitStashListResult,
  GitStashSaveInput,
  GitStatusInput,
  GitStatusResult,
  GitStageFilesInput,
  GitUnstageFilesInput,
  GitAmendCommitInput,
  GitUndoLastCommitInput,
  GitRevertCommitInput,
  GitCherryPickInput,
  GitCreateTagInput,
  GitListTagsInput,
  GitListTagsResult,
  GitWatchedBranchStatusesInput,
  GitWatchedBranchStatusesResult,
} from "@tabs/contracts";

import type { GitCommandError } from "../Errors.ts";

export interface ExecuteGitInput {
  readonly operation: string;
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: NodeJS.ProcessEnv;
  readonly allowNonZeroExit?: boolean;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly progress?: ExecuteGitProgress;
}

export interface ExecuteGitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitStatusDetails extends Omit<GitStatusResult, "pr"> {
  upstreamRef: string | null;
}

export interface GitPreparedCommitContext {
  stagedSummary: string;
  stagedPatch: string;
}

export interface ExecuteGitProgress {
  readonly onStdoutLine?: (line: string) => Effect.Effect<void, never>;
  readonly onStderrLine?: (line: string) => Effect.Effect<void, never>;
  readonly onHookStarted?: (hookName: string) => Effect.Effect<void, never>;
  readonly onHookFinished?: (input: {
    hookName: string;
    exitCode: number | null;
    durationMs: number | null;
  }) => Effect.Effect<void, never>;
}

export interface GitCommitProgress {
  readonly onOutputLine?: (input: {
    stream: "stdout" | "stderr";
    text: string;
  }) => Effect.Effect<void, never>;
  readonly onHookStarted?: (hookName: string) => Effect.Effect<void, never>;
  readonly onHookFinished?: (input: {
    hookName: string;
    exitCode: number | null;
    durationMs: number | null;
  }) => Effect.Effect<void, never>;
}

export interface GitCommitOptions {
  readonly timeoutMs?: number;
  readonly progress?: GitCommitProgress;
}

export interface GitPushResult {
  status: "pushed" | "skipped_up_to_date";
  branch: string;
  upstreamBranch?: string | undefined;
  setUpstream?: boolean | undefined;
}

export interface GitRangeContext {
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
}

export interface GitRenameBranchInput {
  cwd: string;
  oldBranch: string;
  newBranch: string;
}

export interface GitRenameBranchResult {
  branch: string;
}

export interface GitFetchPullRequestBranchInput {
  cwd: string;
  prNumber: number;
  branch: string;
}

export interface GitEnsureRemoteInput {
  cwd: string;
  preferredName: string;
  url: string;
}

export interface GitFetchRemoteBranchInput {
  cwd: string;
  remoteName: string;
  remoteBranch: string;
  localBranch: string;
}

export interface GitSetBranchUpstreamInput {
  cwd: string;
  branch: string;
  remoteName: string;
  remoteBranch: string;
}

export interface GitDeleteBranchInput {
  cwd: string;
  branch: string;
  force?: boolean;
}

/**
 * GitCoreShape - Service API for low-level Git repository interactions.
 */
export interface GitCoreShape {
  /**
   * Execute a raw Git command.
   */
  readonly execute: (input: ExecuteGitInput) => Effect.Effect<ExecuteGitResult, GitCommandError>;

  /**
   * Read Git status for a repository.
   */
  readonly status: (input: GitStatusInput) => Effect.Effect<GitStatusResult, GitCommandError>;

  /**
   * Fetch latest remote refs.
   */
  readonly fetchLatest: (input: GitFetchInput) => Effect.Effect<void, GitCommandError>;

  /**
   * Read recent commit history for the current branch.
   */
  readonly history: (input: GitHistoryInput) => Effect.Effect<GitHistoryResult, GitCommandError>;

  /**
   * Read a unified diff for a working-tree file or commit.
   */
  readonly diff: (input: GitDiffInput) => Effect.Effect<GitDiffResult, GitCommandError>;

  /**
   * Stage one or more files.
   */
  readonly stageFiles: (input: GitStageFilesInput) => Effect.Effect<void, GitCommandError>;

  /**
   * Remove one or more files from the index.
   */
  readonly unstageFiles: (input: GitUnstageFilesInput) => Effect.Effect<void, GitCommandError>;

  /**
   * Discard staged/unstaged/untracked changes for selected files or the whole repository.
   */
  readonly discardChanges: (input: GitDiscardChangesInput) => Effect.Effect<void, GitCommandError>;

  /**
   * Amend the most recent commit, optionally replacing its message. Uses
   * currently-staged changes.
   */
  readonly amendCommit: (input: GitAmendCommitInput) => Effect.Effect<void, GitCommandError>;

  /**
   * Undo the most recent commit, keeping its changes staged (soft reset).
   */
  readonly undoLastCommit: (input: GitUndoLastCommitInput) => Effect.Effect<void, GitCommandError>;

  /**
   * Revert a commit by creating a new commit that undoes its changes.
   */
  readonly revertCommit: (input: GitRevertCommitInput) => Effect.Effect<void, GitCommandError>;

  /**
   * Apply the changes of an existing commit onto the current branch.
   */
  readonly cherryPick: (input: GitCherryPickInput) => Effect.Effect<void, GitCommandError>;

  readonly createTag: (input: GitCreateTagInput) => Effect.Effect<void, GitCommandError>;

  /**
   * List all tags in the repository using git tag -l.
   */
  readonly listTags: (input: GitListTagsInput) => Effect.Effect<GitListTagsResult, GitCommandError>;

  /**
   * Compare HEAD against watched branches to surface divergence (ahead/behind counts).
   */
  readonly watchedBranchStatuses: (
    input: GitWatchedBranchStatusesInput,
  ) => Effect.Effect<GitWatchedBranchStatusesResult, GitCommandError>;

  /**
   * Save a stash entry.
   */
  readonly saveStash: (input: GitStashSaveInput) => Effect.Effect<void, GitCommandError>;

  /**
   * List stash entries.
   */
  readonly listStashes: (
    input: GitStashListInput,
  ) => Effect.Effect<GitStashListResult, GitCommandError>;

  /**
   * Apply or pop a stash entry.
   */
  readonly applyStash: (input: GitApplyStashInput) => Effect.Effect<void, GitCommandError>;

  /**
   * Drop a stash entry.
   */
  readonly dropStash: (input: GitDropStashInput) => Effect.Effect<void, GitCommandError>;

  /**
   * Resolve a conflicted file by choosing ours or theirs and staging the result.
   */
  readonly resolveConflict: (
    input: GitResolveConflictInput,
  ) => Effect.Effect<void, GitCommandError>;

  /**
   * Read base / ours / theirs file contents for a conflicted path.
   */
  readonly readConflictSnapshot: (
    input: GitConflictSnapshotInput,
  ) => Effect.Effect<GitConflictSnapshotResult, GitCommandError>;

  /**
   * Apply a single hunk patch to the index or working tree.
   */
  readonly applyHunk: (input: GitApplyHunkInput) => Effect.Effect<void, GitCommandError>;

  /**
   * Merge the selected branch into the current branch.
   */
  readonly mergeBranch: (input: GitMergeInput) => Effect.Effect<void, GitCommandError>;

  /**
   * Rebase the current branch onto the selected branch.
   */
  readonly rebaseBranch: (input: GitRebaseInput) => Effect.Effect<void, GitCommandError>;

  /**
   * Continue the active merge or rebase operation.
   */
  readonly continueOperation: (
    input: GitContinueOperationInput,
  ) => Effect.Effect<void, GitCommandError>;

  /**
   * Abort the active merge or rebase operation.
   */
  readonly abortOperation: (input: GitAbortOperationInput) => Effect.Effect<void, GitCommandError>;

  /**
   * Skip the current rebase step.
   */
  readonly skipRebase: (input: GitSkipRebaseInput) => Effect.Effect<void, GitCommandError>;

  /**
   * Read detailed working tree / branch status for a repository.
   */
  readonly statusDetails: (cwd: string) => Effect.Effect<GitStatusDetails, GitCommandError>;

  /**
   * Build staged change context for commit generation.
   */
  readonly prepareCommitContext: (
    cwd: string,
    filePaths?: readonly string[],
  ) => Effect.Effect<GitPreparedCommitContext | null, GitCommandError>;

  /**
   * Create a commit with provided subject/body.
   */
  readonly commit: (
    cwd: string,
    subject: string,
    body: string,
    options?: GitCommitOptions,
  ) => Effect.Effect<{ commitSha: string }, GitCommandError>;

  /**
   * Push current branch, setting upstream if needed.
   */
  readonly pushCurrentBranch: (
    cwd: string,
    fallbackBranch: string | null,
  ) => Effect.Effect<GitPushResult, GitCommandError>;

  /**
   * Collect commit/diff context between base branch and current HEAD.
   */
  readonly readRangeContext: (
    cwd: string,
    baseBranch: string,
  ) => Effect.Effect<GitRangeContext, GitCommandError>;

  /**
   * Read a Git config value from the local repository.
   */
  readonly readConfigValue: (
    cwd: string,
    key: string,
  ) => Effect.Effect<string | null, GitCommandError>;

  /**
   * List local + remote branches and branch metadata.
   */
  readonly listBranches: (
    input: GitListBranchesInput,
  ) => Effect.Effect<GitListBranchesResult, GitCommandError>;

  /**
   * Pull current branch from upstream using fast-forward only.
   */
  readonly pullCurrentBranch: (cwd: string) => Effect.Effect<GitPullResult, GitCommandError>;

  /**
   * Create a worktree and branch from a base branch.
   */
  readonly createWorktree: (
    input: GitCreateWorktreeInput,
  ) => Effect.Effect<GitCreateWorktreeResult, GitCommandError>;

  /**
   * Materialize a GitHub pull request head as a local branch without switching checkout.
   */
  readonly fetchPullRequestBranch: (
    input: GitFetchPullRequestBranchInput,
  ) => Effect.Effect<void, GitCommandError>;

  /**
   * List GitHub Actions workflow runs for a branch.
   */
  readonly listWorkflowRuns: (
    input: GitListWorkflowRunsInput,
  ) => Effect.Effect<GitListWorkflowRunsResult, GitCommandError>;

  /**
   * Ensure a named remote exists for the provided URL, returning the reused or created remote name.
   */
  readonly ensureRemote: (input: GitEnsureRemoteInput) => Effect.Effect<string, GitCommandError>;

  /**
   * Fetch a remote branch into a local branch without checkout.
   */
  readonly fetchRemoteBranch: (
    input: GitFetchRemoteBranchInput,
  ) => Effect.Effect<void, GitCommandError>;

  /**
   * Set the upstream tracking branch for a local branch.
   */
  readonly setBranchUpstream: (
    input: GitSetBranchUpstreamInput,
  ) => Effect.Effect<void, GitCommandError>;

  /**
   * Remove an existing worktree.
   */
  readonly removeWorktree: (input: GitRemoveWorktreeInput) => Effect.Effect<void, GitCommandError>;

  /**
   * Rename an existing local branch.
   */
  readonly renameBranch: (
    input: GitRenameBranchInput,
  ) => Effect.Effect<GitRenameBranchResult, GitCommandError>;

  /**
   * Delete an existing local branch.
   */
  readonly deleteBranch: (input: GitDeleteBranchInput) => Effect.Effect<void, GitCommandError>;

  /**
   * Create a local branch.
   */
  readonly createBranch: (input: GitCreateBranchInput) => Effect.Effect<void, GitCommandError>;

  /**
   * Fork repository on GitHub and add local remote.
   */
  readonly createFork: (input: GitCreateForkInput) => Effect.Effect<void, GitCommandError>;

  /**
   * Checkout an existing branch and refresh its upstream metadata in background.
   */
  readonly checkoutBranch: (
    input: GitCheckoutInput,
  ) => Effect.Effect<void, GitCommandError, Scope.Scope>;

  /**
   * Initialize a repository in the provided directory.
   */
  readonly initRepo: (input: GitInitInput) => Effect.Effect<void, GitCommandError>;

  /**
   * List local branch names (short format).
   */
  readonly listLocalBranchNames: (cwd: string) => Effect.Effect<string[], GitCommandError>;
}

/**
 * GitCore - Service tag for low-level Git repository operations.
 */
export class GitCore extends Context.Service<GitCore, GitCoreShape>()(
  "tabs/git/Services/GitCore",
) {}
