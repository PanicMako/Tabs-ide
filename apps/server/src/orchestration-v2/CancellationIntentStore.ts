import { CommandId, MessageId, ThreadId } from "@tabs/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export class CancellationIntentStoreError extends Schema.TaggedError<CancellationIntentStoreError>()(
  "CancellationIntentStoreError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export interface CancellationIntent {
  readonly commandId: CommandId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly requestedAt: DateTime.Utc;
}

export interface CancellationIntentStoreV2Shape {
  readonly record: (
    intent: CancellationIntent,
  ) => Effect.Effect<void, CancellationIntentStoreError>;
  readonly remove: (commandId: CommandId) => Effect.Effect<void, CancellationIntentStoreError>;
  readonly has: (commandId: CommandId) => Effect.Effect<boolean, CancellationIntentStoreError>;
  readonly hasForMessage: (
    threadId: ThreadId,
    messageId: MessageId,
  ) => Effect.Effect<boolean, CancellationIntentStoreError>;
  readonly consumeForMessage: (
    threadId: ThreadId,
    messageId: MessageId,
  ) => Effect.Effect<boolean, CancellationIntentStoreError>;
  readonly consume: (commandId: CommandId) => Effect.Effect<boolean, CancellationIntentStoreError>;
}

export class CancellationIntentStoreV2 extends Context.Service<
  CancellationIntentStoreV2,
  CancellationIntentStoreV2Shape
>()("t3/orchestration-v2/CancellationIntentStore/CancellationIntentStoreV2") {}

export const layer = Layer.effect(
  CancellationIntentStoreV2,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const record: CancellationIntentStoreV2Shape["record"] = (intent) =>
      sql`
        INSERT INTO orchestration_v2_cancellation_intents (
          command_id, thread_id, message_id, requested_at
        ) VALUES (
          ${intent.commandId}, ${intent.threadId}, ${intent.messageId}, ${DateTime.formatIso(intent.requestedAt)}
        )
        ON CONFLICT(command_id) DO UPDATE SET
          thread_id = excluded.thread_id,
          message_id = excluded.message_id,
          requested_at = excluded.requested_at
      `.pipe(
        Effect.asVoid,
        Effect.mapError(
          (cause) =>
            new CancellationIntentStoreError({
              message: `Failed to record cancellation intent for command ${intent.commandId}`,
              cause,
            }),
        ),
      );

    const remove: CancellationIntentStoreV2Shape["remove"] = (commandId) =>
      sql`DELETE FROM orchestration_v2_cancellation_intents WHERE command_id = ${commandId}`.pipe(
        Effect.asVoid,
        Effect.mapError(
          (cause) =>
            new CancellationIntentStoreError({
              message: `Failed to remove cancellation intent for command ${commandId}`,
              cause,
            }),
        ),
      );

    const has: CancellationIntentStoreV2Shape["has"] = (commandId) =>
      sql<{ count: number }>`
        SELECT COUNT(*) as count FROM orchestration_v2_cancellation_intents WHERE command_id = ${commandId}
      `.pipe(
        Effect.map((rows) => (rows[0]?.count ?? 0) > 0),
        Effect.mapError(
          (cause) =>
            new CancellationIntentStoreError({
              message: `Failed to check cancellation intent for command ${commandId}`,
              cause,
            }),
        ),
      );

    const hasForMessage: CancellationIntentStoreV2Shape["hasForMessage"] = (threadId, messageId) =>
      sql<{ count: number }>`
        SELECT COUNT(*) as count FROM orchestration_v2_cancellation_intents
        WHERE thread_id = ${threadId} AND message_id = ${messageId}
      `.pipe(
        Effect.map((rows) => (rows[0]?.count ?? 0) > 0),
        Effect.mapError(
          (cause) =>
            new CancellationIntentStoreError({
              message: `Failed to check cancellation intent for thread ${threadId} message ${messageId}`,
              cause,
            }),
        ),
      );

    const consumeForMessage: CancellationIntentStoreV2Shape["consumeForMessage"] = (
      threadId,
      messageId,
    ) =>
      Effect.gen(function* () {
        const rows = yield* sql<{ command_id: string }>`
          SELECT command_id FROM orchestration_v2_cancellation_intents
          WHERE thread_id = ${threadId} AND message_id = ${messageId}
          LIMIT 1
        `;
        if (rows.length === 0) return false;
        yield* sql`
          DELETE FROM orchestration_v2_cancellation_intents
          WHERE thread_id = ${threadId} AND message_id = ${messageId}
        `;
        return true;
      }).pipe(
        Effect.mapError(
          (cause) =>
            new CancellationIntentStoreError({
              message: `Failed to consume cancellation intent for thread ${threadId} message ${messageId}`,
              cause,
            }),
        ),
      );

    const consume: CancellationIntentStoreV2Shape["consume"] = (commandId) =>
      Effect.gen(function* () {
        const rows = yield* sql<{ command_id: string }>`
          SELECT command_id FROM orchestration_v2_cancellation_intents
          WHERE command_id = ${commandId}
          LIMIT 1
        `;
        if (rows.length === 0) return false;
        yield* sql`
          DELETE FROM orchestration_v2_cancellation_intents
          WHERE command_id = ${commandId}
        `;
        return true;
      }).pipe(
        Effect.mapError(
          (cause) =>
            new CancellationIntentStoreError({
              message: `Failed to consume cancellation intent for command ${commandId}`,
              cause,
            }),
        ),
      );

    return CancellationIntentStoreV2.of({
      record,
      remove,
      has,
      hasForMessage,
      consumeForMessage,
      consume,
    });
  }),
);

export const layerMemory = Layer.succeed(
  CancellationIntentStoreV2,
  (() => {
    const intents = new Map<string, CancellationIntent>();
    return CancellationIntentStoreV2.of({
      record: (intent) =>
        Effect.sync(() => {
          intents.set(intent.commandId, intent);
        }),
      remove: (commandId) =>
        Effect.sync(() => {
          intents.delete(commandId);
        }),
      has: (commandId) => Effect.sync(() => intents.has(commandId)),
      hasForMessage: (threadId, messageId) =>
        Effect.sync(() =>
          Array.from(intents.values()).some(
            (i) => i.threadId === threadId && i.messageId === messageId,
          ),
        ),
      consumeForMessage: (threadId, messageId) =>
        Effect.sync(() => {
          const found = Array.from(intents.values()).find(
            (i) => i.threadId === threadId && i.messageId === messageId,
          );
          if (!found) return false;
          intents.delete(found.commandId);
          return true;
        }),
      consume: (commandId) =>
        Effect.sync(() => {
          if (!intents.has(commandId)) return false;
          intents.delete(commandId);
          return true;
        }),
    });
  })(),
);
