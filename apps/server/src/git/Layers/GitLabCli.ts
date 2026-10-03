import { Effect, Layer } from "effect";
import { runProcess } from "../../processRunner";
import { GitLabCliError } from "../Errors.ts";
import { GitLabCli, type GitLabCliShape } from "../Services/GitLabCli.ts";
import type { GitResolvedPullRequest } from "@tabs/contracts";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_PULL_REQUEST_FILE_PATCH_CHARS = 200_000;
const MAX_PULL_REQUEST_FILES = 300;
const MAX_PULL_REQUEST_TOTAL_PATCH_CHARS = 2_000_000;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseState(value: unknown, mergedAt: unknown): "open" | "closed" | "merged" {
  if (text(mergedAt) || text(value)?.toLowerCase() === "merged") return "merged";
  return text(value)?.toLowerCase() === "closed" ? "closed" : "open";
}

function parseMergeRequest(value: unknown): GitResolvedPullRequest | null {
  const raw = record(value);
  if (!raw) return null;
  const prNumber = number(raw.iid ?? raw.id);
  const title = text(raw.title);
  const url = text(raw.web_url ?? raw.webUrl);
  const headBranch = text(raw.source_branch ?? raw.sourceBranch);
  const baseBranch = text(raw.target_branch ?? raw.targetBranch);
  if (!prNumber || !title || !url || !headBranch || !baseBranch) return null;

  const authorRecord = record(raw.author);
  const authorLogin = text(authorRecord?.username ?? authorRecord?.name);
  const reviewers = Array.isArray(raw.reviewers)
    ? raw.reviewers.flatMap((entry) => {
        const reviewer = record(entry);
        const login = text(reviewer?.username ?? reviewer?.name);
        return login
          ? [
              {
                login,
                ...(text(reviewer?.avatar_url ?? reviewer?.avatarUrl)
                  ? {
                      avatarUrl: text(reviewer?.avatar_url ?? reviewer?.avatarUrl)!,
                    }
                  : {}),
              },
            ]
          : [];
      })
    : [];
  const labels = Array.isArray(raw.labels)
    ? raw.labels.flatMap((entry) => {
        const label = record(entry);
        const name = text(label?.name ?? entry);
        return name
          ? [
              {
                name,
                ...(text(label?.color) ? { color: text(label?.color)! } : {}),
              },
            ]
          : [];
      })
    : [];
  const pipeline = record(raw.head_pipeline ?? raw.pipeline);
  const pipelineStatus = text(pipeline?.status)?.toLowerCase();
  const checksState = pipelineStatus
    ? ["success", "passed"].includes(pipelineStatus)
      ? ("passing" as const)
      : ["failed", "canceled", "skipped"].includes(pipelineStatus)
        ? ("failing" as const)
        : ("pending" as const)
    : undefined;
  const hasConflicts = raw.has_conflicts === true;
  const mergeStatus = text(raw.merge_status)?.toLowerCase();

  return {
    provider: "gitlab",
    number: prNumber,
    title,
    url,
    headBranch,
    baseBranch,
    state: parseState(raw.state, raw.merged_at),
    isDraft: raw.draft === true || raw.work_in_progress === true,
    ...(authorLogin
      ? {
          author: {
            login: authorLogin,
            ...(text(authorRecord?.avatar_url ?? authorRecord?.avatarUrl)
              ? {
                  avatarUrl: text(authorRecord?.avatar_url ?? authorRecord?.avatarUrl)!,
                }
              : {}),
          },
        }
      : {}),
    labels,
    reviewers,
    mergeability:
      hasConflicts || mergeStatus === "cannot_be_merged"
        ? "conflicting"
        : mergeStatus
          ? "mergeable"
          : "unknown",
    ...(checksState ? { checksState } : {}),
    ...(text(raw.created_at) ? { createdAt: text(raw.created_at)! } : {}),
    ...(text(raw.updated_at) ? { updatedAt: text(raw.updated_at)! } : {}),
    ...(typeof raw.description === "string" ? { body: raw.description } : {}),
    ...(typeof raw.changes_count === "string" && Number.isFinite(Number(raw.changes_count))
      ? { changedFiles: Number(raw.changes_count) }
      : {}),
  };
}

