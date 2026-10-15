import { remapComposerContextAttachments } from "@tabs/shared/composerContextReferences";
import { appendUserInputAttachmentPaths } from "../provider/userInputAttachments.ts";
import type { ChatAttachment, OrchestrationV2Command } from "@tabs/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import * as Schema from "effect/Schema";
import { resolveAttachmentPath } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as Orchestrator from "./Orchestrator.ts";

import * as AttachmentClaims from "./AttachmentClaims.ts";
import * as CancellationIntentStore from "./CancellationIntentStore.ts";
import * as OrchestrationCommandReceipts from "../persistence/OrchestrationCommandReceipts.ts";
import * as ThreadLaunch from "./ThreadLaunchService.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

// Intake and cancellation for one message share ownership through commit. Independent
// messages remain concurrent, and idle locks are removed after their last waiter.
const intakeLocks = new WeakMap<
  object,
  Map<string, { semaphore: Semaphore.Semaphore; users: number }>
>();
function withIntakeLock<A, E, R>(
  owner: object,
  threadId: string,
  messageId: string,
  task: Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      let locks = intakeLocks.get(owner);
      if (!locks) {
        locks = new Map();
        intakeLocks.set(owner, locks);
      }
      const key = JSON.stringify([threadId, messageId]);
      let lock = locks.get(key);
      if (!lock) {
        lock = { semaphore: Semaphore.makeUnsafe(1), users: 0 };
        locks.set(key, lock);
      }
      lock.users++;
      return { locks, key, lock };
    }),
    ({ lock }) => lock.semaphore.withPermit(task),
    ({ locks, key, lock }) =>
      Effect.sync(() => {
        if (--lock.users === 0) locks.delete(key);
      }),
  );
}

// These dispatcher failures occur in receipt validation or planning, before
// commitCommand. Generic dispatch errors can follow a commit and remain uncertain.
function dispatchWasNotAccepted(
  error: Orchestrator.OrchestratorV2Error | ThreadManagement.ThreadManagementError,
) {
  switch (error._tag) {
    case "OrchestratorCommandRejectedError":
    case "OrchestratorProjectionError":
    case "OrchestratorProviderAdapterError":
    case "OrchestratorCommandPreviouslyRejectedError":
    case "OrchestratorCommandIdConflictError":
    case "OrchestratorSubagentThreadReadOnlyError":
      return true;
    default:
      return false;
  }
}
const isOrchestratorError = Schema.is(Orchestrator.OrchestratorV2Error);

const releaseUnusedClaims = Effect.fn("ThreadMessageIntake.releaseUnusedClaims")(function* (
  claimedPaths: ReadonlyArray<string>,
  accepted: ReadonlyArray<ChatAttachment>,
) {
  if (claimedPaths.length === 0) return;
  const config = yield* ServerConfig.ServerConfig;
  const retained = new Set(
    accepted.map((attachment) =>
      resolveAttachmentPath({
        attachmentsDir: config.attachmentsDir,
        attachment,
      }),
    ),
  );
  yield* AttachmentClaims.releaseClaimedAttachments(
    claimedPaths.filter((path) => !retained.has(path)),
  );
});

