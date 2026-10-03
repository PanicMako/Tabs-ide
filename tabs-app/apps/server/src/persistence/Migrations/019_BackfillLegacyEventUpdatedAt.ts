import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Older event streams predate `updatedAt` on mutable project/thread payloads.
 * Replay now requires that value, so preserve existing workspaces by deriving
 * it from the durable event timestamp instead of rejecting the entire stream.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_set(payload_json, '$.updatedAt', occurred_at)
    WHERE event_type IN (
      'project.created',
      'project.meta-updated',
      'thread.created',
      'thread.archived',
      'thread.unarchived',
      'thread.meta-updated',
      'thread.runtime-mode-set',
      'thread.interaction-mode-set',
      'thread.message-sent'
    )
      AND json_type(payload_json, '$.updatedAt') IS NULL
  `;
});
