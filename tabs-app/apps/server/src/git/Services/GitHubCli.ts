import * as Context from "effect/Context";
/**
 * GitHubCli - Effect service contract for `gh` process interactions.
 *
 * Provides thin command execution helpers used by Git workflow orchestration.
 *
 * @module GitHubCli
 */
import type { Effect } from "effect";

import type { ProcessRunResult } from "../../processRunner";
import type { GitHubCliError } from "../Errors.ts";
import type { GitMutatePullRequestInput, GitPullRequestStack } from "@tabs/contracts";

export interface GitHubPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state?: "open" | "closed" | "merged";
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;
  readonly isDraft?: boolean | undefined;
  readonly author?: {
    readonly login: string;
    readonly avatarUrl?: string | undefined;
    readonly url?: string | undefined;
  } | null;
  readonly labels?: ReadonlyArray<{
    readonly name: string;
    readonly color?: string | undefined;
    readonly description?: string | null | undefined;
  }>;
  readonly reviewDecision?: "approved" | "changes_requested" | "review_required" | undefined;
  readonly mergeability?: "mergeable" | "conflicting" | "unknown" | undefined;
  readonly checksState?: "passing" | "failing" | "pending" | undefined;
  readonly additions?: number | undefined;
  readonly deletions?: number | undefined;
  readonly changedFiles?: number | undefined;
  readonly createdAt?: string | undefined;
  readonly updatedAt?: string | undefined;
  readonly body?: string | undefined;
  readonly reviewers?: ReadonlyArray<{
    readonly login: string;
    readonly avatarUrl?: string | undefined;
    readonly url?: string | undefined;
  }>;
  readonly checks?: ReadonlyArray<{
    readonly name: string;
    readonly status: "queued" | "in_progress" | "completed" | "unknown";
    readonly conclusion?: string | undefined;
    readonly detailsUrl?: string | undefined;
    readonly workflowName?: string | undefined;
  }>;
  readonly comments?: ReadonlyArray<{
    readonly id: string;
    readonly author: { readonly login: string; readonly avatarUrl?: string | undefined } | null;
    readonly body: string;
    readonly createdAt: string;
    readonly url?: string | undefined;
  }>;
  readonly reviews?: ReadonlyArray<{
    readonly id: string;
    readonly author: { readonly login: string; readonly avatarUrl?: string | undefined } | null;
    readonly body: string;
    readonly state: string;
    readonly submittedAt?: string | null | undefined;
  }>;
  readonly commits?: ReadonlyArray<{
    readonly sha: string;
    readonly subject: string;
    readonly authoredAt?: string | undefined;
    readonly authors: ReadonlyArray<{
      readonly login: string;
      readonly avatarUrl?: string | undefined;
    }>;
  }>;
  readonly files?: ReadonlyArray<{
    readonly path: string;
    readonly previousPath?: string | undefined;
    readonly status: "added" | "modified" | "removed" | "renamed" | "copied" | "changed";
    readonly additions: number;
    readonly deletions: number;
    readonly patch: string | null;
    readonly patchTruncated: boolean;
  }>;
  readonly reviewThreads?: ReadonlyArray<{
    readonly id: string;
    readonly path: string;
    readonly line: number;
    readonly side: "left" | "right";
    readonly originalLine?: number;
    readonly resolved?: boolean;
    readonly outdated?: boolean;
    readonly comments: ReadonlyArray<{
      readonly id: string;
      readonly author: { readonly login: string; readonly avatarUrl?: string } | null;
      readonly body: string;
      readonly createdAt: string;
      readonly updatedAt?: string;
      readonly url?: string;
      readonly reactions?: ReadonlyArray<{
        readonly content: string;
        readonly count: number;
        readonly viewerHasReacted?: boolean;
      }>;
    }>;
  }>;
}

export interface GitHubRepositoryCloneUrls {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
}

/**
 * GitHubCliShape - Service API for executing GitHub CLI commands.
 */
export interface GitHubCliShape {
  /**
   * Execute a GitHub CLI command and return full process output.
   */
  readonly execute: (input: {
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly timeoutMs?: number;
  }) => Effect.Effect<ProcessRunResult, GitHubCliError>;

  /**
   * List open pull requests for a head branch.
   */
  readonly listOpenPullRequests: (input: {
    readonly cwd: string;
    readonly headSelector?: string;
    readonly state?: "open" | "closed" | "merged" | "all";
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<GitHubPullRequestSummary>, GitHubCliError>;

  /**
   * Resolve a pull request by URL, number, or branch-ish identifier.
   */
  readonly getPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<GitHubPullRequestSummary, GitHubCliError>;

  readonly getPullRequestFiles: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<NonNullable<GitHubPullRequestSummary["files"]>, GitHubCliError>;

  readonly getPullRequestReviewThreads: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<NonNullable<GitHubPullRequestSummary["reviewThreads"]>, GitHubCliError>;

  readonly getPullRequestStack: (input: {
    readonly cwd: string;
    readonly reference: string;
    readonly repository?: string;
    readonly host?: string;
  }) => Effect.Effect<GitPullRequestStack | null, GitHubCliError>;

  readonly mutatePullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
    readonly action: GitMutatePullRequestInput["action"];
    readonly mergeMethod?: "merge" | "squash" | "rebase";
    readonly deleteBranch?: boolean;
    readonly body?: string;
    readonly value?: string;
    readonly path?: string;
    readonly line?: number;
    readonly side?: "left" | "right";
    readonly threadId?: string;
    readonly subjectId?: string;
    readonly reaction?:
      | "THUMBS_UP"
      | "THUMBS_DOWN"
      | "LAUGH"
      | "HOORAY"
      | "CONFUSED"
      | "HEART"
      | "ROCKET"
      | "EYES";
  }) => Effect.Effect<void, GitHubCliError>;

  /**
   * Resolve clone URLs for a GitHub repository.
   */
  readonly getRepositoryCloneUrls: (input: {
    readonly cwd: string;
    readonly repository: string;
  }) => Effect.Effect<GitHubRepositoryCloneUrls, GitHubCliError>;

  /**
   * Create a pull request from branch context and body file.
   */
  readonly createPullRequest: (input: {
    readonly cwd: string;
    readonly baseBranch: string;
    readonly headSelector: string;
    readonly title: string;
    readonly bodyFile: string;
    readonly draft?: boolean;
  }) => Effect.Effect<void, GitHubCliError>;

  /**
   * Resolve repository default branch through GitHub metadata.
   */
  readonly getDefaultBranch: (input: {
    readonly cwd: string;
  }) => Effect.Effect<string | null, GitHubCliError>;

  /**
   * Checkout a pull request into the current repository worktree.
   */
  readonly checkoutPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
    readonly force?: boolean;
  }) => Effect.Effect<void, GitHubCliError>;

  /**
   * Get GitHub CLI auth status.
   */
  readonly getAuthStatus: (input: {
    readonly cwd: string;
  }) => Effect.Effect<string, GitHubCliError>;
}

/**
 * GitHubCli - Service tag for GitHub CLI process execution.
 */
export class GitHubCli extends Context.Service<GitHubCli, GitHubCliShape>()(
  "tabs/git/Services/GitHubCli",
) {}
