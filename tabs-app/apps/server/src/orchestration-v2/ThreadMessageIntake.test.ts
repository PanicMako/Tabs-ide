// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  ChatAttachmentId,
  CommandId,
  EventId,
  MessageId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2Command,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2StoredEvent,
  type UserInputAttachments,
} from "@tabs/contracts";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { createPendingAttachmentId, resolveAttachmentPath } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import {
  OrchestratorCommandPreviouslyRejectedError,
  OrchestratorDispatchError,
} from "./Orchestrator.ts";
import * as CancellationIntentStore from "./CancellationIntentStore.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import {
  dispatchCommand,
  reconcileIntake,
  recordCancellationIntent,
} from "./ThreadMessageIntake.ts";

const layerIntakeTest = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-question-intake-",
}).pipe(Layer.provideMerge(NodeServices.layer));

const layerFailingDispatch = (captured: OrchestrationV2ServerCommand[]) =>
  Layer.mock(ThreadManagementService.ThreadManagementService)({
    dispatch: (command) => {
      captured.push(command);
      return Effect.fail(
        new OrchestratorDispatchError({
          commandId: command.commandId,
          commandType: command.type,
          cause: "Stop after intake",
        }),
      );
    },
  });

const NOW = DateTime.makeUnsafe("2026-09-13T00:00:00.000Z");

const answeredRespondEvents = (input: {
  readonly threadId: ThreadId;
  readonly requestId: string;
  readonly attachmentsByQuestionId: UserInputAttachments;
}): OrchestrationV2StoredEvent[] => [
  {
    sequence: 1,
    commandId: null,
    event: {
      id: EventId.make("evt-recorded-answer"),
      type: "turn-item.updated",
      threadId: input.threadId,
      occurredAt: NOW,
      payload: {
        id: TurnItemId.make("item-recorded-answer"),
        type: "user_input_request",
        threadId: input.threadId,
        runId: null,
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 1,
        status: "completed",
        title: null,
        startedAt: null,
        completedAt: NOW,
        updatedAt: NOW,
        requestId: RuntimeRequestId.make(input.requestId),
        questions: [],
        questionAnswer: {
          requestId: input.requestId,
          answers: {},
          attachmentsByQuestionId: input.attachmentsByQuestionId,
        },
      },
    },
  },
];

// The first attempt answered with text only: clients omit attachmentsByQuestionId
// entirely, so the recorded turn item resolves the request without a questionAnswer.
const textOnlyRespondEvents = (input: {
  readonly threadId: ThreadId;
  readonly requestId: string;
}): OrchestrationV2StoredEvent[] => [
  {
    sequence: 1,
    commandId: null,
    event: {
      id: EventId.make("evt-recorded-answer"),
      type: "turn-item.updated",
      threadId: input.threadId,
      occurredAt: NOW,
      payload: {
        id: TurnItemId.make("item-recorded-answer"),
        type: "user_input_request",
        threadId: input.threadId,
        runId: null,
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 1,
        status: "completed",
        title: null,
        startedAt: null,
        completedAt: NOW,
        updatedAt: NOW,
        requestId: RuntimeRequestId.make(input.requestId),
        questions: [],
      },
    },
  },
];

it.effect("claims question uploads and passes readable paths through the V2 request command", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const id = ChatAttachmentId.make(createPendingAttachmentId()!);
    NodeFS.writeFileSync(
      NodePath.join(config.attachmentsDir, `${id}.png`),
      new Uint8Array([1, 2, 3]),
    );
    const captured: OrchestrationV2ServerCommand[] = [];
    yield* dispatchCommand({
      type: "runtime-request.respond",
      commandId: CommandId.make("answer-1"),
      threadId: ThreadId.make("thread-answer"),
      requestId: RuntimeRequestId.make("request-1"),
      answers: { q: ["Selected option"] },
      attachmentsByQuestionId: {
        q: [{ type: "image", id, name: "screen.png", mimeType: "image/png", sizeBytes: 3 }],
      },
    }).pipe(Effect.provide(layerFailingDispatch(captured)), Effect.result);
    expect(captured).toHaveLength(1);
    const command = captured[0]!;
    expect(command.type).toBe("runtime-request.respond");
    if (command.type !== "runtime-request.respond") return;
    const attachment = command.attachmentsByQuestionId?.q?.[0];
    expect(attachment).toBeDefined();
    const path = resolveAttachmentPath({
      attachmentsDir: config.attachmentsDir,
      attachment: attachment!,
    });
    expect(path).not.toBeNull();
    expect(NodeFS.readFileSync(path!)).toEqual(Buffer.from([1, 2, 3]));
    expect(command.answers?.q).toEqual([
      "Selected option",
      `Attached image "screen.png": "${path}"`,
    ]);
  }).pipe(Effect.provide(layerIntakeTest)),
);