const dispatchCommandUnlocked = Effect.fn("ThreadMessageIntake.dispatchCommand")(function* (
  command: OrchestrationV2Command,
) {
  const threads = yield* ThreadManagement.ThreadManagementService;
  if (command.type === "runtime-request.respond" && command.attachmentsByQuestionId) {
    const config = yield* ServerConfig.ServerConfig;
    const incomingByQuestionId = command.attachmentsByQuestionId;
    yield* AttachmentClaims.validateAttachmentLimits(Object.values(incomingByQuestionId).flat());
    // Claims accumulate across questions, so all of preparation shares one
    // rollback boundary: any failure before dispatch removes every new copy.
    const claimedPaths: string[] = [];
    const prepared = yield* Effect.gen(function* () {
      const attachmentsByQuestionId: import("@tabs/contracts").UserInputAttachments = {};
      for (const [questionId, attachments] of Object.entries(incomingByQuestionId)) {
        const claimed = yield* AttachmentClaims.claimPendingAttachments({
          threadId: command.threadId,
          attachments,
        });
        claimedPaths.push(...claimed.claimedPaths);
        Object.defineProperty(attachmentsByQuestionId, questionId, {
          value: claimed.attachments,
          enumerable: true,
        });
      }
      const answers = yield* appendUserInputAttachmentPaths({
        answers: command.answers ?? {},
        attachmentsByQuestionId,
        attachmentsDir: config.attachmentsDir,
      }).pipe(
        Effect.mapError(
          (cause) => new AttachmentClaims.AttachmentClaimError({ message: cause.issue }),
        ),
      );
      return { answers, attachmentsByQuestionId };
    }).pipe(Effect.onError(() => AttachmentClaims.releaseClaimedAttachments(claimedPaths)));
    return yield* threads
      .dispatch({
        ...command,
        answers: prepared.answers,
        attachmentsByQuestionId: prepared.attachmentsByQuestionId,
      })
      .pipe(
        Effect.tap((result) => {
          // A replayed receipt reports the first attempt's answer, so this
          // attempt's copies go unreferenced and are released. The resolved
          // turn item proves the respond was applied; questionAnswer is only
          // recorded when the accepted command carried attachments, so its
          // absence means the accepted answer referenced no copies. With no
          // resolved item at all the outcome is ambiguous and everything stays.
          const answeredItems = result.storedEvents.flatMap(({ event }) =>
            event.type === "turn-item.updated" &&
            event.payload.type === "user_input_request" &&
            event.payload.requestId === command.requestId
              ? [event.payload]
              : [],
          );
          return answeredItems.length > 0
            ? releaseUnusedClaims(
                claimedPaths,
                answeredItems.flatMap((item) =>
                  item.questionAnswer === undefined
                    ? []
                    : Object.values(item.questionAnswer.attachmentsByQuestionId).flat(),
                ),
              )
            : Effect.void;
        }),
        Effect.tapError((error) =>
          dispatchWasNotAccepted(error)
            ? AttachmentClaims.releaseClaimedAttachments(claimedPaths)
            : Effect.void,
        ),
      );
  }
  if (
    command.type !== "message.dispatch" &&
    (command.type !== "queued-run.edit" || command.attachments === undefined)
  )
    return yield* threads.dispatch(command);

  if (command.type === "message.dispatch") {
    const cancellationStoreOpt = yield* Effect.serviceOption(
      CancellationIntentStore.CancellationIntentStoreV2,
    );
    if (Option.isSome(cancellationStoreOpt)) {
      const wasCancelled = yield* cancellationStoreOpt.value.hasForMessage(
        command.threadId,
        command.messageId,
      );
      if (wasCancelled) {
        const receiptRepoOpt = yield* Effect.serviceOption(
          OrchestrationCommandReceipts.OrchestrationCommandReceiptRepository,
        );
        if (Option.isSome(receiptRepoOpt)) {
          yield* receiptRepoOpt.value.upsert({
            commandId: command.commandId,
            aggregateKind: "thread",
            aggregateId: command.threadId,
            commandType: command.type,
            acceptedAt: new Date().toISOString() as any,
            resultSequence: 0 as any,
            status: "rejected",
            error: "Command was cancelled before intake commit",
          });
        }

        return yield* new Orchestrator.OrchestratorCommandRejectedError({
          commandId: command.commandId,
          commandType: command.type,
        });
      }
    }
  }

  const claimed = yield* AttachmentClaims.claimPendingAttachments({
    threadId: command.threadId,
    attachments: command.attachments ?? [],
  });
  return yield* threads
    .dispatch({
      ...command,
      attachments: claimed.attachments,
      ...(command.context
        ? {
            context: remapComposerContextAttachments(
              command.context,
              command.attachments ?? [],
              claimed.attachments,
            ),
          }
        : {}),
    })
    .pipe(
      Effect.tap((result) =>
        releaseUnusedClaims(
          claimed.claimedPaths,
          result.storedEvents.flatMap(({ event }) =>
            event.type === "message.updated" ? event.payload.attachments : [],
          ),
        ),
      ),
      Effect.tapError((error) =>
        dispatchWasNotAccepted(error)
          ? AttachmentClaims.releaseClaimedAttachments(claimed.claimedPaths)
          : Effect.void,
      ),
    );
});

export const dispatchCommand = Effect.fn("ThreadMessageIntake.dispatchCommand.serialized")(
  function* (command: OrchestrationV2Command) {
    if (command.type !== "message.dispatch") return yield* dispatchCommandUnlocked(command);
    const threads = yield* ThreadManagement.ThreadManagementService;
    return yield* withIntakeLock(
      threads,
      command.threadId,
      command.messageId,
      dispatchCommandUnlocked(command),
    );
  },
);

