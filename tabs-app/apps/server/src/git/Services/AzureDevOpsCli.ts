import * as Context from "effect/Context";
import type { Effect } from "effect";
import type { ProcessRunResult } from "../../processRunner";
import type { AzureDevOpsCliError } from "../Errors.ts";
import type {
  GitCreatePullRequestInput,
  GitMutatePullRequestInput,
  GitResolvedPullRequest,
} from "@tabs/contracts";

export interface AzureDevOpsCliShape {
  readonly execute: (input: {
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly timeoutMs?: number;
  }) => Effect.Effect<ProcessRunResult, AzureDevOpsCliError>;

  readonly getAuthStatus: (input: {
    readonly cwd: string;
  }) => Effect.Effect<string, AzureDevOpsCliError>;

  readonly listPullRequests: (input: {
    readonly cwd: string;
    readonly state: "all" | "open" | "merged" | "closed";
    readonly limit: number;
  }) => Effect.Effect<ReadonlyArray<GitResolvedPullRequest>, AzureDevOpsCliError>;

  readonly getPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<GitResolvedPullRequest, AzureDevOpsCliError>;

  readonly mutatePullRequest: (
    input: GitMutatePullRequestInput,
  ) => Effect.Effect<void, AzureDevOpsCliError>;

  readonly createPullRequest: (
    input: GitCreatePullRequestInput,
  ) => Effect.Effect<GitResolvedPullRequest, AzureDevOpsCliError>;
}

export class AzureDevOpsCli extends Context.Service<AzureDevOpsCli, AzureDevOpsCliShape>()(
  "tabs/git/Services/AzureDevOpsCli",
) {}