it.effect("rolls back earlier question claims when a later pending upload is missing", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const threadId = ThreadId.make("thread-q-fail");
    const pendingId = ChatAttachmentId.make(createPendingAttachmentId()!);
    const existingId = ChatAttachmentId.make("thread-q-fail-00000000-0000-4000-8000-000000000001");
    NodeFS.writeFileSync(
      NodePath.join(config.attachmentsDir, `${pendingId}.png`),
      new Uint8Array([1, 2, 3]),
    );
    NodeFS.writeFileSync(
      NodePath.join(config.attachmentsDir, `${existingId}.png`),
      new Uint8Array([9, 9, 9, 9]),
    );
    const captured: OrchestrationV2ServerCommand[] = [];
    const result = yield* dispatchCommand({
      type: "runtime-request.respond",
      commandId: CommandId.make("answer-missing-pending"),
      threadId,
      requestId: RuntimeRequestId.make("request-missing-pending"),
      answers: { q1: ["one"], q2: ["two"] },
      attachmentsByQuestionId: {
        q1: [
          {
            type: "image",
            id: existingId,
            name: "keep.png",
            mimeType: "image/png",
            sizeBytes: 4,
          },
          {
            type: "image",
            id: pendingId,
            name: "screen.png",
            mimeType: "image/png",
            sizeBytes: 3,
          },
        ],
        q2: [
          {
            type: "image",
            id: ChatAttachmentId.make(createPendingAttachmentId()!),
            name: "gone.png",
            mimeType: "image/png",
            sizeBytes: 3,
          },
        ],
      },
    }).pipe(Effect.provide(layerFailingDispatch(captured)), Effect.result);
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("AttachmentClaimError");
    }
    expect(captured).toHaveLength(0);
    // The pending sources stay behind so the user can retry the response.
    expect(NodeFS.readFileSync(NodePath.join(config.attachmentsDir, `${pendingId}.png`))).toEqual(
      Buffer.from([1, 2, 3]),
    );
    // The pre-existing thread attachment is retained; only the new copy is rolled back.
    expect(
      NodeFS.readdirSync(config.attachmentsDir).filter((entry) =>
        entry.startsWith("thread-q-fail-"),
      ),
    ).toEqual([`${existingId}.png`]);
  }).pipe(Effect.provide(layerIntakeTest)),
);

it.effect("rolls back earlier question claims when attachment path preparation fails", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const pendingId = ChatAttachmentId.make(createPendingAttachmentId()!);
    NodeFS.writeFileSync(
      NodePath.join(config.attachmentsDir, `${pendingId}.png`),
      new Uint8Array([1, 2, 3]),
    );
    const captured: OrchestrationV2ServerCommand[] = [];
    const result = yield* dispatchCommand({
      type: "runtime-request.respond",
      commandId: CommandId.make("answer-missing-claimed"),
      threadId: ThreadId.make("thread-path-fail"),
      requestId: RuntimeRequestId.make("request-missing-claimed"),
      answers: { q1: ["one"], q2: ["two"] },
      attachmentsByQuestionId: {
        q1: [
          {
            type: "image",
            id: pendingId,
            name: "screen.png",
            mimeType: "image/png",
            sizeBytes: 3,
          },
        ],
        q2: [
          {
            type: "image",
            id: ChatAttachmentId.make("thread-path-fail-00000000-0000-4000-8000-000000000099"),
            name: "missing.png",
            mimeType: "image/png",
            sizeBytes: 3,
          },
        ],
      },
    }).pipe(Effect.provide(layerFailingDispatch(captured)), Effect.result);
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("AttachmentClaimError");
    }
    expect(captured).toHaveLength(0);
    expect(NodeFS.readFileSync(NodePath.join(config.attachmentsDir, `${pendingId}.png`))).toEqual(
      Buffer.from([1, 2, 3]),
    );
    expect(
      NodeFS.readdirSync(config.attachmentsDir).filter((entry) =>
        entry.startsWith("thread-path-fail-"),
      ),
    ).toEqual([]);
  }).pipe(Effect.provide(layerIntakeTest)),
);

