import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!columns.some((c) => c.name === "latest_user_message_at")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN latest_user_message_at TEXT
    `;
  }

  if (!columns.some((c) => c.name === "pending_approval_count")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN pending_approval_count INTEGER NOT NULL DEFAULT 0
    `;
  }

  if (!columns.some((c) => c.name === "pending_user_input_count")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN pending_user_input_count INTEGER NOT NULL DEFAULT 0
    `;
  }

  if (!columns.some((c) => c.name === "has_actionable_proposed_plan")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN has_actionable_proposed_plan INTEGER NOT NULL DEFAULT 0
    `;
  }
});