export const sendToThread = Effect.fn("ThreadMessageIntake.sendToThread")(function* (
  input: ThreadManagement.ThreadManagementSendInput,
) {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const claimed = yield* AttachmentClaims.claimPendingAttachments(input);
  return yield* threads.sendToThread({ ...input, attachments: claimed.attachments }).pipe(
    Effect.tap((result) => releaseUnusedClaims(claimed.claimedPaths, result.message.attachments)),
    Effect.tapError((error) =>
      dispatchWasNotAccepted(error)
        ? AttachmentClaims.releaseClaimedAttachments(claimed.claimedPaths)
        : Effect.void,
    ),
  );
});

export const launchThread = Effect.fn("ThreadMessageIntake.launchThread")(function* (
  input: ThreadLaunch.ThreadLaunchInput,
) {
  const launches = yield* ThreadLaunch.ThreadLaunchService;
  yield* AttachmentClaims.validateAttachmentLimits(input.initialMessage?.attachments ?? []);
  if (!input.initialMessage?.attachments.some(AttachmentClaims.attachmentIsPendingUpload)) {
    return yield* launches.launch(input);
  }
  if (input.threadId === undefined) {
    return yield* new AttachmentClaims.AttachmentClaimError({
      message: "Uploaded attachments need a thread id at launch.",
    });
  }
  const claimed = yield* AttachmentClaims.claimPendingAttachments({
    threadId: input.threadId,
    attachments: input.initialMessage.attachments,
  });
  return yield* launches
    .launch({
      ...input,
      initialMessage: {
        ...input.initialMessage,
        attachments: claimed.attachments,
        ...(input.initialMessage.context
          ? {
              context: remapComposerContextAttachments(
                input.initialMessage.context,
                input.initialMessage.attachments,
                claimed.attachments,
              ),
            }
          : {}),
      },
    })
    .pipe(
      Effect.tap((result) =>
        releaseUnusedClaims(
          claimed.claimedPaths,
          result.projection.messages.flatMap((message) => message.attachments),
        ),
      ),
      Effect.tapError((error) => {
        // Project/receipt reads precede message dispatch. The create-thread error
        // also wraps post-message projection reads, so its tag alone is not proof.
        const notAccepted =
          error.operation === "resolve-project" ||
          error.operation === "read-receipt" ||
          ((error.operation === "create-thread" || error.operation === "dispatch-message") &&
            isOrchestratorError(error.cause) &&
            // Projection errors under create-thread can occur after the message commit.
            (error.operation !== "create-thread" ||
              error.cause._tag !== "OrchestratorProjectionError") &&
            dispatchWasNotAccepted(error.cause));
        return notAccepted
          ? AttachmentClaims.releaseClaimedAttachments(claimed.claimedPaths)
          : Effect.void;
      }),
    );
});

