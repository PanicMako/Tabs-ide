import { Clock, Effect, Schema } from "effect";
import type { GitPullRequestStack, GitPullRequestStackHead } from "@tabs/contracts";
import type { GitHubCliShape } from "./Services/GitHubCli.ts";

const stackErrorIdentity = {
  repository: Schema.String,
  number: Schema.Int,
  stackNumber: Schema.Int,
};

export class GitHubStackChangedError extends Schema.TaggedErrorClass<GitHubStackChangedError>()(
  "GitHubStackChangedError",
  { ...stackErrorIdentity, completed: Schema.Int },
) {
  get detail(): string {
    return this.message;
  }

  override get message(): string {
    return this.completed > 0
      ? `The stack changed at PR #${this.number} after ${this.completed} layers. Earlier updates remain on GitHub. Refresh it before trying again.`
      : "The stack changed. Refresh it before trying again.";
  }
}

export class GitHubStackUnsupportedError extends Schema.TaggedErrorClass<GitHubStackUnsupportedError>()(
  "GitHubStackUnsupportedError",
  stackErrorIdentity,
) {
  get detail(): string {
    return this.message;
  }

  override get message(): string {
    return "This operation is not supported for this stack.";
  }
}

export class GitHubStackResponseInvalidError extends Schema.TaggedErrorClass<GitHubStackResponseInvalidError>()(
  "GitHubStackResponseInvalidError",
  { ...stackErrorIdentity, cause: Schema.optional(Schema.Unknown) },
) {
  get detail(): string {
    return this.message;
  }

  override get message(): string {
    return "GitHub returned an unreadable stack operation response.";
  }
}

export class GitHubStackMergeRejectedError extends Schema.TaggedErrorClass<GitHubStackMergeRejectedError>()(
  "GitHubStackMergeRejectedError",
  { ...stackErrorIdentity, cause: Schema.optional(Schema.Unknown) },
) {
  get detail(): string {
    return this.message;
  }

  override get message(): string {
    return "GitHub refused the stack merge. Check the stack's branch rules and merge requirements.";
  }
}

export class GitHubStackMergePendingError extends Schema.TaggedErrorClass<GitHubStackMergePendingError>()(
  "GitHubStackMergePendingError",
  stackErrorIdentity,
) {
  get detail(): string {
    return this.message;
  }

  override get message(): string {
    return "The merge is still running on GitHub. Check its status there before submitting another request.";
  }
}

export class GitHubStackPermissionError extends Schema.TaggedErrorClass<GitHubStackPermissionError>()(
  "GitHubStackPermissionError",
  stackErrorIdentity,
) {
  get detail(): string {
    return this.message;
  }

  override get message(): string {
    return "You cannot update every branch in this stack. Check write access and fork maintainer permissions before retrying.";
  }
}

export class GitHubStackRebaseFailedError extends Schema.TaggedErrorClass<GitHubStackRebaseFailedError>()(
  "GitHubStackRebaseFailedError",
  { ...stackErrorIdentity, completed: Schema.Int, cause: Schema.optional(Schema.Unknown) },
) {
  get detail(): string {
    return this.message;
  }

  override get message(): string {
    return `Stack rebase stopped at PR #${this.number} after ${this.completed} layers. Earlier updates remain on GitHub; resolve the failing layer before retrying.`;
  }
}

export type GitHubStackActionError =
  | GitHubStackChangedError
  | GitHubStackUnsupportedError
  | GitHubStackResponseInvalidError
  | GitHubStackMergeRejectedError
  | GitHubStackMergePendingError
  | GitHubStackPermissionError
  | GitHubStackRebaseFailedError;

const RawStackPullRequestSchema = Schema.Struct({
  title: Schema.optional(Schema.String),
  draft: Schema.optional(Schema.Boolean),
  number: Schema.Int,
  head: Schema.Struct({ ref: Schema.String, sha: Schema.optional(Schema.String) }),
  state: Schema.optional(Schema.NullOr(Schema.String)),
  merged_at: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawStackSchema = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.Union([Schema.Int, Schema.String]))),
  number: Schema.Int,
  node_id: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.String,
  html_url: Schema.optional(Schema.NullOr(Schema.String)),
  base: Schema.Union([Schema.String, Schema.Struct({ ref: Schema.String })]),
  pull_requests: Schema.Array(RawStackPullRequestSchema),
});

const decodeRawStacks = Schema.decodeUnknownSync(Schema.Array(RawStackSchema));