it.effect("retains claimed copies when dispatch failure may have been accepted", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const pendingId = ChatAttachmentId.make(createPendingAttachmentId()!);
    NodeFS.writeFileSync(
      NodePath.join(config.attachmentsDir, `${pendingId}.png`),
      new Uint8Array([1, 2, 3]),
    );
    const captured: OrchestrationV2ServerCommand[] = [];
    const result = yield* dispatchCommand({
      type: "runtime-request.respond",
      commandId: CommandId.make("answer-ambiguous"),
      threadId: ThreadId.make("thread-ambiguous"),
      requestId: RuntimeRequestId.make("request-ambiguous"),
      answers: { q: ["one"] },
      attachmentsByQuestionId: {
        q: [
          {
            type: "image",
            id: pendingId,
            name: "screen.png",
            mimeType: "image/png",
            sizeBytes: 3,
          },
        ],
      },
    }).pipe(Effect.provide(layerFailingDispatch(captured)), Effect.result);
    expect(result._tag).toBe("Failure");
    expect(captured).toHaveLength(1);
    // The response may have been accepted before the error, so the copy that
    // backs the answer's path stays for the provider to read.
    const threadFiles = NodeFS.readdirSync(config.attachmentsDir).filter((entry) =>
      entry.startsWith("thread-ambiguous-"),
    );
    expect(threadFiles).toHaveLength(1);
    expect(NodeFS.existsSync(NodePath.join(config.attachmentsDir, `${pendingId}.png`))).toBe(true);
  }).pipe(Effect.provide(layerIntakeTest)),
);

it.effect("releases claimed copies when the command was already rejected", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const pendingId = ChatAttachmentId.make(createPendingAttachmentId()!);
    NodeFS.writeFileSync(
      NodePath.join(config.attachmentsDir, `${pendingId}.png`),
      new Uint8Array([1, 2, 3]),
    );
    // A retry of a previously rejected command claims fresh copies, then the
    // orchestrator replays the rejection without touching them.
    const result = yield* dispatchCommand({
      type: "runtime-request.respond",
      commandId: CommandId.make("answer-rejected"),
      threadId: ThreadId.make("thread-rejected"),
      requestId: RuntimeRequestId.make("request-rejected"),
      answers: { q: ["one"] },
      attachmentsByQuestionId: {
        q: [
          {
            type: "image",
            id: pendingId,
            name: "screen.png",
            mimeType: "image/png",
            sizeBytes: 3,
          },
        ],
      },
    }).pipe(
      Effect.provide(
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          dispatch: (command) =>
            Effect.fail(
              new OrchestratorCommandPreviouslyRejectedError({
                commandId: command.commandId,
                commandType: command.type,
                detail: "rejected earlier",
              }),
            ),
        }),
      ),
      Effect.result,
    );
    expect(result._tag).toBe("Failure");
    expect(
      NodeFS.readdirSync(config.attachmentsDir).filter((entry) =>
        entry.startsWith("thread-rejected-"),
      ),
    ).toEqual([]);
    expect(NodeFS.existsSync(NodePath.join(config.attachmentsDir, `${pendingId}.png`))).toBe(true);
  }).pipe(Effect.provide(layerIntakeTest)),
);

