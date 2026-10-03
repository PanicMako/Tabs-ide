import { Effect, Layer, Schema } from "effect";
import { PositiveInt, TrimmedNonEmptyString } from "@tabs/contracts";

import { runProcess } from "../../processRunner";
import { GitHubCliError } from "../Errors.ts";
import {
  GitHubCli,
  type GitHubRepositoryCloneUrls,
  type GitHubCliShape,
  type GitHubPullRequestSummary,
} from "../Services/GitHubCli.ts";
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
  additions: Schema.optional(Schema.Number),
  deletions: Schema.optional(Schema.Number),
  changedFiles: Schema.optional(Schema.Number),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
  body: Schema.optional(Schema.String),
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
  const checksState =
    checks.length === 0
      ? undefined
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

  const service = {
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
      return execute({
        cwd: input.cwd,
        args,
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed([])
            : decodeGitHubJson(
                raw,
                Schema.Array(RawGitHubPullRequestSchema),
                "listOpenPullRequests",
                "GitHub CLI returned invalid PR list JSON.",
              ),
        ),
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
        Effect.map((pages) => {
          const files = pages.flat();
          let remainingPatchChars = MAX_PULL_REQUEST_TOTAL_PATCH_CHARS;
          return files.slice(0, MAX_PULL_REQUEST_FILES).map((file) => {
            const patch = file.patch ?? null;
            const allowedPatchChars = Math.min(
              MAX_PULL_REQUEST_FILE_PATCH_CHARS,
              remainingPatchChars,
            );
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
        }),
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
  } satisfies GitHubCliShape;

  return service;
});

export const GitHubCliLive = Layer.effect(GitHubCli, makeGitHubCli);