export function decodeGitLabMergeRequestChanges(
  value: unknown,
): NonNullable<GitResolvedPullRequest["files"]> {
  const raw = record(value);
  const changes = Array.isArray(raw?.changes) ? raw.changes.slice(0, MAX_PULL_REQUEST_FILES) : [];
  let remainingPatchChars = MAX_PULL_REQUEST_TOTAL_PATCH_CHARS;
  return changes.flatMap((entry) => {
    const change = record(entry);
    const path = text(change?.new_path ?? change?.old_path);
    if (!change || !path) return [];
    const previousPath = text(change.old_path);
    const patch = typeof change.diff === "string" ? change.diff : null;
    const status =
      change.new_file === true
        ? ("added" as const)
        : change.deleted_file === true
          ? ("removed" as const)
          : change.renamed_file === true
            ? ("renamed" as const)
            : ("modified" as const);
    let additions = 0;
    let deletions = 0;
    if (patch) {
      for (const line of patch.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
        else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
      }
    }
    const allowedPatchChars = Math.min(MAX_PULL_REQUEST_FILE_PATCH_CHARS, remainingPatchChars);
    const boundedPatch = patch === null ? null : patch.slice(0, allowedPatchChars);
    remainingPatchChars -= boundedPatch?.length ?? 0;
    return [
      {
        path,
        ...(previousPath && previousPath !== path ? { previousPath } : {}),
        status,
        additions,
        deletions,
        patch: boundedPatch,
        patchTruncated: patch !== null && patch.length > allowedPatchChars,
      },
    ];
  });
}

export function decodeGitLabMergeRequests(stdout: string): ReadonlyArray<GitResolvedPullRequest> {
  const parsed: unknown = JSON.parse(stdout);
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries.flatMap((entry) => {
    const pullRequest = parseMergeRequest(entry);
    return pullRequest ? [pullRequest] : [];
  });
}

const GITLAB_REACTION_NAMES = {
  THUMBS_UP: "thumbsup",
  THUMBS_DOWN: "thumbsdown",
  LAUGH: "laughing",
  HOORAY: "tada",
  CONFUSED: "confused",
  HEART: "heart",
  ROCKET: "rocket",
  EYES: "eyes",
} as const;

function gitLabReactionContent(name: string) {
  const entry = Object.entries(GITLAB_REACTION_NAMES).find(([, value]) => value === name);
  return entry?.[0] ?? null;
}