it.effect("releases claimed copies when dispatch replays an earlier accepted response", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const threadId = ThreadId.make("thread-replay");
    const pendingId = ChatAttachmentId.make(createPendingAttachmentId()!);
    NodeFS.writeFileSync(
      NodePath.join(config.attachmentsDir, `${pendingId}.png`),
      new Uint8Array([1, 2, 3]),
    );
    // The first attempt was accepted but its response was lost. The retry's
    // dispatch replays the stored events, which reference the first claim's
    // attachment id — not this attempt's fresh copy.
    const earlierAttachment = {
      type: "image" as const,
      id: ChatAttachmentId.make("thread-replay-00000000-0000-4000-8000-0000000000aa"),
      name: "screen.png",
      mimeType: "image/png",
      sizeBytes: 3,
    };
    NodeFS.writeFileSync(
      NodePath.join(config.attachmentsDir, `${earlierAttachment.id}.png`),
      new Uint8Array([4, 4, 4]),
    );
    const storedEvents = answeredRespondEvents({
      threadId,
      requestId: "request-replay",
      attachmentsByQuestionId: { q: [earlierAttachment] },
    });
    const result = yield* dispatchCommand({
      type: "runtime-request.respond",
      commandId: CommandId.make("answer-replay"),
      threadId,
      requestId: RuntimeRequestId.make("request-replay"),
      answers: { q: ["one"] },
      attachmentsByQuestionId: {
        q: [
          {
            type: "image",
            id: pendingId,
            name: "screen.png",
            mimeType: "image/png",
            sizeBytes: 3,
          },
        ],
      },
    }).pipe(
      Effect.provide(
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          dispatch: () => Effect.succeed({ sequence: 1, storedEvents }),
        }),
      ),
      Effect.result,
    );
    expect(result._tag).toBe("Success");
    // The accepted copy from the first attempt is untouched; only the
    // retry's unreferenced copy is removed.
    expect(
      NodeFS.readdirSync(config.attachmentsDir).filter((entry) =>
        entry.startsWith("thread-replay-"),
      ),
    ).toEqual([`${earlierAttachment.id}.png`]);
    expect(
      NodeFS.readFileSync(NodePath.join(config.attachmentsDir, `${earlierAttachment.id}.png`)),
    ).toEqual(Buffer.from([4, 4, 4]));
    expect(NodeFS.existsSync(NodePath.join(config.attachmentsDir, `${pendingId}.png`))).toBe(true);
  }).pipe(Effect.provide(layerIntakeTest)),
);

it.effect("releases claimed copies when the recorded answer has no attachments", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const threadId = ThreadId.make("thread-empty-answer");
    const pendingId = ChatAttachmentId.make(createPendingAttachmentId()!);
    NodeFS.writeFileSync(
      NodePath.join(config.attachmentsDir, `${pendingId}.png`),
      new Uint8Array([1, 2, 3]),
    );
    // The same command id was first answered without attachments; this
    // retry's copies are unreferenced by the recorded answer.
    const storedEvents = answeredRespondEvents({
      threadId,
      requestId: "request-empty-answer",
      attachmentsByQuestionId: {},
    });
    const result = yield* dispatchCommand({
      type: "runtime-request.respond",
      commandId: CommandId.make("answer-empty"),
      threadId,
      requestId: RuntimeRequestId.make("request-empty-answer"),
      answers: { q: ["one"] },
      attachmentsByQuestionId: {
        q: [
          {
            type: "image",
            id: pendingId,
            name: "screen.png",
            mimeType: "image/png",
            sizeBytes: 3,
          },
        ],
      },
    }).pipe(
      Effect.provide(
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          dispatch: () => Effect.succeed({ sequence: 1, storedEvents }),
        }),
      ),
      Effect.result,
    );
    expect(result._tag).toBe("Success");
    expect(
      NodeFS.readdirSync(config.attachmentsDir).filter((entry) =>
        entry.startsWith("thread-empty-answer-"),
      ),
    ).toEqual([]);
    expect(NodeFS.existsSync(NodePath.join(config.attachmentsDir, `${pendingId}.png`))).toBe(true);
  }).pipe(Effect.provide(layerIntakeTest)),
);

