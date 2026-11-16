import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { PositiveInt, TrimmedNonEmptyString } from "@tabs/contracts";

import { runProcess } from "../../processRunner";
import { GitHubCliError } from "../Errors.ts";
import {
  GitHubCli,
  type GitHubRepositoryCloneUrls,
  type GitHubCliShape,
  type GitHubPullRequestReaction,
  type GitHubPullRequestSummary,
} from "../Services/GitHubCli.ts";
import { githubGraphql, githubRestGet, resolveGitHubRepository } from "../Services/GitHubDirect.ts";
import { decodePullRequestStacksJson } from "../githubStackActions.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_PULL_REQUEST_FILE_PATCH_CHARS = 200_000;
const MAX_PULL_REQUEST_FILES = 300;
const MAX_PULL_REQUEST_TOTAL_PATCH_CHARS = 2_000_000;

function normalizeGitHubCliError(operation: "execute" | "stdout", error: unknown): GitHubCliError {
  if (error instanceof Error) {
    if (error.message.includes("Command not found: gh")) {
      return new GitHubCliError({
        operation,
        detail: "GitHub CLI (`gh`) is required but not available on PATH.",
        cause: error,
      });
    }

    const lower = error.message.toLowerCase();
    if (
      lower.includes("authentication failed") ||
      lower.includes("not logged in") ||
      lower.includes("gh auth login") ||
      lower.includes("no oauth token")
    ) {
      return new GitHubCliError({
        operation,
        detail: "GitHub CLI is not authenticated. Run `gh auth login` and retry.",
        cause: error,
      });
    }

    if (
      lower.includes("could not resolve to a pullrequest") ||
      lower.includes("repository.pullrequest") ||
      lower.includes("no pull requests found for branch") ||
      lower.includes("pull request not found")
    ) {
      return new GitHubCliError({
        operation,
        detail: "Pull request not found. Check the PR number or URL and try again.",
        cause: error,
      });
    }

    return new GitHubCliError({
      operation,
      detail: `GitHub CLI command failed: ${error.message}`,
      cause: error,
    });
  }

  return new GitHubCliError({
    operation,
    detail: "GitHub CLI command failed.",
    cause: error,
  });
}

function normalizePullRequestState(input: {
  state?: string | null | undefined;
  mergedAt?: string | null | undefined;
}): "open" | "closed" | "merged" {
  const mergedAt = input.mergedAt;
  const state = input.state;
  if ((typeof mergedAt === "string" && mergedAt.trim().length > 0) || state === "MERGED") {
    return "merged";
  }
  if (state === "CLOSED") {
    return "closed";
  }
  return "open";
}

const RawReactionGroupsSchema = Schema.optional(
  Schema.Array(
    Schema.Struct({
      content: Schema.String,
      viewerHasReacted: Schema.optional(Schema.Boolean),
      reactors: Schema.optional(
        Schema.Struct({
          totalCount: Schema.Number,
          nodes: Schema.optional(
            Schema.Array(Schema.NullOr(Schema.Struct({ login: Schema.optional(Schema.String) }))),
          ),
        }),
      ),
    }),
  ),
);

const REACTION_CONTENT = {
  THUMBS_UP: "thumbs-up",
  THUMBS_DOWN: "thumbs-down",
  LAUGH: "laugh",
  HOORAY: "hooray",
  CONFUSED: "confused",
  HEART: "heart",
  ROCKET: "rocket",
  EYES: "eyes",
} as const;

/** GitHub's reaction groups as the page shows them; groups nobody is in are dropped. */
function normalizeReactionGroups(
  groups: Schema.Schema.Type<typeof RawReactionGroupsSchema>,
): GitHubPullRequestReaction[] | undefined {
  if (groups === undefined) return undefined;
  return groups.flatMap((group) => {
    const content = REACTION_CONTENT[group.content as keyof typeof REACTION_CONTENT];
    const count = group.reactors?.totalCount ?? 0;
    if (content === undefined || count <= 0) return [];
    return [
      {
        content,
        count,
        actors: (group.reactors?.nodes ?? []).flatMap((node) => (node?.login ? [node.login] : [])),
        viewerHasReacted: group.viewerHasReacted === true,
      },
    ];
  });
}

