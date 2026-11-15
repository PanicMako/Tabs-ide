import {
  CommandId,
  MessageId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2Subagent,
} from "@tabs/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import { reportLabel } from "./Notification.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

/**
 * Wakes the parent of an app-owned delegated task when the task is blocked on a person: a
 * question, or an approval. The request blocks the task until someone answers it, and the user
 * rarely watches child threads, so the parent agent is told to answer a question itself or to
 * ask the user. Approvals cannot be answered through the pending request tools, so the parent
 * is told to hand them to the user. This is the reactor upstream T3 Code v0.1.0 ships as
 * `DelegatedTaskQuestionReactor`, widened from questions to every blocking request, which
 * Overmind needs so a stuck worker never leaves its lead asleep.
 *
 * Failures need no reactor here: a failed child run is terminal, and the delegated completion
 * delivery already wakes the parent for it.
 */
export class DelegatedTaskQuestionReactor extends Context.Service<
  DelegatedTaskQuestionReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly handle: (event: OrchestrationV2DomainEvent) => Effect.Effect<void>;
  }
>()("tabs/orchestration-v2/DelegatedTaskQuestionReactor") {}

const TERMINAL_TASK_STATUSES = ["completed", "failed", "cancelled", "interrupted"];

/** Questions can be answered by the parent; everything else is the user's call. */
export const isQuestionRequest = (request: Pick<OrchestrationV2RuntimeRequest, "kind">) =>
  request.kind === "user_input";

/** Whether a request needs a person to move on. A request nobody can answer wakes no one. */
export const isBlockingRequest = (
  request: Pick<OrchestrationV2RuntimeRequest, "status" | "responseCapability">,
) => request.status === "pending" && request.responseCapability.type !== "not_resumable";

const wakeText = (
  task: OrchestrationV2Subagent,
  request: Pick<OrchestrationV2RuntimeRequest, "id" | "kind" | "responseCapability">,
) => {
  if (isQuestionRequest(request)) {
    const situation =
      request.responseCapability.type === "message"
        ? `Delegated task ${task.id} asked a question and is still working.`
        : `Delegated task ${task.id} is blocked on a question and cannot continue until it is answered.`;
    return `${situation} Read it with t3_pending_request_read using threadId ${task.childThreadId} and requestId ${request.id}. Answer it with t3_pending_request_respond when the answer follows from the task or the user's instructions; otherwise ask the user, then answer it. If it is no longer pending, it was answered or dismissed.`;
  }
  return `Delegated task ${task.id} is blocked on a ${request.kind} approval and cannot continue until the user decides. Tell the user to open thread ${task.childThreadId} and approve or deny it; do not try to answer it yourself. If it is no longer pending, it was decided or dismissed.`;
};

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;

  const wakeParent = Effect.fnUntraced(function* (
    task: OrchestrationV2Subagent,
    request: OrchestrationV2RuntimeRequest,
  ) {
    if (task.childThreadId === null) return;
    const key = `${task.threadId}:${request.id}`;
    const label = reportLabel(task.title?.trim() || task.prompt);
    const what = isQuestionRequest(request) ? "has a question" : "needs approval";
    yield* engine.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(`server:delegated-task-question:${key}`),
      threadId: task.threadId,
      messageId: MessageId.make(`message:delegated-task-question:${key}`),
      text: wakeText(task, request),
      notification: {
        source: { kind: "delegated_task", taskIds: [task.id], childThreadId: task.childThreadId },
        outcome: "updated",
        summary: `Delegated task${label === undefined ? "" : ` "${label}"`} ${what}`,
      },
      attachments: [],
      dispatchMode: { type: "queue_after_active" },
      createdBy: "agent",
      creationSource: "server",
    });
  });

  const handle: DelegatedTaskQuestionReactor["Service"]["handle"] = (event) =>
    Effect.gen(function* () {
      if (event.type === "run.updated") {
        // A parent run that settled while its blocking wait still held a request: nothing is
        // left to deliver it, so catch it up here.
        if (!["completed", "failed", "waiting"].includes(event.payload.status)) return;
        const parent = yield* projections.getThreadRecords(event.threadId, ["subagents"]);
        if (parent.thread.archivedAt !== null || parent.thread.deletedAt !== null) return;
        for (const task of parent.subagents) {
          if (
            task.origin !== "app_owned" ||
            task.runId !== event.payload.id ||
            task.completionWake !== "settled_only" ||
            task.completionDelivery?.state === "disposed" ||
            task.childThreadId === null ||
            TERMINAL_TASK_STATUSES.includes(task.status)
          ) {
            continue;
          }
          const child = yield* projections.getThreadRecords(task.childThreadId, [
            "runtimeRequests",
          ]);
          for (const request of child.runtimeRequests) {
            if (!isBlockingRequest(request) || request.responseCapability.type !== "live") {
              continue;
            }
            yield* wakeParent(task, request).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("catching up a delegated task request failed", {
                  taskId: task.id,
                  requestId: request.id,
                  cause,
                }),
              ),
            );
          }
        }
        return;
      }
      if (event.type !== "runtime-request.updated") return;
      const child = yield* projections.getThread(event.threadId);
      const parentThreadId = child.lineage.parentThreadId;
      if (parentThreadId === null) return;
      const request = yield* projections.getRuntimeRequest(event.threadId, event.payload.id);
      // Keyed by the request, so a request updated while still pending wakes the parent once.
      const key = `${parentThreadId}:${event.payload.id}`;
      const messageId = MessageId.make(`message:delegated-task-question:${key}`);
      if (request === undefined || request === null || !isBlockingRequest(request)) {
        // Answered or dismissed before the parent got to it: drop the stale wake.
        const parent = yield* projections.getThreadRecords(parentThreadId, ["runs"]);
        const queued = parent.runs.find(
          (run) => run.status === "queued" && run.userMessageId === messageId,
        );
        if (queued !== undefined) {
          yield* engine.dispatch({
            type: "queued-run.cancel",
            commandId: CommandId.make(`server:delegated-task-question-cancel:${key}`),
            threadId: parentThreadId,
            runId: queued.id,
          });
        }
        return;
      }
      const parent = yield* projections.getThreadRecords(parentThreadId, ["subagents", "runs"]);
      const taskId = child.forkedFrom?.type === "node" ? child.forkedFrom.nodeId : undefined;
      const task = parent.subagents.find(
        (candidate) => candidate.origin === "app_owned" && candidate.id === taskId,
      );
      if (
        task === undefined ||
        parent.thread.archivedAt !== null ||
        parent.thread.deletedAt !== null
      ) {
        return;
      }
      // A blocking delegate_task wait delivers the request itself.
      if (
        task.completionWake === "settled_only" &&
        request.responseCapability.type === "live" &&
        parent.runs.some(
          (run) =>
            run.id === task.runId &&
            (run.status === "preparing" || run.status === "starting" || run.status === "running"),
        )
      ) {
        return;
      }
      yield* wakeParent(task, request);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("waking the parent of a delegated task request failed", {
          threadId: event.threadId,
          cause,
        }),
      ),
    );

  const start: DelegatedTaskQuestionReactor["Service"]["start"] = () =>
    forkParked(
      Stream.runForEach(engine.streamDomainEvents, handle).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("delegated task request event stream failed", { cause }),
        ),
      ),
    );

  return { start, handle } satisfies DelegatedTaskQuestionReactor["Service"];
});

export const layer = Layer.effect(DelegatedTaskQuestionReactor, make);