export function decodeGitLabReviewThreads(value: unknown, viewerLogin?: string | null) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const discussion = record(entry);
    const id = text(discussion?.id);
    const notes = Array.isArray(discussion?.notes) ? discussion.notes : [];
    const positioned = notes.find((note) => record(record(note)?.position));
    const position = record(record(positioned)?.position);
    const path = text(position?.new_path ?? position?.old_path);
    const lineValue = position?.new_line ?? position?.old_line;
    const line = typeof lineValue === "number" && lineValue > 0 ? Math.trunc(lineValue) : null;
    if (!discussion || !id || !path || !line) return [];
    const comments = notes.flatMap((note) => {
      const raw = record(note);
      const noteId = raw ? String(raw.id ?? "").trim() : "";
      const body = raw && typeof raw.body === "string" ? raw.body : null;
      const createdAt = raw && text(raw.created_at);
      if (!raw || !noteId || body === null || !createdAt || raw.system === true) return [];
      const author = record(raw.author);
      const login = text(author?.username ?? author?.name);
      const reactionCounts = new Map<
        string,
        { content: string; count: number; viewerHasReacted: boolean }
      >();
      for (const entry of Array.isArray(raw.award_emoji) ? raw.award_emoji : []) {
        const award = record(entry);
        const name = text(award?.name);
        const content = name ? gitLabReactionContent(name) : null;
        if (!award || !content) continue;
        const existing = reactionCounts.get(content);
        const awardUser = record(award.user);
        reactionCounts.set(content, {
          content,
          count: (existing?.count ?? 0) + 1,
          viewerHasReacted:
            (existing?.viewerHasReacted ?? false) ||
            (!!viewerLogin && text(awardUser?.username) === viewerLogin),
        });
      }
      const reactions = [...reactionCounts.values()];
      return [
        {
          id: noteId,
          author: login
            ? {
                login,
                ...(text(author?.avatar_url) ? { avatarUrl: text(author?.avatar_url)! } : {}),
              }
            : null,
          body,
          createdAt,
          ...(text(raw.updated_at) ? { updatedAt: text(raw.updated_at)! } : {}),
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
            side: position?.new_line ? ("right" as const) : ("left" as const),
            ...(discussion.resolved === true ? { resolved: true } : {}),
            comments,
          },
        ]
      : [];
  });
}

function normalizeGitLabCliError(operation: string, error: unknown): GitLabCliError {
  if (error instanceof Error) {
    if (error.message.includes("Command not found: glab")) {
      return new GitLabCliError({
        operation,
        detail: "GitLab CLI (`glab`) is required but not available on PATH.",
        cause: error,
      });
    }
    return new GitLabCliError({
      operation,
      detail: `GitLab CLI command failed: ${error.message}`,
      cause: error,
    });
  }
  return new GitLabCliError({
    operation,
    detail: "GitLab CLI command failed.",
    cause: error,
  });
}