it.effect("releases claimed copies when the recorded answer was text-only", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const threadId = ThreadId.make("thread-text-only-answer");
    const pendingId = ChatAttachmentId.make(createPendingAttachmentId()!);
    NodeFS.writeFileSync(
      NodePath.join(config.attachmentsDir, `${pendingId}.png`),
      new Uint8Array([1, 2, 3]),
    );
    // The first attempt accepted a text-only response, so its recorded turn
    // item has no questionAnswer at all. The retried command id uploads an
    // attachment whose fresh copy is unreferenced by that answer.
    const storedEvents = textOnlyRespondEvents({
      threadId,
      requestId: "request-text-only",
    });
    const result = yield* dispatchCommand({
      type: "runtime-request.respond",
      commandId: CommandId.make("answer-text-only"),
      threadId,
      requestId: RuntimeRequestId.make("request-text-only"),
      answers: { q: ["one"] },
      attachmentsByQuestionId: {
        q: [
          {
            type: "image",
            id: pendingId,
            name: "screen.png",
            mimeType: "image/png",
            sizeBytes: 3,
          },
        ],
      },
    }).pipe(
      Effect.provide(
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          dispatch: () => Effect.succeed({ sequence: 1, storedEvents }),
        }),
      ),
      Effect.result,
    );
    expect(result._tag).toBe("Success");
    expect(
      NodeFS.readdirSync(config.attachmentsDir).filter((entry) =>
        entry.startsWith("thread-text-only-answer-"),
      ),
    ).toEqual([]);
    expect(NodeFS.existsSync(NodePath.join(config.attachmentsDir, `${pendingId}.png`))).toBe(true);
  }).pipe(Effect.provide(layerIntakeTest)),
);

it.effect("retains claimed copies referenced by a fresh recorded answer", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const threadId = ThreadId.make("thread-fresh-answer");
    const firstId = ChatAttachmentId.make(createPendingAttachmentId()!);
    const secondId = ChatAttachmentId.make(createPendingAttachmentId()!);
    NodeFS.writeFileSync(
      NodePath.join(config.attachmentsDir, `${firstId}.png`),
      new Uint8Array([1, 2, 3]),
    );
    NodeFS.writeFileSync(
      NodePath.join(config.attachmentsDir, `${secondId}.png`),
      new Uint8Array([7, 7]),
    );
    const result = yield* dispatchCommand({
      type: "runtime-request.respond",
      commandId: CommandId.make("answer-fresh"),
      threadId,
      requestId: RuntimeRequestId.make("request-fresh"),
      answers: { q1: ["one"], q2: ["two"] },
      attachmentsByQuestionId: {
        q1: [
          {
            type: "image",
            id: firstId,
            name: "one.png",
            mimeType: "image/png",
            sizeBytes: 3,
          },
        ],
        q2: [
          {
            type: "image",
            id: secondId,
            name: "two.png",
            mimeType: "image/png",
            sizeBytes: 2,
          },
        ],
      },
    }).pipe(
      Effect.provide(
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          // A fresh commit records exactly the attachments this attempt claimed.
          dispatch: (command) =>
            Effect.succeed({
              sequence: 1,
              storedEvents: answeredRespondEvents({
                threadId,
                requestId: "request-fresh",
                attachmentsByQuestionId:
                  command.type === "runtime-request.respond"
                    ? (command.attachmentsByQuestionId ?? {})
                    : {},
              }),
            }),
        }),
      ),
      Effect.result,
    );
    expect(result._tag).toBe("Success");
    expect(
      NodeFS.readdirSync(config.attachmentsDir).filter((entry) =>
        entry.startsWith("thread-fresh-answer-"),
      ),
    ).toHaveLength(2);
  }).pipe(Effect.provide(layerIntakeTest)),
);

it.effect("releases claimed copies when preparation dies with a defect", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const pendingId = ChatAttachmentId.make(createPendingAttachmentId()!);
    NodeFS.writeFileSync(
      NodePath.join(config.attachmentsDir, `${pendingId}.png`),
      new Uint8Array([1, 2, 3]),
    );
    const poisoned = {
      get id(): string {
        throw new Error("poisoned");
      },
    };
    const captured: OrchestrationV2ServerCommand[] = [];
    const result = yield* dispatchCommand({
      type: "runtime-request.respond",
      commandId: CommandId.make("answer-defect"),
      threadId: ThreadId.make("thread-defect"),
      requestId: RuntimeRequestId.make("request-defect"),
      answers: { q1: ["one"], q2: ["two"] },
      attachmentsByQuestionId: {
        q1: [
          {
            type: "image",
            id: pendingId,
            name: "screen.png",
            mimeType: "image/png",
            sizeBytes: 3,
          },
        ],
        q2: [poisoned] as never,
      },
    }).pipe(Effect.provide(layerFailingDispatch(captured)), Effect.exit);
    expect(result._tag).toBe("Failure");
    expect(captured).toHaveLength(0);
    expect(
      NodeFS.readdirSync(config.attachmentsDir).filter((entry) =>
        entry.startsWith("thread-defect-"),
      ),
    ).toEqual([]);
    expect(NodeFS.existsSync(NodePath.join(config.attachmentsDir, `${pendingId}.png`))).toBe(true);
  }).pipe(Effect.provide(layerIntakeTest)),
);

