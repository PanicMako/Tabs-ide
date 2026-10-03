import * as Context from "effect/Context";
import type { Effect } from "effect";
import type { ProcessRunResult } from "../../processRunner";
import type { GitLabCliError } from "../Errors.ts";
import type {
  GitCreatePullRequestInput,
  GitMutatePullRequestInput,
  GitResolvedPullRequest,
} from "@tabs/contracts";

export interface GitLabCliShape {
  readonly execute: (input: {
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly timeoutMs?: number;
  }) => Effect.Effect<ProcessRunResult, GitLabCliError>;

  readonly getAuthStatus: (input: {
    readonly cwd: string;
  }) => Effect.Effect<string, GitLabCliError>;

  readonly listPullRequests: (input: {
    readonly cwd: string;
    readonly state: "all" | "open" | "merged" | "closed";
    readonly limit: number;
  }) => Effect.Effect<ReadonlyArray<GitResolvedPullRequest>, GitLabCliError>;

  readonly getPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<GitResolvedPullRequest, GitLabCliError>;

  readonly getPullRequestReviewThreads: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<NonNullable<GitResolvedPullRequest["reviewThreads"]>, GitLabCliError>;

  readonly mutatePullRequest: (
    input: GitMutatePullRequestInput,
  ) => Effect.Effect<void, GitLabCliError>;

  readonly createPullRequest: (
    input: GitCreatePullRequestInput & { readonly bodyFile: string },
  ) => Effect.Effect<void, GitLabCliError>;
}

export class GitLabCli extends Context.Service<GitLabCli, GitLabCliShape>()(
  "tabs/git/Services/GitLabCli",
) {}
