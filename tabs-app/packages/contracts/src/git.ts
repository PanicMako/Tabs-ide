import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import {
  SourceControlProviderError,
  SourceControlProviderInfo,
  SourceControlProviderKind,
} from "./sourceControl.ts";
import { ModelSelection } from "./modelSelection.ts";
import { VcsDriverKind } from "./vcs.ts";

const TrimmedNonEmptyStringSchema = TrimmedNonEmptyString;
const GIT_LIST_BRANCHES_MAX_LIMIT = 200;

// Domain Types

export const GitStackedAction = Schema.Literals([
  "commit",
  "push",
  "create_pr",
  "commit_push",
  "commit_push_pr",
]);
export type GitStackedAction = typeof GitStackedAction.Type;
export const GitActionProgressPhase = Schema.Literals(["branch", "commit", "push", "pr"]);
export type GitActionProgressPhase = typeof GitActionProgressPhase.Type;
export const GitActionProgressKind = Schema.Literals([
  "action_started",
  "phase_started",
  "hook_started",
  "hook_output",
  "hook_finished",
  "action_finished",
  "action_failed",
]);
export type GitActionProgressKind = typeof GitActionProgressKind.Type;
export const GitActionProgressStream = Schema.Literals(["stdout", "stderr"]);
export type GitActionProgressStream = typeof GitActionProgressStream.Type;
const GitCommitStepStatus = Schema.Literals([
  "created",
  "skipped_no_changes",
  "skipped_not_requested",
]);
const GitPushStepStatus = Schema.Literals([
  "pushed",
  "skipped_not_requested",
  "skipped_up_to_date",
]);
const GitBranchStepStatus = Schema.Literals(["created", "skipped_not_requested"]);
const GitPrStepStatus = Schema.Literals(["created", "opened_existing", "skipped_not_requested"]);
const VcsStatusChangeRequestState = Schema.Literals(["open", "closed", "merged"]);
const GitPullRequestReference = TrimmedNonEmptyStringSchema;
const GitPullRequestState = Schema.Literals(["open", "closed", "merged"]);
const GitPreparePullRequestThreadMode = Schema.Literals(["local", "worktree"]);
export const GitRunStackedActionToastRunAction = Schema.Struct({
  kind: GitStackedAction,
});
export type GitRunStackedActionToastRunAction = typeof GitRunStackedActionToastRunAction.Type;
const GitRunStackedActionToastCta = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("none"),
  }),
  Schema.Struct({
    kind: Schema.Literal("open_pr"),
    label: TrimmedNonEmptyStringSchema,
    url: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("run_action"),
    label: TrimmedNonEmptyStringSchema,
    action: GitRunStackedActionToastRunAction,
  }),
]);
export type GitRunStackedActionToastCta = typeof GitRunStackedActionToastCta.Type;
const GitRunStackedActionToast = Schema.Struct({
  title: TrimmedNonEmptyStringSchema,
  description: Schema.optional(TrimmedNonEmptyStringSchema),
  cta: GitRunStackedActionToastCta,
});
export type GitRunStackedActionToast = typeof GitRunStackedActionToast.Type;

export const VcsRef = Schema.Struct({
  name: TrimmedNonEmptyStringSchema,
  isRemote: Schema.optional(Schema.Boolean),
  remoteName: Schema.optional(TrimmedNonEmptyStringSchema),
  current: Schema.Boolean,
  isDefault: Schema.Boolean,
  worktreePath: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
});
export type VcsRef = typeof VcsRef.Type;

const VcsWorktree = Schema.Struct({
  path: TrimmedNonEmptyStringSchema,
  refName: TrimmedNonEmptyStringSchema,
});

const GitStatusPrState = Schema.Literals(["open", "closed", "merged"]);
export const GitOperationKind = Schema.Literals(["merge", "rebase"]);
const GitOperationStatus = Schema.Literals(["in_progress", "conflicted"]);
export const GitConflictResolutionSide = Schema.Literals(["ours", "theirs"]);
export const GitBranch = Schema.Struct({
  name: TrimmedNonEmptyStringSchema,
  isRemote: Schema.optional(Schema.Boolean),
  remoteName: Schema.optional(TrimmedNonEmptyStringSchema),
  current: Schema.Boolean,
  isDefault: Schema.Boolean,
  worktreePath: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
});
const GitWorktree = Schema.Struct({
  path: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
});
export const GitPullRequestActor = Schema.Struct({
  id: Schema.optional(TrimmedNonEmptyStringSchema),
  login: TrimmedNonEmptyStringSchema,
  avatarUrl: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
});
export const GitPullRequestLabel = Schema.Struct({
  name: TrimmedNonEmptyStringSchema,
  color: Schema.optional(Schema.String),
  description: Schema.optional(Schema.NullOr(Schema.String)),
});
export const GitPullRequestChecksState = Schema.Literals(["passing", "failing", "pending"]);
export const GitPullRequestReviewDecision = Schema.Literals([
  "approved",
  "changes_requested",
  "review_required",
]);
export const GitPullRequestMergeability = Schema.Literals(["mergeable", "conflicting", "unknown"]);
export const GitPullRequestCheck = Schema.Struct({
  name: TrimmedNonEmptyStringSchema,
  status: Schema.Literals(["queued", "in_progress", "completed", "unknown"]),
  conclusion: Schema.optional(Schema.String),
  detailsUrl: Schema.optional(Schema.String),
  workflowName: Schema.optional(Schema.String),
});
export const GitPullRequestComment = Schema.Struct({
  id: TrimmedNonEmptyStringSchema,
  author: Schema.NullOr(GitPullRequestActor),
  body: Schema.String,
  createdAt: Schema.String,
  url: Schema.optional(Schema.String),
});
export const GitPullRequestReview = Schema.Struct({
  id: TrimmedNonEmptyStringSchema,
  author: Schema.NullOr(GitPullRequestActor),
  body: Schema.String,
  state: Schema.String,
  submittedAt: Schema.optional(Schema.NullOr(Schema.String)),
});
export const GitPullRequestReaction = Schema.Struct({
  content: TrimmedNonEmptyStringSchema,
  count: PositiveInt,
  viewerHasReacted: Schema.optional(Schema.Boolean),
});
export const GitPullRequestInlineComment = Schema.Struct({
  id: TrimmedNonEmptyStringSchema,
  author: Schema.NullOr(GitPullRequestActor),
  body: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  reactions: Schema.optional(Schema.Array(GitPullRequestReaction)),
});
export const GitPullRequestReviewThread = Schema.Struct({
  id: TrimmedNonEmptyStringSchema,
  path: TrimmedNonEmptyStringSchema,
  line: PositiveInt,
  side: Schema.Literals(["left", "right"]),
  originalLine: Schema.optional(PositiveInt),
  resolved: Schema.optional(Schema.Boolean),
  outdated: Schema.optional(Schema.Boolean),
  comments: Schema.Array(GitPullRequestInlineComment).check(Schema.isMinLength(1)),
});
export const GitPullRequestCommit = Schema.Struct({
  sha: TrimmedNonEmptyStringSchema,
  subject: TrimmedNonEmptyStringSchema,
  authoredAt: Schema.optional(Schema.String),
  authors: Schema.Array(GitPullRequestActor),
});
export const GitPullRequestFile = Schema.Struct({
  path: TrimmedNonEmptyStringSchema,
  previousPath: Schema.optional(TrimmedNonEmptyStringSchema),
  status: Schema.Literals(["added", "modified", "removed", "renamed", "copied", "changed"]),
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  patch: Schema.NullOr(Schema.String),
  patchTruncated: Schema.Boolean,
});
export const GitPullRequestStackMembership = Schema.Struct({
  number: PositiveInt,
  position: PositiveInt,
  size: PositiveInt,
  base: TrimmedNonEmptyStringSchema,
});
export const GitPullRequestStackLayer = Schema.Struct({
  number: PositiveInt,
  title: Schema.optional(Schema.String),
  isDraft: Schema.optional(Schema.Boolean),
  headSha: Schema.optional(TrimmedNonEmptyStringSchema),
  headBranch: TrimmedNonEmptyStringSchema,
  state: GitPullRequestState,
});
export const GitPullRequestStack = Schema.Struct({
  id: TrimmedNonEmptyStringSchema,
  number: PositiveInt,
  url: TrimmedNonEmptyStringSchema,
  base: TrimmedNonEmptyStringSchema,
  layers: Schema.Array(GitPullRequestStackLayer),
});
export const GitPullRequestStackHead = Schema.Struct({
  number: PositiveInt,
  headSha: TrimmedNonEmptyStringSchema,
});

