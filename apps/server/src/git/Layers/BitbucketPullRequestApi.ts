import { Effect } from "effect";
import type {
  GitCreatePullRequestInput,
  GitMutatePullRequestInput,
  GitResolvedPullRequest,
} from "@tabs/contracts";

import { runProcess } from "../../processRunner";
import { BitbucketApiError } from "../Errors";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function actor(value: unknown) {
  const raw = record(value);
  const login = text(raw?.nickname ?? raw?.username ?? raw?.display_name);
  const links = record(raw?.links);
  const avatar = record(links?.avatar);
  return login
    ? {
        ...(text(raw?.uuid ?? raw?.account_id) ? { id: text(raw?.uuid ?? raw?.account_id)! } : {}),
        login,
        ...(text(avatar?.href) ? { avatarUrl: text(avatar?.href)! } : {}),
      }
    : null;
}

function filterLiteral(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function reviewerIdentity(value: unknown): { id: string; login: string } | null {
  const member = record(value);
  const raw = record(member?.user) ?? member;
  const id = text(raw?.uuid ?? raw?.account_id);
  const login = text(raw?.nickname ?? raw?.username ?? raw?.display_name);
  return id && login ? { id, login } : null;
}

function decodePullRequest(value: unknown): GitResolvedPullRequest | null {
  const raw = record(value);
  if (!raw) return null;
  const number = positiveInt(raw.id);
  const title = text(raw.title);
  const links = record(raw.links);
  const html = record(links?.html);
  const url = text(html?.href);
  const source = record(raw.source);
  const destination = record(raw.destination);
  const sourceBranch = record(source?.branch);
  const targetBranch = record(destination?.branch);
  const headBranch = text(sourceBranch?.name);
  const baseBranch = text(targetBranch?.name);
  if (!number || !title || !url || !headBranch || !baseBranch) return null;
  const state = text(raw.state)?.toUpperCase();
  const reviewers = Array.isArray(raw.reviewers)
    ? raw.reviewers.flatMap((entry) => {
        const reviewer = actor(entry);
        return reviewer ? [reviewer] : [];
      })
    : [];
  return {
    provider: "bitbucket",
    number,
    title,
    url,
    headBranch,
    baseBranch,
    state: state === "MERGED" ? "merged" : state === "DECLINED" ? "closed" : "open",
    isDraft: false,
    author: actor(raw.author),
    reviewers,
    mergeability: raw.conflict === true ? "conflicting" : "unknown",
    ...(typeof raw.description === "string" ? { body: raw.description } : {}),
    ...(text(raw.created_on) ? { createdAt: text(raw.created_on)! } : {}),
    ...(text(raw.updated_on) ? { updatedAt: text(raw.updated_on)! } : {}),
  };
}

export function decodeBitbucketPullRequests(value: unknown) {
  const raw = record(value);
  const rows = Array.isArray(raw?.values) ? raw.values : Array.isArray(value) ? value : [value];
  return rows.flatMap((entry) => {
    const pullRequest = decodePullRequest(entry);
    return pullRequest ? [pullRequest] : [];
  });
}

export function parseBitbucketDiff(patch: string): NonNullable<GitResolvedPullRequest["files"]> {
  const files: Array<NonNullable<GitResolvedPullRequest["files"]>[number]> = [];
  let current: { path: string; previousPath?: string; lines: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const body = current.lines.join("\n");
    let additions = 0;
    let deletions = 0;
    for (const line of current.lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
      if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
    }
    files.push({
      path: current.path,
      ...(current.previousPath && current.previousPath !== current.path
        ? { previousPath: current.previousPath }
        : {}),
      status: body.includes("new file mode")
        ? "added"
        : body.includes("deleted file mode")
          ? "removed"
          : current.previousPath && current.previousPath !== current.path
            ? "renamed"
            : "modified",
      additions,
      deletions,
      patch: body.slice(0, 200_000),
      patchTruncated: body.length > 200_000,
    });
  };
  for (const line of patch.split("\n")) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header) {
      flush();
      current = { previousPath: header[1]!, path: header[2]!, lines: [line] };
    } else current?.lines.push(line);
  }
  flush();
  return files.slice(0, 300);
}