function normalizePullRequestState(input: {
  state?: string | null | undefined;
  mergedAt?: string | null | undefined;
}): "open" | "closed" | "merged" {
  const mergedAt = input.mergedAt;
  const state = input.state;
  if (
    (typeof mergedAt === "string" && mergedAt.trim().length > 0) ||
    state?.toUpperCase() === "MERGED"
  ) {
    return "merged";
  }
  if (state?.toUpperCase() === "CLOSED") {
    return "closed";
  }
  return "open";
}

export function decodePullRequestStacksJson(raw: string): GitPullRequestStack | null {
  try {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed === "[]") return null;
    const parsed = JSON.parse(trimmed);
    const array = Array.isArray(parsed) ? parsed : [parsed];
    const decoded = decodeRawStacks(array);
    const stack = decoded[0];
    if (!stack || !Array.isArray(stack.pull_requests)) return null;
    return {
      id: stack.id != null ? String(stack.id) : stack.node_id?.trim() || String(stack.number),
      number: stack.number,
      url: stack.html_url?.trim() || stack.url,
      base: typeof stack.base === "string" ? stack.base : stack.base.ref,
      layers: stack.pull_requests.map((pr) => ({
        ...(pr.title !== undefined ? { title: pr.title } : {}),
        ...(pr.draft !== undefined ? { isDraft: pr.draft } : {}),
        ...(pr.head.sha !== undefined ? { headSha: pr.head.sha } : {}),
        number: pr.number,
        headBranch: pr.head.ref,
        state: normalizePullRequestState({ state: pr.state, mergedAt: pr.merged_at }),
      })),
    };
  } catch {
    return null;
  }
}

const MergeResponse = Schema.Struct({
  status: Schema.Literals(["pending", "merged", "enqueued", "failed"]),
  details: Schema.Struct({
    uuid: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
  }),
});

const decodeBranchAccess = (raw: string) =>
  Effect.try({
    try: () => {
      const parsed = JSON.parse(raw);
      return Schema.decodeUnknownSync(
        Schema.Struct({
          data: Schema.Struct({
            repository: Schema.NullOr(
              Schema.Record(
                Schema.String,
                Schema.NullOr(
                  Schema.Struct({
                    headRepository: Schema.NullOr(
                      Schema.Struct({ viewerPermission: Schema.NullOr(Schema.String) }),
                    ),
                    maintainerCanModify: Schema.Boolean,
                  }),
                ),
              ),
            ),
          }),
        }),
      )(parsed);
    },
    catch: (cause) => cause,
  });

const decodeRebaseBranch = (raw: string) =>
  Effect.try({
    try: () => {
      const parsed = JSON.parse(raw);
      return Schema.decodeUnknownSync(
        Schema.Struct({
          data: Schema.Struct({
            processed: Schema.optional(
              Schema.Array(Schema.NullOr(Schema.Struct({ headRefOid: Schema.String }))),
            ),
            repository: Schema.Struct({
              pullRequest: Schema.Struct({
                id: Schema.String,
                headRefOid: Schema.String,
                baseRef: Schema.Struct({ compare: Schema.Struct({ behindBy: Schema.Int }) }),
              }),
            }),
          }),
        }),
      )(parsed);
    },
    catch: (cause) => cause,
  });

const decodeRebaseResponse = (raw: string) =>
  Effect.try({
    try: () => {
      const parsed = JSON.parse(raw);
      return Schema.decodeUnknownSync(
        Schema.Struct({
          data: Schema.Struct({
            updatePullRequestBranch: Schema.Struct({
              pullRequest: Schema.Struct({ headRefOid: Schema.String }),
            }),
          }),
        }),
      )(parsed);
    },
    catch: (cause) => cause,
  });

const decodeMergeResponse = (raw: string) =>
  Effect.try({
    try: () => {
      const parsed = JSON.parse(raw);
      return Schema.decodeUnknownSync(MergeResponse)(parsed);
    },
    catch: (cause) => cause,
  });