export const GitResolvedPullRequest = Schema.Struct({
  provider: Schema.optional(SourceControlProviderKind),
  number: PositiveInt,
  title: TrimmedNonEmptyStringSchema,
  url: Schema.String,
  baseBranch: TrimmedNonEmptyStringSchema,
  headBranch: TrimmedNonEmptyStringSchema,
  state: GitPullRequestState,
  isDraft: Schema.optional(Schema.Boolean),
  author: Schema.optional(Schema.NullOr(GitPullRequestActor)),
  labels: Schema.optional(Schema.Array(GitPullRequestLabel)),
  reviewDecision: Schema.optional(GitPullRequestReviewDecision),
  mergeability: Schema.optional(GitPullRequestMergeability),
  checksState: Schema.optional(GitPullRequestChecksState),
  additions: Schema.optional(NonNegativeInt),
  deletions: Schema.optional(NonNegativeInt),
  changedFiles: Schema.optional(NonNegativeInt),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
  body: Schema.optional(Schema.String),
  reviewers: Schema.optional(Schema.Array(GitPullRequestActor)),
  checks: Schema.optional(Schema.Array(GitPullRequestCheck)),
  comments: Schema.optional(Schema.Array(GitPullRequestComment)),
  reviews: Schema.optional(Schema.Array(GitPullRequestReview)),
  commits: Schema.optional(Schema.Array(GitPullRequestCommit)),
  files: Schema.optional(Schema.Array(GitPullRequestFile)),
  reviewThreads: Schema.optional(Schema.Array(GitPullRequestReviewThread)),
  autoMergeEnabled: Schema.optional(Schema.Boolean),
  autoMergeMethod: Schema.optional(Schema.Literals(["merge", "squash", "rebase"])),
  stack: Schema.optional(GitPullRequestStack),
  stackMembership: Schema.optional(GitPullRequestStackMembership),
  headRepositoryNameWithOwner: Schema.optional(Schema.NullOr(TrimmedNonEmptyStringSchema)),
  isCrossRepository: Schema.optional(Schema.Boolean),
});
export type GitResolvedPullRequest = typeof GitResolvedPullRequest.Type;

// RPC Inputs

export const VcsStatusInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type VcsStatusInput = typeof VcsStatusInput.Type;

export const VcsPullInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type VcsPullInput = typeof VcsPullInput.Type;

export const GitRunStackedActionInput = Schema.Struct({
  actionId: TrimmedNonEmptyStringSchema,
  cwd: TrimmedNonEmptyStringSchema,
  action: GitStackedAction,
  commitMessage: Schema.optional(TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(10_000))),
  featureBranch: Schema.optional(Schema.Boolean),
  filePaths: Schema.optional(
    Schema.Array(TrimmedNonEmptyStringSchema).check(Schema.isMinLength(1)),
  ),
  /** The thread the action runs beside; a pull request it creates is linked to it. */
  threadId: Schema.optional(ThreadId),
  projectId: Schema.optional(ProjectId),
});
export type GitRunStackedActionInput = typeof GitRunStackedActionInput.Type;

export const VcsListRefsInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  query: Schema.optional(TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(256))),
  cursor: Schema.optional(NonNegativeInt),
  includeMatchingRemoteRefs: Schema.optional(Schema.Boolean),
  refKind: Schema.optional(Schema.Literals(["all", "local", "remote"])),
  refresh: Schema.optional(Schema.Boolean),
  limit: Schema.optional(
    PositiveInt.check(Schema.isLessThanOrEqualTo(GIT_LIST_BRANCHES_MAX_LIMIT)),
  ),
});
export type VcsListRefsInput = typeof VcsListRefsInput.Type;

export const VcsCreateWorktreeInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  refName: TrimmedNonEmptyStringSchema,
  newRefName: Schema.optional(TrimmedNonEmptyStringSchema),
  baseRefName: Schema.optional(TrimmedNonEmptyStringSchema),
  path: Schema.NullOr(TrimmedNonEmptyStringSchema),
});
export type VcsCreateWorktreeInput = typeof VcsCreateWorktreeInput.Type;

export const GitPullRequestRefInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  reference: GitPullRequestReference,
});
export type GitPullRequestRefInput = typeof GitPullRequestRefInput.Type;

export const GitPreparePullRequestThreadInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  reference: GitPullRequestReference,
  mode: GitPreparePullRequestThreadMode,
  threadId: Schema.optional(ThreadId),
});
export type GitPreparePullRequestThreadInput = typeof GitPreparePullRequestThreadInput.Type;

export const VcsRemoveWorktreeInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  path: TrimmedNonEmptyStringSchema,
  force: Schema.optional(Schema.Boolean),
});
export type VcsRemoveWorktreeInput = typeof VcsRemoveWorktreeInput.Type;

