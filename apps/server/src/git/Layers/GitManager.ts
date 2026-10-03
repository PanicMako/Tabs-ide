import * as Context from "effect/Context";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";

import { Effect, FileSystem, Layer, Path } from "effect";
import {
  GitActionProgressEvent,
  GitActionProgressPhase,
  type GitResolvedPullRequest,
  type GitStackedAction,
  ModelSelection,
  type GitGenerateReviewResult,
} from "@tabs/contracts";
import {
  resolveAutoFeatureBranchName,
  sanitizeBranchFragment,
  sanitizeFeatureBranchName,
} from "@tabs/shared/git";

import { GitManagerError, type GitManagerServiceError } from "../Errors.ts";
import { setCachedPushAccess } from "../Services/PushAccessCache.ts";
import {
  GitManager,
  type GitActionProgressReporter,
  type GitManagerShape,
  type GitRunStackedActionOptions,
} from "../Services/GitManager.ts";
import { GitCore } from "../Services/GitCore.ts";
import { GitHubCli, type GitHubPullRequestSummary } from "../Services/GitHubCli.ts";
import { PullRequestReadCache } from "../Services/PullRequestReadCache.ts";
import { parseGitHubAuthStatus } from "../Services/GitEnvironment.ts";
import { makeGitLabCli } from "./GitLabCli.ts";
import { makeAzureDevOpsCli } from "./AzureDevOpsCli.ts";
import { makeBitbucketPullRequestApi } from "./BitbucketPullRequestApi.ts";
import { TextGeneration } from "../../textGeneration/TextGeneration";
import { ServerSettingsService } from "../../serverSettings.ts";
import { runStaticAnalysis } from "../../staticAnalysis/StaticAnalysisService.ts";
import { runGitHubStackAction } from "../githubStackActions.ts";
import {
  buildStaticAnalysisContext,
  extractChangedFilesFromPatch,
} from "../../staticAnalysis/ContextBuilder.ts";
import { runRepoContext, loadTabsReviewJson } from "../../repoContext/RepoContextService.ts";
import { runReviewPasses } from "../../review/ReviewPassRunner.ts";
import {
  prepareIncrementalDiff,
  mergeIncrementalFindings,
} from "../../review/IncrementalDiffBuilder.ts";
import { saveReviewState } from "../../review/ReviewStateStore.ts";
import { recordFeedback } from "../../review/FeedbackStore.ts";
import {
  addReviewHistoryRecord,
  getReviewHistory as fetchReviewHistoryStore,
} from "../../review/ReviewHistoryStore.ts";
import { ProjectSetupScriptRunner } from "../../project/ProjectSetupScriptRunner.ts";
import { VcsAutoPullPolicy } from "../Services/VcsAutoPullPolicy.ts";

const COMMIT_TIMEOUT_MS = 10 * 60_000;
const MAX_PROGRESS_TEXT_LENGTH = 500;
type StripProgressContext<T> = T extends any ? Omit<T, "actionId" | "cwd" | "action"> : never;
type GitActionProgressPayload = StripProgressContext<GitActionProgressEvent>;

interface OpenPrInfo {
  number: number;
  title: string;
  url: string;
  baseRefName: string;
  headRefName: string;
}

interface PullRequestInfo extends OpenPrInfo {
  state: "open" | "closed" | "merged";
  updatedAt: string | null;
}

type ResolvedPullRequest = GitResolvedPullRequest;

interface PullRequestHeadRemoteInfo {
  isCrossRepository?: boolean;
  headRepositoryNameWithOwner?: string | null;
  headRepositoryOwnerLogin?: string | null;
}

interface BranchHeadContext {
  localBranch: string;
  headBranch: string;
  headSelectors: ReadonlyArray<string>;
  preferredHeadSelector: string;
  remoteName: string | null;
  headRepositoryNameWithOwner: string | null;
  headRepositoryOwnerLogin: string | null;
  isCrossRepository: boolean;
}

function isCommitAction(
  action: GitStackedAction,
): action is "commit" | "commit_push" | "commit_push_pr" {
  return action === "commit" || action === "commit_push" || action === "commit_push_pr";
}

function parseRepositoryNameFromPullRequestUrl(url: string): string | null {
  const trimmed = url.trim();
  const match = /^https:\/\/github\.com\/[^/]+\/([^/]+)\/pull\/\d+(?:\/.*)?$/i.exec(trimmed);
  const repositoryName = match?.[1]?.trim() ?? "";
  return repositoryName.length > 0 ? repositoryName : null;
}

function resolveHeadRepositoryNameWithOwner(
  pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
): string | null {
  const explicitRepository = pullRequest.headRepositoryNameWithOwner?.trim() ?? "";
  if (explicitRepository.length > 0) {
    return explicitRepository;
  }

  if (!pullRequest.isCrossRepository) {
    return null;
  }

  const ownerLogin = pullRequest.headRepositoryOwnerLogin?.trim() ?? "";
  const repositoryName = parseRepositoryNameFromPullRequestUrl(pullRequest.url);
  if (ownerLogin.length === 0 || !repositoryName) {
    return null;
  }

  return `${ownerLogin}/${repositoryName}`;
}

function resolvePullRequestWorktreeLocalBranchName(
  pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
): string {
  if (!pullRequest.isCrossRepository) {
    return pullRequest.headBranch;
  }

  const sanitizedHeadBranch = sanitizeBranchFragment(pullRequest.headBranch).trim();
  const suffix = sanitizedHeadBranch.length > 0 ? sanitizedHeadBranch : "head";
  return `tabs/pr-${pullRequest.number}/${suffix}`;
}

function parseGitHubRepositoryNameWithOwnerFromRemoteUrl(url: string | null): string | null {
  const trimmed = url?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }

  const match =
    /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/|git:\/\/github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i.exec(
      trimmed,
    );
  const repositoryNameWithOwner = match?.[1]?.trim() ?? "";
  return repositoryNameWithOwner.length > 0 ? repositoryNameWithOwner : null;
}

function parseRepositoryOwnerLogin(nameWithOwner: string | null): string | null {
  const trimmed = nameWithOwner?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }
  const [ownerLogin] = trimmed.split("/");
  const normalizedOwnerLogin = ownerLogin?.trim() ?? "";
  return normalizedOwnerLogin.length > 0 ? normalizedOwnerLogin : null;
}

function parsePullRequestList(raw: unknown): PullRequestInfo[] {
  if (!Array.isArray(raw)) return [];

  const parsed: PullRequestInfo[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const number = record.number;
    const title = record.title;
    const url = record.url;
    const baseRefName = record.baseRefName;
    const headRefName = record.headRefName;
    const state = record.state;
    const mergedAt = record.mergedAt;
    const updatedAt = record.updatedAt;
    if (typeof number !== "number" || !Number.isInteger(number) || number <= 0) {
      continue;
    }
    if (
      typeof title !== "string" ||
      typeof url !== "string" ||
      typeof baseRefName !== "string" ||
      typeof headRefName !== "string"
    ) {
      continue;
    }

    let normalizedState: "open" | "closed" | "merged";
    if ((typeof mergedAt === "string" && mergedAt.trim().length > 0) || state === "MERGED") {
      normalizedState = "merged";
    } else if (state === "OPEN" || state === undefined || state === null) {
      normalizedState = "open";
    } else if (state === "CLOSED") {
      normalizedState = "closed";
    } else {
      continue;
    }

    parsed.push({
      number,
      title,
      url,
      baseRefName,
      headRefName,
      state: normalizedState,
      updatedAt: typeof updatedAt === "string" && updatedAt.trim().length > 0 ? updatedAt : null,
    });
  }
  return parsed;
}

