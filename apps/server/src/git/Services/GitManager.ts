import * as Context from "effect/Context";
/**
 * GitManager - Effect service contract for stacked Git workflows.
 *
 * Orchestrates status inspection and commit/push/PR flows by composing
 * lower-level Git and external tool services.
 *
 * @module GitManager
 */
import {
  GitActionProgressEvent,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullRequestRefInput,
  GitResolvePullRequestResult,
  GitListPullRequestsInput,
  GitListPullRequestsResult,
  GitMutatePullRequestInput,
  GitMutatePullRequestResult,
  GitCreatePullRequestInput,
  GitCreatePullRequestResult,
  GitRunStackedActionInput,
  GitRunStackedActionResult,
  GitStatusInput,
  GitStatusResult,
  GitGenerateDiffSummaryInput,
  GitGenerateDiffSummaryResult,
  GitGenerateReviewInput,
  GitGenerateReviewResult,
  GitSubmitFindingFeedbackInput,
  GitSubmitFindingFeedbackResult,
  GitGetReviewHistoryInput,
  GitGetReviewHistoryResult,
  ReviewProgressEvent,
} from "@tabs/contracts";
import type { Effect } from "effect";
import type { GitManagerServiceError } from "../Errors.ts";

export interface GitActionProgressReporter {
  readonly publish: (event: GitActionProgressEvent) => Effect.Effect<void, never>;
}

export interface GitRunStackedActionOptions {
  readonly actionId?: string;
  readonly progressReporter?: GitActionProgressReporter;
}

import type { PullRequestReadCacheShape } from "./PullRequestReadCache.ts";

/**
 * GitManagerShape - Service API for high-level Git workflow actions.
 */
export interface GitManagerShape {
  /**
   * Persistent pull request read cache.
   */
  readonly pullRequestReadCache: PullRequestReadCacheShape;

  /**
   * Read current repository Git status plus open PR metadata when available.
   */
  readonly status: (
    input: GitStatusInput,
  ) => Effect.Effect<GitStatusResult, GitManagerServiceError>;

  /**
   * Resolve a pull request by URL/number against the current repository.
   */
  readonly resolvePullRequest: (
    input: GitPullRequestRefInput,
  ) => Effect.Effect<GitResolvePullRequestResult, GitManagerServiceError>;

  /**
   * List all open pull requests for the repository.
   */
  readonly listPullRequests: (
    input: GitListPullRequestsInput,
  ) => Effect.Effect<GitListPullRequestsResult, GitManagerServiceError>;

  readonly mutatePullRequest: (
    input: GitMutatePullRequestInput,
  ) => Effect.Effect<GitMutatePullRequestResult, GitManagerServiceError>;

  readonly createPullRequest: (
    input: GitCreatePullRequestInput,
  ) => Effect.Effect<GitCreatePullRequestResult, GitManagerServiceError>;

  /**
   * Prepare a new thread workspace from a pull request in local or worktree mode.
   */
  readonly preparePullRequestThread: (
    input: GitPreparePullRequestThreadInput,
  ) => Effect.Effect<GitPreparePullRequestThreadResult, GitManagerServiceError>;

  /**
   * Run a stacked Git action (`commit`, `push`, `create_pr`, `commit_push`, or `commit_push_pr`).
   * When `featureBranch` is set, creates and checks out a feature branch first.
   */
  readonly runStackedAction: (
    input: GitRunStackedActionInput,
    options?: GitRunStackedActionOptions,
  ) => Effect.Effect<GitRunStackedActionResult, GitManagerServiceError>;

  /**
   * Generate an AI diff summary for working tree or commit.
   */
  readonly generateDiffSummary: (
    input: GitGenerateDiffSummaryInput,
  ) => Effect.Effect<GitGenerateDiffSummaryResult, GitManagerServiceError>;

  /**
   * Generate a multi-pass AI review with verified line-level findings.
   */
  readonly generateReview: (
    input: GitGenerateReviewInput,
    options?: {
      onCostPreview?: (preview: any) => Effect.Effect<void>;
      onProgress?: (event: ReviewProgressEvent) => Effect.Effect<void>;
    },
  ) => Effect.Effect<GitGenerateReviewResult, GitManagerServiceError>;

  /**
   * Submit finding feedback (accepted, dismissed, false_positive).
   */
  readonly submitFindingFeedback: (
    input: GitSubmitFindingFeedbackInput,
  ) => Effect.Effect<GitSubmitFindingFeedbackResult, GitManagerServiceError>;

  /**
   * Get review history records for a workspace.
   */
  readonly getReviewHistory: (
    input: GitGetReviewHistoryInput,
  ) => Effect.Effect<GitGetReviewHistoryResult, GitManagerServiceError>;
}

/**
 * GitManager - Service tag for stacked Git workflow orchestration.
 */
export class GitManager extends Context.Service<GitManager, GitManagerShape>()(
  "tabs/git/Services/GitManager",
) {}