export const VcsCreateRefInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  refName: TrimmedNonEmptyStringSchema,
  switchRef: Schema.optional(Schema.Boolean),
});
export type VcsCreateRefInput = typeof VcsCreateRefInput.Type;

export const VcsCreateRefResult = Schema.Struct({
  refName: TrimmedNonEmptyStringSchema,
});
export type VcsCreateRefResult = typeof VcsCreateRefResult.Type;

export const VcsSwitchRefInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  refName: TrimmedNonEmptyStringSchema,
});
export type VcsSwitchRefInput = typeof VcsSwitchRefInput.Type;

export const VcsInitInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  kind: Schema.optional(VcsDriverKind),
});
export type VcsInitInput = typeof VcsInitInput.Type;

// RPC Results

const VcsStatusChangeRequest = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyStringSchema,
  url: Schema.String,
  baseRef: TrimmedNonEmptyStringSchema,
  headRef: TrimmedNonEmptyStringSchema,
  state: VcsStatusChangeRequestState,
  /** Optional for compatibility with older servers and providers. */
  isDraft: Schema.optional(Schema.Boolean),
  /**
   * Last provider-side activity (ISO), including comments and metadata edits.
   * This is not the time a change request closed or merged. Optional for old
   * servers and providers whose lookups do not report it.
   */
  updatedAt: Schema.optional(Schema.NullOr(Schema.String)),
});

const VcsStatusLocalShape = {
  isRepo: Schema.Boolean,
  sourceControlProvider: Schema.optional(SourceControlProviderInfo),
  hasPrimaryRemote: Schema.Boolean,
  isDefaultRef: Schema.Boolean,
  refName: Schema.NullOr(TrimmedNonEmptyStringSchema),
  hasWorkingTreeChanges: Schema.Boolean,
  workingTree: Schema.Struct({
    files: Schema.Array(
      Schema.Struct({
        path: TrimmedNonEmptyStringSchema,
        insertions: NonNegativeInt,
        deletions: NonNegativeInt,
      }),
    ),
    insertions: NonNegativeInt,
    deletions: NonNegativeInt,
  }),
  /**
   * Totals for the diff panel's Changes view: merge-base with the base branch to the
   * working tree, untracked files included. Absent on older servers.
   */
  branchChanges: Schema.optional(
    Schema.Struct({
      baseRef: Schema.NullOr(TrimmedNonEmptyStringSchema),
      insertions: NonNegativeInt,
      deletions: NonNegativeInt,
    }),
  ),
};

const VcsStatusRemoteShape = {
  hasUpstream: Schema.Boolean,
  aheadCount: NonNegativeInt,
  behindCount: NonNegativeInt,
  aheadOfDefaultCount: Schema.optional(NonNegativeInt),
  pr: Schema.NullOr(VcsStatusChangeRequest),
};

export const VcsStatusLocalResult = Schema.Struct(VcsStatusLocalShape);
export type VcsStatusLocalResult = typeof VcsStatusLocalResult.Type;

export const VcsStatusRemoteResult = Schema.Struct(VcsStatusRemoteShape);
export type VcsStatusRemoteResult = typeof VcsStatusRemoteResult.Type;

export const VcsStatusResult = Schema.Struct({
  ...VcsStatusLocalShape,
  ...VcsStatusRemoteShape,
});
export type VcsStatusResult = typeof VcsStatusResult.Type;

export const VcsStatusStreamEvent = Schema.Union([
  Schema.TaggedStruct("snapshot", {
    local: VcsStatusLocalResult,
    remote: Schema.NullOr(VcsStatusRemoteResult),
  }),
  Schema.TaggedStruct("localUpdated", {
    local: VcsStatusLocalResult,
  }),
  Schema.TaggedStruct("remoteUpdated", {
    remote: Schema.NullOr(VcsStatusRemoteResult),
  }),
]);
export type VcsStatusStreamEvent = typeof VcsStatusStreamEvent.Type;

export const VcsListRefsResult = Schema.Struct({
  refs: Schema.Array(VcsRef),
  isRepo: Schema.Boolean,
  hasPrimaryRemote: Schema.Boolean,
  nextCursor: NonNegativeInt.pipe(Schema.NullOr),
  totalCount: NonNegativeInt,
});
export type VcsListRefsResult = typeof VcsListRefsResult.Type;

export const VcsCreateWorktreeResult = Schema.Struct({
  worktree: VcsWorktree,
});
export type VcsCreateWorktreeResult = typeof VcsCreateWorktreeResult.Type;

export const GitResolvePullRequestResult = Schema.Struct({
  pullRequest: GitResolvedPullRequest,
  capabilities: Schema.optional(Schema.suspend(() => GitPullRequestCapabilities)),
});
export type GitResolvePullRequestResult = typeof GitResolvePullRequestResult.Type;

export const GitPreparePullRequestThreadResult = Schema.Struct({
  pullRequest: GitResolvedPullRequest,
  branch: TrimmedNonEmptyStringSchema,
  worktreePath: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  /**
   * False when the checkout could not be brought to the pull request head — a reused worktree
   * holding local commits or uncommitted changes keeps its own state, so the code being handed
   * over is older than the pull request.
   */
  isOnPullRequestHead: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
});
export type GitPreparePullRequestThreadResult = typeof GitPreparePullRequestThreadResult.Type;

export const VcsSwitchRefResult = Schema.Struct({
  refName: Schema.NullOr(TrimmedNonEmptyStringSchema),
});
export type VcsSwitchRefResult = typeof VcsSwitchRefResult.Type;

export const GitRunStackedActionResult = Schema.Struct({
  action: GitStackedAction,
  branch: Schema.Struct({
    status: GitBranchStepStatus,
    name: Schema.optional(TrimmedNonEmptyStringSchema),
  }),
  commit: Schema.Struct({
    status: GitCommitStepStatus,
    commitSha: Schema.optional(TrimmedNonEmptyStringSchema),
    subject: Schema.optional(TrimmedNonEmptyStringSchema),
  }),
  push: Schema.Struct({
    status: GitPushStepStatus,
    branch: Schema.optional(TrimmedNonEmptyStringSchema),
    upstreamBranch: Schema.optional(TrimmedNonEmptyStringSchema),
    setUpstream: Schema.optional(Schema.Boolean),
  }),
  pr: Schema.Struct({
    status: GitPrStepStatus,
    url: Schema.optional(Schema.String),
    number: Schema.optional(PositiveInt),
    baseBranch: Schema.optional(TrimmedNonEmptyStringSchema),
    headBranch: Schema.optional(TrimmedNonEmptyStringSchema),
    title: Schema.optional(TrimmedNonEmptyStringSchema),
  }),
  toast: GitRunStackedActionToast,
});
export type GitRunStackedActionResult = typeof GitRunStackedActionResult.Type;