function gitManagerError(operation: string, detail: string, cause?: unknown): GitManagerError {
  return new GitManagerError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function limitContext(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated]`;
}

function sanitizeCommitMessage(generated: {
  subject: string;
  body: string;
  branch?: string | undefined;
}): {
  subject: string;
  body: string;
  branch?: string | undefined;
} {
  const rawSubject = generated.subject.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const subject = rawSubject.replace(/[.]+$/g, "").trim();
  const safeSubject = subject.length > 0 ? subject.slice(0, 72).trimEnd() : "Update project files";
  return {
    subject: safeSubject,
    body: generated.body.trim(),
    ...(generated.branch !== undefined ? { branch: generated.branch } : {}),
  };
}

function sanitizeProgressText(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length <= MAX_PROGRESS_TEXT_LENGTH) {
    return trimmed;
  }
  return trimmed.slice(0, MAX_PROGRESS_TEXT_LENGTH).trimEnd();
}

interface CommitAndBranchSuggestion {
  subject: string;
  body: string;
  branch?: string | undefined;
  commitMessage: string;
}

function formatCommitMessage(subject: string, body: string): string {
  const trimmedBody = body.trim();
  if (trimmedBody.length === 0) {
    return subject;
  }
  return `${subject}\n\n${trimmedBody}`;
}

function parseCustomCommitMessage(raw: string): { subject: string; body: string } | null {
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    return null;
  }

  const [firstLine, ...rest] = normalized.split("\n");
  const subject = firstLine?.trim() ?? "";
  if (subject.length === 0) {
    return null;
  }

  return {
    subject,
    body: rest.join("\n").trim(),
  };
}

function extractBranchFromRef(ref: string): string {
  const normalized = ref.trim();

  if (normalized.startsWith("refs/remotes/")) {
    const withoutPrefix = normalized.slice("refs/remotes/".length);
    const firstSlash = withoutPrefix.indexOf("/");
    if (firstSlash === -1) {
      return withoutPrefix.trim();
    }
    return withoutPrefix.slice(firstSlash + 1).trim();
  }

  const firstSlash = normalized.indexOf("/");
  if (firstSlash === -1) {
    return normalized;
  }
  return normalized.slice(firstSlash + 1).trim();
}

function appendUnique(values: string[], next: string | null | undefined): void {
  const trimmed = next?.trim() ?? "";
  if (trimmed.length === 0 || values.includes(trimmed)) {
    return;
  }
  values.push(trimmed);
}

function toStatusPr(pr: PullRequestInfo): {
  number: number;
  title: string;
  url: string;
  baseBranch: string;
  headBranch: string;
  state: "open" | "closed" | "merged";
} {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    baseBranch: pr.baseRefName,
    headBranch: pr.headRefName,
    state: pr.state,
  };
}

function normalizePullRequestReference(reference: string): string {
  const trimmed = reference.trim();
  const hashNumber = /^#(\d+)$/.exec(trimmed);
  return hashNumber?.[1] ?? trimmed;
}

const GITHUB_PULL_REQUEST_CAPABILITIES = {
  provider: "github" as const,
  diff: true,
  create: true,
  search: false,
  actions: [
    "merge",
    "close",
    "reopen",
    "ready",
    "draft",
    "enable_auto_merge",
    "disable_auto_merge",
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
    "edit_pull_request",
    "stack_rebase",
    "stack_merge",
  ] as const,
  mergeMethods: ["merge", "squash", "rebase"] as const,
};

const GITLAB_PULL_REQUEST_CAPABILITIES = {
  provider: "gitlab" as const,
  diff: true,
  create: true,
  search: false,
  actions: [
    "merge",
    "close",
    "reopen",
    "ready",
    "draft",
    "comment",
    "approve",
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
    "edit_pull_request",
  ] as const,
  mergeMethods: ["merge", "squash", "rebase"] as const,
};

const AZURE_DEVOPS_PULL_REQUEST_CAPABILITIES = {
  provider: "azure-devops" as const,
  diff: false,
  create: true,
  search: false,
  actions: [
    "merge",
    "close",
    "reopen",
    "ready",
    "draft",
    "add_reviewer",
    "remove_reviewer",
    "edit_pull_request",
  ] as const,
  mergeMethods: ["merge", "squash"] as const,
};

const BITBUCKET_PULL_REQUEST_CAPABILITIES = {
  provider: "bitbucket" as const,
  diff: true,
  create: true,
  search: true,
  actions: [
    "merge",
    "close",
    "comment",
    "approve",
    "request_changes",
    "add_reviewer",
    "remove_reviewer",
    "edit_pull_request",
    "inline_comment",
    "reply_to_thread",
    "resolve_thread",
    "unresolve_thread",
  ] as const,
  mergeMethods: ["merge", "squash", "rebase"] as const,
};

function pullRequestCapabilities(provider: "github" | "gitlab" | "azure-devops" | "bitbucket") {
  return provider === "github"
    ? GITHUB_PULL_REQUEST_CAPABILITIES
    : provider === "gitlab"
      ? GITLAB_PULL_REQUEST_CAPABILITIES
      : provider === "azure-devops"
        ? AZURE_DEVOPS_PULL_REQUEST_CAPABILITIES
        : BITBUCKET_PULL_REQUEST_CAPABILITIES;
}

function canonicalizeExistingPath(value: string): string {
  try {
    return realpathSync.native(value);
  } catch {
    return value;
  }
}

function toResolvedPullRequest(pr: GitHubPullRequestSummary): ResolvedPullRequest {
  return {
    provider: "github",
    number: pr.number,
    title: pr.title,
    url: pr.url,
    baseBranch: pr.baseRefName,
    headBranch: pr.headRefName,
    state: pr.state ?? "open",
    ...(typeof pr.isDraft === "boolean" ? { isDraft: pr.isDraft } : {}),
    ...(pr.author !== undefined ? { author: pr.author } : {}),
    ...(pr.labels ? { labels: [...pr.labels] } : {}),
    ...(pr.reviewDecision ? { reviewDecision: pr.reviewDecision } : {}),
    ...(pr.mergeability ? { mergeability: pr.mergeability } : {}),
    ...(pr.checksState ? { checksState: pr.checksState } : {}),
    ...(typeof pr.additions === "number" ? { additions: pr.additions } : {}),
    ...(typeof pr.deletions === "number" ? { deletions: pr.deletions } : {}),
    ...(typeof pr.changedFiles === "number" ? { changedFiles: pr.changedFiles } : {}),
    ...(pr.createdAt ? { createdAt: pr.createdAt } : {}),
    ...(pr.updatedAt ? { updatedAt: pr.updatedAt } : {}),
    ...(pr.body !== undefined ? { body: pr.body } : {}),
    ...(pr.reviewers ? { reviewers: [...pr.reviewers] } : {}),
    ...(pr.checks ? { checks: [...pr.checks] } : {}),
    ...(pr.comments ? { comments: [...pr.comments] } : {}),
    ...(pr.reviews ? { reviews: [...pr.reviews] } : {}),
    ...(pr.commits
      ? {
          commits: pr.commits.map((commit) => ({
            ...commit,
            authors: [...commit.authors],
          })),
        }
      : {}),
  };
}

function shouldPreferSshRemote(url: string | null): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  return trimmed.startsWith("git@") || trimmed.startsWith("ssh://");
}

function toPullRequestHeadRemoteInfo(pr: {
  isCrossRepository?: boolean;
  headRepositoryNameWithOwner?: string | null;
  headRepositoryOwnerLogin?: string | null;
}): PullRequestHeadRemoteInfo {
  return {
    ...(pr.isCrossRepository !== undefined ? { isCrossRepository: pr.isCrossRepository } : {}),
    ...(pr.headRepositoryNameWithOwner !== undefined
      ? { headRepositoryNameWithOwner: pr.headRepositoryNameWithOwner }
      : {}),
    ...(pr.headRepositoryOwnerLogin !== undefined
      ? { headRepositoryOwnerLogin: pr.headRepositoryOwnerLogin }
      : {}),
  };
}

function parseRepositoryIdentifier(remoteUrl: string, cwd: string): string {
  if (remoteUrl && remoteUrl.trim().length > 0) {
    const trimmed = remoteUrl.trim();
    const match = trimmed.match(/[:/]([^/:]+\/[^/:]+?)(?:\.git)?$/);
    if (match && match[1]) {
      return match[1].toLowerCase();
    }
    return trimmed.toLowerCase();
  }
  const parts = cwd.split(/[/\\]/);
  return (parts[parts.length - 1] || "default").toLowerCase();
}

export const makeGitManager = Effect.gen(function* () {
  const gitCore = yield* GitCore;
  const gitHubCli = yield* GitHubCli;
  const gitLabCli = yield* makeGitLabCli;
  const azureDevOpsCli = yield* makeAzureDevOpsCli;
  const bitbucketApi = yield* makeBitbucketPullRequestApi;
  const textGeneration = yield* TextGeneration;
  const serverSettingsService = yield* ServerSettingsService;
  const pullRequestReadCache = yield* PullRequestReadCache;
  const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;
  const autoPullPolicy = yield* VcsAutoPullPolicy;

  const repositoryRemoteUrl = (cwd: string) =>
    Effect.gen(function* () {
      const origin = yield* gitCore
        .execute({
          operation: "repositoryRemoteUrl.origin",
          cwd,
          args: ["remote", "get-url", "origin"],
        })
        .pipe(
          Effect.map((result) => result.stdout.trim()),
          Effect.catch(() => Effect.succeed("")),
        );
      if (origin.length > 0) return origin;
      const remoteList = yield* gitCore
        .execute({
          operation: "repositoryRemoteUrl.list",
          cwd,
          args: ["remote", "-v"],
        })
        .pipe(
          Effect.map((result) => result.stdout.split(/\r?\n/)[0]?.split(/\s+/)[1]?.trim() ?? ""),
          Effect.catch(() => Effect.succeed("")),
        );
      return remoteList;
    });

  const repositoryProvider = (cwd: string) =>
    Effect.gen(function* () {
      const remoteUrl = yield* repositoryRemoteUrl(cwd);
      const normalized = remoteUrl.toLowerCase();
      if (normalized.includes("github")) return "github" as const;
      if (normalized.includes("gitlab")) return "gitlab" as const;
      if (normalized.includes("bitbucket")) return "bitbucket" as const;
      if (normalized.includes("dev.azure.com") || normalized.includes("visualstudio.com")) {
        return "azure-devops" as const;
      }
      return "unknown" as const;
    });

  const resolveAccountForProvider = (provider: string, cwd: string) =>
    Effect.gen(function* () {
      if (provider === "github") {
        const authStatus = yield* gitHubCli.getAuthStatus({ cwd }).pipe(
          Effect.map((out) => {
            const parsed = parseGitHubAuthStatus(out);
            const active = parsed.find((a) => a.active);
            return active?.login ?? parsed[0]?.login ?? null;
          }),
          Effect.catch(() => Effect.succeed(null)),
        );
        if (authStatus) return authStatus;
      } else if (provider === "gitlab") {
        const authStatus = yield* gitLabCli.getAuthStatus({ cwd }).pipe(
          Effect.map((out) => {
            const match = out.match(/Logged in to [^\s]+ as ([^\s(]+)/i);
            return match ? match[1] : null;
          }),
          Effect.catch(() => Effect.succeed(null)),
        );
        if (authStatus) return authStatus;
      }
      const email = yield* gitCore
        .execute({
          operation: "gitConfig.userEmail",
          cwd,
          args: ["config", "user.email"],
        })
        .pipe(
          Effect.map((r) => r.stdout.trim()),
          Effect.catch(() => Effect.succeed("")),
        );
      if (email.length > 0) return email;
      return "anonymous";
    });

  const requireSupportedPullRequestProvider = (cwd: string) =>
    repositoryProvider(cwd).pipe(
      Effect.flatMap((provider) =>
        provider === "github" ||
        provider === "gitlab" ||
        provider === "azure-devops" ||
        provider === "bitbucket" ||
        provider === "unknown"
          ? Effect.succeed(provider === "unknown" ? ("github" as const) : provider)
          : Effect.fail(
              gitManagerError(
                "pullRequestProvider",
                `${provider} pull-request workflows are not implemented yet.`,
              ),
            ),
      ),
    );

  const createProgressEmitter = (
    input: { cwd: string; action: GitStackedAction },
    options?: GitRunStackedActionOptions,
  ) => {
    const actionId = options?.actionId ?? randomUUID();
    const reporter = options?.progressReporter;

    const emit = (event: GitActionProgressPayload) =>
      reporter
        ? reporter.publish({
            actionId,
            cwd: input.cwd,
            action: input.action,
            ...event,
          } as GitActionProgressEvent)
        : Effect.void;

    return {
      actionId,
      emit,
    };
  };

  const configurePullRequestHeadUpstream = (
    cwd: string,
    pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
    localBranch = pullRequest.headBranch,
  ) =>
    Effect.gen(function* () {
      const repositoryNameWithOwner = resolveHeadRepositoryNameWithOwner(pullRequest) ?? "";
      if (repositoryNameWithOwner.length === 0) {
        return;
      }

      const cloneUrls = yield* gitHubCli.getRepositoryCloneUrls({
        cwd,
        repository: repositoryNameWithOwner,
      });
      const originRemoteUrl = yield* gitCore.readConfigValue(cwd, "remote.origin.url");
      const remoteUrl = shouldPreferSshRemote(originRemoteUrl) ? cloneUrls.sshUrl : cloneUrls.url;
      const preferredRemoteName =
        pullRequest.headRepositoryOwnerLogin?.trim() ||
        repositoryNameWithOwner.split("/")[0]?.trim() ||
        "fork";
      const remoteName = yield* gitCore.ensureRemote({
        cwd,
        preferredName: preferredRemoteName,
        url: remoteUrl,
      });

      yield* gitCore.setBranchUpstream({
        cwd,
        branch: localBranch,
        remoteName,
        remoteBranch: pullRequest.headBranch,
      });
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning(
          `GitManager.configurePullRequestHeadUpstream: failed to configure upstream for ${localBranch} -> ${pullRequest.headBranch} in ${cwd}: ${error.message}`,
        ).pipe(Effect.asVoid),
      ),
    );

  const materializePullRequestHeadBranch = (
    cwd: string,
    pullRequest: ResolvedPullRequest & PullRequestHeadRemoteInfo,
    localBranch = pullRequest.headBranch,
  ) =>
    Effect.gen(function* () {
      const repositoryNameWithOwner = resolveHeadRepositoryNameWithOwner(pullRequest) ?? "";

      if (repositoryNameWithOwner.length === 0) {
        yield* gitCore.fetchPullRequestBranch({
          cwd,
          prNumber: pullRequest.number,
          branch: localBranch,
        });
        return;
      }

      const cloneUrls = yield* gitHubCli.getRepositoryCloneUrls({
        cwd,
        repository: repositoryNameWithOwner,
      });
      const originRemoteUrl = yield* gitCore.readConfigValue(cwd, "remote.origin.url");
      const remoteUrl = shouldPreferSshRemote(originRemoteUrl) ? cloneUrls.sshUrl : cloneUrls.url;
      const preferredRemoteName =
        pullRequest.headRepositoryOwnerLogin?.trim() ||
        repositoryNameWithOwner.split("/")[0]?.trim() ||
        "fork";
      const remoteName = yield* gitCore.ensureRemote({
        cwd,
        preferredName: preferredRemoteName,
        url: remoteUrl,
      });

      yield* gitCore.fetchRemoteBranch({
        cwd,
        remoteName,
        remoteBranch: pullRequest.headBranch,
        localBranch,
      });
      yield* gitCore.setBranchUpstream({
        cwd,
        branch: localBranch,
        remoteName,
        remoteBranch: pullRequest.headBranch,
      });
    }).pipe(
      Effect.catch(() =>
        gitCore.fetchPullRequestBranch({
          cwd,
          prNumber: pullRequest.number,
          branch: localBranch,
        }),
      ),
    );
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const tempDir = process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? "/tmp";

  const readConfigValueNullable = (cwd: string, key: string) =>
    gitCore.readConfigValue(cwd, key).pipe(Effect.catch(() => Effect.succeed(null)));

  const resolveRemoteRepositoryContext = (cwd: string, remoteName: string | null) =>
    Effect.gen(function* () {
      if (!remoteName) {
        return {
          repositoryNameWithOwner: null,
          ownerLogin: null,
        };
      }

      const remoteUrl = yield* readConfigValueNullable(cwd, `remote.${remoteName}.url`);
      const repositoryNameWithOwner = parseGitHubRepositoryNameWithOwnerFromRemoteUrl(remoteUrl);
      return {
        repositoryNameWithOwner,
        ownerLogin: parseRepositoryOwnerLogin(repositoryNameWithOwner),
      };
    });

  const resolveBranchHeadContext = (
    cwd: string,
    details: { branch: string; upstreamRef: string | null },
  ) =>
    Effect.gen(function* () {
      const remoteName = yield* readConfigValueNullable(cwd, `branch.${details.branch}.remote`);
      const headBranchFromUpstream = details.upstreamRef
        ? extractBranchFromRef(details.upstreamRef)
        : "";
      const headBranch =
        headBranchFromUpstream.length > 0 ? headBranchFromUpstream : details.branch;

      const [remoteRepository, originRepository] = yield* Effect.all(
        [
          resolveRemoteRepositoryContext(cwd, remoteName),
          resolveRemoteRepositoryContext(cwd, "origin"),
        ],
        { concurrency: "unbounded" },
      );

      const isCrossRepository =
        remoteRepository.repositoryNameWithOwner !== null &&
        originRepository.repositoryNameWithOwner !== null
          ? remoteRepository.repositoryNameWithOwner.toLowerCase() !==
            originRepository.repositoryNameWithOwner.toLowerCase()
          : remoteName !== null &&
            remoteName !== "origin" &&
            remoteRepository.repositoryNameWithOwner !== null;

      const ownerHeadSelector =
        remoteRepository.ownerLogin && headBranch.length > 0
          ? `${remoteRepository.ownerLogin}:${headBranch}`
          : null;
      const remoteAliasHeadSelector =
        remoteName && headBranch.length > 0 ? `${remoteName}:${headBranch}` : null;
      const shouldProbeRemoteOwnedSelectors =
        isCrossRepository || (remoteName !== null && remoteName !== "origin");

      const headSelectors: string[] = [];
      if (isCrossRepository && shouldProbeRemoteOwnedSelectors) {
        appendUnique(headSelectors, ownerHeadSelector);
        appendUnique(
          headSelectors,
          remoteAliasHeadSelector !== ownerHeadSelector ? remoteAliasHeadSelector : null,
        );
      }
      appendUnique(headSelectors, details.branch);
      appendUnique(headSelectors, headBranch !== details.branch ? headBranch : null);
      if (!isCrossRepository && shouldProbeRemoteOwnedSelectors) {
        appendUnique(headSelectors, ownerHeadSelector);
        appendUnique(
          headSelectors,
          remoteAliasHeadSelector !== ownerHeadSelector ? remoteAliasHeadSelector : null,
        );
      }

      return {
        localBranch: details.branch,
        headBranch,
        headSelectors,
        preferredHeadSelector:
          ownerHeadSelector && isCrossRepository ? ownerHeadSelector : headBranch,
        remoteName,
        headRepositoryNameWithOwner: remoteRepository.repositoryNameWithOwner,
        headRepositoryOwnerLogin: remoteRepository.ownerLogin,
        isCrossRepository,
      } satisfies BranchHeadContext;
    });

  const findOpenPr = (cwd: string, headSelectors: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      for (const headSelector of headSelectors) {
        const pullRequests = yield* gitHubCli.listOpenPullRequests({
          cwd,
          headSelector,
          limit: 1,
        });

        const [firstPullRequest] = pullRequests;
        if (firstPullRequest) {
          return {
            number: firstPullRequest.number,
            title: firstPullRequest.title,
            url: firstPullRequest.url,
            baseRefName: firstPullRequest.baseRefName,
            headRefName: firstPullRequest.headRefName,
            state: "open",
            updatedAt: null,
          } satisfies PullRequestInfo;
        }
      }

      return null;
    });

  const findLatestPr = (cwd: string, details: { branch: string; upstreamRef: string | null }) =>
    Effect.gen(function* () {
      const headContext = yield* resolveBranchHeadContext(cwd, details);
      const parsedByNumber = new Map<number, PullRequestInfo>();

      for (const headSelector of headContext.headSelectors) {
        const stdout = yield* gitHubCli
          .execute({
            cwd,
            args: [
              "pr",
              "list",
              "--head",
              headSelector,
              "--state",
              "all",
              "--limit",
              "20",
              "--json",
              "number,title,url,baseRefName,headRefName,state,mergedAt,updatedAt",
            ],
          })
          .pipe(Effect.map((result) => result.stdout));

        const raw = stdout.trim();
        if (raw.length === 0) {
          continue;
        }

        const parsedJson = yield* Effect.try({
          try: () => JSON.parse(raw) as unknown,
          catch: (cause) =>
            gitManagerError("findLatestPr", "GitHub CLI returned invalid PR list JSON.", cause),
        });

        for (const pr of parsePullRequestList(parsedJson)) {
          parsedByNumber.set(pr.number, pr);
        }
      }

      const parsed = Array.from(parsedByNumber.values()).toSorted((a, b) => {
        const left = a.updatedAt ? Date.parse(a.updatedAt) : 0;
        const right = b.updatedAt ? Date.parse(b.updatedAt) : 0;
        return right - left;
      });

      const latestOpenPr = parsed.find((pr) => pr.state === "open");
      if (latestOpenPr) {
        return latestOpenPr;
      }
      return parsed[0] ?? null;
    });

  const resolveBaseBranch = (
    cwd: string,
    branch: string,
    upstreamRef: string | null,
    headContext: Pick<BranchHeadContext, "isCrossRepository">,
  ) =>
    Effect.gen(function* () {
      const configured = yield* gitCore.readConfigValue(cwd, `branch.${branch}.gh-merge-base`);
      if (configured) return configured;

      if (upstreamRef && !headContext.isCrossRepository) {
        const upstreamBranch = extractBranchFromRef(upstreamRef);
        if (upstreamBranch.length > 0 && upstreamBranch !== branch) {
          return upstreamBranch;
        }
      }

      const defaultFromGh = yield* gitHubCli
        .getDefaultBranch({ cwd })
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (defaultFromGh) {
        return defaultFromGh;
      }

      return "main";
    });

  const resolveCommitAndBranchSuggestion = (input: {
    cwd: string;
    branch: string | null;
    commitMessage?: string;
    /** When true, also produce a semantic feature branch name. */
    includeBranch?: boolean;
    filePaths?: readonly string[];
    modelSelection: ModelSelection;
  }) =>
    Effect.gen(function* () {
      const context = yield* gitCore.prepareCommitContext(input.cwd, input.filePaths);
      if (!context) {
        return null;
      }

      const customCommit = parseCustomCommitMessage(input.commitMessage ?? "");
      if (customCommit) {
        return {
          subject: customCommit.subject,
          body: customCommit.body,
          ...(input.includeBranch
            ? { branch: sanitizeFeatureBranchName(customCommit.subject) }
            : {}),
          commitMessage: formatCommitMessage(customCommit.subject, customCommit.body),
        };
      }

      const generated = yield* textGeneration
        .generateCommitMessage({
          cwd: input.cwd,
          branch: input.branch,
          stagedSummary: limitContext(context.stagedSummary, 8_000),
          stagedPatch: limitContext(context.stagedPatch, 50_000),
          ...(input.includeBranch ? { includeBranch: true } : {}),
          modelSelection: input.modelSelection,
        })
        .pipe(Effect.map((result) => sanitizeCommitMessage(result)));

      return {
        subject: generated.subject,
        body: generated.body,
        ...(generated.branch !== undefined ? { branch: generated.branch } : {}),
        commitMessage: formatCommitMessage(generated.subject, generated.body),
      };
    });

  const runCommitStep = (
    modelSelection: ModelSelection,
    cwd: string,
    action: "commit" | "commit_push" | "commit_push_pr",
    branch: string | null,
    commitMessage?: string,
    preResolvedSuggestion?: CommitAndBranchSuggestion,
    filePaths?: readonly string[],
    progressReporter?: GitActionProgressReporter,
    actionId?: string,
  ) =>
    Effect.gen(function* () {
      const emit = (event: GitActionProgressPayload) =>
        progressReporter && actionId
          ? progressReporter.publish({
              actionId,
              cwd,
              action,
              ...event,
            } as GitActionProgressEvent)
          : Effect.void;

      let suggestion: CommitAndBranchSuggestion | null | undefined = preResolvedSuggestion;
      if (!suggestion) {
        const needsGeneration = !commitMessage?.trim();
        if (needsGeneration) {
          yield* emit({
            kind: "phase_started",
            phase: "commit",
            label: "Generating commit message...",
          });
        }
        suggestion = yield* resolveCommitAndBranchSuggestion({
          cwd,
          branch,
          ...(commitMessage ? { commitMessage } : {}),
          ...(filePaths ? { filePaths } : {}),
          modelSelection,
        });
      }
      if (!suggestion) {
        return { status: "skipped_no_changes" as const };
      }

      yield* emit({
        kind: "phase_started",
        phase: "commit",
        label: "Committing...",
      });

      let currentHookName: string | null = null;
      const commitProgress =
        progressReporter && actionId
          ? {
              onOutputLine: ({ stream, text }: { stream: "stdout" | "stderr"; text: string }) => {
                const sanitized = sanitizeProgressText(text);
                if (!sanitized) {
                  return Effect.void;
                }
                return emit({
                  kind: "hook_output",
                  hookName: currentHookName,
                  stream,
                  text: sanitized,
                });
              },
              onHookStarted: (hookName: string) => {
                currentHookName = hookName;
                return emit({
                  kind: "hook_started",
                  hookName,
                });
              },
              onHookFinished: ({
                hookName,
                exitCode,
                durationMs,
              }: {
                hookName: string;
                exitCode: number | null;
                durationMs: number | null;
              }) => {
                if (currentHookName === hookName) {
                  currentHookName = null;
                }
                return emit({
                  kind: "hook_finished",
                  hookName,
                  exitCode,
                  durationMs,
                });
              },
            }
          : null;
      const { commitSha } = yield* gitCore.commit(cwd, suggestion.subject, suggestion.body, {
        timeoutMs: COMMIT_TIMEOUT_MS,
        ...(commitProgress ? { progress: commitProgress } : {}),
      });
      if (currentHookName !== null) {
        yield* emit({
          kind: "hook_finished",
          hookName: currentHookName,
          exitCode: 0,
          durationMs: null,
        });
        currentHookName = null;
      }
      return {
        status: "created" as const,
        commitSha,
        subject: suggestion.subject,
      };
    });

  const runPrStep = (modelSelection: ModelSelection, cwd: string, fallbackBranch: string | null) =>
    Effect.gen(function* () {
      const details = yield* gitCore.statusDetails(cwd);
      const branch = details.branch ?? fallbackBranch;
      if (!branch) {
        return yield* gitManagerError(
          "runPrStep",
          "Cannot create a pull request from detached HEAD.",
        );
      }
      if (!details.hasUpstream) {
        return yield* gitManagerError(
          "runPrStep",
          "Current branch has not been pushed. Push before creating a PR.",
        );
      }

      const headContext = yield* resolveBranchHeadContext(cwd, {
        branch,
        upstreamRef: details.upstreamRef,
      });

      const existing = yield* findOpenPr(cwd, headContext.headSelectors);
      if (existing) {
        return {
          status: "opened_existing" as const,
          url: existing.url,
          number: existing.number,
          baseBranch: existing.baseRefName,
          headBranch: existing.headRefName,
          title: existing.title,
        };
      }

      const baseBranch = yield* resolveBaseBranch(cwd, branch, details.upstreamRef, headContext);
      const rangeContext = yield* gitCore.readRangeContext(cwd, baseBranch);

      const generated = yield* textGeneration.generatePrContent({
        cwd,
        baseBranch,
        headBranch: headContext.headBranch,
        commitSummary: limitContext(rangeContext.commitSummary, 20_000),
        diffSummary: limitContext(rangeContext.diffSummary, 20_000),
        diffPatch: limitContext(rangeContext.diffPatch, 60_000),
        modelSelection,
      });

      const bodyFile = path.join(tempDir, `tabs-pr-body-${process.pid}-${randomUUID()}.md`);
      yield* fileSystem
        .writeFileString(bodyFile, generated.body)
        .pipe(
          Effect.mapError((cause) =>
            gitManagerError("runPrStep", "Failed to write pull request body temp file.", cause),
          ),
        );
      yield* gitHubCli
        .createPullRequest({
          cwd,
          baseBranch,
          headSelector: headContext.preferredHeadSelector,
          title: generated.title,
          bodyFile,
        })
        .pipe(Effect.ensuring(fileSystem.remove(bodyFile).pipe(Effect.catch(() => Effect.void))));

      const created = yield* findOpenPr(cwd, headContext.headSelectors);
      if (!created) {
        return {
          status: "created" as const,
          baseBranch,
          headBranch: headContext.headBranch,
          title: generated.title,
        };
      }

      return {
        status: "created" as const,
        url: created.url,
        number: created.number,
        baseBranch: created.baseRefName,
        headBranch: created.headRefName,
        title: created.title,
      };
    });

  const inFlightPulls = new Set<string>();

  const maybeAutoPull = (cwd: string) =>
    Effect.gen(function* () {
      if (inFlightPulls.has(cwd)) {
        return;
      }
      const isEnabled = yield* autoPullPolicy.isEnabled(cwd);
      if (!isEnabled) {
        return;
      }
      const details = yield* gitCore.statusDetails(cwd);
      if (
        !details.branch ||
        !details.hasUpstream ||
        details.hasWorkingTreeChanges ||
        details.aheadCount > 0 ||
        details.behindCount <= 0
      ) {
        return;
      }
      const branchList = yield* gitCore.listBranches({ cwd });
      const isDefaultBranch = branchList.branches.some(
        (b) => b.name === details.branch && b.isDefault,
      );
      if (!isDefaultBranch) {
        return;
      }

      yield* Effect.gen(function* () {
        inFlightPulls.add(cwd);
        const pullResult = yield* gitCore.pullCurrentBranch(cwd);
        yield* Effect.logDebug("Automatic project pull completed", {
          cwd,
          status: pullResult.status,
          branch: pullResult.branch,
        });
      }).pipe(Effect.ensuring(Effect.sync(() => inFlightPulls.delete(cwd))));
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Automatic project pull failed", { cwd, cause }).pipe(Effect.asVoid),
      ),
    );

  const status: GitManagerShape["status"] = Effect.fnUntraced(function* (input) {
    yield* maybeAutoPull(input.cwd);
    const details = yield* gitCore.statusDetails(input.cwd);

    const pr =
      details.branch !== null
        ? yield* findLatestPr(input.cwd, {
            branch: details.branch,
            upstreamRef: details.upstreamRef,
          }).pipe(
            Effect.map((latest) => (latest ? toStatusPr(latest) : null)),
            Effect.catch(() => Effect.succeed(null)),
          )
        : null;

    return {
      branch: details.branch,
      hasWorkingTreeChanges: details.hasWorkingTreeChanges,
      workingTree: details.workingTree,
      staged: details.staged,
      unstaged: details.unstaged,
      conflicted: details.conflicted,
      untracked: details.untracked,
      hasUpstream: details.hasUpstream,
      aheadCount: details.aheadCount,
      behindCount: details.behindCount,
      operation: details.operation,
      pr,
    };
  });

  const resolvePullRequest: GitManagerShape["resolvePullRequest"] = Effect.fnUntraced(
    function* (input) {
      const provider = yield* requireSupportedPullRequestProvider(input.cwd);
      const reference = normalizePullRequestReference(input.reference);
      const remoteUrl = yield* repositoryRemoteUrl(input.cwd);
      const repository = parseRepositoryIdentifier(remoteUrl, input.cwd);
      const account = yield* resolveAccountForProvider(provider, input.cwd);
      const environmentId = "local";

      const scope = {
        provider,
        account,
        environmentId,
        repository,
        prIdentity: reference,
      };

      const fetchPullRequest = Effect.gen(function* () {
        const pullRequest =
          provider === "github"
            ? yield* Effect.gen(function* () {
                const details = yield* gitHubCli.getPullRequest({
                  cwd: input.cwd,
                  reference,
                });
                const files = yield* gitHubCli.getPullRequestFiles({
                  cwd: input.cwd,
                  reference: String(details.number),
                });
                const reviewThreads = yield* gitHubCli.getPullRequestReviewThreads({
                  cwd: input.cwd,
                  reference: String(details.number),
                });
                const stack = yield* gitHubCli.getPullRequestStack({
                  cwd: input.cwd,
                  reference: String(details.number),
                  repository,
                });
                const targetIndex = stack
                  ? stack.layers.findIndex((layer) => layer.number === details.number)
                  : -1;
                const stackMembership = stack
                  ? {
                      number: stack.number,
                      position: targetIndex >= 0 ? targetIndex + 1 : 1,
                      size: stack.layers.length,
                      base: stack.base,
                    }
                  : undefined;
                return {
                  ...toResolvedPullRequest(details),
                  ...(files.length > 0 ? { files } : {}),
                  ...(reviewThreads.length > 0 ? { reviewThreads } : {}),
                  ...(stack ? { stack } : {}),
                  ...(stackMembership ? { stackMembership } : {}),
                };
              })
            : provider === "gitlab"
              ? yield* Effect.gen(function* () {
                  const details = yield* gitLabCli.getPullRequest({
                    cwd: input.cwd,
                    reference,
                  });
                  const reviewThreads = yield* gitLabCli.getPullRequestReviewThreads({
                    cwd: input.cwd,
                    reference: String(details.number),
                  });
                  return {
                    ...details,
                    ...(reviewThreads.length > 0 ? { reviewThreads } : {}),
                  };
                })
              : provider === "azure-devops"
                ? yield* azureDevOpsCli.getPullRequest({
                    cwd: input.cwd,
                    reference,
                  })
                : yield* bitbucketApi.getPullRequest({
                    cwd: input.cwd,
                    reference,
                  });

        return { pullRequest, capabilities: pullRequestCapabilities(provider) };
      });

      return yield* pullRequestReadCache.readOrFetch(scope, fetchPullRequest, {
        ttlMs: 60_000,
        allowStaleOnFailure: true,
      });
    },
  );

  const listPullRequests: GitManagerShape["listPullRequests"] = Effect.fnUntraced(
    function* (input) {
      const provider = yield* requireSupportedPullRequestProvider(input.cwd);
      const limit = input.limit ?? 50;
      const pullRequests =
        provider === "github"
          ? yield* gitHubCli
              .listOpenPullRequests({
                cwd: input.cwd,
                state: input.state ?? "all",
                limit,
              })
              .pipe(Effect.map((list) => list.map(toResolvedPullRequest)))
          : provider === "gitlab"
            ? yield* gitLabCli.listPullRequests({
                cwd: input.cwd,
                state: input.state ?? "all",
                limit,
              })
            : provider === "azure-devops"
              ? yield* azureDevOpsCli.listPullRequests({
                  cwd: input.cwd,
                  state: input.state ?? "all",
                  limit,
                })
              : yield* bitbucketApi.listPullRequests({
                  cwd: input.cwd,
                  state: input.state ?? "all",
                  limit,
                  ...(input.query !== undefined ? { query: input.query } : {}),
                });

      return {
        pullRequests,
        hasMore: pullRequests.length >= limit && limit < 200,
        capabilities: pullRequestCapabilities(provider),
      };
    },
  );

  const mutatePullRequest: GitManagerShape["mutatePullRequest"] = Effect.fnUntraced(
    function* (input) {
      const provider = yield* requireSupportedPullRequestProvider(input.cwd);
      const reference = normalizePullRequestReference(input.reference);
      const capabilities = pullRequestCapabilities(provider);
      if (!(capabilities.actions as readonly string[]).includes(input.action)) {
        return yield* gitManagerError(
          "mutatePullRequest",
          `${provider} does not support the ${input.action.replaceAll("_", " ")} action.`,
        );
      }
      if (
        ["add_reviewer", "remove_reviewer", "add_label", "remove_label"].includes(input.action) &&
        !input.value?.trim()
      ) {
        return yield* gitManagerError(
          "mutatePullRequest",
          `Action ${input.action} requires a reviewer or label value.`,
        );
      }
      if (["comment", "request_changes"].includes(input.action) && !input.body?.trim()) {
        return yield* gitManagerError(
          "mutatePullRequest",
          `Action ${input.action} requires a non-empty message.`,
        );
      }
      if (
        input.action === "edit_pull_request" &&
        input.title === undefined &&
        input.body === undefined
      ) {
        return yield* gitManagerError(
          "mutatePullRequest",
          "Editing a pull request requires a title or description.",
        );
      }
      if (["inline_comment", "reply_to_thread"].includes(input.action) && !input.body?.trim()) {
        return yield* gitManagerError("mutatePullRequest", `${input.action} requires a message.`);
      }
      if (input.action === "inline_comment" && (!input.path?.trim() || !input.line)) {
        return yield* gitManagerError(
          "mutatePullRequest",
          "Inline comments require a file path and positive line number.",
        );
      }
      if (
        ["reply_to_thread", "resolve_thread", "unresolve_thread"].includes(input.action) &&
        !input.threadId?.trim()
      ) {
        return yield* gitManagerError("mutatePullRequest", `${input.action} requires a thread id.`);
      }
      if (
        ["add_reaction", "remove_reaction"].includes(input.action) &&
        (!input.subjectId?.trim() || !input.reaction)
      ) {
        return yield* gitManagerError(
          "mutatePullRequest",
          `${input.action} requires a subject id and reaction.`,
        );
      }
      const mutation = {
        cwd: input.cwd,
        reference,
        action: input.action,
        ...(input.mergeMethod ? { mergeMethod: input.mergeMethod } : {}),
        ...(input.deleteBranch !== undefined ? { deleteBranch: input.deleteBranch } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.value !== undefined ? { value: input.value } : {}),
        ...(input.path !== undefined ? { path: input.path } : {}),
        ...(input.line !== undefined ? { line: input.line } : {}),
        ...(input.side !== undefined ? { side: input.side } : {}),
        ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
        ...(input.subjectId !== undefined ? { subjectId: input.subjectId } : {}),
        ...(input.reaction !== undefined ? { reaction: input.reaction } : {}),
      } satisfies typeof input;
      if (input.action === "stack_rebase" || input.action === "stack_merge") {
        if (provider !== "github") {
          return yield* gitManagerError(
            "mutatePullRequest",
            "Stacks are only supported for GitHub.",
          );
        }
        const remoteUrl = yield* repositoryRemoteUrl(input.cwd);
        const repository = parseRepositoryIdentifier(remoteUrl, input.cwd);
        yield* runGitHubStackAction({
          gitHubCli,
          cwd: input.cwd,
          repository,
          host: "github.com",
          number: Number(reference),
          stackNumber: input.stackNumber ?? 0,
          expectedStackHeads: input.expectedStackHeads,
          action: input.action,
          mergeMethod: input.mergeMethod,
        }).pipe(
          Effect.catch((err: any) =>
            gitManagerError(
              "mutatePullRequest",
              err?.message || (err instanceof Error ? err.message : String(err)),
            ),
          ),
        );
      } else if (provider === "github") {
        yield* gitHubCli.mutatePullRequest({
          ...mutation,
          action: mutation.action,
        });
      } else if (provider === "gitlab") yield* gitLabCli.mutatePullRequest(mutation);
      else if (provider === "azure-devops") yield* azureDevOpsCli.mutatePullRequest(mutation);
      else yield* bitbucketApi.mutatePullRequest(mutation);
      const pullRequest =
        provider === "github"
          ? yield* Effect.gen(function* () {
              const details = yield* gitHubCli.getPullRequest({ cwd: input.cwd, reference });
              const remoteUrl = yield* repositoryRemoteUrl(input.cwd);
              const repository = parseRepositoryIdentifier(remoteUrl, input.cwd);
              const stack = yield* gitHubCli.getPullRequestStack({
                cwd: input.cwd,
                reference: String(details.number),
                repository,
              });
              const targetIndex = stack
                ? stack.layers.findIndex((layer) => layer.number === details.number)
                : -1;
              const stackMembership = stack
                ? {
                    number: stack.number,
                    position: targetIndex >= 0 ? targetIndex + 1 : 1,
                    size: stack.layers.length,
                    base: stack.base,
                  }
                : undefined;
              return {
                ...toResolvedPullRequest(details),
                ...(stack ? { stack } : {}),
                ...(stackMembership ? { stackMembership } : {}),
              };
            })
          : provider === "gitlab"
            ? yield* gitLabCli.getPullRequest({ cwd: input.cwd, reference })
            : provider === "azure-devops"
              ? yield* azureDevOpsCli.getPullRequest({
                  cwd: input.cwd,
                  reference,
                })
              : yield* bitbucketApi.getPullRequest({
                  cwd: input.cwd,
                  reference,
                });

      const remoteUrl = yield* repositoryRemoteUrl(input.cwd);
      const repository = parseRepositoryIdentifier(remoteUrl, input.cwd);
      const account = yield* resolveAccountForProvider(provider, input.cwd);

      yield* pullRequestReadCache.invalidate({
        provider,
        account,
        repository,
        prIdentity: reference,
      });

      yield* pullRequestReadCache.set(
        {
          provider,
          account,
          environmentId: "local",
          repository,
          prIdentity: reference,
        },
        { pullRequest, capabilities },
        60_000,
      );

      return { pullRequest };
    },
  );

  const createPullRequest: GitManagerShape["createPullRequest"] = Effect.fnUntraced(
    function* (input) {
      const provider = yield* requireSupportedPullRequestProvider(input.cwd);
      const bodyFile = path.join(tempDir, `tabs-pr-body-${process.pid}-${randomUUID()}.md`);
      yield* fileSystem
        .writeFileString(bodyFile, input.body)
        .pipe(
          Effect.mapError((cause) =>
            gitManagerError(
              "createPullRequest",
              "Failed to write pull request body temp file.",
              cause,
            ),
          ),
        );
      let azureCreated: GitResolvedPullRequest | null = null;
      let bitbucketCreated: GitResolvedPullRequest | null = null;
      if (provider === "github") {
        yield* gitHubCli
          .createPullRequest({
            cwd: input.cwd,
            baseBranch: input.baseBranch,
            headSelector: input.headBranch,
            title: input.title,
            bodyFile,
            ...(input.draft !== undefined ? { draft: input.draft } : {}),
          })
          .pipe(Effect.ensuring(fileSystem.remove(bodyFile).pipe(Effect.catch(() => Effect.void))));
      } else if (provider === "gitlab") {
        yield* gitLabCli
          .createPullRequest({ ...input, bodyFile })
          .pipe(Effect.ensuring(fileSystem.remove(bodyFile).pipe(Effect.catch(() => Effect.void))));
      } else if (provider === "azure-devops") {
        azureCreated = yield* azureDevOpsCli
          .createPullRequest(input)
          .pipe(Effect.ensuring(fileSystem.remove(bodyFile).pipe(Effect.catch(() => Effect.void))));
      } else {
        bitbucketCreated = yield* bitbucketApi
          .createPullRequest(input)
          .pipe(Effect.ensuring(fileSystem.remove(bodyFile).pipe(Effect.catch(() => Effect.void))));
      }
      const created =
        provider === "github"
          ? toResolvedPullRequest(
              yield* gitHubCli.getPullRequest({
                cwd: input.cwd,
                reference: input.headBranch,
              }),
            )
          : provider === "gitlab"
            ? yield* gitLabCli.getPullRequest({
                cwd: input.cwd,
                reference: input.headBranch,
              })
            : provider === "azure-devops"
              ? azureCreated!
              : bitbucketCreated!;

      const remoteUrl = yield* repositoryRemoteUrl(input.cwd);
      const repository = parseRepositoryIdentifier(remoteUrl, input.cwd);
      const account = yield* resolveAccountForProvider(provider, input.cwd);

      yield* pullRequestReadCache.invalidate({
        provider,
        repository,
      });

      if (created) {
        yield* pullRequestReadCache.set(
          {
            provider,
            account,
            environmentId: "local",
            repository,
            prIdentity: String(created.number),
          },
          { pullRequest: created, capabilities: pullRequestCapabilities(provider) },
          60_000,
        );
      }

      return { pullRequest: created };
    },
  );

  const preparePullRequestThread: GitManagerShape["preparePullRequestThread"] = Effect.fnUntraced(
    function* (input) {
      const normalizedReference = normalizePullRequestReference(input.reference);
      const rootWorktreePath = canonicalizeExistingPath(input.cwd);
      const provider = yield* requireSupportedPullRequestProvider(input.cwd);
      const pullRequestSummary =
        provider === "github"
          ? yield* gitHubCli.getPullRequest({
              cwd: input.cwd,
              reference: normalizedReference,
            })
          : null;
      const pullRequest = pullRequestSummary
        ? toResolvedPullRequest(pullRequestSummary)
        : provider === "gitlab"
          ? yield* gitLabCli.getPullRequest({
              cwd: input.cwd,
              reference: normalizedReference,
            })
          : provider === "azure-devops"
            ? yield* azureDevOpsCli.getPullRequest({
                cwd: input.cwd,
                reference: normalizedReference,
              })
            : yield* bitbucketApi.getPullRequest({
                cwd: input.cwd,
                reference: normalizedReference,
              });
      const pullRequestWithRemoteInfo = {
        ...pullRequest,
        ...(pullRequestSummary ? toPullRequestHeadRemoteInfo(pullRequestSummary) : {}),
      } as const;

      if (input.mode === "local") {
        if (provider === "github") {
          yield* gitHubCli.checkoutPullRequest({
            cwd: input.cwd,
            reference: normalizedReference,
            force: true,
          });
        } else {
          const localBranch = resolvePullRequestWorktreeLocalBranchName(pullRequestWithRemoteInfo);
          yield* materializePullRequestHeadBranch(
            input.cwd,
            pullRequestWithRemoteInfo,
            localBranch,
          );
          yield* Effect.scoped(gitCore.checkoutBranch({ cwd: input.cwd, branch: localBranch }));
        }
        const details = yield* gitCore.statusDetails(input.cwd);
        yield* configurePullRequestHeadUpstream(
          input.cwd,
          pullRequestWithRemoteInfo,
          details.branch ?? pullRequest.headBranch,
        );
        return {
          pullRequest,
          branch: details.branch ?? pullRequest.headBranch,
          worktreePath: null,
        };
      }

      const ensureExistingWorktreeUpstream = (worktreePath: string) =>
        Effect.gen(function* () {
          const details = yield* gitCore.statusDetails(worktreePath);
          yield* configurePullRequestHeadUpstream(
            worktreePath,
            pullRequestWithRemoteInfo,
            details.branch ?? pullRequest.headBranch,
          );
        });

      const localPullRequestBranch =
        resolvePullRequestWorktreeLocalBranchName(pullRequestWithRemoteInfo);

      const findLocalHeadBranch = (cwd: string) =>
        gitCore.listBranches({ cwd }).pipe(
          Effect.map((result) => {
            const localBranch = result.branches.find(
              (branch) => !branch.isRemote && branch.name === localPullRequestBranch,
            );
            if (localBranch) {
              return localBranch;
            }
            if (localPullRequestBranch === pullRequest.headBranch) {
              return null;
            }
            return (
              result.branches.find(
                (branch) =>
                  !branch.isRemote &&
                  branch.name === pullRequest.headBranch &&
                  branch.worktreePath !== null &&
                  canonicalizeExistingPath(branch.worktreePath) !== rootWorktreePath,
              ) ?? null
            );
          }),
        );

      const existingBranchBeforeFetch = yield* findLocalHeadBranch(input.cwd);
      const existingBranchBeforeFetchPath = existingBranchBeforeFetch?.worktreePath
        ? canonicalizeExistingPath(existingBranchBeforeFetch.worktreePath)
        : null;
      if (
        existingBranchBeforeFetch?.worktreePath &&
        existingBranchBeforeFetchPath !== rootWorktreePath
      ) {
        yield* ensureExistingWorktreeUpstream(existingBranchBeforeFetch.worktreePath);
        return {
          pullRequest,
          branch: localPullRequestBranch,
          worktreePath: existingBranchBeforeFetch.worktreePath,
        };
      }
      if (existingBranchBeforeFetchPath === rootWorktreePath) {
        return yield* gitManagerError(
          "preparePullRequestThread",
          "This PR branch is already checked out in the main repo. Use Local, or switch the main repo off that branch before creating a worktree thread.",
        );
      }

      yield* materializePullRequestHeadBranch(
        input.cwd,
        pullRequestWithRemoteInfo,
        localPullRequestBranch,
      );

      const existingBranchAfterFetch = yield* findLocalHeadBranch(input.cwd);
      const existingBranchAfterFetchPath = existingBranchAfterFetch?.worktreePath
        ? canonicalizeExistingPath(existingBranchAfterFetch.worktreePath)
        : null;
      if (
        existingBranchAfterFetch?.worktreePath &&
        existingBranchAfterFetchPath !== rootWorktreePath
      ) {
        yield* ensureExistingWorktreeUpstream(existingBranchAfterFetch.worktreePath);
        return {
          pullRequest,
          branch: localPullRequestBranch,
          worktreePath: existingBranchAfterFetch.worktreePath,
        };
      }
      if (existingBranchAfterFetchPath === rootWorktreePath) {
        return yield* gitManagerError(
          "preparePullRequestThread",
          "This PR branch is already checked out in the main repo. Use Local, or switch the main repo off that branch before creating a worktree thread.",
        );
      }

      const worktree = yield* gitCore.createWorktree({
        cwd: input.cwd,
        branch: localPullRequestBranch,
        path: null,
      });
      yield* ensureExistingWorktreeUpstream(worktree.worktree.path);

      if (input.threadId) {
        yield* projectSetupScriptRunner
          .runForThread({
            threadId: input.threadId,
            projectCwd: input.cwd,
            worktreePath: worktree.worktree.path,
          })
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("GitManager.preparePullRequestThread setup script failed", {
                threadId: input.threadId,
                worktreePath: worktree.worktree.path,
                cause: error,
              }).pipe(Effect.asVoid),
            ),
          );
      }

      return {
        pullRequest,
        branch: worktree.worktree.branch,
        worktreePath: worktree.worktree.path,
      };
    },
  );

  const runFeatureBranchStep = (
    modelSelection: ModelSelection,
    cwd: string,
    branch: string | null,
    commitMessage?: string,
    filePaths?: readonly string[],
  ) =>
    Effect.gen(function* () {
      const suggestion = yield* resolveCommitAndBranchSuggestion({
        cwd,
        branch,
        ...(commitMessage ? { commitMessage } : {}),
        ...(filePaths ? { filePaths } : {}),
        includeBranch: true,
        modelSelection,
      });
      if (!suggestion) {
        return yield* gitManagerError(
          "runFeatureBranchStep",
          "Cannot create a feature branch because there are no changes to commit.",
        );
      }

      const preferredBranch = suggestion.branch ?? sanitizeFeatureBranchName(suggestion.subject);
      const existingBranchNames = yield* gitCore.listLocalBranchNames(cwd);
      const resolvedBranch = resolveAutoFeatureBranchName(existingBranchNames, preferredBranch);

      yield* gitCore.createBranch({ cwd, branch: resolvedBranch });
      yield* Effect.scoped(gitCore.checkoutBranch({ cwd, branch: resolvedBranch }));

      return {
        branchStep: { status: "created" as const, name: resolvedBranch },
        resolvedCommitMessage: suggestion.commitMessage,
        resolvedCommitSuggestion: suggestion,
      };
    });

  const runStackedAction: GitManagerShape["runStackedAction"] = Effect.fnUntraced(
    function* (input, options) {
      const progress = createProgressEmitter(input, options);
      let currentPhase: GitActionProgressPhase | null = null;
      let createdCommitSha: string | undefined = undefined;

      const runAction = Effect.gen(function* () {
        const initialStatus = yield* gitCore.statusDetails(input.cwd);
        const wantsCommit = isCommitAction(input.action);
        const wantsPush =
          input.action === "push" ||
          input.action === "commit_push" ||
          input.action === "commit_push_pr" ||
          (input.action === "create_pr" &&
            (!initialStatus.hasUpstream || initialStatus.aheadCount > 0));
        const wantsPr = input.action === "create_pr" || input.action === "commit_push_pr";
        const phases: GitActionProgressPhase[] = [
          ...(input.featureBranch ? (["branch"] as const) : []),
          ...(wantsCommit ? (["commit"] as const) : []),
          ...(wantsPush ? (["push"] as const) : []),
          ...(wantsPr ? (["pr"] as const) : []),
        ];

        yield* progress.emit({
          kind: "action_started",
          phases,
        });

        if (input.featureBranch && !wantsCommit) {
          return yield* gitManagerError(
            "runStackedAction",
            "Feature-branch checkout is only supported for commit actions.",
          );
        }
        if (input.action === "create_pr" && initialStatus.hasWorkingTreeChanges) {
          return yield* gitManagerError(
            "runStackedAction",
            "Commit local changes before creating a PR.",
          );
        }

        if (!input.featureBranch && wantsPush && !initialStatus.branch) {
          return yield* gitManagerError("runStackedAction", "Cannot push from detached HEAD.");
        }
        if (!input.featureBranch && wantsPr && !initialStatus.branch) {
          return yield* gitManagerError(
            "runStackedAction",
            "Cannot create a pull request from detached HEAD.",
          );
        }
        let branchStep: {
          status: "created" | "skipped_not_requested";
          name?: string;
        };
        let commitMessageForStep = input.commitMessage;
        let preResolvedCommitSuggestion: CommitAndBranchSuggestion | undefined = undefined;

        const modelSelection = yield* serverSettingsService.getSettings.pipe(
          Effect.map((settings) => settings.textGenerationModelSelection),
          Effect.mapError((cause) =>
            gitManagerError("runStackedAction", "Failed to get server settings.", cause),
          ),
        );

        if (input.featureBranch) {
          currentPhase = "branch";
          yield* progress.emit({
            kind: "phase_started",
            phase: "branch",
            label: "Preparing feature branch...",
          });
          const result = yield* runFeatureBranchStep(
            modelSelection,
            input.cwd,
            initialStatus.branch,
            input.commitMessage,
            input.filePaths,
          );
          branchStep = result.branchStep;
          commitMessageForStep = result.resolvedCommitMessage;
          preResolvedCommitSuggestion = result.resolvedCommitSuggestion;
        } else {
          branchStep = { status: "skipped_not_requested" as const };
        }

        const currentBranch = branchStep.name ?? initialStatus.branch;

        currentPhase = "commit";
        const commit = wantsCommit
          ? yield* runCommitStep(
              modelSelection,
              input.cwd,
              input.action,
              currentBranch,
              commitMessageForStep,
              preResolvedCommitSuggestion,
              input.filePaths,
              options?.progressReporter,
              progress.actionId,
            )
          : { status: "skipped_not_requested" as const };

        if (commit.status === "created") {
          createdCommitSha = commit.commitSha;
        }

        const push = wantsPush
          ? yield* progress
              .emit({
                kind: "phase_started",
                phase: "push",
                label: "Pushing...",
              })
              .pipe(
                Effect.flatMap(() =>
                  Effect.gen(function* () {
                    currentPhase = "push";
                    return yield* gitCore.pushCurrentBranch(input.cwd, currentBranch);
                  }),
                ),
              )
          : { status: "skipped_not_requested" as const };

        const pr = wantsPr
          ? yield* progress
              .emit({
                kind: "phase_started",
                phase: "pr",
                label: "Creating PR...",
              })
              .pipe(
                Effect.flatMap(() =>
                  Effect.gen(function* () {
                    currentPhase = "pr";
                    return yield* runPrStep(modelSelection, input.cwd, currentBranch);
                  }),
                ),
              )
          : { status: "skipped_not_requested" as const };

        let toastTitle = "Git action finished";
        let toastDescription: string | undefined = undefined;
        let cta: any = { kind: "none" };

        if (pr.status === "created" || pr.status === "opened_existing") {
          const prNumber = pr.number ? ` #${pr.number}` : "";
          toastTitle = `${pr.status === "created" ? "Created PR" : "Opened PR"}${prNumber}`;
          toastDescription = pr.title;
          if (pr.url) {
            cta = { kind: "open_pr", label: "Open PR", url: pr.url };
          }
        } else if (push.status === "pushed") {
          const shortSha = commit.status === "created" ? commit.commitSha.substring(0, 7) : "";
          const branch = push.upstreamBranch ?? push.branch;
          const pushedCommitPart = shortSha ? ` ${shortSha}` : "";
          const branchPart = branch ? ` to ${branch}` : "";
          toastTitle = `Pushed${pushedCommitPart}${branchPart}`;
          toastDescription = commit.status === "created" ? commit.subject : undefined;
        } else if (commit.status === "created") {
          const shortSha = commit.commitSha ? commit.commitSha.substring(0, 7) : "";
          toastTitle = shortSha ? `Committed ${shortSha}` : "Committed changes";
          toastDescription = commit.subject;
        }

        const result = {
          action: input.action,
          branch: branchStep,
          commit,
          push,
          pr,
          toast: {
            title: toastTitle,
            ...(toastDescription ? { description: toastDescription } : {}),
            cta,
          },
        };
        yield* progress.emit({
          kind: "action_finished",
          result,
        });
        return result;
      });

      return yield* runAction.pipe(
        Effect.catch((error) => {
          let finalError: GitManagerServiceError = error;
          if (currentPhase === "push") {
            const pushDetail =
              (error as { detail?: string })?.detail ?? error?.message ?? String(error);
            const lower = pushDetail.toLowerCase();
            if (
              lower.includes("permission to") ||
              lower.includes("403") ||
              lower.includes("write access") ||
              lower.includes("access denied")
            ) {
              setCachedPushAccess(input.cwd, "read_only");
            }
            if (createdCommitSha) {
              finalError = new GitManagerError({
                operation: "runStackedAction",
                detail: pushDetail,
                phase: "push",
                createdCommitSha,
                cause: error,
              });
            }
          }

          return progress
            .emit({
              kind: "action_failed",
              phase: currentPhase,
              message: finalError.message,
            })
            .pipe(Effect.flatMap(() => Effect.fail(finalError)));
        }),
      );
    },
  );

  const generateDiffSummary: GitManagerShape["generateDiffSummary"] = Effect.fn(
    "GitManager.generateDiffSummary",
  )((input) =>
    Effect.gen(function* () {
      const settings = yield* serverSettingsService.getSettings;
      const modelSelection =
        input.modelSelection ??
        settings.gitAi?.gitTextGenerationModelSelection ??
        settings.textGenerationModelSelection;
      if (!modelSelection || !modelSelection.instanceId || !modelSelection.model) {
        return yield* gitManagerError(
          "generateDiffSummary",
          "No text generation model configured — set one up in Settings → Providers",
        );
      }

      let diffSummary = "";
      let rawPatch = "";
      let commitMessage: string | undefined = undefined;
      let targetScope: "staged" | "working_tree" | "commit" | "full_codebase" = "working_tree";

      if (input.target.kind === "commit") {
        targetScope = "commit";
        const commitSha = input.target.sha;
        const diffRes = yield* gitCore.diff({
          cwd: input.cwd,
          commit: commitSha,
        });
        rawPatch = diffRes.patch;
        diffSummary = `Commit ${commitSha}`;
      } else if (input.target.kind === "full_codebase") {
        targetScope = "full_codebase";
        const diffRes = yield* gitCore.execute({
          operation: "GitManager.generateDiffSummary.fullCodebase",
          cwd: input.cwd,
          args: [
            "diff",
            "--no-color",
            "--no-ext-diff",
            "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
            "HEAD",
          ],
          allowNonZeroExit: true,
        });
        rawPatch = diffRes.stdout;
        diffSummary = "Full codebase audit across repository source files";
      } else {
        const details = yield* gitCore.statusDetails(input.cwd);
        const stagedCount = details.staged?.files.length ?? 0;
        if (stagedCount > 0) {
          targetScope = "staged";
          const prepContext = yield* gitCore.prepareCommitContext(input.cwd);
          if (prepContext) {
            diffSummary = prepContext.stagedSummary;
            rawPatch = prepContext.stagedPatch;
          }
        } else {
          targetScope = "working_tree";
          const diffRes = yield* gitCore.diff({ cwd: input.cwd, path: "." });
          rawPatch = diffRes.patch;
          diffSummary = `Working tree changes (${details.workingTree.files.length} files)`;
        }
      }

      if (!rawPatch.trim() && !input.userHint) {
        return {
          summary: "No changes detected.",
          keyChanges: "- No modifications found in diff.",
          notesAndRisk: "",
          targetScope,
          wasTruncated: false,
        };
      }

      // Truncation & Exclusions logic
      const EXCLUDED_PATTERNS = [
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "bun.lockb",
        ".min.js",
        ".min.css",
        ".map",
      ];
      const lines = rawPatch.split("\n");
      const filteredLines: string[] = [];
      let truncatedCount = 0;
      let wasTruncated = false;
      let currentFileExcluded = false;
      let fileLineCount = 0;

      for (const line of lines) {
        if (line.startsWith("diff --git")) {
          const isExcluded = EXCLUDED_PATTERNS.some((pat) => line.includes(pat));
          if (isExcluded) {
            currentFileExcluded = true;
            truncatedCount++;
            wasTruncated = true;
            continue;
          }
          currentFileExcluded = false;
          fileLineCount = 0;
        }

        if (currentFileExcluded) {
          continue;
        }

        fileLineCount++;
        if (fileLineCount > 150) {
          if (fileLineCount === 151) {
            filteredLines.push("[... file patch truncated at 150 lines ...]");
            wasTruncated = true;
          }
          continue;
        }

        filteredLines.push(line);
      }

      let patchContent = filteredLines.join("\n");
      if (patchContent.length > 300_000) {
        patchContent =
          patchContent.slice(0, 300_000) + "\n[... diff patch capped at 300,000 characters ...]";
        wasTruncated = true;
      }

      const customInstructions = settings.gitAi?.customPromptInstructions?.trim();

      // Phase 1 — Static Analysis Enrichment
      // Run configured tools and inject findings for changed files into the
      // prompt context before the LLM call. Skipped when disabled or no tools
      // are configured.
      let staticAnalysisContextSection = "";
      const saSettings = settings.gitAi?.staticAnalysis;
      if (saSettings?.enabled && saSettings.tools.length > 0) {
        const saResult = yield* runStaticAnalysis({
          cwd: input.cwd,
          tools: saSettings.tools,
        });
        const changedFiles = extractChangedFilesFromPatch(patchContent);
        const contextResult = buildStaticAnalysisContext({
          changedFiles,
          allFindings: saResult.allFindings,
        });
        staticAnalysisContextSection = contextResult.contextSection;
      }

      // Separate custom instructions (userHint) from static analysis context
      const userHintParts: string[] = [];
      if (input.userHint?.trim()) userHintParts.push(input.userHint.trim());
      if (customInstructions) userHintParts.push(customInstructions);
      const finalUserHint = userHintParts.join("\n\n") || undefined;

      // Phase 2 — Repo-Context & History Enrichment
      // Gather per-file git history and grep-based impact analysis for changed
      // files. Results are a best-effort heuristic labelled as such in the prompt.
      let repoContextSection = "";
      let projectRulesSection = "";
      const rcSettings = settings.gitAi?.repoContext;
      if (rcSettings?.enabled) {
        const changedFiles = extractChangedFilesFromPatch(patchContent);

        // Load .tabs-review.json project rules
        const tabsReview = loadTabsReviewJson(input.cwd);
        if (tabsReview.parseError) {
          yield* Effect.logWarning(
            `[GitManager.generateDiffSummary] .tabs-review.json config error — project rules will not be applied: ${tabsReview.parseError}`,
          );
        }
        if (tabsReview.config?.instructions?.trim()) {
          projectRulesSection = tabsReview.config.instructions.trim();
        }

        const rcResult = yield* runRepoContext({
          cwd: input.cwd,
          changedFiles,
          diffPatch: patchContent,
          maxCallersPerSymbol: rcSettings.maxCallersPerSymbol,
          maxCommitHistoryPerFile: rcSettings.maxCommitHistoryPerFile,
        });
        repoContextSection = rcResult.contextSection;
      }

      const generated = yield* textGeneration.generateDiffSummary({
        cwd: input.cwd,
        diffSummary: limitContext(diffSummary, 12_000),
        diffPatch: patchContent,
        ...(commitMessage ? { commitMessage } : {}),
        ...(finalUserHint ? { userHint: finalUserHint } : {}),
        ...(staticAnalysisContextSection
          ? { staticAnalysisContext: staticAnalysisContextSection }
          : {}),
        ...(repoContextSection ? { repoContext: repoContextSection } : {}),
        ...(projectRulesSection ? { projectRules: projectRulesSection } : {}),
        modelSelection,
      });

      const truncatedReason = wasTruncated
        ? truncatedCount > 0
          ? `Summary based on partial diff — ${truncatedCount} file(s) excluded or truncated.`
          : "Summary based on partial diff — patch truncated to fit context limits."
        : undefined;

      return {
        summary: generated.summary,
        keyChanges: generated.keyChanges,
        notesAndRisk: generated.notesAndRisk,
        targetScope,
        wasTruncated,
        ...(truncatedCount > 0 ? { truncatedCount } : {}),
        ...(truncatedReason ? { truncatedReason } : {}),
      };
    }).pipe(
      Effect.mapError((err) =>
        gitManagerError(
          "generateDiffSummary",
          (err as { detail?: string; message?: string })?.detail ||
            (err as { detail?: string; message?: string })?.message ||
            "Failed to generate AI diff summary.",
          err,
        ),
      ),
    ),
  );

  const generateReview: GitManagerShape["generateReview"] = Effect.fn("GitManager.generateReview")(
    (input, options) =>
      Effect.gen(function* () {
        const settings = yield* serverSettingsService.getSettings;
        const modelSelection =
          input.modelSelection ??
          settings.gitAi?.gitTextGenerationModelSelection ??
          settings.textGenerationModelSelection;
        if (!modelSelection || !modelSelection.instanceId || !modelSelection.model) {
          return yield* gitManagerError(
            "generateReview",
            "No text generation model configured — set one up in Settings → Providers",
          );
        }

        let diffSummary = "";
        let rawPatch = "";
        let targetScope: "staged" | "working_tree" | "commit" | "full_codebase" = "working_tree";

        if (options?.onProgress) {
          yield* options.onProgress({
            cwd: input.cwd,
            stage: "assembling_context",
            message:
              input.target.kind === "full_codebase"
                ? "Collecting full codebase source files & diff patch buffers..."
                : "Collecting working tree diff patch & git status...",
            timestamp: new Date().toISOString(),
          });
        }

        if (input.target.kind === "commit") {
          targetScope = "commit";
          const commitSha = input.target.sha;
          const diffRes = yield* gitCore.diff({
            cwd: input.cwd,
            commit: commitSha,
          });
          rawPatch = diffRes.patch;
          diffSummary = `Commit ${commitSha}`;
        } else if (input.target.kind === "full_codebase") {
          targetScope = "full_codebase";
          const diffRes = yield* gitCore.execute({
            operation: "GitManager.generateReview.fullCodebase",
            cwd: input.cwd,
            args: [
              "diff",
              "--no-color",
              "--no-ext-diff",
              "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
              "HEAD",
            ],
            allowNonZeroExit: true,
          });
          rawPatch = diffRes.stdout;
          diffSummary = "Full codebase audit across repository source files";
        } else {
          const details = yield* gitCore.statusDetails(input.cwd);
          const stagedCount = details.staged?.files.length ?? 0;
          if (stagedCount > 0) {
            targetScope = "staged";
            const prepContext = yield* gitCore.prepareCommitContext(input.cwd);
            if (prepContext) {
              diffSummary = prepContext.stagedSummary;
              rawPatch = prepContext.stagedPatch;
            }
          } else {
            targetScope = "working_tree";
            const diffRes = yield* gitCore.diff({ cwd: input.cwd, path: "." });
            rawPatch = diffRes.patch;
            diffSummary = `Working tree changes (${details.workingTree.files.length} files)`;
          }
        }

        if (!rawPatch.trim() && !input.userHint) {
          return {
            summary: "No changes detected.",
            keyChanges: "- No modifications found in diff.",
            notesAndRisk: "",
            findings: [],
            passesRun: [],
            targetScope,
            wasTruncated: false,
          };
        }

        // Truncation & Exclusions logic
        const EXCLUDED_PATTERNS = [
          "package-lock.json",
          "pnpm-lock.yaml",
          "yarn.lock",
          "bun.lockb",
          ".min.js",
          ".min.css",
          ".map",
        ];
        const lines = rawPatch.split("\n");
        const filteredLines: string[] = [];
        let truncatedCount = 0;
        let wasTruncated = false;
        let currentFileExcluded = false;
        let fileLineCount = 0;

        for (const line of lines) {
          if (line.startsWith("diff --git")) {
            const isExcluded = EXCLUDED_PATTERNS.some((pat) => line.includes(pat));
            if (isExcluded) {
              currentFileExcluded = true;
              truncatedCount++;
              wasTruncated = true;
              continue;
            }
            currentFileExcluded = false;
            fileLineCount = 0;
          }

          if (currentFileExcluded) {
            continue;
          }

          fileLineCount++;
          if (fileLineCount > 150) {
            if (fileLineCount === 151) {
              filteredLines.push("[... file patch truncated at 150 lines ...]");
              wasTruncated = true;
            }
            continue;
          }

          filteredLines.push(line);
        }

        let patchContent = filteredLines.join("\n");
        if (patchContent.length > 300_000) {
          patchContent =
            patchContent.slice(0, 300_000) + "\n[... diff patch capped at 300,000 characters ...]";
          wasTruncated = true;
        }

        const initialChangedFiles = extractChangedFilesFromPatch(patchContent);
        if (options?.onProgress) {
          yield* options.onProgress({
            cwd: input.cwd,
            stage: "assembling_context",
            message:
              input.target.kind === "full_codebase"
                ? `Assembled patch context for ${initialChangedFiles.length} codebase files.`
                : `Assembled patch context for ${initialChangedFiles.length} modified files.`,
            fileCount: initialChangedFiles.length,
            timestamp: new Date().toISOString(),
          });
        }

        const customInstructions = settings.gitAi?.customPromptInstructions?.trim();

        // Static Analysis
        let staticAnalysisContextSection = "";
        const saSettings = settings.gitAi?.staticAnalysis;
        if (saSettings?.enabled && saSettings.tools.length > 0) {
          if (options?.onProgress) {
            yield* options.onProgress({
              cwd: input.cwd,
              stage: "static_analysis",
              message: "Evaluating static analysis context & AST symbol diagnostics...",
              timestamp: new Date().toISOString(),
            });
          }
          const saResult = yield* runStaticAnalysis({
            cwd: input.cwd,
            tools: saSettings.tools,
          });
          const changedFiles = extractChangedFilesFromPatch(patchContent);
          const contextResult = buildStaticAnalysisContext({
            changedFiles,
            allFindings: saResult.allFindings,
          });
          staticAnalysisContextSection = contextResult.contextSection;
        }

        // User hint
        const userHintParts: string[] = [];
        if (input.userHint?.trim()) userHintParts.push(input.userHint.trim());
        if (customInstructions) userHintParts.push(customInstructions);
        const finalUserHint = userHintParts.join("\n\n") || undefined;

        // Repo Context & .tabs-review.json
        let repoContextSection = "";
        let projectRulesSection = "";
        const rcSettings = settings.gitAi?.repoContext;
        if (rcSettings?.enabled) {
          const changedFiles = extractChangedFilesFromPatch(patchContent);
          const tabsReview = loadTabsReviewJson(input.cwd);
          if (tabsReview.parseError) {
            yield* Effect.logWarning(
              `[GitManager.generateReview] .tabs-review.json config error: ${tabsReview.parseError}`,
            );
          }
          if (tabsReview.config?.instructions?.trim()) {
            projectRulesSection = tabsReview.config.instructions.trim();
          }
          const rcResult = yield* runRepoContext({
            cwd: input.cwd,
            changedFiles,
            diffPatch: patchContent,
            maxCallersPerSymbol: rcSettings.maxCallersPerSymbol,
            maxCommitHistoryPerFile: rcSettings.maxCommitHistoryPerFile,
          });
          repoContextSection = rcResult.contextSection;
        }

        // Review passes configured via gitAi.review.passes
        const configuredPasses = settings.gitAi?.review?.passes;

        const reviewResult = yield* runReviewPasses(
          {
            cwd: input.cwd,
            diffSummary: limitContext(diffSummary, 12_000),
            diffPatch: patchContent,
            userHint: finalUserHint,
            staticAnalysisContext: staticAnalysisContextSection || undefined,
            repoContext: repoContextSection || undefined,
            projectRules: projectRulesSection || undefined,
            modelSelection,
            configuredPasses,
            ...(options?.onCostPreview ? { onCostPreview: options.onCostPreview } : {}),
            ...(options?.onProgress ? { onProgress: options.onProgress } : {}),
          },
          textGeneration,
        );

        const truncatedReason = wasTruncated
          ? truncatedCount > 0
            ? `Summary based on partial diff — ${truncatedCount} file(s) excluded or truncated.`
            : "Summary based on partial diff — patch truncated to fit context limits."
          : undefined;

        const branchRes = yield* gitCore
          .execute({
            operation: "GitManager.generateReview.getBranch",
            cwd: input.cwd,
            args: ["rev-parse", "--abbrev-ref", "HEAD"],
            allowNonZeroExit: true,
          })
          .pipe(Effect.option);

        const shaRes = yield* gitCore
          .execute({
            operation: "GitManager.generateReview.getHeadSha",
            cwd: input.cwd,
            args: ["rev-parse", "HEAD"],
            allowNonZeroExit: true,
          })
          .pipe(Effect.option);

        const currentBranchName = branchRes._tag === "Some" ? branchRes.value.stdout.trim() : "";
        const currentHeadSha = shaRes._tag === "Some" ? shaRes.value.stdout.trim() : "";

        if (currentHeadSha && currentBranchName) {
          saveReviewState({
            repoPath: input.cwd,
            branchName: currentBranchName,
            lastReviewedSha: currentHeadSha,
            findings: reviewResult.findings,
            updatedAt: new Date().toISOString(),
          });
        }

        addReviewHistoryRecord({
          id: randomUUID(),
          repoPath: input.cwd,
          branchName: currentBranchName || "HEAD",
          timestamp: new Date().toISOString(),
          modelUsed: modelSelection.model,
          targetScope,
          summary: reviewResult.summary,
          keyChanges: reviewResult.keyChanges,
          notesAndRisk: reviewResult.notesAndRisk,
          findings: reviewResult.findings,
          passesRun: reviewResult.passesRun,
          isIncremental: false,
        });

        const result: GitGenerateReviewResult = {
          summary: reviewResult.summary,
          keyChanges: reviewResult.keyChanges,
          notesAndRisk: reviewResult.notesAndRisk,
          findings: [...reviewResult.findings],
          passesRun: [...reviewResult.passesRun],
          targetScope,
          wasTruncated,
          ...(truncatedCount > 0 ? { truncatedCount } : {}),
          ...(truncatedReason ? { truncatedReason } : {}),
        };
        return result;
      }).pipe(
        Effect.mapError((err) =>
          gitManagerError(
            "generateReview",
            (err as { detail?: string; message?: string })?.detail ||
              (err as { detail?: string; message?: string })?.message ||
              "Failed to generate AI review.",
            err,
          ),
        ),
      ),
  );

  const submitFindingFeedback: GitManagerShape["submitFindingFeedback"] = Effect.fn(
    "GitManager.submitFindingFeedback",
  )((input) =>
    Effect.sync(() => {
      return recordFeedback(input.cwd, input.findingFingerprint, input.category, input.verdict);
    }),
  );

  const getReviewHistory: GitManagerShape["getReviewHistory"] = Effect.fn(
    "GitManager.getReviewHistory",
  )((input) =>
    Effect.sync(() => {
      const records = fetchReviewHistoryStore(input.cwd);
      return { records: [...records] };
    }),
  );

  return {
    pullRequestReadCache,
    status,
    resolvePullRequest,
    listPullRequests,
    mutatePullRequest,
    createPullRequest,
    preparePullRequestThread,
    runStackedAction,
    generateDiffSummary,
    generateReview,
    submitFindingFeedback,
    getReviewHistory,
  } satisfies GitManagerShape;
});

export const GitManagerLive = Layer.effect(GitManager, makeGitManager);