export const makeGitLabCli = Effect.sync(() => {
  const execute: GitLabCliShape["execute"] = (input) =>
    Effect.tryPromise({
      try: () =>
        runProcess("glab", input.args, {
          cwd: input.cwd,
          timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        }),
      catch: (error) => normalizeGitLabCliError("execute", error),
    });

  return {
    execute,
    getAuthStatus: (input) =>
      execute({
        cwd: input.cwd,
        args: ["auth", "status"],
      }).pipe(
        Effect.map((result) => `${result.stdout}\n${result.stderr}`),
        Effect.catch((err) => {
          // glab auth status exits non-zero if not logged in.
          if (err && typeof err === "object" && "cause" in err) {
            const cause = err.cause;
            if (cause && typeof cause === "object") {
              const stdout =
                "stdout" in cause && typeof cause.stdout === "string" ? cause.stdout : "";
              const stderr =
                "stderr" in cause && typeof cause.stderr === "string" ? cause.stderr : "";
              if (stdout || stderr) {
                return Effect.succeed(`${stdout}\n${stderr}`);
              }
            }
          }
          return Effect.fail(err);
        }),
      ),
    listPullRequests: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "mr",
          "list",
          ...(input.state === "open"
            ? []
            : input.state === "merged"
              ? ["--merged"]
              : input.state === "closed"
                ? ["--closed"]
                : ["--all"]),
          "--per-page",
          String(input.limit),
          "--output",
          "json",
        ],
      }).pipe(
        Effect.flatMap((result) =>
          Effect.try({
            try: () => decodeGitLabMergeRequests(result.stdout.trim() || "[]"),
            catch: (error) => normalizeGitLabCliError("listPullRequests", error),
          }),
        ),
      ),
    getPullRequest: (input) =>
      Effect.gen(function* () {
        const details = yield* execute({
          cwd: input.cwd,
          args: ["mr", "view", input.reference, "--output", "json"],
        });
        const [pullRequest] = decodeGitLabMergeRequests(details.stdout.trim());
        if (!pullRequest) {
          return yield* normalizeGitLabCliError(
            "getPullRequest",
            new Error("GitLab returned an invalid merge request."),
          );
        }
        const changes = yield* execute({
          cwd: input.cwd,
          args: ["api", `projects/:fullpath/merge_requests/${pullRequest.number}/changes`],
        });
        return yield* Effect.try({
          try: () => {
            const parsedChanges: unknown = JSON.parse(changes.stdout.trim() || "{}");
            const files = decodeGitLabMergeRequestChanges(parsedChanges);
            return { ...pullRequest, ...(files.length > 0 ? { files } : {}) };
          },
          catch: (error) => normalizeGitLabCliError("getPullRequest", error),
        });
      }),
    getPullRequestReviewThreads: (input) =>
      Effect.gen(function* () {
        const viewerLogin = yield* execute({
          cwd: input.cwd,
          args: ["api", "user", "--jq", ".username"],
        }).pipe(
          Effect.map((result) => text(result.stdout)),
          Effect.catch(() => Effect.succeed(null)),
        );
        const result = yield* execute({
          cwd: input.cwd,
          args: [
            "api",
            "--paginate",
            `projects/:fullpath/merge_requests/${input.reference}/discussions`,
          ],
        });
        return yield* Effect.try({
          try: () =>
            decodeGitLabReviewThreads(JSON.parse(result.stdout.trim() || "[]"), viewerLogin),
          catch: (error) => normalizeGitLabCliError("getPullRequestReviewThreads", error),
        });
      }),
    mutatePullRequest: (input) => {
      const reference = input.reference.trim().replace(/^#/, "");
      let args: ReadonlyArray<string>;
      switch (input.action) {
        case "merge":
          args = [
            "mr",
            "merge",
            reference,
            ...(input.mergeMethod === "squash" ? ["--squash"] : []),
            ...(input.mergeMethod === "rebase" ? ["--rebase"] : []),
            ...(input.deleteBranch ? ["--remove-source-branch"] : []),
          ];
          break;
        case "close":
        case "reopen":
        case "approve":
          args = ["mr", input.action, reference];
          break;
        case "ready":
          args = ["mr", "update", reference, "--ready"];
          break;
        case "draft":
          args = ["mr", "update", reference, "--draft"];
          break;
        case "enable_auto_merge":
        case "disable_auto_merge":
        case "edit_pull_request":
        case "stack_rebase":
        case "stack_merge":
          return Effect.fail(
            new GitLabCliError({
              operation: "mutatePullRequest",
              detail: `GitLab does not advertise ${input.action.replaceAll("_", " ")} here.`,
            }),
          );
        case "comment":
          args = ["mr", "note", reference, "--message", input.body ?? ""];
          break;
        case "add_reviewer":
          args = ["mr", "update", reference, "--reviewer", input.value ?? ""];
          break;
        case "remove_reviewer":
          args = ["mr", "update", reference, "--unreviewer", input.value ?? ""];
          break;
        case "add_label":
          args = ["mr", "update", reference, "--label", input.value ?? ""];
          break;
        case "remove_label":
          args = ["mr", "update", reference, "--unlabel", input.value ?? ""];
          break;
        case "request_changes":
          return Effect.fail(
            new GitLabCliError({
              operation: "mutatePullRequest",
              detail: "GitLab does not support a request-changes review verdict.",
            }),
          );
        case "inline_comment":
          return Effect.gen(function* () {
            const versionsResult = yield* execute({
              cwd: input.cwd,
              args: ["api", `projects/:fullpath/merge_requests/${reference}/versions`],
            });
            const versions: unknown = JSON.parse(versionsResult.stdout.trim() || "[]");
            const latest = Array.isArray(versions) ? record(versions[0]) : null;
            const baseSha = text(latest?.base_commit_sha);
            const startSha = text(latest?.start_commit_sha);
            const headSha = text(latest?.head_commit_sha);
            if (!baseSha || !startSha || !headSha) {
              return yield* new GitLabCliError({
                operation: "mutatePullRequest",
                detail: "GitLab did not return merge-request diff version SHAs.",
              });
            }
            yield* execute({
              cwd: input.cwd,
              args: [
                "api",
                "--method",
                "POST",
                `projects/:fullpath/merge_requests/${reference}/discussions`,
                "--raw-field",
                `body=${input.body ?? ""}`,
                "--raw-field",
                "position[position_type]=text",
                "--raw-field",
                `position[base_sha]=${baseSha}`,
                "--raw-field",
                `position[start_sha]=${startSha}`,
                "--raw-field",
                `position[head_sha]=${headSha}`,
                "--raw-field",
                `position[${input.side === "left" ? "old_path" : "new_path"}]=${input.path ?? ""}`,
                "--field",
                `position[${input.side === "left" ? "old_line" : "new_line"}]=${input.line ?? 0}`,
              ],
            });
          });
        case "reply_to_thread":
          args = [
            "api",
            "--method",
            "POST",
            `projects/:fullpath/merge_requests/${reference}/discussions/${input.threadId ?? ""}/notes`,
            "--raw-field",
            `body=${input.body ?? ""}`,
          ];
          break;
        case "resolve_thread":
        case "unresolve_thread":
          args = [
            "api",
            "--method",
            "PUT",
            `projects/:fullpath/merge_requests/${reference}/discussions/${input.threadId ?? ""}`,
            "--field",
            `resolved=${input.action === "resolve_thread"}`,
          ];
          break;
        case "add_reaction":
          args = [
            "api",
            "--method",
            "POST",
            `projects/:fullpath/merge_requests/${reference}/notes/${input.subjectId ?? ""}/award_emoji`,
            "--raw-field",
            `name=${GITLAB_REACTION_NAMES[input.reaction ?? "THUMBS_UP"]}`,
          ];
          break;
        case "remove_reaction":
          return Effect.gen(function* () {
            const [viewerResult, awardsResult] = yield* Effect.all([
              execute({ cwd: input.cwd, args: ["api", "user"] }),
              execute({
                cwd: input.cwd,
                args: [
                  "api",
                  "--paginate",
                  `projects/:fullpath/merge_requests/${reference}/notes/${input.subjectId ?? ""}/award_emoji`,
                ],
              }),
            ]);
            const viewerId = record(JSON.parse(viewerResult.stdout.trim() || "{}"))?.id;
            const awards: unknown = JSON.parse(awardsResult.stdout.trim() || "[]");
            const reactionName = GITLAB_REACTION_NAMES[input.reaction ?? "THUMBS_UP"];
            const owned = Array.isArray(awards)
              ? awards.find((entry) => {
                  const award = record(entry);
                  return text(award?.name) === reactionName && record(award?.user)?.id === viewerId;
                })
              : null;
            const awardId = record(owned)?.id;
            if (typeof awardId !== "number" && typeof awardId !== "string") return;
            yield* execute({
              cwd: input.cwd,
              args: [
                "api",
                "--method",
                "DELETE",
                `projects/:fullpath/merge_requests/${reference}/notes/${input.subjectId ?? ""}/award_emoji/${awardId}`,
              ],
            });
          });
      }
      return execute({ cwd: input.cwd, args }).pipe(Effect.asVoid);
    },
    createPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "api",
          "--method",
          "POST",
          "projects/:fullpath/merge_requests",
          "--raw-field",
          `source_branch=${input.headBranch}`,
          "--raw-field",
          `target_branch=${input.baseBranch}`,
          "--raw-field",
          `title=${input.draft && !/^draft:/i.test(input.title) ? `Draft: ${input.title}` : input.title}`,
          "--field",
          `description=@${input.bodyFile}`,
        ],
      }).pipe(Effect.asVoid),
  } satisfies GitLabCliShape;
});

export const GitLabCliLive = Layer.effect(GitLabCli, makeGitLabCli);