export const VcsPullResult = Schema.Struct({
  status: Schema.Literals(["pulled", "skipped_up_to_date"]),
  refName: TrimmedNonEmptyStringSchema,
  upstreamRef: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
});
export type VcsPullResult = typeof VcsPullResult.Type;

// RPC / domain errors

// Well-known git failures, recognized from stderr at the driver and carried as
// a closed set of diagnostic tags. Git's stderr itself stays off the error: it
// echoes argv and remote URLs, which can hold credentials. The tag names the
// cause for logs and callers; it does not select a message.
export const GitCommandFailureReason = Schema.Literals([
  "authentication_failed",
  "branch_already_exists",
  "branch_checked_out_in_worktree",
  "host_key_unverified",
  "not_a_repository",
  "path_already_exists",
  "remote_unreachable",
  "tag_would_be_clobbered",
]);
export type GitCommandFailureReason = typeof GitCommandFailureReason.Type;

export class GitCommandError extends Schema.TaggedError<GitCommandError>()("GitCommandError", {
  operation: Schema.String,
  command: Schema.String,
  cwd: Schema.String,
  argumentCount: Schema.optional(Schema.Number),
  exitCode: Schema.optional(Schema.Number),
  stdoutLength: Schema.optional(Schema.Number),
  stderrLength: Schema.optional(Schema.Number),
  outputLength: Schema.optional(Schema.Number),
  reason: Schema.optional(GitCommandFailureReason),
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    const reason = this.reason === undefined ? "" : ` (${this.reason})`;
    return `Git command failed in ${this.operation} (${this.cwd}): ${this.detail}${reason}`;
  }
}

export class TextGenerationError extends Schema.TaggedError<TextGenerationError>()(
  "TextGenerationError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Text generation failed in ${this.operation}: ${this.detail}`;
  }
}

export class GitManagerError extends Schema.TaggedError<GitManagerError>()("GitManagerError", {
  operation: Schema.String,
  cwd: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Git manager failed in ${this.operation}: ${this.detail}`;
  }
}

export class GitPullRequestMaterializationError extends Schema.TaggedError<GitPullRequestMaterializationError>()(
  "GitPullRequestMaterializationError",
  {
    cwd: TrimmedNonEmptyStringSchema,
    pullRequestNumber: PositiveInt,
    headRepository: Schema.NullOr(TrimmedNonEmptyStringSchema),
    headBranch: TrimmedNonEmptyStringSchema,
    localBranch: TrimmedNonEmptyStringSchema,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to materialize pull request #${this.pullRequestNumber} branch ${this.headBranch} as ${this.localBranch}.`;
  }
}

export const GitManagerServiceError = Schema.Union([
  GitManagerError,
  GitPullRequestMaterializationError,
  GitCommandError,
  SourceControlProviderError,
  TextGenerationError,
]);
export type GitManagerServiceError = typeof GitManagerServiceError.Type;

const GitActionProgressBase = Schema.Struct({
  actionId: TrimmedNonEmptyStringSchema,
  cwd: TrimmedNonEmptyStringSchema,
  action: GitStackedAction,
});

const GitActionStartedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("action_started"),
  phases: Schema.Array(GitActionProgressPhase),
});
const GitActionPhaseStartedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("phase_started"),
  phase: GitActionProgressPhase,
  label: TrimmedNonEmptyStringSchema,
});
const GitActionHookStartedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("hook_started"),
  hookName: TrimmedNonEmptyStringSchema,
});
const GitActionHookOutputEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("hook_output"),
  hookName: Schema.NullOr(TrimmedNonEmptyStringSchema),
  stream: GitActionProgressStream,
  text: TrimmedNonEmptyStringSchema,
});
const GitActionHookFinishedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("hook_finished"),
  hookName: TrimmedNonEmptyStringSchema,
  exitCode: Schema.NullOr(Schema.Int),
  durationMs: Schema.NullOr(NonNegativeInt),
});
const GitActionFinishedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("action_finished"),
  result: GitRunStackedActionResult,
});
const GitActionFailedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal("action_failed"),
  phase: Schema.NullOr(GitActionProgressPhase),
  message: TrimmedNonEmptyStringSchema,
});

export const GitActionProgressEvent = Schema.Union([
  GitActionStartedEvent,
  GitActionPhaseStartedEvent,
  GitActionHookStartedEvent,
  GitActionHookOutputEvent,
  GitActionHookFinishedEvent,
  GitActionFinishedEvent,
  GitActionFailedEvent,
]);
export type GitActionProgressEvent = typeof GitActionProgressEvent.Type;