export function decodeBitbucketThreads(
  value: unknown,
): NonNullable<GitResolvedPullRequest["reviewThreads"]> {
  const raw = record(value);
  const rows = Array.isArray(raw?.values) ? raw.values : [];
  const comments = rows.flatMap((entry) => {
    const comment = record(entry);
    const id = positiveInt(comment?.id);
    const content = record(comment?.content);
    const body = typeof content?.raw === "string" ? content.raw : null;
    const createdAt = text(comment?.created_on);
    const inline = record(comment?.inline);
    const path = text(inline?.path);
    const lineValue = inline?.to ?? inline?.from;
    const line = positiveInt(lineValue);
    if (
      !comment ||
      !id ||
      body === null ||
      !createdAt ||
      !path ||
      !line ||
      comment.deleted === true
    )
      return [];
    const parent = record(comment.parent);
    const rootId = positiveInt(parent?.id) ?? id;
    const links = record(comment.links);
    const html = record(links?.html);
    return [
      {
        rootId: String(rootId),
        path,
        line,
        side: inline?.to ? ("right" as const) : ("left" as const),
        resolved: comment.resolution !== null && comment.resolution !== undefined,
        comment: {
          id: String(id),
          author: actor(comment.user),
          body,
          createdAt,
          ...(text(comment.updated_on) ? { updatedAt: text(comment.updated_on)! } : {}),
          ...(text(html?.href) ? { url: text(html?.href)! } : {}),
        },
      },
    ];
  });
  const threads = new Map<
    string,
    (typeof comments)[number] & {
      comments: Array<(typeof comments)[number]["comment"]>;
    }
  >();
  for (const item of comments) {
    const existing = threads.get(item.rootId);
    if (existing) existing.comments.push(item.comment);
    else threads.set(item.rootId, { ...item, comments: [item.comment] });
  }
  return [...threads.values()].map(({ rootId, comment: _comment, ...thread }) => ({
    ...thread,
    id: rootId,
  }));
}