/** Remote-only updates: a stack rebase never touches or rewrites the environment's local checkout. */
export const runGitHubStackAction = (input: {
  gitHubCli: GitHubCliShape;
  cwd: string;
  repository: string;
  host?: string | undefined;
  number: number;
  stackNumber: number;
  expectedStackHeads?: ReadonlyArray<GitPullRequestStackHead> | undefined;
  action: "stack_rebase" | "stack_merge";
  mergeMethod?: "merge" | "squash" | "rebase" | undefined;
}): Effect.Effect<void, GitHubStackActionError> =>
  Effect.gen(function* () {
    const github = input.gitHubCli;
    const host = input.host || "github.com";
    const identity = {
      repository: input.repository,
      number: input.number,
      stackNumber: input.stackNumber,
    };
    if (input.action !== "stack_merge" && input.action !== "stack_rebase") {
      return yield* new GitHubStackUnsupportedError({ ...identity });
    }
    const endpoint = `repos/${input.repository}`;
    const read = yield* github
      .execute({
        cwd: input.cwd,
        args: ["api", "--hostname", host, `${endpoint}/stacks?pull_request=${input.number}`],
      })
      .pipe(
        Effect.mapError((cause) => new GitHubStackResponseInvalidError({ ...identity, cause })),
      );
    const stack = decodePullRequestStacksJson(read.stdout);
    if (!stack) {
      return yield* new GitHubStackResponseInvalidError({ ...identity });
    }
    const targetIndex = stack.layers.findIndex((layer) => layer.number === input.number);
    const target = stack.layers[targetIndex];
    if (
      stack.number !== input.stackNumber ||
      target === undefined ||
      (input.action === "stack_rebase" && targetIndex !== stack.layers.length - 1)
    ) {
      return yield* new GitHubStackChangedError({
        ...identity,
        number: input.number,
        completed: 0,
      });
    }
    const affectedLayers =
      input.action === "stack_merge" ? stack.layers.slice(0, targetIndex + 1) : stack.layers;
    const open = affectedLayers.filter((layer) => layer.state !== "merged");
    if (input.action === "stack_merge" && target.state !== "open") {
      return yield* new GitHubStackUnsupportedError({ ...identity });
    }
    if (
      !input.expectedStackHeads ||
      input.expectedStackHeads.length !== open.length ||
      new Set(input.expectedStackHeads.map((layer) => layer.number)).size !== open.length ||
      open.some(
        (layer) =>
          !layer.headSha ||
          !input.expectedStackHeads?.some(
            (expected) => expected.number === layer.number && expected.headSha === layer.headSha,
          ),
      )
    ) {
      return yield* new GitHubStackChangedError({
        ...identity,
        number: input.number,
        completed: 0,
      });
    }
    if (open.length === 0 || open.some((layer) => layer.state !== "open")) {
      return yield* new GitHubStackUnsupportedError({ ...identity });
    }

    if (input.action === "stack_rebase") {
      const [owner, name] = input.repository.split("/");
      const permissions = yield* github
        .execute({
          cwd: input.cwd,
          args: [
            "api",
            "--hostname",
            host,
            "graphql",
            "-f",
            `owner=${owner}`,
            "-f",
            `name=${name}`,
            "-f",
            `query=query($owner:String!,$name:String!){repository(owner:$owner,name:$name){${open
              .map(
                (layer) =>
                  `pr${layer.number}:pullRequest(number:${layer.number}){headRepository{viewerPermission} maintainerCanModify}`,
              )
              .join(" ")}}}`,
          ],
        })
        .pipe(
          Effect.mapError((cause) => new GitHubStackResponseInvalidError({ ...identity, cause })),
        );
      const access = yield* decodeBranchAccess(permissions.stdout).pipe(
        Effect.mapError((cause) => new GitHubStackResponseInvalidError({ ...identity, cause })),
      );
      if (
        open.some((layer) => {
          const pr = access.data.repository?.[`pr${layer.number}`];
          return (
            !pr?.headRepository ||
            (!pr.maintainerCanModify &&
              !["ADMIN", "MAINTAIN", "WRITE"].includes(pr.headRepository.viewerPermission ?? ""))
          );
        })
      ) {
        return yield* new GitHubStackPermissionError({ ...identity });
      }

      const processed: Array<{ id: string; number: number; headSha: string }> = [];
      for (const [index, layer] of open.entries()) {
        yield* Effect.gen(function* () {
          const readBranch = yield* github
            .execute({
              cwd: input.cwd,
              args: [
                "api",
                "--hostname",
                host,
                "graphql",
                "-f",
                `owner=${owner}`,
                "-f",
                `name=${name}`,
                "-F",
                `number=${layer.number}`,
                "-f",
                `sha=${layer.headSha}`,
                "-f",
                `query=query($owner:String!,$name:String!,$number:Int!,$sha:String!){${
                  processed.length === 0
                    ? ""
                    : `processed:nodes(ids:${JSON.stringify(processed.map((head) => head.id))}){... on PullRequest{headRefOid}}`
                } repository(owner:$owner,name:$name){pullRequest(number:$number){id headRefOid baseRef{compare(headRef:$sha){behindBy}}}}}`,
              ],
            })
            .pipe(
              Effect.mapError(
                (cause) => new GitHubStackResponseInvalidError({ ...identity, cause }),
              ),
            );
          const {
            data: {
              processed: observed,
              repository: { pullRequest: pr },
            },
          } = yield* decodeRebaseBranch(readBranch.stdout).pipe(
            Effect.mapError((cause) => new GitHubStackResponseInvalidError({ ...identity, cause })),
          );
          const changed = processed.find((head, i) => observed?.[i]?.headRefOid !== head.headSha);
          if (changed !== undefined) {
            return yield* new GitHubStackChangedError({
              ...identity,
              number: changed.number,
              completed: index,
            });
          }
          if (pr.headRefOid !== layer.headSha) {
            return yield* new GitHubStackChangedError({
              ...identity,
              number: layer.number,
              completed: index,
            });
          }
          if (pr.baseRef.compare.behindBy === 0) {
            processed.push({ id: pr.id, number: layer.number, headSha: pr.headRefOid });
            return;
          }
          const updated = yield* github
            .execute({
              cwd: input.cwd,
              args: [
                "api",
                "--hostname",
                host,
                "graphql",
                "-f",
                `id=${pr.id}`,
                "-f",
                `sha=${layer.headSha}`,
                "-f",
                "query=mutation($id:ID!,$sha:GitObjectID!){updatePullRequestBranch(input:{pullRequestId:$id,expectedHeadOid:$sha,updateMethod:REBASE}){pullRequest{headRefOid}}}",
              ],
            })
            .pipe(
              Effect.mapError(
                (cause) => new GitHubStackResponseInvalidError({ ...identity, cause }),
              ),
            );
          const response = yield* decodeRebaseResponse(updated.stdout).pipe(
            Effect.mapError((cause) => new GitHubStackResponseInvalidError({ ...identity, cause })),
          );
          processed.push({
            id: pr.id,
            number: layer.number,
            headSha: response.data.updatePullRequestBranch.pullRequest.headRefOid,
          });
        }).pipe(
          Effect.mapError((cause: any) =>
            cause?._tag === "GitHubStackChangedError"
              ? cause
              : new GitHubStackRebaseFailedError({
                  ...identity,
                  number: layer.number,
                  completed: index,
                  cause,
                }),
          ),
        );
      }
      return;
    }

    // Stack merge action
    if (open.some((layer) => layer.isDraft)) {
      return yield* new GitHubStackUnsupportedError({ ...identity });
    }
    const decode = (raw: string) =>
      decodeMergeResponse(raw).pipe(
        Effect.mapError((cause) => new GitHubStackResponseInvalidError({ ...identity, cause })),
      );
    const request = yield* github
      .execute({
        cwd: input.cwd,
        args: [
          "api",
          "--hostname",
          host,
          "--method",
          "PUT",
          `${endpoint}/pulls/${input.number}/merge-async`,
          "-f",
          `merge_method=${input.mergeMethod ?? "merge"}`,
          "-f",
          "merge_action=default",
          "-f",
          `sha=${target.headSha}`,
        ],
      })
      .pipe(
        Effect.mapError((cause) => new GitHubStackResponseInvalidError({ ...identity, cause })),
      );
    let result = yield* decode(request.stdout);
    const deadline = (yield* Clock.currentTimeMillis) + 5 * 60_000;
    for (
      let attempt = 0;
      result.status === "pending" && (yield* Clock.currentTimeMillis) < deadline;
      attempt++
    ) {
      const uuid = result.details.uuid;
      if (!uuid) return yield* new GitHubStackResponseInvalidError({ ...identity });
      yield* Effect.sleep(Math.min(1_000 * 2 ** attempt, 10_000));
      const poll = yield* github
        .execute({
          cwd: input.cwd,
          args: [
            "api",
            "--hostname",
            host,
            `${endpoint}/pulls/${input.number}/merge-async/${encodeURIComponent(uuid)}`,
          ],
        })
        .pipe(
          Effect.mapError((cause) => new GitHubStackResponseInvalidError({ ...identity, cause })),
        );
      result = yield* decode(poll.stdout);
    }
    if (result.status === "pending") {
      return yield* new GitHubStackMergePendingError({ ...identity });
    }
    if (result.status === "failed") {
      return yield* new GitHubStackMergeRejectedError({ ...identity, cause: result });
    }
  });
