import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSqliteClient from "@tabs/shared/nodeSqliteClient";
import * as Layer from "effect/Layer";
import * as Migrator from "effect/unstable/sql/Migrator";
import { runMigrations } from "./Migrations.ts";
import OrchestrationV2 from "./Migrations/054_OrchestrationV2.ts";
import { layerFromPath, assertDatabaseCompatibility, SqlitePersistenceMemory } from "./Sqlite.ts";

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

// Exercise the real startup layer, rather than calling the guard after migrations.
it.effect("starts a published V2 preview database and preserves its import progress", () => {
  const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-preview-startup-"));
  const filename = Path.join(directory, "state.sqlite");
  const seed = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 52 });
    yield* Migrator.make({})({
      loader: Migrator.fromRecord({ "53_OrchestrationV2": OrchestrationV2 }),
    });
    yield* sql`INSERT INTO orchestration_v2_legacy_imports
      (thread_id, source_updated_at, shell_imported_at, transcript_imported_at, imported_message_count)
      VALUES ('preview-thread', '2026-09-15', '2026-09-15', '2026-09-16', 42)`;
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename })));
  return Effect.gen(function* () {
    yield* seed;
    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows =
        yield* sql`SELECT imported_message_count FROM orchestration_v2_legacy_imports WHERE thread_id = 'preview-thread'`;
      assert.deepEqual(rows, [{ imported_message_count: 42 }]);
      assert.deepEqual(yield* sql`SELECT name FROM effect_sql_migrations WHERE migration_id = 54`, [
        { name: "OrchestrationV2" },
      ]);
    }).pipe(Effect.provide(layerFromPath(filename).pipe(Layer.provide(NodeServices.layer))));
  }).pipe(
    Effect.ensuring(Effect.sync(() => FS.rmSync(directory, { recursive: true, force: true }))),
  );
});

it.effect("refuses a preview ledger with unexpected later migrations", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 52 });
    yield* Migrator.make({})({
      loader: Migrator.fromRecord({ "53_OrchestrationV2": OrchestrationV2 }),
    });
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (99, 'FutureMigration')`;
    const before = yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`;
    const result = yield* Effect.result(assertDatabaseCompatibility());
    assert.equal(result._tag, "Failure");
    assert.deepEqual(yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`, before);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