function credentials(): Record<string, string> | null {
  const accessToken = process.env.T3CODE_BITBUCKET_ACCESS_TOKEN;
  if (accessToken) return { Authorization: `Bearer ${accessToken}` };
  const email = process.env.T3CODE_BITBUCKET_EMAIL;
  const apiToken = process.env.T3CODE_BITBUCKET_API_TOKEN;
  return email && apiToken
    ? {
        Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`,
      }
    : null;
}

export const makeBitbucketPullRequestApi = Effect.sync(() => {
  const repository = (cwd: string) =>
    Effect.tryPromise({
      try: async () => {
        const result = await runProcess("git", ["remote", "get-url", "origin"], { cwd });
        const match = /bitbucket\.org[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(result.stdout.trim());
        if (!match) throw new Error("The origin remote is not a Bitbucket Cloud repository.");
        return `${encodeURIComponent(match[1]!)}/${encodeURIComponent(match[2]!)}`;
      },
      catch: (cause) =>
        new BitbucketApiError({
          operation: "resolveRepository",
          detail: cause instanceof Error ? cause.message : "Cannot resolve Bitbucket repository.",
          cause,
        }),
    });

  const request = (operation: string, path: string, init?: RequestInit) =>
    Effect.tryPromise({
      try: async () => {
        const auth = credentials();
        if (!auth) throw new Error("Bitbucket credentials are not configured.");
        const response = await fetch(
          path.startsWith("https://") ? path : `https://api.bitbucket.org/2.0/repositories/${path}`,
          {
            ...init,
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              ...auth,
              ...init?.headers,
            },
          },
        );
        const body = await response.text();
        if (!response.ok) {
          let apiMessage: string | null = null;
          try {
            const decoded: unknown = JSON.parse(body);
            apiMessage = text(record(record(decoded)?.error)?.message);
          } catch {
            // A proxy or host may return plain text or HTML; preserve that response below.
          }
          throw new BitbucketApiError({
            operation,
            status: response.status,
            detail: apiMessage ?? (body.trim() || response.statusText),
          });
        }
        return body;
      },
      catch: (cause) =>
        cause instanceof BitbucketApiError
          ? cause
          : new BitbucketApiError({
              operation,
              detail: cause instanceof Error ? cause.message : "Bitbucket request failed.",
              cause,
            }),
    });

  const withRepo = <A>(cwd: string, use: (repo: string) => Effect.Effect<A, BitbucketApiError>) =>
    repository(cwd).pipe(Effect.flatMap(use));

  const parseJson = (operation: string, body: string) =>
    Effect.try({
      try: () => JSON.parse(body || "{}") as unknown,
      catch: (cause) =>
        new BitbucketApiError({
          operation,
          detail: "Bitbucket returned malformed JSON.",
          cause,
        }),
    });

  return {
    listPullRequests: (input: {
      cwd: string;
      state: "all" | "open" | "merged" | "closed";
      limit: number;
      query?: string;
    }) =>
      withRepo(input.cwd, (repo) => {
        const state =
          input.state === "open"
            ? "OPEN"
            : input.state === "merged"
              ? "MERGED"
              : input.state === "closed"
                ? "DECLINED"
                : null;
        const query = new URLSearchParams({
          pagelen: String(Math.min(50, input.limit)),
          sort: "-updated_on",
        });
        if (state) query.set("state", state);
        const search = input.query?.trim();
        if (search) {
          const literal = filterLiteral(search);
          query.set("q", `(title ~ "${literal}" OR description ~ "${literal}")`);
        }
        return Effect.gen(function* () {
          const items: GitResolvedPullRequest[] = [];
          let next: string | null = `${repo}/pullrequests?${query}`;
          while (next && items.length < input.limit) {
            const body = yield* request("listPullRequests", next);
            const decoded = yield* parseJson("listPullRequests", body);
            items.push(...decodeBitbucketPullRequests(decoded));
            next = text(record(decoded)?.next);
          }
          return items.slice(0, input.limit);
        });
      }),
    getPullRequest: (input: { cwd: string; reference: string }) =>
      withRepo(input.cwd, (repo) =>
        Effect.gen(function* () {
          const number = input.reference.replace(/^#/, "");
          const [detailBody, diffBody] = yield* Effect.all([
            request("getPullRequest", `${repo}/pullrequests/${number}`),
            request("getPullRequestDiff", `${repo}/pullrequests/${number}/diff`, {
              headers: { Accept: "text/plain" },
            }),
          ]);
          const detail = decodePullRequest(yield* parseJson("getPullRequest", detailBody));
          if (!detail)
            return yield* new BitbucketApiError({
              operation: "getPullRequest",
              detail: "Bitbucket returned an incomplete pull request.",
            });
          const files = parseBitbucketDiff(diffBody);
          const commentValues: unknown[] = [];
          let nextComments: string | null = `${repo}/pullrequests/${number}/comments?pagelen=100`;
          for (let page = 0; nextComments && page < 20; page += 1) {
            const commentsBody = yield* request("getPullRequestComments", nextComments);
            const decoded = yield* parseJson("getPullRequestComments", commentsBody);
            const pageRecord = record(decoded);
            if (Array.isArray(pageRecord?.values)) commentValues.push(...pageRecord.values);
            nextComments = text(pageRecord?.next);
          }
          const reviewThreads = decodeBitbucketThreads({
            values: commentValues,
          });
          return {
            ...detail,
            ...(files.length ? { files } : {}),
            ...(reviewThreads.length ? { reviewThreads } : {}),
          };
        }),
      ),
    mutatePullRequest: (input: GitMutatePullRequestInput) =>
      withRepo(input.cwd, (repo) => {
        const number = input.reference.replace(/^#/, "");
        const root = `${repo}/pullrequests/${number}`;
        switch (input.action) {
          case "merge":
            return request("mergePullRequest", `${root}/merge`, {
              method: "POST",
              body: JSON.stringify({
                merge_strategy:
                  input.mergeMethod === "squash"
                    ? "squash"
                    : input.mergeMethod === "rebase"
                      ? "fast_forward"
                      : "merge_commit",
              }),
            }).pipe(Effect.asVoid);
          case "close":
            return request("declinePullRequest", `${root}/decline`, {
              method: "POST",
            }).pipe(Effect.asVoid);
          case "edit_pull_request":
            return request("editPullRequest", root, {
              method: "PUT",
              body: JSON.stringify({
                ...(input.title === undefined ? {} : { title: input.title }),
                ...(input.body === undefined ? {} : { description: input.body }),
              }),
            }).pipe(Effect.asVoid);
          case "add_reviewer":
          case "remove_reviewer":
            return Effect.gen(function* () {
              const current = yield* request("getPullRequest", root).pipe(
                Effect.flatMap((body) => parseJson("getPullRequest", body)),
              );
              const currentRaw = record(current);
              const reviewers = Array.isArray(currentRaw?.reviewers)
                ? currentRaw.reviewers.flatMap((entry) => {
                    const identity = reviewerIdentity(entry);
                    return identity ? [identity] : [];
                  })
                : [];
              const requestedValue = input.value ?? "";
              let requested = reviewers.find(
                (reviewer) => reviewer.id === requestedValue || reviewer.login === requestedValue,
              );
              if (input.action === "add_reviewer" && !requested) {
                const workspace = repo.split("/")[0]!;
                const literal = filterLiteral(requestedValue);
                const membersBody = yield* request(
                  "findReviewer",
                  `https://api.bitbucket.org/2.0/workspaces/${workspace}/members?pagelen=50&q=${encodeURIComponent(
                    `user.nickname = "${literal}"`,
                  )}`,
                );
                const members = record(yield* parseJson("findReviewer", membersBody));
                requested = Array.isArray(members?.values)
                  ? members.values
                      .flatMap((entry) => {
                        const identity = reviewerIdentity(entry);
                        return identity ? [identity] : [];
                      })
                      .find((reviewer) => reviewer.login === requestedValue)
                  : undefined;
                if (!requested) {
                  return yield* new BitbucketApiError({
                    operation: "findReviewer",
                    detail: `Bitbucket workspace member ${requestedValue} was not found.`,
                  });
                }
              }
              if (!requested) {
                return yield* new BitbucketApiError({
                  operation: "setReviewers",
                  detail: `Reviewer ${requestedValue} is not assigned to this pull request.`,
                });
              }
              const next = new Map(reviewers.map((reviewer) => [reviewer.id, reviewer]));
              if (input.action === "add_reviewer") next.set(requested.id, requested);
              else next.delete(requested.id);
              yield* request("setReviewers", root, {
                method: "PUT",
                body: JSON.stringify({
                  reviewers: [...next.keys()].map((uuid) => ({ uuid })),
                }),
              });
            });
          case "comment":
            return request("comment", `${root}/comments`, {
              method: "POST",
              body: JSON.stringify({ content: { raw: input.body ?? "" } }),
            }).pipe(Effect.asVoid);
          case "approve":
          case "request_changes":
            return request(
              input.action,
              `${root}/${input.action === "approve" ? "approve" : "request-changes"}`,
              { method: "POST" },
            ).pipe(Effect.asVoid);
          case "inline_comment":
            return request("inlineComment", `${root}/comments`, {
              method: "POST",
              body: JSON.stringify({
                content: { raw: input.body ?? "" },
                inline: {
                  path: input.path ?? "",
                  [input.side === "left" ? "from" : "to"]: input.line ?? 0,
                },
              }),
            }).pipe(Effect.asVoid);
          case "reply_to_thread":
            return request("reply", `${root}/comments`, {
              method: "POST",
              body: JSON.stringify({
                content: { raw: input.body ?? "" },
                parent: { id: Number(input.threadId) },
              }),
            }).pipe(Effect.asVoid);
          case "resolve_thread":
            return request("resolve", `${root}/comments/${input.threadId ?? ""}/resolve`, {
              method: "POST",
            }).pipe(Effect.asVoid);
          case "unresolve_thread":
            return request("unresolve", `${root}/comments/${input.threadId ?? ""}/resolve`, {
              method: "DELETE",
            }).pipe(Effect.asVoid);
          default:
            return Effect.fail(
              new BitbucketApiError({
                operation: "mutatePullRequest",
                detail: `Bitbucket does not support ${input.action.replaceAll("_", " ")} here.`,
              }),
            );
        }
      }),
    createPullRequest: (input: GitCreatePullRequestInput) =>
      withRepo(input.cwd, (repo) =>
        request("createPullRequest", `${repo}/pullrequests`, {
          method: "POST",
          body: JSON.stringify({
            title: input.title,
            description: input.body,
            source: { branch: { name: input.headBranch } },
            destination: { branch: { name: input.baseBranch } },
            close_source_branch: false,
          }),
        }).pipe(
          Effect.flatMap((body) => parseJson("createPullRequest", body)),
          Effect.flatMap((decoded) => {
            const pullRequest = decodePullRequest(decoded);
            return pullRequest
              ? Effect.succeed(pullRequest)
              : Effect.fail(
                  new BitbucketApiError({
                    operation: "createPullRequest",
                    detail: "Bitbucket returned an incomplete pull request.",
                  }),
                );
          }),
        ),
      ),
  };
});