export const GitStatusInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export const GitPullInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export const GitPushInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export const GitRepositoryOperation = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("push_ref"),
    remote: TrimmedNonEmptyStringSchema,
    ref: TrimmedNonEmptyStringSchema,
    forceWithLease: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    action: Schema.Literal("pull_ref"),
    remote: TrimmedNonEmptyStringSchema,
    ref: TrimmedNonEmptyStringSchema,
  }),
  Schema.Struct({
    action: Schema.Literal("push_tag"),
    remote: TrimmedNonEmptyStringSchema,
    tag: TrimmedNonEmptyStringSchema,
  }),
  Schema.Struct({
    action: Schema.Literal("add_remote"),
    name: TrimmedNonEmptyStringSchema,
    url: TrimmedNonEmptyStringSchema,
  }),
  Schema.Struct({
    action: Schema.Literal("remove_remote"),
    name: TrimmedNonEmptyStringSchema,
  }),
  Schema.Struct({
    action: Schema.Literal("reset"),
    mode: Schema.Literals(["soft", "mixed", "hard"]),
    sha: TrimmedNonEmptyStringSchema,
  }),
]);
export const GitRepositoryActionInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  operation: GitRepositoryOperation,
});
export const GitPublishReleaseInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  tag: TrimmedNonEmptyStringSchema,
  title: TrimmedNonEmptyStringSchema,
  notes: Schema.String,
  prerelease: Schema.Boolean,
});
export const GitTriggerReleaseWorkflowInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  ref: TrimmedNonEmptyStringSchema,
  version: TrimmedNonEmptyStringSchema,
});
export const GitFetchInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export const GitStageFilesInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  paths: Schema.Array(TrimmedNonEmptyStringSchema).check(Schema.isMinLength(1)),
});
export const GitUnstageFilesInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  paths: Schema.Array(TrimmedNonEmptyStringSchema).check(Schema.isMinLength(1)),
});
export const GitCreateForkInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  remoteName: Schema.optional(TrimmedNonEmptyStringSchema),
});
export const GitDiscardChangesInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  paths: Schema.optional(Schema.Array(TrimmedNonEmptyStringSchema).check(Schema.isMinLength(1))),
  discardStaged: Schema.optional(Schema.Boolean),
  discardUnstaged: Schema.optional(Schema.Boolean),
  discardUntracked: Schema.optional(Schema.Boolean),
});
export const GitStashSaveInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  message: Schema.optional(TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(500))),
  includeUntracked: Schema.optional(Schema.Boolean),
});
export const GitStashListInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export const GitApplyStashInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  stashRef: TrimmedNonEmptyStringSchema,
  pop: Schema.optional(Schema.Boolean),
});
export const GitDropStashInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  stashRef: TrimmedNonEmptyStringSchema,
});
export const GitMergeInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
});
export const GitRebaseInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
});
export const GitContinueOperationInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  kind: GitOperationKind,
});
export const GitAbortOperationInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  kind: GitOperationKind,
});
export const GitSkipRebaseInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export const GitResolveConflictInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  path: TrimmedNonEmptyStringSchema,
  side: GitConflictResolutionSide,
});
export const GitConflictSnapshotInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  path: TrimmedNonEmptyStringSchema,
});
export const GitApplyHunkMode = Schema.Literals(["stage", "unstage", "discard"]);
export const GitApplyHunkInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  path: TrimmedNonEmptyStringSchema,
  patch: TrimmedNonEmptyStringSchema,
  mode: GitApplyHunkMode,
});
export const GitListBranchesInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export const GitCreateWorktreeInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
  newBranch: Schema.optional(TrimmedNonEmptyStringSchema),
  path: Schema.NullOr(TrimmedNonEmptyStringSchema),
});
export const GitRemoveWorktreeInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  path: TrimmedNonEmptyStringSchema,
  force: Schema.optional(Schema.Boolean),
});
export const GitCreateBranchInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
});
export const GitCheckoutInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
});
export const GitRenameBranchInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  oldBranch: TrimmedNonEmptyStringSchema,
  newBranch: TrimmedNonEmptyStringSchema,
});
export const GitRenameBranchResult = Schema.Struct({
  branch: TrimmedNonEmptyStringSchema,
});
export const GitDeleteBranchInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
  force: Schema.optional(Schema.Boolean),
});
export const GitSetBranchUpstreamInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
  remoteName: TrimmedNonEmptyStringSchema,
  remoteBranch: TrimmedNonEmptyStringSchema,
});
export const GitHistoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  limit: Schema.optional(PositiveInt),
});
export const GitDiffInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  path: Schema.optional(TrimmedNonEmptyStringSchema),
  commit: Schema.optional(TrimmedNonEmptyStringSchema),
});
export const GitGenerateDiffSummaryTarget = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("working_tree"),
  }),
  Schema.Struct({
    kind: Schema.Literal("commit"),
    sha: TrimmedNonEmptyStringSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("full_codebase"),
  }),
]);
export const GitGenerateDiffSummaryInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  target: GitGenerateDiffSummaryTarget,
  modelSelection: Schema.optional(ModelSelection),
  userHint: Schema.optional(Schema.String),
});
export const GitGenerateDiffSummaryResult = Schema.Struct({
  summary: Schema.String,
  keyChanges: Schema.String,
  notesAndRisk: Schema.String,
  targetScope: Schema.optional(
    Schema.Literals(["staged", "working_tree", "commit", "full_codebase"]),
  ),
  wasTruncated: Schema.Boolean,
  truncatedCount: Schema.optional(NonNegativeInt),
  truncatedReason: Schema.optional(Schema.String),
});
export const ReviewFindingCategory = Schema.Literals([
  "correctness",
  "security",
  "api_compatibility",
]);
export const ReviewFindingSeverity = Schema.Literals(["error", "warning", "info"]);
export const ReviewFinding = Schema.Struct({
  id: Schema.String,
  file: Schema.String,
  line: Schema.Number,
  col: Schema.optional(Schema.Number),
  category: Schema.String,
  severity: ReviewFindingSeverity,
  title: Schema.String,
  body: Schema.String,
  confidence: Schema.Number,
  isInDiff: Schema.Boolean,
  isNew: Schema.optional(Schema.Boolean),
});
export const ReviewCostPreviewEvent = Schema.Struct({
  estimatedPassCount: Schema.Number,
  estimatedInputTokens: Schema.Number,
});
export const AuditReviewOptions = Schema.Struct({
  mode: Schema.Literals(["pr_review", "full_audit", "security", "architecture", "refactoring"]),
  depth: Schema.Literals(["quick", "standard", "deep"]),
  targetPaths: Schema.optional(Schema.Array(TrimmedNonEmptyStringSchema)),
});
export type AuditReviewOptions = typeof AuditReviewOptions.Type;

export const GitGenerateReviewInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  target: GitGenerateDiffSummaryTarget,
  modelSelection: Schema.optional(ModelSelection),
  userHint: Schema.optional(Schema.String),
  audit: Schema.optional(AuditReviewOptions),
});
export const GitGenerateReviewResult = Schema.Struct({
  filesInspected: Schema.optional(Schema.Number),
  summary: Schema.String,
  keyChanges: Schema.String,
  notesAndRisk: Schema.String,
  findings: Schema.Array(ReviewFinding),
  passesRun: Schema.Array(Schema.String),
  targetScope: Schema.optional(
    Schema.Literals(["staged", "working_tree", "commit", "full_codebase"]),
  ),
  wasTruncated: Schema.Boolean,
  truncatedCount: Schema.optional(NonNegativeInt),
  truncatedReason: Schema.optional(Schema.String),
  isIncremental: Schema.optional(Schema.Boolean),
});
export const FindingFeedbackVerdict = Schema.Literals(["accepted", "dismissed", "false_positive"]);
export const GitSubmitFindingFeedbackInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  findingFingerprint: TrimmedNonEmptyStringSchema,
  category: Schema.String,
  verdict: FindingFeedbackVerdict,
});
export const GitSubmitFindingFeedbackResult = Schema.Struct({
  success: Schema.Boolean,
  falsePositiveCount: Schema.Number,
  isSuppressed: Schema.Boolean,
});
export const ReviewHistoryRecordSchema = Schema.Struct({
  id: Schema.String,
  repoPath: Schema.String,
  branchName: Schema.String,
  timestamp: Schema.String,
  modelUsed: Schema.String,
  targetScope: Schema.String,
  summary: Schema.String,
  keyChanges: Schema.String,
  notesAndRisk: Schema.String,
  findings: Schema.Array(ReviewFinding),
  passesRun: Schema.Array(Schema.String),
  isIncremental: Schema.Boolean,
});
export const GitGetReviewHistoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export const GitGetReviewHistoryResult = Schema.Struct({
  records: Schema.Array(ReviewHistoryRecordSchema),
});
export const GitInitInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
const GitStatusPr = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyStringSchema,
  url: Schema.String,
  baseBranch: TrimmedNonEmptyStringSchema,
  headBranch: TrimmedNonEmptyStringSchema,
  state: GitStatusPrState,
});