const RawGitHubPullRequestSchema = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  baseRefName: TrimmedNonEmptyString,
  headRefName: TrimmedNonEmptyString,
  state: Schema.optional(Schema.NullOr(Schema.String)),
  mergedAt: Schema.optional(Schema.NullOr(Schema.String)),
  isCrossRepository: Schema.optional(Schema.Boolean),
  headRepository: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        nameWithOwner: Schema.String,
      }),
    ),
  ),
  headRepositoryOwner: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        login: Schema.String,
      }),
    ),
  ),
  isDraft: Schema.optional(Schema.Boolean),
  author: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        login: TrimmedNonEmptyString,
        avatarUrl: Schema.optional(Schema.String),
        url: Schema.optional(Schema.String),
      }),
    ),
  ),
  labels: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: TrimmedNonEmptyString,
        color: Schema.optional(Schema.String),
        description: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
  reviewDecision: Schema.optional(Schema.NullOr(Schema.String)),
  mergeable: Schema.optional(Schema.NullOr(Schema.String)),
  statusCheckRollup: Schema.optional(Schema.Array(Schema.Record(Schema.String, Schema.Unknown))),
  /**
   * The rollup's single aggregate state (`SUCCESS`, `FAILURE`, `PENDING`…), for listings that
   * deliberately skip the per-check contexts: reading every context of fifty pull requests is
   * what made `gh pr list --json statusCheckRollup` take seconds longer than the rest of the page.
   */
  checksRollupState: Schema.optional(Schema.NullOr(Schema.String)),
  additions: Schema.optional(Schema.Number),
  deletions: Schema.optional(Schema.Number),
  changedFiles: Schema.optional(Schema.Number),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
  body: Schema.optional(Schema.String),
  reactionGroups: RawReactionGroupsSchema,
  reviewRequests: Schema.optional(
    Schema.Array(
      Schema.Struct({
        login: TrimmedNonEmptyString,
        avatarUrl: Schema.optional(Schema.String),
        url: Schema.optional(Schema.String),
      }),
    ),
  ),
  comments: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: TrimmedNonEmptyString,
        author: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              login: TrimmedNonEmptyString,
              avatarUrl: Schema.optional(Schema.String),
            }),
          ),
        ),
        body: Schema.String,
        createdAt: Schema.String,
        url: Schema.optional(Schema.String),
        reactionGroups: RawReactionGroupsSchema,
      }),
    ),
  ),
  reviews: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: TrimmedNonEmptyString,
        author: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              login: TrimmedNonEmptyString,
              avatarUrl: Schema.optional(Schema.String),
            }),
          ),
        ),
        body: Schema.String,
        state: Schema.String,
        submittedAt: Schema.optional(Schema.NullOr(Schema.String)),
        reactionGroups: RawReactionGroupsSchema,
      }),
    ),
  ),
  commits: Schema.optional(
    Schema.Array(
      Schema.Struct({
        oid: TrimmedNonEmptyString,
        messageHeadline: TrimmedNonEmptyString,
        authoredDate: Schema.optional(Schema.String),
        authors: Schema.optional(
          Schema.Array(
            Schema.Struct({
              login: Schema.optional(Schema.NullOr(Schema.String)),
              avatarUrl: Schema.optional(Schema.String),
            }),
          ),
        ),
      }),
    ),
  ),
});

const RawGitHubRepositoryCloneUrlsSchema = Schema.Struct({
  nameWithOwner: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sshUrl: TrimmedNonEmptyString,
});

const RawGitHubPullRequestFileSchema = Schema.Struct({
  filename: TrimmedNonEmptyString,
  previous_filename: Schema.optional(TrimmedNonEmptyString),
  status: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
  patch: Schema.optional(Schema.String),
});

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function decodeGitHubReviewThreads(value: unknown) {
  const root = object(value);
  const data = object(root?.data);
  const repository = object(data?.repository);
  const pullRequest = object(repository?.pullRequest);
  const connection = object(pullRequest?.reviewThreads);
  const nodes = Array.isArray(connection?.nodes) ? connection.nodes : [];
  return nodes.flatMap((entry) => {
    const thread = object(entry);
    const id = nonEmptyText(thread?.id);
    const path = nonEmptyText(thread?.path);
    const lineValue = thread?.line;
    const line = typeof lineValue === "number" && lineValue > 0 ? Math.trunc(lineValue) : null;
    const commentConnection = object(thread?.comments);
    const commentNodes = Array.isArray(commentConnection?.nodes) ? commentConnection.nodes : [];
    if (!thread || !id || !path || !line) return [];
    const comments = commentNodes.flatMap((entry) => {
      const raw = object(entry);
      const commentId = nonEmptyText(raw?.id);
      const body = raw && typeof raw.body === "string" ? raw.body : null;
      const createdAt = nonEmptyText(raw?.createdAt);
      if (!raw || !commentId || body === null || !createdAt) return [];
      const author = object(raw.author);
      const login = nonEmptyText(author?.login);
      const reactionGroups = Array.isArray(raw.reactionGroups) ? raw.reactionGroups : [];
      const reactions = reactionGroups.flatMap((entry) => {
        const group = object(entry);
        const content = nonEmptyText(group?.content);
        const users = object(group?.users);
        const count = users?.totalCount;
        return content && typeof count === "number" && count > 0
          ? [
              {
                content,
                count: Math.trunc(count),
                ...(typeof group?.viewerHasReacted === "boolean"
                  ? { viewerHasReacted: group.viewerHasReacted }
                  : {}),
              },
            ]
          : [];
      });
      return [
        {
          id: commentId,
          author: login
            ? {
                login,
                ...(nonEmptyText(author?.avatarUrl)
                  ? { avatarUrl: nonEmptyText(author?.avatarUrl)! }
                  : {}),
              }
            : null,
          body,
          createdAt,
          ...(nonEmptyText(raw.updatedAt) ? { updatedAt: nonEmptyText(raw.updatedAt)! } : {}),
          ...(nonEmptyText(raw.url) ? { url: nonEmptyText(raw.url)! } : {}),
          ...(reactions.length > 0 ? { reactions } : {}),
        },
      ];
    });
    return comments.length > 0
      ? [
          {
            id,
            path,
            line,
            side:
              nonEmptyText(thread.diffSide)?.toUpperCase() === "LEFT"
                ? ("left" as const)
                : ("right" as const),
            ...(thread.isResolved === true ? { resolved: true } : {}),
            ...(thread.isOutdated === true ? { outdated: true } : {}),
            comments,
          },
        ]
      : [];
  });
}