it.effect("a retried response re-claims the preserved pending uploads", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const threadId = ThreadId.make("thread-retry");
    const pendingId = ChatAttachmentId.make(createPendingAttachmentId()!);
    const lateId = ChatAttachmentId.make(createPendingAttachmentId()!);
    NodeFS.writeFileSync(
      NodePath.join(config.attachmentsDir, `${pendingId}.png`),
      new Uint8Array([1, 2, 3]),
    );
    const command: OrchestrationV2Command = {
      type: "runtime-request.respond",
      commandId: CommandId.make("answer-retry"),
      threadId,
      requestId: RuntimeRequestId.make("request-retry"),
      answers: { q1: ["one"], q2: ["two"] },
      attachmentsByQuestionId: {
        q1: [
          {
            type: "image",
            id: pendingId,
            name: "screen.png",
            mimeType: "image/png",
            sizeBytes: 3,
          },
        ],
        q2: [
          {
            type: "image",
            id: lateId,
            name: "late.png",
            mimeType: "image/png",
            sizeBytes: 2,
          },
        ],
      },
    };
    const captured: OrchestrationV2ServerCommand[] = [];
    const first = yield* dispatchCommand(command).pipe(
      Effect.provide(layerFailingDispatch(captured)),
      Effect.result,
    );
    expect(first._tag).toBe("Failure");
    expect(captured).toHaveLength(0);

    NodeFS.writeFileSync(
      NodePath.join(config.attachmentsDir, `${lateId}.png`),
      new Uint8Array([7, 7]),
    );
    const retry = yield* dispatchCommand(command).pipe(
      Effect.provide(
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          dispatch: (dispatched) => {
            captured.push(dispatched);
            return Effect.succeed({ sequence: 1, storedEvents: [] });
          },
        }),
      ),
      Effect.result,
    );
    expect(retry._tag).toBe("Success");
    const dispatched = captured[0]!;
    expect(dispatched.type).toBe("runtime-request.respond");
    if (dispatched.type !== "runtime-request.respond") return;
    for (const attachment of [
      ...(dispatched.attachmentsByQuestionId?.q1 ?? []),
      ...(dispatched.attachmentsByQuestionId?.q2 ?? []),
    ]) {
      const path = resolveAttachmentPath({
        attachmentsDir: config.attachmentsDir,
        attachment,
      });
      expect(path).not.toBeNull();
      expect(NodeFS.existsSync(path!)).toBe(true);
    }
    expect(
      NodeFS.readdirSync(config.attachmentsDir).filter((entry) =>
        entry.startsWith("thread-retry-"),
      ),
    ).toHaveLength(2);
  }).pipe(Effect.provide(layerIntakeTest)),
);