export const GitStatusFile = Schema.Struct({
  path: TrimmedNonEmptyStringSchema,
  insertions: NonNegativeInt,
  deletions: NonNegativeInt,
  staged: Schema.optional(Schema.Boolean),
  unstaged: Schema.optional(Schema.Boolean),
  untracked: Schema.optional(Schema.Boolean),
  conflicted: Schema.optional(Schema.Boolean),
});
export const GitOperationState = Schema.Struct({
  kind: GitOperationKind,
  status: GitOperationStatus,
});
export const GitStatusResult = Schema.Struct({
  branch: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  hasWorkingTreeChanges: Schema.Boolean,
  workingTree: Schema.Struct({
    files: Schema.Array(GitStatusFile),
    insertions: NonNegativeInt,
    deletions: NonNegativeInt,
  }),
  staged: Schema.optional(
    Schema.Struct({
      files: Schema.Array(GitStatusFile),
      insertions: NonNegativeInt,
      deletions: NonNegativeInt,
    }),
  ),
  unstaged: Schema.optional(
    Schema.Struct({
      files: Schema.Array(GitStatusFile),
      insertions: NonNegativeInt,
      deletions: NonNegativeInt,
    }),
  ),
  conflicted: Schema.optional(
    Schema.Struct({
      files: Schema.Array(GitStatusFile),
    }),
  ),
  untracked: Schema.optional(
    Schema.Struct({
      files: Schema.Array(GitStatusFile),
    }),
  ),
  hasUpstream: Schema.Boolean,
  aheadCount: NonNegativeInt,
  behindCount: NonNegativeInt,
  operation: Schema.NullOr(GitOperationState),
  pr: Schema.NullOr(GitStatusPr),
});
export const GitPushAccess = Schema.Literals(["write", "read_only", "unknown"]);
export const GitListBranchesResult = Schema.Struct({
  branches: Schema.Array(GitBranch),
  isRepo: Schema.Boolean,
  hasOriginRemote: Schema.Boolean,
  pushAccess: Schema.optional(GitPushAccess),
  remoteName: Schema.optional(Schema.NullOr(Schema.String)),
});
export const GitEnvironmentInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export const GitHubAccount = Schema.Struct({
  // Credential-store label can differ from the current GitHub username after a rename.
  authLogin: Schema.optional(TrimmedNonEmptyStringSchema),
  host: TrimmedNonEmptyStringSchema,
  login: TrimmedNonEmptyStringSchema,
  active: Schema.Boolean,
  scopes: Schema.Array(Schema.String),
});
export const GitEnvironmentResult = Schema.Struct({
  git: Schema.Struct({
    installed: Schema.Boolean,
    version: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  }),
  gitHub: Schema.Struct({
    cliInstalled: Schema.Boolean,
    version: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
    authenticated: Schema.Boolean,
    accounts: Schema.Array(GitHubAccount),
    activeLogin: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  }),
});
export const GitHubSwitchAccountInput = Schema.Struct({
  host: TrimmedNonEmptyStringSchema,
  login: TrimmedNonEmptyStringSchema,
});
export const GitHubLogoutInput = Schema.Struct({
  host: TrimmedNonEmptyStringSchema,
  login: TrimmedNonEmptyStringSchema,
});
export const GitAmendCommitInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  message: Schema.optional(TrimmedNonEmptyStringSchema),
});
export const GitUndoLastCommitInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export const GitRevertCommitInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  sha: TrimmedNonEmptyStringSchema,
});
export const GitCherryPickInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  sha: TrimmedNonEmptyStringSchema,
});
export const GitCreateTagInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  name: TrimmedNonEmptyStringSchema,
  sha: Schema.optional(TrimmedNonEmptyStringSchema),
});
export const GitTag = Schema.Struct({
  name: TrimmedNonEmptyStringSchema,
  sha: Schema.String,
  subject: Schema.String,
});
export const GitListTagsInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export const GitListTagsResult = Schema.Struct({
  tags: Schema.Array(GitTag),
});
export const GitWatchedBranchStatus = Schema.Struct({
  name: TrimmedNonEmptyStringSchema,
  isRemote: Schema.Boolean,
  aheadCount: Schema.Number,
  behindCount: Schema.Number,
  isDefault: Schema.optional(Schema.Boolean),
  lastCommitTimestamp: Schema.optional(Schema.Number),
});
export const GitWatchedBranchStatusesInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  excludedBranches: Schema.optional(Schema.Array(Schema.String)),
  maxCandidates: Schema.optional(Schema.Number),
});
export const GitWatchedBranchStatusesResult = Schema.Struct({
  branches: Schema.Array(GitWatchedBranchStatus),
  isFullScan: Schema.optional(Schema.Boolean),
});
export const GitCreateWorktreeResult = Schema.Struct({
  worktree: GitWorktree,
});
export const GitListPullRequestsInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  query: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  state: Schema.optional(
    Schema.Union([
      Schema.Literal("open"),
      Schema.Literal("closed"),
      Schema.Literal("merged"),
      Schema.Literal("all"),
    ]),
  ),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(200))),
});
export const GitPullRequestAction = Schema.Literals([
  "merge",
  "close",
  "reopen",
  "ready",
  "draft",
  "enable_auto_merge",
  "disable_auto_merge",
  "edit_pull_request",
  "comment",
  "approve",
  "request_changes",
  "add_reviewer",
  "remove_reviewer",
  "add_label",
  "remove_label",
  "inline_comment",
  "reply_to_thread",
  "resolve_thread",
  "unresolve_thread",
  "add_reaction",
  "remove_reaction",
  "stack_rebase",
  "stack_merge",
]);
export const GitPullRequestCapabilities = Schema.Struct({
  provider: SourceControlProviderKind,
  diff: Schema.Boolean,
  create: Schema.Boolean,
  search: Schema.Boolean,
  actions: Schema.Array(GitPullRequestAction),
  mergeMethods: Schema.Array(Schema.Literals(["merge", "squash", "rebase"])),
});
export const GitListPullRequestsResult = Schema.Struct({
  pullRequests: Schema.Array(GitResolvedPullRequest),
  hasMore: Schema.optional(Schema.Boolean),
  capabilities: Schema.optional(GitPullRequestCapabilities),
});
export const GitMutatePullRequestInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  reference: GitPullRequestReference,
  action: GitPullRequestAction,
  stackNumber: Schema.optional(PositiveInt),
  expectedStackHeads: Schema.optional(Schema.Array(GitPullRequestStackHead)),
  mergeMethod: Schema.optional(Schema.Literals(["merge", "squash", "rebase"])),
  deleteBranch: Schema.optional(Schema.Boolean),
  title: Schema.optional(TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(1_000))),
  body: Schema.optional(Schema.String.check(Schema.isMaxLength(100_000))),
  value: Schema.optional(TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(256))),
  path: Schema.optional(TrimmedNonEmptyStringSchema),
  line: Schema.optional(PositiveInt),
  side: Schema.optional(Schema.Literals(["left", "right"])),
  threadId: Schema.optional(TrimmedNonEmptyStringSchema),
  subjectId: Schema.optional(TrimmedNonEmptyStringSchema),
  reaction: Schema.optional(
    Schema.Literals([
      "THUMBS_UP",
      "THUMBS_DOWN",
      "LAUGH",
      "HOORAY",
      "CONFUSED",
      "HEART",
      "ROCKET",
      "EYES",
    ]),
  ),
});
export const GitMutatePullRequestResult = Schema.Struct({
  pullRequest: GitResolvedPullRequest,
});
export const GitCreatePullRequestInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  baseBranch: TrimmedNonEmptyStringSchema,
  headBranch: TrimmedNonEmptyStringSchema,
  title: TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(512)),
  body: Schema.String.check(Schema.isMaxLength(100_000)),
  draft: Schema.optional(Schema.Boolean),
});
export const GitCreatePullRequestResult = Schema.Struct({
  pullRequest: GitResolvedPullRequest,
});
export const GitPullResult = Schema.Struct({
  status: Schema.Literals(["pulled", "skipped_up_to_date"]),
  branch: TrimmedNonEmptyStringSchema,
  upstreamBranch: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
});
export const GitPushResult = Schema.Struct({
  status: Schema.Literals(["pushed", "skipped_up_to_date"]),
  branch: TrimmedNonEmptyStringSchema,
  upstreamBranch: Schema.optional(TrimmedNonEmptyStringSchema),
  setUpstream: Schema.optional(Schema.Boolean),
});
export const GitHistoryCommit = Schema.Struct({
  sha: TrimmedNonEmptyStringSchema,
  shortSha: TrimmedNonEmptyStringSchema,
  subject: TrimmedNonEmptyStringSchema,
  authorName: TrimmedNonEmptyStringSchema,
  authoredAt: Schema.String,
  refs: Schema.Array(TrimmedNonEmptyStringSchema),
  isHead: Schema.Boolean,
});
export const GitHistoryResult = Schema.Struct({
  commits: Schema.Array(GitHistoryCommit),
});
export const GitDiffTarget = Schema.Literals(["working_tree", "commit"]);
export const GitDiffStats = Schema.Struct({
  filesChanged: NonNegativeInt,
  insertions: NonNegativeInt,
  deletions: NonNegativeInt,
});
export const GitDiffResult = Schema.Struct({
  target: GitDiffTarget,
  path: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  commit: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  title: TrimmedNonEmptyStringSchema,
  patch: Schema.String,
  stats: GitDiffStats,
});
export const GitConflictSnapshotResult = Schema.Struct({
  path: TrimmedNonEmptyStringSchema,
  baseContents: Schema.NullOr(Schema.String),
  oursContents: Schema.NullOr(Schema.String),
  theirsContents: Schema.NullOr(Schema.String),
});
export const GitStashEntry = Schema.Struct({
  stashRef: TrimmedNonEmptyStringSchema,
  sha: TrimmedNonEmptyStringSchema,
  shortSha: TrimmedNonEmptyStringSchema,
  message: TrimmedNonEmptyStringSchema,
  createdAt: Schema.String,
});
export const GitStashListResult = Schema.Struct({
  entries: Schema.Array(GitStashEntry),
});
export const GitWorkflowRun = Schema.Struct({
  status: Schema.NullOr(Schema.String),
  conclusion: Schema.NullOr(Schema.String),
  name: Schema.String,
  headBranch: Schema.String,
  createdAt: Schema.String,
  url: Schema.String,
  workflowName: Schema.String,
});
export const GitListWorkflowRunsInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
  limit: Schema.optional(Schema.Number),
});
export const GitListWorkflowRunsResult = Schema.Struct({
  hasWorkflows: Schema.Boolean,
  runs: Schema.Array(GitWorkflowRun),
});

