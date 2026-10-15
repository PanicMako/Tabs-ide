import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { assertDatabaseCompatibility, SqlitePersistenceMemory } from "./Sqlite.ts";

it.layer(SqlitePersistenceMemory)("database compatibility", (it) => {
  it.effect("accepts the current migration ledger", () => assertDatabaseCompatibility());
  it.effect("refuses a newer migration without changing events or migrations", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES (99, 'FutureMigration', '2026-10-16')`;
      const before = yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`;
      const result = yield* Effect.result(assertDatabaseCompatibility());
      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.include(String(result.failure), "99: FutureMigration");
        assert.include(String(result.failure), "preserved");
      }
      assert.deepEqual(
        yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`,
        before,
      );
      assert.deepEqual(yield* sql`SELECT * FROM orchestration_events`, []);
    }),
  );
  it.effect("rejects a different migration using an existing ID", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE effect_sql_migrations SET name = 'ForeignSchema' WHERE migration_id = 47`;
      const result = yield* Effect.result(assertDatabaseCompatibility());
      assert.equal(result._tag, "Failure");
    }),
  );
});
