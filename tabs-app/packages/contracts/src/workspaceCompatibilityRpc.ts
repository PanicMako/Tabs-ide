import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as Git from "./git.ts";
import * as Server from "./server.ts";
import * as SourceControl from "./sourceControl.ts";
import { TerminalSessionSnapshot } from "./terminal.ts";
import { EnvironmentAuthorizationError } from "./auth.ts";

export class WorkspaceCompatibilityError extends Schema.TaggedError<WorkspaceCompatibilityError>()(
  "WorkspaceCompatibilityError",
  { operation: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `${this.operation}: ${this.detail}`;
  }
}

export const WorkspaceCompatibilityRpcs = [
  Rpc.make("terminal.list", {
    payload: Schema.Struct({}),
    success: Schema.Array(TerminalSessionSnapshot),
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.fetch", {
    payload: Git.GitFetchInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.pull", {
    payload: Git.GitPullInput,
    success: Git.GitPullResult,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.listWorkflowRuns", {
    payload: Git.GitListWorkflowRunsInput,
    success: Git.GitListWorkflowRunsResult,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.createWorktree", {
    payload: Git.GitCreateWorktreeInput,
    success: Git.GitCreateWorktreeResult,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.removeWorktree", {
    payload: Git.GitRemoveWorktreeInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.createBranch", {
    payload: Git.GitCreateBranchInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.createFork", {
    payload: Git.GitCreateForkInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.checkout", {
    payload: Git.GitCheckoutInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.renameBranch", {
    payload: Git.GitRenameBranchInput,
    success: Git.GitRenameBranchResult,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.deleteBranch", {
    payload: Git.GitDeleteBranchInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.setBranchUpstream", {
    payload: Git.GitSetBranchUpstreamInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.init", {
    payload: Git.GitInitInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.diff", {
    payload: Git.GitDiffInput,
    success: Git.GitDiffResult,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.stageFiles", {
    payload: Git.GitStageFilesInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.unstageFiles", {
    payload: Git.GitUnstageFilesInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.discardChanges", {
    payload: Git.GitDiscardChangesInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.saveStash", {
    payload: Git.GitStashSaveInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.listStashes", {
    payload: Git.GitStashListInput,
    success: Git.GitStashListResult,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.applyStash", {
    payload: Git.GitApplyStashInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.dropStash", {
    payload: Git.GitDropStashInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.resolveConflict", {
    payload: Git.GitResolveConflictInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.conflictSnapshot", {
    payload: Git.GitConflictSnapshotInput,
    success: Git.GitConflictSnapshotResult,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.applyHunk", {
    payload: Git.GitApplyHunkInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.merge", {
    payload: Git.GitMergeInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.rebase", {
    payload: Git.GitRebaseInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.continueOperation", {
    payload: Git.GitContinueOperationInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.abortOperation", {
    payload: Git.GitAbortOperationInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.skipRebase", {
    payload: Git.GitSkipRebaseInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.listPullRequests", {
    payload: Git.GitListPullRequestsInput,
    success: Git.GitListPullRequestsResult,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.mutatePullRequest", {
    payload: Git.GitMutatePullRequestInput,
    success: Git.GitMutatePullRequestResult,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.createPullRequest", {
    payload: Git.GitCreatePullRequestInput,
    success: Git.GitCreatePullRequestResult,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.push", {
    payload: Git.GitPushInput,
    success: Git.GitPushResult,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.performRepositoryAction", {
    payload: Git.GitRepositoryActionInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.publishRelease", {
    payload: Git.GitPublishReleaseInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.triggerReleaseWorkflow", {
    payload: Git.GitTriggerReleaseWorkflowInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.gitHubSwitchAccount", {
    payload: Git.GitHubSwitchAccountInput,
    success: Git.GitEnvironmentResult,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.gitHubLogout", {
    payload: Git.GitHubLogoutInput,
    success: Git.GitEnvironmentResult,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.amendCommit", {
    payload: Git.GitAmendCommitInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.undoLastCommit", {
    payload: Git.GitUndoLastCommitInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.revertCommit", {
    payload: Git.GitRevertCommitInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.cherryPick", {
    payload: Git.GitCherryPickInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.createTag", {
    payload: Git.GitCreateTagInput,
    success: Schema.Void,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("git.watchedBranchStatuses", {
    payload: Git.GitWatchedBranchStatusesInput,
    success: Git.GitWatchedBranchStatusesResult,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("server.batchUpsertKeybindings", {
    payload: Server.ServerBatchUpsertKeybindingsInput,
    success: Server.ServerBatchUpsertKeybindingsResult,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("server.batchRemoveKeybindings", {
    payload: Server.ServerBatchRemoveKeybindingsInput,
    success: Server.ServerBatchRemoveKeybindingsResult,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("server.cloneRepository", {
    payload: SourceControl.SourceControlCloneRepositoryInput,
    success: SourceControl.SourceControlCloneRepositoryResult,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("server.lookupRepository", {
    payload: SourceControl.SourceControlRepositoryLookupInput,
    success: SourceControl.SourceControlRepositoryInfo,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("server.createSupportBundle", {
    payload: Schema.Struct({}),
    success: Server.ServerSupportBundleResult,
    error: Schema.Union([WorkspaceCompatibilityError, EnvironmentAuthorizationError]),
  }),
] as const;