// RESTORED TYPES
export type GitOperationKind = typeof GitOperationKind.Type;
export type GitConflictResolutionSide = typeof GitConflictResolutionSide.Type;
export type GitBranch = typeof GitBranch.Type;
export type GitPullRequestActor = typeof GitPullRequestActor.Type;
export type GitPullRequestLabel = typeof GitPullRequestLabel.Type;
export type GitPullRequestChecksState = typeof GitPullRequestChecksState.Type;
export type GitPullRequestReviewDecision = typeof GitPullRequestReviewDecision.Type;
export type GitPullRequestMergeability = typeof GitPullRequestMergeability.Type;
export type GitPullRequestCheck = typeof GitPullRequestCheck.Type;
export type GitPullRequestComment = typeof GitPullRequestComment.Type;
export type GitPullRequestReview = typeof GitPullRequestReview.Type;
export type GitPullRequestReaction = typeof GitPullRequestReaction.Type;
export type GitPullRequestInlineComment = typeof GitPullRequestInlineComment.Type;
export type GitPullRequestReviewThread = typeof GitPullRequestReviewThread.Type;
export type GitPullRequestCommit = typeof GitPullRequestCommit.Type;
export type GitPullRequestFile = typeof GitPullRequestFile.Type;
export type GitPullRequestStackMembership = typeof GitPullRequestStackMembership.Type;
export type GitPullRequestStackLayer = typeof GitPullRequestStackLayer.Type;
export type GitPullRequestStack = typeof GitPullRequestStack.Type;
export type GitPullRequestStackHead = typeof GitPullRequestStackHead.Type;
export type GitStatusInput = typeof GitStatusInput.Type;
export type GitPullInput = typeof GitPullInput.Type;
export type GitPushInput = typeof GitPushInput.Type;
export type GitRepositoryOperation = typeof GitRepositoryOperation.Type;
export type GitRepositoryActionInput = typeof GitRepositoryActionInput.Type;
export type GitPublishReleaseInput = typeof GitPublishReleaseInput.Type;
export type GitTriggerReleaseWorkflowInput = typeof GitTriggerReleaseWorkflowInput.Type;
export type GitFetchInput = typeof GitFetchInput.Type;
export type GitStageFilesInput = typeof GitStageFilesInput.Type;
export type GitUnstageFilesInput = typeof GitUnstageFilesInput.Type;
export type GitCreateForkInput = typeof GitCreateForkInput.Type;
export type GitDiscardChangesInput = typeof GitDiscardChangesInput.Type;
export type GitStashSaveInput = typeof GitStashSaveInput.Type;
export type GitStashListInput = typeof GitStashListInput.Type;
export type GitApplyStashInput = typeof GitApplyStashInput.Type;
export type GitDropStashInput = typeof GitDropStashInput.Type;
export type GitMergeInput = typeof GitMergeInput.Type;
export type GitRebaseInput = typeof GitRebaseInput.Type;
export type GitContinueOperationInput = typeof GitContinueOperationInput.Type;
export type GitAbortOperationInput = typeof GitAbortOperationInput.Type;
export type GitSkipRebaseInput = typeof GitSkipRebaseInput.Type;
export type GitResolveConflictInput = typeof GitResolveConflictInput.Type;
export type GitConflictSnapshotInput = typeof GitConflictSnapshotInput.Type;
export type GitApplyHunkMode = typeof GitApplyHunkMode.Type;
export type GitApplyHunkInput = typeof GitApplyHunkInput.Type;
export type GitListBranchesInput = typeof GitListBranchesInput.Type;
export type GitCreateWorktreeInput = typeof GitCreateWorktreeInput.Type;
export type GitRemoveWorktreeInput = typeof GitRemoveWorktreeInput.Type;
export type GitCreateBranchInput = typeof GitCreateBranchInput.Type;
export type GitCheckoutInput = typeof GitCheckoutInput.Type;
export type GitRenameBranchInput = typeof GitRenameBranchInput.Type;
export type GitRenameBranchResult = typeof GitRenameBranchResult.Type;
export type GitDeleteBranchInput = typeof GitDeleteBranchInput.Type;
export type GitSetBranchUpstreamInput = typeof GitSetBranchUpstreamInput.Type;
export type GitHistoryInput = typeof GitHistoryInput.Type;
export type GitDiffInput = typeof GitDiffInput.Type;
export type GitGenerateDiffSummaryTarget = typeof GitGenerateDiffSummaryTarget.Type;
export type GitGenerateDiffSummaryInput = typeof GitGenerateDiffSummaryInput.Type;
export type GitGenerateDiffSummaryResult = typeof GitGenerateDiffSummaryResult.Type;
export type ReviewFindingCategory = typeof ReviewFindingCategory.Type;
export type ReviewFindingSeverity = typeof ReviewFindingSeverity.Type;
export type ReviewFinding = typeof ReviewFinding.Type;
export type ReviewCostPreviewEvent = typeof ReviewCostPreviewEvent.Type;
export type GitGenerateReviewInput = typeof GitGenerateReviewInput.Type;
export type GitGenerateReviewResult = typeof GitGenerateReviewResult.Type;
export type FindingFeedbackVerdict = typeof FindingFeedbackVerdict.Type;
export type GitSubmitFindingFeedbackInput = typeof GitSubmitFindingFeedbackInput.Type;
export type GitSubmitFindingFeedbackResult = typeof GitSubmitFindingFeedbackResult.Type;
export type ReviewHistoryRecordSchema = typeof ReviewHistoryRecordSchema.Type;
export type GitGetReviewHistoryInput = typeof GitGetReviewHistoryInput.Type;
export type GitGetReviewHistoryResult = typeof GitGetReviewHistoryResult.Type;
export type GitInitInput = typeof GitInitInput.Type;
export type GitStatusFile = typeof GitStatusFile.Type;
export type GitOperationState = typeof GitOperationState.Type;
export type GitStatusResult = typeof GitStatusResult.Type;
export type GitPushAccess = typeof GitPushAccess.Type;
export type GitListBranchesResult = typeof GitListBranchesResult.Type;
export type GitEnvironmentInput = typeof GitEnvironmentInput.Type;
export type GitHubAccount = typeof GitHubAccount.Type;
export type GitEnvironmentResult = typeof GitEnvironmentResult.Type;
export type GitHubSwitchAccountInput = typeof GitHubSwitchAccountInput.Type;
export type GitHubLogoutInput = typeof GitHubLogoutInput.Type;
export type GitAmendCommitInput = typeof GitAmendCommitInput.Type;
export type GitUndoLastCommitInput = typeof GitUndoLastCommitInput.Type;
export type GitRevertCommitInput = typeof GitRevertCommitInput.Type;
export type GitCherryPickInput = typeof GitCherryPickInput.Type;
export type GitCreateTagInput = typeof GitCreateTagInput.Type;
export type GitTag = typeof GitTag.Type;
export type GitListTagsInput = typeof GitListTagsInput.Type;
export type GitListTagsResult = typeof GitListTagsResult.Type;
export type GitWatchedBranchStatus = typeof GitWatchedBranchStatus.Type;
export type GitWatchedBranchStatusesInput = typeof GitWatchedBranchStatusesInput.Type;
export type GitWatchedBranchStatusesResult = typeof GitWatchedBranchStatusesResult.Type;
export type GitCreateWorktreeResult = typeof GitCreateWorktreeResult.Type;
export type GitListPullRequestsInput = typeof GitListPullRequestsInput.Type;
export type GitPullRequestAction = typeof GitPullRequestAction.Type;
export type GitPullRequestCapabilities = typeof GitPullRequestCapabilities.Type;
export type GitListPullRequestsResult = typeof GitListPullRequestsResult.Type;
export type GitMutatePullRequestInput = typeof GitMutatePullRequestInput.Type;
export type GitMutatePullRequestResult = typeof GitMutatePullRequestResult.Type;
export type GitCreatePullRequestInput = typeof GitCreatePullRequestInput.Type;
export type GitCreatePullRequestResult = typeof GitCreatePullRequestResult.Type;
export type GitPullResult = typeof GitPullResult.Type;
export type GitPushResult = typeof GitPushResult.Type;
export type GitHistoryCommit = typeof GitHistoryCommit.Type;
export type GitHistoryResult = typeof GitHistoryResult.Type;
export type GitDiffTarget = typeof GitDiffTarget.Type;
export type GitDiffStats = typeof GitDiffStats.Type;
export type GitDiffResult = typeof GitDiffResult.Type;
export type GitConflictSnapshotResult = typeof GitConflictSnapshotResult.Type;
export type GitStashEntry = typeof GitStashEntry.Type;
export type GitStashListResult = typeof GitStashListResult.Type;
export type GitWorkflowRun = typeof GitWorkflowRun.Type;
export type GitListWorkflowRunsInput = typeof GitListWorkflowRunsInput.Type;
export type GitListWorkflowRunsResult = typeof GitListWorkflowRunsResult.Type;