const reconcileIntakeUnlocked = Effect.fn("ThreadMessageIntake.reconcileIntake")(function* (
  input: import("@tabs/contracts").OrchestrationV2ReconcileIntakeInput,
) {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const cancellationStoreOpt = yield* Effect.serviceOption(
    CancellationIntentStore.CancellationIntentStoreV2,
  );
  const receiptsOpt = yield* Effect.serviceOption(
    OrchestrationCommandReceipts.OrchestrationCommandReceiptRepository,
  );

  // 1. Check receipt if commandId provided and receipts repo available
  if (input.commandId && Option.isSome(receiptsOpt)) {
    const maybeReceipt = yield* receiptsOpt.value.getByCommandId({ commandId: input.commandId });
    if (Option.isSome(maybeReceipt)) {
      const receipt = maybeReceipt.value;
      if (receipt.status === "rejected") {
        return {
          outcome: "definitively_rejected" as const,
          runId: null,
          runStatus: null,
          message: receipt.error ?? "Intake command was rejected",
        };
      }
    }
  }

  // 2. Query thread projection window
  const snapshot = Option.some(
    yield* threads.getThreadSnapshotWindow(input.threadId, { rowLimit: 100 }),
  );

  if (snapshot._tag === "Some") {
    const proj = snapshot.value.projection;
    const matched = proj.runs?.find((r) => r.userMessageId === input.messageId);

    if (matched) {
      if (input.cancelIfFound) {
        if (matched.status === "queued") {
          yield* threads.dispatch({
            type: "queued-run.cancel",
            commandId:
              `cancel-${Date.now()}-${input.messageId}` as import("@tabs/contracts").CommandId,
            threadId: input.threadId,
            runId: matched.id,
          });
          const updated = yield* threads.getThreadSnapshotWindow(input.threadId, { rowLimit: 100 });
          const actual = updated.projection.runs?.find((run) => run.id === matched.id);
          const terminal =
            actual &&
            ["completed", "interrupted", "failed", "cancelled", "rolled_back"].includes(
              actual.status,
            );
          return {
            outcome:
              actual?.status === "cancelled"
                ? ("cancelled" as const)
                : terminal
                  ? ("already_completed" as const)
                  : ("unknown" as const),
            runId: matched.id,
            runStatus: actual?.status ?? matched.status,
          };
        } else if (["running", "preparing", "starting", "waiting"].includes(matched.status)) {
          yield* threads.dispatch({
            type: "run.interrupt",
            commandId:
              `interrupt-${Date.now()}-${input.messageId}` as import("@tabs/contracts").CommandId,
            threadId: input.threadId,
            runId: matched.id,
          });
          const updated = yield* threads.getThreadSnapshotWindow(input.threadId, { rowLimit: 100 });
          const actual = updated.projection.runs?.find((run) => run.id === matched.id);
          const terminal =
            actual &&
            ["completed", "interrupted", "failed", "cancelled", "rolled_back"].includes(
              actual.status,
            );
          return {
            outcome: terminal ? ("interrupted" as const) : ("running" as const),
            runId: matched.id,
            runStatus: actual?.status ?? matched.status,
            ...(!terminal
              ? { message: "Interruption requested; awaiting a terminal run outcome." }
              : {}),
          };
        } else {
          return {
            outcome: "already_completed" as const,
            runId: matched.id,
            runStatus: matched.status,
          };
        }
      } else {
        if (matched.status === "queued") {
          return {
            outcome: "queued" as const,
            runId: matched.id,
            runStatus: "queued",
          };
        } else if (["running", "preparing", "starting", "waiting"].includes(matched.status)) {
          return {
            outcome: "running" as const,
            runId: matched.id,
            runStatus: matched.status,
          };
        } else {
          return {
            outcome: "already_completed" as const,
            runId: matched.id,
            runStatus: matched.status,
          };
        }
      }
    }
  }

  // 3. Not found in projection:
  if (input.cancelIfFound) {
    if (Option.isNone(cancellationStoreOpt)) {
      return yield* new CancellationIntentStore.CancellationIntentStoreError({
        message: "Cancellation intent storage is unavailable.",
      });
    }
    if (Option.isSome(cancellationStoreOpt)) {
      yield* cancellationStoreOpt.value.record({
        commandId: (input.commandId ??
          `cancel-${input.threadId}-${input.messageId}`) as import("@tabs/contracts").CommandId,
        threadId: input.threadId,
        messageId: input.messageId,
        requestedAt: DateTime.nowUnsafe(),
      });
    }

    return {
      outcome: "cancelled" as const,
      runId: null,
      runStatus: null,
      message: "Cancellation intent persisted for pending/uncommitted intake",
    };
  }

  return {
    outcome: "unknown" as const,
    runId: null,
    runStatus: null,
  };
});

export const reconcileIntake = Effect.fn("ThreadMessageIntake.reconcileIntake.serialized")(
  function* (input: import("@tabs/contracts").OrchestrationV2ReconcileIntakeInput) {
    const threads = yield* ThreadManagement.ThreadManagementService;
    return yield* withIntakeLock(
      threads,
      input.threadId,
      input.messageId,
      reconcileIntakeUnlocked(input),
    );
  },
);

export const recordCancellationIntent = Effect.fn("ThreadMessageIntake.recordCancellationIntent")(
  function* (input: import("@tabs/contracts").OrchestrationV2RecordCancellationIntentInput) {
    const result = yield* reconcileIntake({
      threadId: input.threadId,
      messageId: input.messageId,
      commandId: input.commandId,
      cancelIfFound: true,
    });
    return {
      recorded: true,
      appliedImmediateOutcome:
        result.outcome === "cancelled" ||
        result.outcome === "interrupted" ||
        result.outcome === "already_completed"
          ? result.outcome
          : null,
      runId: result.runId,
    };
  },
);