it.effect("applies the image budget across all questions before dispatch", () =>
  Effect.gen(function* () {
    const attachments = Array.from({ length: 5 }, (_, index) => ({
      type: "image" as const,
      id: ChatAttachmentId.make(`existing-budget-${index}`),
      name: `${index}.png`,
      mimeType: "image/png",
      sizeBytes: 10 * 1024 * 1024,
    }));
    const captured: OrchestrationV2ServerCommand[] = [];
    const result = yield* Effect.exit(
      dispatchCommand({
        type: "runtime-request.respond",
        commandId: CommandId.make("command-image-budget"),
        threadId: ThreadId.make("thread-image-budget"),
        requestId: RuntimeRequestId.make("question-image-budget"),
        answers: {},
        attachmentsByQuestionId: { q1: attachments, q2: attachments },
      }).pipe(Effect.provide(layerFailingDispatch(captured))),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(String(result.cause)).toContain("80 MiB");
    expect(captured).toEqual([]);
  }).pipe(Effect.provide(layerIntakeTest)),
);

it.effect(
  "pre-commit cancellation intent consumes late dispatch and rejects with OrchestratorCommandRejectedError",
  () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread-late-intake");
      const messageId = MessageId.make("msg-late-intake");
      const commandId = CommandId.make("cmd-late-intake");

      // 1. Record pre-commit cancellation intent before dispatch arrives
      const intentRes = yield* recordCancellationIntent({
        threadId,
        messageId,
        commandId,
      }).pipe(
        Effect.provide(
          Layer.mock(ThreadManagementService.ThreadManagementService)({
            getThreadSnapshotWindow: () =>
              Effect.succeed({
                schemaVersion: 1,
                snapshotSequence: 1,
                projection: { runs: [] } as any,
              }),
          }),
        ),
        Effect.provide(CancellationIntentStore.layerMemory),
      );
      expect(intentRes.recorded).toBe(true);

      // 2. Late dispatch arrives for the cancelled message
      const captured: OrchestrationV2ServerCommand[] = [];
      const dispatchExit = yield* Effect.exit(
        dispatchCommand({
          type: "message.dispatch",
          createdBy: "user",
          creationSource: "web",
          commandId,
          threadId,
          messageId,
          text: "Late prompt that was already cancelled",
          attachments: [],
          dispatchMode: { type: "start_immediately" },
        }).pipe(
          Effect.provide(layerFailingDispatch(captured)),
          Effect.provide(CancellationIntentStore.layerMemory),
        ),
      );

      // Must be rejected before entering thread dispatch!
      expect(dispatchExit._tag).toBe("Failure");
      if (dispatchExit._tag === "Failure") {
        expect(String(dispatchExit.cause)).toContain("OrchestratorCommandRejectedError");
      }
      expect(captured).toHaveLength(0);
    }).pipe(Effect.provide(layerIntakeTest)),
);

it.effect("reconcileIntake with cancelIfFound targets queued or running work accurately", () =>
  Effect.gen(function* () {
    const threadId = ThreadId.make("thread-reconcile-test");
    const dispatched: any[] = [];

    const layerMockThread = Layer.mock(ThreadManagementService.ThreadManagementService)({
      getThreadSnapshotWindow: () =>
        Effect.succeed({
          schemaVersion: 1,
          snapshotSequence: 1,
          projection: {
            runs: [
              {
                id: "run:queued:1",
                threadId,
                userMessageId: "msg-queued",
                status: dispatched.some((command) => command.type === "queued-run.cancel")
                  ? "cancelled"
                  : "queued",
              },
              {
                id: "run:running:1",
                threadId,
                userMessageId: "msg-running",
                status: "running",
              },
              {
                id: "run:done:1",
                threadId,
                userMessageId: "msg-done",
                status: "succeeded",
              },
            ],
          } as any,
        }),
      dispatch: (cmd) => {
        dispatched.push(cmd);
        return Effect.succeed({ sequence: 1, storedEvents: [] });
      },
    });

    // Case 1: Queued run -> cancels queued run
    const res1 = yield* reconcileIntake({
      threadId,
      messageId: MessageId.make("msg-queued"),
      cancelIfFound: true,
    }).pipe(Effect.provide(layerMockThread), Effect.provide(CancellationIntentStore.layerMemory));
    expect(res1.outcome).toBe("cancelled");
    expect(res1.runId).toBe("run:queued:1");
    expect(
      dispatched.some((c) => c.type === "queued-run.cancel" && c.runId === "run:queued:1"),
    ).toBe(true);

    // Case 2: Running run -> interrupts running run
    const res2 = yield* reconcileIntake({
      threadId,
      messageId: MessageId.make("msg-running"),
      cancelIfFound: true,
    }).pipe(Effect.provide(layerMockThread), Effect.provide(CancellationIntentStore.layerMemory));
    expect(res2.outcome).toBe("running");
    expect(res2.runStatus).toBe("running");
    expect(res2.runId).toBe("run:running:1");
    expect(dispatched.some((c) => c.type === "run.interrupt" && c.runId === "run:running:1")).toBe(
      true,
    );

    // Case 3: Already completed run -> reports already_completed without dispatching commands
    const dispatchedBefore3 = dispatched.length;
    const res3 = yield* reconcileIntake({
      threadId,
      messageId: MessageId.make("msg-done"),
      cancelIfFound: true,
    }).pipe(Effect.provide(layerMockThread), Effect.provide(CancellationIntentStore.layerMemory));
    expect(res3.outcome).toBe("already_completed");
    expect(res3.runId).toBe("run:done:1");
    expect(dispatched.length).toBe(dispatchedBefore3);
  }).pipe(Effect.provide(layerIntakeTest)),
);

