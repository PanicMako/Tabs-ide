import {
  ContextTransferId,
  OrchestrationV2Actor,
  OrchestrationV2AppThread,
  OrchestrationV2ContextSourcePoint,
  OrchestrationV2ContextTransfer,
  OrchestrationV2CreationSource,
  OrchestrationV2ProviderThread,
  OrchestrationV2Run,
  OrchestrationV2ThreadProjection,
  ThreadId,
} from "@tabs/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export interface ThreadForkPlanV2 {
  readonly targetThread: OrchestrationV2AppThread;
  /** Null for a side chat whose parent has no stable run yet: it starts from a digest instead. */
  readonly transfer: OrchestrationV2ContextTransfer | null;
}

export class ThreadForkPlanError extends Schema.TaggedError<ThreadForkPlanError>()(
  "ThreadForkPlanError",
  {
    sourceThreadId: ThreadId,
    targetThreadId: ThreadId,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/**
 * Fork copies a provider-finished conversation. Usage-limited and other
 * failed, interrupted, or cancelled turns still have a native thread (or a
 * portable transcript) even though the run did not complete successfully.
 * `waiting` is provider-finished with checkpoint capture still pending.
 * In-progress and rolled-back runs are not forkable.
 */
export function isForkableSourceRunStatus(status: OrchestrationV2Run["status"]): boolean {
  return (
    status === "completed" ||
    status === "waiting" ||
    status === "failed" ||
    status === "interrupted" ||
    status === "cancelled"
  );
}

export function forkableSourceRunStatusError(
  run: Pick<OrchestrationV2Run, "id" | "status">,
): string {
  return `Fork source run ${run.id} is ${run.status}; in-progress and rolled-back runs cannot be forked.`;
}

export interface ThreadForkServiceV2Shape {
  readonly plan: (input: {
    readonly sourceProjection: Pick<OrchestrationV2ThreadProjection, "thread">;
    /** Null only for a side chat whose parent has no stable run yet. */
    readonly sourceRun: OrchestrationV2Run | null;
    readonly sourceProviderThread: OrchestrationV2ProviderThread | undefined;
    readonly canonicalSourcePoint: OrchestrationV2ContextSourcePoint;
    readonly transferId: ContextTransferId;
    readonly targetThreadId: ThreadId;
    readonly title?: string;
    readonly sideChat?: boolean;
    readonly createdBy: OrchestrationV2Actor;
    readonly creationSource: OrchestrationV2CreationSource;
    readonly createdAt: DateTime.Utc;
  }) => Effect.Effect<ThreadForkPlanV2, ThreadForkPlanError>;
}

export class ThreadForkServiceV2 extends Context.Service<
  ThreadForkServiceV2,
  ThreadForkServiceV2Shape
>()("t3/orchestration-v2/ThreadForkService/ThreadForkServiceV2") {}

export const layer: Layer.Layer<ThreadForkServiceV2> = Layer.succeed(
  ThreadForkServiceV2,
  ThreadForkServiceV2.of({
    plan: (input) =>
      Effect.gen(function* () {
        const sourceLineage = input.sourceProjection.thread.lineage;
        if (
          input.sideChat &&
          (sourceLineage.sideChat === true || sourceLineage.relationshipToParent === "subagent")
        ) {
          return yield* new ThreadForkPlanError({
            sourceThreadId: input.sourceProjection.thread.id,
            targetThreadId: input.targetThreadId,
            cause:
              sourceLineage.sideChat === true
                ? "A side chat cannot start another side chat."
                : "A subagent cannot start a side chat.",
          });
        }
        const { sourceRun } = input;
        if (sourceRun === null && !input.sideChat) {
          return yield* new ThreadForkPlanError({
            sourceThreadId: input.sourceProjection.thread.id,
            targetThreadId: input.targetThreadId,
            cause: "No stable source run was found.",
          });
        }
        if (sourceRun !== null && !isForkableSourceRunStatus(sourceRun.status)) {
          return yield* new ThreadForkPlanError({
            sourceThreadId: input.sourceProjection.thread.id,
            targetThreadId: input.targetThreadId,
            cause: forkableSourceRunStatusError(sourceRun),
          });
        }
        const targetThread: OrchestrationV2AppThread = {
          ...input.sourceProjection.thread,
          createdBy: input.createdBy,
          creationSource: input.creationSource,
          id: input.targetThreadId,
          title: input.title ?? `${input.sourceProjection.thread.title} fork`,
          // The source's title job completes only on the source thread.
          titleRegeneration: null,
          activeProviderThreadId: null,
          lineage: {
            parentThreadId: input.sourceProjection.thread.id,
            relationshipToParent: "fork",
            rootThreadId: input.sourceProjection.thread.lineage.rootThreadId,
            ...(input.sideChat ? { sideChat: true } : {}),
          },
          forkedFrom:
            sourceRun === null
              ? null
              : { type: "run", threadId: input.sourceProjection.thread.id, runId: sourceRun.id },
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          snoozedUntil: null,
          snoozedAt: null,
          lastVisitedAt: null,
          deletedAt: null,
        };
        if (sourceRun === null) return { targetThread, transfer: null };
        const transfer: OrchestrationV2ContextTransfer = {
          id: input.transferId,
          type: "fork",
          sourceThreadId: input.sourceProjection.thread.id,
          targetThreadId: input.targetThreadId,
          sourcePoint: input.canonicalSourcePoint,
          basePoint: null,
          sourceProviderInstanceId: sourceRun.providerInstanceId,
          targetProviderInstanceId: null,
          targetRunId: null,
          status: "pending",
          resolution: null,
          createdBy: input.createdBy,
          error:
            input.sourceProviderThread?.nativeThreadRef?.strength === "strong"
              ? null
              : "Source provider thread does not expose a strong native thread ref.",
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
          consumedAt: null,
        };
        return { targetThread, transfer };
      }),
  }),
);
