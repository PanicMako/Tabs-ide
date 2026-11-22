import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS teammates (
      teammate_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      finish TEXT NOT NULL,
      model_selection_json TEXT,
      project_id TEXT,
      paused INTEGER NOT NULL DEFAULT 0,
      look_around_json TEXT NOT NULL,
      notify_json TEXT NOT NULL,
      home_thread_id TEXT,
      last_look_around_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS teammate_items (
      item_id TEXT PRIMARY KEY,
      teammate_id TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      status TEXT NOT NULL,
      worker_thread_ids_json TEXT NOT NULL,
      question TEXT,
      link TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_teammate_items_teammate ON teammate_items(teammate_id)`;
  yield* sql`
    CREATE TABLE IF NOT EXISTS teammate_suggestions (
      suggestion_id TEXT PRIMARY KEY,
      teammate_id TEXT NOT NULL,
      title TEXT NOT NULL,
      why TEXT NOT NULL,
      ask TEXT NOT NULL,
      link TEXT,
      dedupe_key TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (teammate_id, dedupe_key)
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS teammate_memory_facts (
      fact_id TEXT PRIMARY KEY,
      teammate_id TEXT NOT NULL,
      text TEXT NOT NULL,
      topic TEXT,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_teammate_facts_teammate ON teammate_memory_facts(teammate_id)`;
  // Every thread a teammate owns: "home" chat, "look-around" turns, and "worker" threads.
  yield* sql`
    CREATE TABLE IF NOT EXISTS teammate_threads (
      thread_id TEXT PRIMARY KEY,
      teammate_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      item_id TEXT,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_teammate_threads_teammate ON teammate_threads(teammate_id)`;
});