it.effect("does not confirm cancellation when the server mutation fails", () =>
  Effect.gen(function* () {
    const threadId = ThreadId.make("failed-cancel-thread");
    const result = yield* Effect.exit(
      reconcileIntake({
        threadId,
        messageId: MessageId.make("failed-cancel-message"),
        cancelIfFound: true,
      }),
    );
    expect(result._tag).toBe("Failure");
  }).pipe(
    Effect.provide(
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadSnapshotWindow: () =>
          Effect.succeed({
            schemaVersion: 1,
            snapshotSequence: 1,
            projection: {
              runs: [
                { id: "failed-run", userMessageId: "failed-cancel-message", status: "queued" },
              ],
            },
          } as any),
        dispatch: () =>
          Effect.fail(
            new OrchestratorDispatchError({
              commandType: "queued-run.cancel",
              commandId: CommandId.make("failed-command"),
              cause: new Error("disk failure"),
            }),
          ),
      }),
    ),
  ),
);

it.effect("does not confirm durable intent when storage fails or is unavailable", () =>
  Effect.gen(function* () {
    const input = {
      threadId: ThreadId.make("failed-intent-thread"),
      messageId: MessageId.make("failed-intent-message"),
      cancelIfFound: true,
    };
    const missing = yield* Effect.exit(reconcileIntake(input));
    expect(missing._tag).toBe("Failure");
    const failed = yield* Effect.exit(
      reconcileIntake(input).pipe(
        Effect.provide(
          Layer.mock(CancellationIntentStore.CancellationIntentStoreV2)({
            record: () =>
              Effect.fail(
                new CancellationIntentStore.CancellationIntentStoreError({
                  message: "disk failure",
                }),
              ),
          }),
        ),
      ),
    );
    expect(failed._tag).toBe("Failure");
  }).pipe(
    Effect.provide(
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadSnapshotWindow: () =>
          Effect.succeed({
            schemaVersion: 1,
            snapshotSequence: 1,
            projection: { runs: [] },
          } as any),
      }),
    ),
  ),
);

it.effect("serializes cancellation against an intake paused before commit", () =>
  Effect.gen(function* () {
    const paused = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const threadId = ThreadId.make("serialized-thread");
    const messageId = MessageId.make("serialized-message");
    const runs: any[] = [];
    let resolved = false;
    const threads = Layer.mock(ThreadManagementService.ThreadManagementService)({
      getThreadSnapshotWindow: () =>
        Effect.sync(() => ({ schemaVersion: 1, snapshotSequence: 1, projection: { runs } }) as any),
      dispatch: (command) =>
        Effect.gen(function* () {
          if (command.type === "message.dispatch") {
            yield* Deferred.succeed(paused, undefined);
            yield* Deferred.await(release);
            runs.push({ id: "serialized-run", userMessageId: messageId, status: "queued" });
          } else if (command.type === "queued-run.cancel") runs[0].status = "cancelled";
          return { sequence: 1, storedEvents: [] } as any;
        }),
    });
    yield* Effect.gen(function* () {
      const intake = yield* Effect.forkChild(
        dispatchCommand({
          type: "message.dispatch",
          createdBy: "user",
          creationSource: "web",
          commandId: CommandId.make("serialized-command"),
          threadId,
          messageId,
          text: "scheduled",
          attachments: [],
          dispatchMode: { type: "start_immediately" },
        }),
      );
      yield* Deferred.await(paused);
      const cancellation = yield* Effect.forkChild(
        reconcileIntake({ threadId, messageId, cancelIfFound: true }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              resolved = true;
            }),
          ),
        ),
      );
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(resolved).toBe(false);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(intake);
      expect((yield* Fiber.join(cancellation)).outcome).toBe("cancelled");
      expect(runs[0].status).toBe("cancelled");
    }).pipe(Effect.provide(threads), Effect.provide(CancellationIntentStore.layerMemory));
  }).pipe(Effect.provide(layerIntakeTest)),
);
