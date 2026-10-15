import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@tabs/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Migrator from "effect/unstable/sql/Migrator";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { runMigrations, migrationManifest } from "./Migrations.ts";
import OrchestrationV2 from "./Migrations/054_OrchestrationV2.ts";

it.effect("preserves V2 preview tables and import progress when moving migration53 to54", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 52 });
    yield* Migrator.make({})({
      loader: Migrator.fromRecord({ "53_OrchestrationV2": OrchestrationV2 }),
    });
    yield* sql`INSERT INTO orchestration_v2_legacy_imports
      (thread_id, source_updated_at, shell_imported_at, transcript_imported_at, imported_message_count)
      VALUES ('sentinel', '2026-09-15', '2026-09-15', '2026-09-16', 42)`;
    const before = yield* sql`SELECT * FROM orchestration_v2_legacy_imports`;
    yield* runMigrations();
    assert.deepStrictEqual(yield* sql`SELECT * FROM orchestration_v2_legacy_imports`, before);
    assert.deepStrictEqual(yield* runMigrations(), []);
    const history = yield* sql<{
      migration_id: number;
      name: string;
    }>`SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id`;
    assert.deepStrictEqual(
      history.map((row) => [row.migration_id, row.name] as const),
      migrationManifest,
    );
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

it.effect("rolls back preview schema and ledger on failure and retries", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 52 });
    yield* Migrator.make({})({
      loader: Migrator.fromRecord({ "53_OrchestrationV2": OrchestrationV2 }),
    });
    yield* sql`CREATE TRIGGER reject_preview BEFORE INSERT ON effect_sql_migrations
      WHEN NEW.migration_id = 53 BEGIN SELECT RAISE(ABORT, 'injected'); END`;
    assert.ok(Exit.isFailure(yield* Effect.exit(runMigrations())));
    assert.deepStrictEqual(
      yield* sql`SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id >= 53`,
      [{ migration_id: 53, name: "OrchestrationV2" }],
    );
    const columns = yield* sql<{ name: string }>`PRAGMA table_info(projection_threads)`;
    assert.ok(!columns.some((column) => column.name === "auto_settle_disabled_at"));
    yield* sql`DROP TRIGGER reject_preview`;
    yield* runMigrations();
    assert.deepStrictEqual(yield* runMigrations(), []);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