const REVIEW_THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved isOutdated path line diffSide
          comments(first: 100) {
            nodes {
              id body createdAt updatedAt url author { login avatarUrl }
              reactionGroups { content viewerHasReacted users { totalCount } }
            }
          }
        }
      }
    }
  }
}`;

function normalizeFileStatus(
  value: string,
): "added" | "modified" | "removed" | "renamed" | "copied" | "changed" {
  return value === "added" ||
    value === "modified" ||
    value === "removed" ||
    value === "renamed" ||
    value === "copied" ||
    value === "changed"
    ? value
    : "changed";
}

type RawPullRequestFile = Schema.Schema.Type<typeof RawGitHubPullRequestFileSchema>;

function boundPullRequestFiles(files: ReadonlyArray<RawPullRequestFile>) {
  let remainingPatchChars = MAX_PULL_REQUEST_TOTAL_PATCH_CHARS;
  return files.slice(0, MAX_PULL_REQUEST_FILES).map((file) => {
    const patch = file.patch ?? null;
    const allowedPatchChars = Math.min(MAX_PULL_REQUEST_FILE_PATCH_CHARS, remainingPatchChars);
    const boundedPatch = patch === null ? null : patch.slice(0, allowedPatchChars);
    remainingPatchChars -= boundedPatch?.length ?? 0;
    return {
      path: file.filename,
      ...(file.previous_filename ? { previousPath: file.previous_filename } : {}),
      status: normalizeFileStatus(file.status),
      additions: Math.max(0, file.additions),
      deletions: Math.max(0, file.deletions),
      patch: boundedPatch,
      patchTruncated: patch !== null && patch.length > allowedPatchChars,
    };
  });
}

function normalizePullRequestSummary(
  raw: Schema.Schema.Type<typeof RawGitHubPullRequestSchema>,
): GitHubPullRequestSummary {
  const headRepositoryNameWithOwner = raw.headRepository?.nameWithOwner ?? null;
  const headRepositoryOwnerLogin =
    raw.headRepositoryOwner?.login ??
    (typeof headRepositoryNameWithOwner === "string" && headRepositoryNameWithOwner.includes("/")
      ? (headRepositoryNameWithOwner.split("/")[0] ?? null)
      : null);
  const reviewDecision =
    raw.reviewDecision === "APPROVED"
      ? ("approved" as const)
      : raw.reviewDecision === "CHANGES_REQUESTED"
        ? ("changes_requested" as const)
        : raw.reviewDecision === "REVIEW_REQUIRED"
          ? ("review_required" as const)
          : undefined;
  const mergeability =
    raw.mergeable === "MERGEABLE"
      ? ("mergeable" as const)
      : raw.mergeable === "CONFLICTING"
        ? ("conflicting" as const)
        : raw.mergeable
          ? ("unknown" as const)
          : undefined;
  const checks = raw.statusCheckRollup ?? [];
  const normalizedChecks = checks.flatMap((check) => {
    const nameValue = check.name ?? check.context;
    if (typeof nameValue !== "string" || nameValue.trim().length === 0) return [];
    const rawStatus = String(check.status ?? "").toUpperCase();
    const status =
      rawStatus === "QUEUED"
        ? ("queued" as const)
        : rawStatus === "IN_PROGRESS" || rawStatus === "PENDING"
          ? ("in_progress" as const)
          : rawStatus === "COMPLETED"
            ? ("completed" as const)
            : ("unknown" as const);
    const conclusionValue = check.conclusion ?? check.state;
    const detailsUrlValue = check.detailsUrl ?? check.targetUrl;
    const workflowNameValue = check.workflowName ?? check.workflow;
    return [
      {
        name: nameValue.trim(),
        status,
        ...(typeof conclusionValue === "string" ? { conclusion: conclusionValue } : {}),
        ...(typeof detailsUrlValue === "string" ? { detailsUrl: detailsUrlValue } : {}),
        ...(typeof workflowNameValue === "string" ? { workflowName: workflowNameValue } : {}),
      },
    ];
  });
  const rollupState = String(raw.checksRollupState ?? "").toUpperCase();
  const checksState =
    checks.length === 0
      ? rollupState === "SUCCESS"
        ? ("passing" as const)
        : rollupState === "FAILURE" || rollupState === "ERROR"
          ? ("failing" as const)
          : rollupState === "PENDING" || rollupState === "EXPECTED"
            ? ("pending" as const)
            : undefined
      : checks.some((check) => {
            const conclusion = String(check.conclusion ?? check.state ?? "").toUpperCase();
            return ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"].includes(
              conclusion,
            );
          })
        ? ("failing" as const)
        : checks.some((check) => {
              const status = String(check.status ?? check.state ?? "").toUpperCase();
              return ["QUEUED", "IN_PROGRESS", "PENDING", "EXPECTED"].includes(status);
            })
          ? ("pending" as const)
          : ("passing" as const);
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    baseRefName: raw.baseRefName,
    headRefName: raw.headRefName,
    state: normalizePullRequestState(raw),
    ...(typeof raw.isCrossRepository === "boolean"
      ? { isCrossRepository: raw.isCrossRepository }
      : {}),
    ...(headRepositoryNameWithOwner ? { headRepositoryNameWithOwner } : {}),
    ...(headRepositoryOwnerLogin ? { headRepositoryOwnerLogin } : {}),
    ...(typeof raw.isDraft === "boolean" ? { isDraft: raw.isDraft } : {}),
    ...(raw.author !== undefined ? { author: raw.author } : {}),
    ...(raw.labels ? { labels: raw.labels } : {}),
    ...(reviewDecision ? { reviewDecision } : {}),
    ...(mergeability ? { mergeability } : {}),
    ...(checksState ? { checksState } : {}),
    ...(typeof raw.additions === "number" ? { additions: Math.max(0, raw.additions) } : {}),
    ...(typeof raw.deletions === "number" ? { deletions: Math.max(0, raw.deletions) } : {}),
    ...(typeof raw.changedFiles === "number"
      ? { changedFiles: Math.max(0, raw.changedFiles) }
      : {}),
    ...(raw.createdAt ? { createdAt: raw.createdAt } : {}),
    ...(raw.updatedAt ? { updatedAt: raw.updatedAt } : {}),
    ...(raw.body !== undefined ? { body: raw.body } : {}),
    ...(raw.reactionGroups !== undefined
      ? { reactions: normalizeReactionGroups(raw.reactionGroups)! }
      : {}),
    ...(raw.reviewRequests ? { reviewers: raw.reviewRequests } : {}),
    ...(raw.statusCheckRollup ? { checks: normalizedChecks } : {}),
    ...(raw.comments
      ? {
          comments: raw.comments.map((comment) => ({
            id: comment.id,
            author: comment.author ?? null,
            body: comment.body,
            createdAt: comment.createdAt,
            ...(comment.url ? { url: comment.url } : {}),
            ...(comment.reactionGroups !== undefined
              ? { reactions: normalizeReactionGroups(comment.reactionGroups)! }
              : {}),
          })),
        }
      : {}),
    ...(raw.reviews
      ? {
          reviews: raw.reviews.map((review) => ({
            id: review.id,
            author: review.author ?? null,
            body: review.body,
            state: review.state,
            ...(review.submittedAt !== undefined ? { submittedAt: review.submittedAt } : {}),
            ...(review.reactionGroups !== undefined
              ? { reactions: normalizeReactionGroups(review.reactionGroups)! }
              : {}),
          })),
        }
      : {}),
    ...(raw.commits
      ? {
          commits: raw.commits.map((commit) => ({
            sha: commit.oid,
            subject: commit.messageHeadline,
            ...(commit.authoredDate ? { authoredAt: commit.authoredDate } : {}),
            authors: (commit.authors ?? []).flatMap((author) =>
              author.login
                ? [
                    {
                      login: author.login,
                      ...(author.avatarUrl ? { avatarUrl: author.avatarUrl } : {}),
                    },
                  ]
                : [],
            ),
          })),
        }
      : {}),
  };
}

function normalizeRepositoryCloneUrls(
  raw: Schema.Schema.Type<typeof RawGitHubRepositoryCloneUrlsSchema>,
): GitHubRepositoryCloneUrls {
  return {
    nameWithOwner: raw.nameWithOwner,
    url: raw.url,
    sshUrl: raw.sshUrl,
  };
}

function decodeGitHubJson<S extends Schema.Top>(
  raw: string,
  schema: S,
  operation:
    | "listOpenPullRequests"
    | "getPullRequest"
    | "getPullRequestFiles"
    | "getRepositoryCloneUrls",
  invalidDetail: string,
): Effect.Effect<S["Type"], GitHubCliError, S["DecodingServices"]> {
  return Schema.decodeEffect(Schema.fromJsonString(schema))(raw).pipe(
    Effect.mapError(
      (error) =>
        new GitHubCliError({
          operation,
          detail: error instanceof Error ? `${invalidDetail}: ${error.message}` : invalidDetail,
          cause: error,
        }),
    ),
  );
}

/**
 * One GraphQL document in place of `gh pr list --json …statusCheckRollup`. The CLI's rollup field
 * reads every check context of every row (measured: ~3-5s extra for 50 rows), whereas the
 * rollup's aggregate state is what the list actually shows. `{owner}`/`{repo}` are filled in by
 * `gh api` from the working directory's repository, so no separate repository lookup is spent.
 */
const PULL_REQUEST_LIST_MAX_FAST_LIMIT = 100;
function buildPullRequestListQuery(state: "open" | "closed" | "merged" | "all"): string {
  const states =
    state === "open"
      ? "[OPEN]"
      : state === "closed"
        ? "[CLOSED]"
        : state === "merged"
          ? "[MERGED]"
          : "[OPEN, CLOSED, MERGED]";
  return `query($owner: String!, $name: String!, $limit: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: $limit, states: ${states}, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes {
        number title url baseRefName headRefName state mergedAt isDraft isCrossRepository
        author { login avatarUrl url }
        headRepository { nameWithOwner }
        headRepositoryOwner { login }
        labels(first: 20) { nodes { name color description } }
        reviewDecision mergeable additions deletions changedFiles createdAt updatedAt
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}`;
}

interface GraphQlPullRequestNode {
  readonly commits?: {
    readonly nodes?: ReadonlyArray<{
      readonly commit?: { readonly statusCheckRollup?: { readonly state?: string } | null };
    } | null>;
  };
  readonly labels?: { readonly nodes?: ReadonlyArray<unknown> };
  readonly [key: string]: unknown;
}

/** Reshapes a GraphQL node into the object `gh pr list --json` would have printed. */
export function pullRequestListNodesToRaw(raw: string): string {
  const parsed = JSON.parse(raw) as {
    data?: {
      repository?: { pullRequests?: { nodes?: ReadonlyArray<GraphQlPullRequestNode | null> } };
    };
  };
  const nodes = parsed.data?.repository?.pullRequests?.nodes;
  if (!Array.isArray(nodes)) throw new Error("GitHub returned no pull request list.");
  return JSON.stringify(
    nodes.flatMap((node) => {
      if (node === null) return [];
      const { commits, labels, ...rest } = node;
      const checksRollupState = commits?.nodes?.[0]?.commit?.statusCheckRollup?.state;
      return [
        {
          ...rest,
          labels: labels?.nodes ?? [],
          ...(checksRollupState ? { checksRollupState } : {}),
        },
      ];
    }),
  );
}

const PULL_REQUEST_DETAIL_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number title url baseRefName headRefName state mergedAt isCrossRepository isDraft
      headRepository { nameWithOwner }
      headRepositoryOwner { login }
      author { login avatarUrl url }
      labels(first: 50) { nodes { name color description } }
      reviewDecision mergeable additions deletions changedFiles createdAt updatedAt body
      reactionGroups { content viewerHasReacted reactors(first: 3) { totalCount nodes { ... on Actor { login } } } }
      reviewRequests(first: 30) {
        nodes { requestedReviewer { __typename ... on User { login avatarUrl url } } }
      }
      comments(first: 100) {
        nodes { id body createdAt url author { login avatarUrl } reactionGroups { content viewerHasReacted reactors(first: 3) { totalCount nodes { ... on Actor { login } } } } }
      }
      reviews(first: 100) {
        nodes { id body state submittedAt author { login avatarUrl } reactionGroups { content viewerHasReacted reactors(first: 3) { totalCount nodes { ... on Actor { login } } } } }
      }
      commits(first: 100) {
        nodes {
          commit {
            oid messageHeadline authoredDate
            authors(first: 5) { nodes { user { login avatarUrl } } }
          }
        }
      }
      latest: commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: 100) {
                nodes {
                  __typename
                  ... on CheckRun {
                    name status conclusion detailsUrl
                    checkSuite { workflowRun { workflow { name } } }
                  }
                  ... on StatusContext { context state targetUrl }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

type Nodes<T> = { readonly nodes?: ReadonlyArray<T | null> } | null | undefined;
const nodesOf = <T>(connection: Nodes<T>): T[] =>
  (connection?.nodes ?? []).filter((node): node is T => node !== null);

/** Reshapes the detail GraphQL node into what `gh pr view --json …` prints. */
export function pullRequestDetailNodeToRaw(raw: string): string {
  const root = JSON.parse(raw) as {
    data?: { repository?: { pullRequest?: Record<string, any> | null } | null };
  };
  const pr = root.data?.repository?.pullRequest;
  if (!pr) throw new Error("GitHub returned no pull request.");
  const contexts = nodesOf<Record<string, any>>(
    nodesOf<Record<string, any>>(pr.latest)[0]?.commit?.statusCheckRollup?.contexts,
  );
  return JSON.stringify({
    number: pr.number,
    title: pr.title,
    url: pr.url,
    baseRefName: pr.baseRefName,
    headRefName: pr.headRefName,
    state: pr.state,
    mergedAt: pr.mergedAt,
    isCrossRepository: pr.isCrossRepository,
    isDraft: pr.isDraft,
    headRepository: pr.headRepository,
    headRepositoryOwner: pr.headRepositoryOwner,
    author: pr.author,
    labels: nodesOf(pr.labels),
    reviewDecision: pr.reviewDecision,
    mergeable: pr.mergeable,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    body: pr.body ?? "",
    reactionGroups: pr.reactionGroups,
    reviewRequests: nodesOf<Record<string, any>>(pr.reviewRequests).flatMap((request) =>
      request.requestedReviewer?.login ? [request.requestedReviewer] : [],
    ),
    comments: nodesOf(pr.comments),
    reviews: nodesOf(pr.reviews),
    commits: nodesOf<Record<string, any>>(pr.commits).map(({ commit }) => ({
      oid: commit.oid,
      messageHeadline: commit.messageHeadline,
      authoredDate: commit.authoredDate,
      authors: nodesOf<Record<string, any>>(commit.authors).map((author) => author.user ?? {}),
    })),
    statusCheckRollup: contexts.map((context) =>
      context.__typename === "CheckRun"
        ? {
            __typename: "CheckRun",
            name: context.name,
            status: context.status,
            conclusion: context.conclusion,
            detailsUrl: context.detailsUrl,
            workflowName: context.checkSuite?.workflowRun?.workflow?.name,
          }
        : {
            __typename: "StatusContext",
            context: context.context,
            state: context.state,
            targetUrl: context.targetUrl,
          },
    ),
  });
}

const makeGitHubCli = Effect.sync(() => {
  const execute: GitHubCliShape["execute"] = (input) =>
    Effect.tryPromise({
      try: () =>
        runProcess("gh", input.args, {
          cwd: input.cwd,
          timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        }),
      catch: (error) => normalizeGitHubCliError("execute", error),
    });

  const cliService = {
    execute,
    listOpenPullRequests: (input) => {
      const args = [
        "pr",
        "list",
        "--state",
        input.state ?? "all",
        "--limit",
        String(input.limit ?? 50),
        "--json",
        "number,title,url,baseRefName,headRefName,state,mergedAt,isDraft,author,labels,reviewDecision,mergeable,statusCheckRollup,additions,deletions,changedFiles,createdAt,updatedAt",
      ];
      if (input.headSelector) {
        args.push("--head", input.headSelector);
      }
      const decodeList = (raw: string) =>
        raw.length === 0
          ? Effect.succeed([])
          : decodeGitHubJson(
              raw,
              Schema.Array(RawGitHubPullRequestSchema),
              "listOpenPullRequests",
              "GitHub CLI returned invalid PR list JSON.",
            );
      const viaCli = execute({ cwd: input.cwd, args }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap(decodeList),
      );
      const limit = input.limit ?? 50;
      // A head selector or a page past one GraphQL page keeps gh's own handling.
      const query = buildPullRequestListQuery(input.state ?? "all");
      const viaGraphQl = (transport: "direct" | "cli") =>
        (transport === "direct"
          ? Effect.tryPromise({
              try: async () => {
                const repository = await resolveGitHubRepository(input.cwd);
                if (repository === null) throw new Error("No GitHub repository was found.");
                return githubGraphql({
                  cwd: input.cwd,
                  host: repository.host,
                  query,
                  variables: {
                    owner: repository.owner,
                    name: repository.name,
                    limit: Math.trunc(limit),
                  },
                });
              },
              catch: (error) => normalizeGitHubCliError("stdout", error),
            })
          : execute({
              cwd: input.cwd,
              args: [
                "api",
                "graphql",
                "-F",
                "owner={owner}",
                "-F",
                "name={repo}",
                "-F",
                `limit=${Math.trunc(limit)}`,
                "-f",
                `query=${query}`,
              ],
            }).pipe(Effect.map((result) => result.stdout))
        ).pipe(
          Effect.flatMap((stdout) =>
            Effect.try({
              try: () => pullRequestListNodesToRaw(stdout),
              catch: (error) => normalizeGitHubCliError("stdout", error),
            }),
          ),
          Effect.flatMap(decodeList),
        );
      // Direct HTTPS first (no process start), then the CLI's own GraphQL, then `gh pr list`.
      const fast =
        input.headSelector || limit > PULL_REQUEST_LIST_MAX_FAST_LIMIT || limit < 1
          ? null
          : viaGraphQl("direct").pipe(Effect.catch(() => viaGraphQl("cli")));
      return (fast === null ? viaCli : fast.pipe(Effect.catch(() => viaCli))).pipe(
        Effect.map((pullRequests) => pullRequests.map(normalizePullRequestSummary)),
      );
    },
    getPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "view",
          input.reference,
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner,isDraft,author,labels,reviewDecision,mergeable,statusCheckRollup,additions,deletions,changedFiles,createdAt,updatedAt,body,reviewRequests,comments,reviews,commits",
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeGitHubJson(
            raw,
            RawGitHubPullRequestSchema,
            "getPullRequest",
            "GitHub CLI returned invalid pull request JSON.",
          ),
        ),
        Effect.map(normalizePullRequestSummary),
      ),
    getPullRequestFiles: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "api",
          "--paginate",
          "--slurp",
          `repos/{owner}/{repo}/pulls/${input.reference}/files`,
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeGitHubJson(
            raw || "[]",
            Schema.Array(Schema.Array(RawGitHubPullRequestFileSchema)),
            "getPullRequestFiles",
            "GitHub CLI returned invalid pull request file JSON.",
          ),
        ),
        Effect.map((pages) => boundPullRequestFiles(pages.flat())),
      ),
    getPullRequestReviewThreads: (input) =>
      Effect.gen(function* () {
        const repositoryResult = yield* execute({
          cwd: input.cwd,
          args: ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
        });
        const [owner, name] = repositoryResult.stdout.trim().split("/", 2);
        if (!owner || !name || !/^\d+$/.test(input.reference)) {
          return yield* new GitHubCliError({
            operation: "stdout",
            detail: "GitHub did not return a repository identity or numeric pull request number.",
          });
        }
        const threads: ReturnType<typeof decodeGitHubReviewThreads> = [];
        let cursor: string | null = null;
        for (let page = 0; page < 20; page += 1) {
          const result = yield* execute({
            cwd: input.cwd,
            args: [
              "api",
              "graphql",
              "-f",
              `query=${REVIEW_THREADS_QUERY}`,
              "-F",
              `owner=${owner}`,
              "-F",
              `name=${name}`,
              "-F",
              `number=${input.reference}`,
              ...(cursor ? ["-F", `cursor=${cursor}`] : []),
            ],
          });
          const parsed = yield* Effect.try({
            try: () => JSON.parse(result.stdout.trim() || "{}") as unknown,
            catch: (error) => normalizeGitHubCliError("stdout", error),
          });
          threads.push(...decodeGitHubReviewThreads(parsed));
          const connection = object(
            object(object(object(object(parsed)?.data)?.repository)?.pullRequest)?.reviewThreads,
          );
          const pageInfo = object(connection?.pageInfo);
          const nextCursor = nonEmptyText(pageInfo?.endCursor);
          if (pageInfo?.hasNextPage !== true || !nextCursor) break;
          cursor = nextCursor;
        }
        return threads;
      }),
    getPullRequestStack: (input) => {
      const args = ["api"];
      if (input.host) {
        args.push("--hostname", input.host);
      }
      const endpoint = input.repository ? `repos/${input.repository}` : "repos/{owner}/{repo}";
      args.push(`${endpoint}/stacks?pull_request=${input.reference}`);
      return execute({
        cwd: input.cwd,
        args,
      }).pipe(
        Effect.map((result) => decodePullRequestStacksJson(result.stdout)),
        Effect.catch(() => Effect.succeed(null)),
      );
    },
    mutatePullRequest: (input) => {
      const args: string[] = ["pr"];
      switch (input.action) {
        case "merge":
          args.push(
            "merge",
            input.reference,
            input.mergeMethod === "rebase"
              ? "--rebase"
              : input.mergeMethod === "merge"
                ? "--merge"
                : "--squash",
          );
          if (input.deleteBranch) args.push("--delete-branch");
          break;
        case "close":
        case "reopen":
          args.push(input.action, input.reference);
          break;
        case "ready":
          args.push("ready", input.reference);
          break;
        case "draft":
          args.push("ready", input.reference, "--undo");
          break;
        case "enable_auto_merge":
        case "disable_auto_merge":
        case "edit_pull_request":
        case "stack_rebase":
        case "stack_merge":
          return Effect.fail(
            new GitHubCliError({
              operation: "mutatePullRequest",
              detail: `GitHub does not advertise ${input.action.replaceAll("_", " ")} here.`,
            }),
          );
        case "comment":
          args.push("comment", input.reference, "--body", input.body ?? "");
          break;
        case "approve":
          args.push("review", input.reference, "--approve");
          if (input.body) args.push("--body", input.body);
          break;
        case "request_changes":
          args.push("review", input.reference, "--request-changes", "--body", input.body ?? "");
          break;
        case "add_reviewer":
        case "remove_reviewer":
        case "add_label":
        case "remove_label": {
          const flag =
            input.action === "add_reviewer"
              ? "--add-reviewer"
              : input.action === "remove_reviewer"
                ? "--remove-reviewer"
                : input.action === "add_label"
                  ? "--add-label"
                  : "--remove-label";
          args.push("edit", input.reference, flag, input.value ?? "");
          break;
        }
        case "inline_comment":
          return Effect.gen(function* () {
            const head = yield* execute({
              cwd: input.cwd,
              args: ["api", `repos/{owner}/{repo}/pulls/${input.reference}`, "--jq", ".head.sha"],
            });
            yield* execute({
              cwd: input.cwd,
              args: [
                "api",
                "--method",
                "POST",
                `repos/{owner}/{repo}/pulls/${input.reference}/comments`,
                "--raw-field",
                `body=${input.body ?? ""}`,
                "--raw-field",
                `commit_id=${head.stdout.trim()}`,
                "--raw-field",
                `path=${input.path ?? ""}`,
                "--field",
                `line=${input.line ?? 0}`,
                "--raw-field",
                `side=${(input.side ?? "right").toUpperCase()}`,
              ],
            });
          });
        case "reply_to_thread":
          return execute({
            cwd: input.cwd,
            args: [
              "api",
              "graphql",
              "-f",
              "query=mutation($threadId: ID!, $body: String!) { addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $threadId, body: $body}) { comment { id } } }",
              "-F",
              `threadId=${input.threadId ?? ""}`,
              "-f",
              `body=${input.body ?? ""}`,
            ],
          }).pipe(Effect.asVoid);
        case "resolve_thread":
          return execute({
            cwd: input.cwd,
            args: [
              "api",
              "graphql",
              "-f",
              "query=mutation($threadId: ID!) { resolveReviewThread(input: {threadId: $threadId}) { thread { id isResolved } } }",
              "-F",
              `threadId=${input.threadId ?? ""}`,
            ],
          }).pipe(Effect.asVoid);
        case "unresolve_thread":
          return execute({
            cwd: input.cwd,
            args: [
              "api",
              "graphql",
              "-f",
              "query=mutation($threadId: ID!) { unresolveReviewThread(input: {threadId: $threadId}) { thread { id isResolved } } }",
              "-F",
              `threadId=${input.threadId ?? ""}`,
            ],
          }).pipe(Effect.asVoid);
        case "add_reaction":
        case "remove_reaction":
          return execute({
            cwd: input.cwd,
            args: [
              "api",
              "graphql",
              "-f",
              `query=mutation($subjectId: ID!, $content: ReactionContent!) { ${
                input.action === "add_reaction" ? "addReaction" : "removeReaction"
              }(input: {subjectId: $subjectId, content: $content}) { reaction { content } } }`,
              "-F",
              `subjectId=${input.subjectId ?? ""}`,
              "-F",
              `content=${input.reaction ?? "THUMBS_UP"}`,
            ],
          }).pipe(Effect.asVoid);
      }
      return execute({ cwd: input.cwd, args }).pipe(Effect.asVoid);
    },
    getRepositoryCloneUrls: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", input.repository, "--json", "nameWithOwner,url,sshUrl"],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeGitHubJson(
            raw,
            RawGitHubRepositoryCloneUrlsSchema,
            "getRepositoryCloneUrls",
            "GitHub CLI returned invalid repository JSON.",
          ),
        ),
        Effect.map(normalizeRepositoryCloneUrls),
      ),
    createPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "create",
          "--base",
          input.baseBranch,
          "--head",
          input.headSelector,
          "--title",
          input.title,
          "--body-file",
          input.bodyFile,
          ...(input.draft ? ["--draft"] : []),
        ],
      }).pipe(Effect.asVoid),
    getDefaultBranch: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
      }).pipe(
        Effect.map((value) => {
          const trimmed = value.stdout.trim();
          return trimmed.length > 0 ? trimmed : null;
        }),
      ),
    checkoutPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "checkout", input.reference, ...(input.force ? ["--force"] : [])],
      }).pipe(Effect.asVoid),
    getAuthStatus: (input) =>
      execute({
        cwd: input.cwd,
        args: ["auth", "status", "--json", "hosts"],
      }).pipe(
        Effect.map((result) => result.stdout),
        Effect.catch((err) => {
          // If gh auth status exits with an error code (e.g. 1 when not logged in),
          // check if we can still extract stdout.
          if (err && typeof err === "object" && "cause" in err) {
            const cause = err.cause;
            if (
              cause &&
              typeof cause === "object" &&
              "stdout" in cause &&
              typeof cause.stdout === "string"
            ) {
              return Effect.succeed(cause.stdout);
            }
          }
          return Effect.fail(err);
        }),
      ),
  } satisfies Omit<GitHubCliShape, "resolvePullRequestNumber">;

  /**
   * Pull request detail reads over the in-process connection. The detail page needs the pull
   * request, its files, its review threads and its stack; as four `gh` processes (two of them
   * preceded by a `gh repo view`) that was several seconds. Each read here falls back to the CLI
   * read it replaces, so a failure of the direct path is only ever a slower page.
   */
  const direct = <A, E>(attempt: () => Promise<A>, fallback: Effect.Effect<A, E>) =>
    Effect.tryPromise({ try: attempt, catch: (error) => error }).pipe(Effect.catch(() => fallback));

  const directFiles: GitHubCliShape["getPullRequestFiles"] = (input) =>
    direct(async () => {
      const repository = await resolveGitHubRepository(input.cwd);
      if (repository === null || !/^\d+$/.test(input.reference)) throw new Error("no repository");
      const rows: Array<Record<string, unknown>> = [];
      for (let page = 1; page <= 10; page += 1) {
        const body = (await githubRestGet({
          cwd: input.cwd,
          host: repository.host,
          path: `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(
            repository.name,
          )}/pulls/${input.reference}/files?per_page=100&page=${page}`,
        })) as Array<Record<string, unknown>>;
        if (!Array.isArray(body)) throw new Error("unexpected files response");
        rows.push(...body);
        if (body.length < 100) break;
      }
      // Decoded and bounded by the CLI path's own code, so both paths answer identically.
      return rows;
    }, Effect.succeed(null)).pipe(
      Effect.flatMap((rows) =>
        rows === null
          ? cliService.getPullRequestFiles(input)
          : Effect.gen(function* () {
              const pages = yield* decodeGitHubJson(
                JSON.stringify([rows]),
                Schema.Array(Schema.Array(RawGitHubPullRequestFileSchema)),
                "getPullRequestFiles",
                "GitHub returned invalid pull request file JSON.",
              );
              return boundPullRequestFiles(pages.flat());
            }).pipe(Effect.catch(() => cliService.getPullRequestFiles(input))),
      ),
    );

  const directReviewThreads: GitHubCliShape["getPullRequestReviewThreads"] = (input) =>
    direct(async () => {
      const repository = await resolveGitHubRepository(input.cwd);
      if (repository === null || !/^\d+$/.test(input.reference)) throw new Error("no repository");
      const threads: ReturnType<typeof decodeGitHubReviewThreads> = [];
      let cursor: string | null = null;
      for (let page = 0; page < 20; page += 1) {
        const body = JSON.parse(
          await githubGraphql({
            cwd: input.cwd,
            host: repository.host,
            query: REVIEW_THREADS_QUERY,
            variables: {
              owner: repository.owner,
              name: repository.name,
              number: Number(input.reference),
              cursor,
            },
          }),
        ) as unknown;
        threads.push(...decodeGitHubReviewThreads(body));
        const connection = object(
          object(object(object(object(body)?.data)?.repository)?.pullRequest)?.reviewThreads,
        );
        const pageInfo = object(connection?.pageInfo);
        const nextCursor = nonEmptyText(pageInfo?.endCursor);
        if (pageInfo?.hasNextPage !== true || !nextCursor) break;
        cursor = nextCursor;
      }
      return threads;
    }, cliService.getPullRequestReviewThreads(input));

  const directStack: GitHubCliShape["getPullRequestStack"] = (input) =>
    Effect.tryPromise({
      try: async () => {
        const repository = input.repository
          ? (() => {
              const [owner, name] = input.repository!.split("/");
              return owner && name ? { host: input.host ?? "github.com", owner, name } : null;
            })()
          : await resolveGitHubRepository(input.cwd);
        if (repository === null) throw new Error("no repository");
        try {
          const body = await githubRestGet({
            cwd: input.cwd,
            host: repository.host,
            path: `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(
              repository.name,
            )}/stacks?pull_request=${encodeURIComponent(input.reference)}`,
          });
          return decodePullRequestStacksJson(JSON.stringify(body));
        } catch (error) {
          // Stacks are not offered everywhere: these answers mean "none", not "try the CLI".
          if (error instanceof Error && /responded (404|403|410|422)\./.test(error.message)) {
            return null;
          }
          throw error;
        }
      },
      catch: (error) => error,
    }).pipe(Effect.catch(() => cliService.getPullRequestStack(input)));

  const resolvePullRequestNumber: GitHubCliShape["resolvePullRequestNumber"] = (input) => {
    const reference = input.reference.trim();
    const numeric = /^#?(\d+)$/.exec(reference) ?? /\/pull\/(\d+)(?:[/?#].*)?$/.exec(reference);
    if (numeric?.[1]) return Effect.succeed(Number(numeric[1]));
    return Effect.tryPromise({
      try: async () => {
        const repository = await resolveGitHubRepository(input.cwd);
        if (repository === null) return null;
        const body = JSON.parse(
          await githubGraphql({
            cwd: input.cwd,
            host: repository.host,
            query: `query($owner: String!, $name: String!, $head: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(headRefName: $head, first: 10, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { number state }
    }
  }
}`,
            variables: { owner: repository.owner, name: repository.name, head: reference },
          }),
        ) as {
          data?: {
            repository?: {
              pullRequests?: { nodes?: ReadonlyArray<{ number: number; state: string }> };
            };
          };
        };
        const nodes = body.data?.repository?.pullRequests?.nodes ?? [];
        // What `gh pr view <branch>` prefers: an open pull request, else the latest one.
        return (nodes.find((node) => node.state === "OPEN") ?? nodes[0])?.number ?? null;
      },
      catch: (error) => error,
    }).pipe(Effect.catch(() => Effect.succeed(null)));
  };

  const directPullRequest: GitHubCliShape["getPullRequest"] = (input) =>
    resolvePullRequestNumber(input).pipe(
      Effect.flatMap((number) =>
        number === null
          ? cliService.getPullRequest(input)
          : Effect.tryPromise({
              try: async () => {
                const repository = await resolveGitHubRepository(input.cwd);
                if (repository === null) throw new Error("no repository");
                return pullRequestDetailNodeToRaw(
                  await githubGraphql({
                    cwd: input.cwd,
                    host: repository.host,
                    query: PULL_REQUEST_DETAIL_QUERY,
                    variables: { owner: repository.owner, name: repository.name, number },
                  }),
                );
              },
              catch: (error) => error,
            }).pipe(
              Effect.flatMap((raw) =>
                decodeGitHubJson(
                  raw,
                  RawGitHubPullRequestSchema,
                  "getPullRequest",
                  "GitHub returned invalid pull request JSON.",
                ),
              ),
              Effect.map(normalizePullRequestSummary),
              Effect.catch(() => cliService.getPullRequest(input)),
            ),
      ),
    );

  const service = {
    ...cliService,
    getPullRequest: directPullRequest,
    getPullRequestFiles: directFiles,
    getPullRequestReviewThreads: directReviewThreads,
    getPullRequestStack: directStack,
    resolvePullRequestNumber,
  } satisfies GitHubCliShape;

  return service;
});

export const GitHubCliLive = Layer.effect(GitHubCli, makeGitHubCli);
