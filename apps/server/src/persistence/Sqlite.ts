import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { MigrationError } from "effect/unstable/sql/Migrator";
import * as NodeSqliteClient from "@tabs/shared/nodeSqliteClient";
import { BACKEND_STARTUP_ERROR_PREFIX } from "@tabs/shared/backendStartup";

import { migrationEntries, runMigrations } from "./Migrations.ts";
import { initializeV2Database } from "./initializeV2Database.ts";
import * as ServerConfig from "../config.ts";

// Size the -wal file is cut back to on the first commit after a WAL reset.
export const WAL_SIZE_LIMIT_BYTES = 32 * 1024 * 1024;

export const assertDatabaseCompatibility = Effect.fn("assertDatabaseCompatibility")(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Check before migrations: older builds must not write
  // into a database upgraded by another harness.
  const tables = yield* sql<{ name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
  `;
  if (tables.length > 0) {
    const migrations = yield* sql<{ migration_id: number; name: string }>`
      SELECT migration_id, name FROM effect_sql_migrations
    `;
    const incompatible = migrations.find(
      (row) => !migrationEntries.some(([id, name]) => id === row.migration_id && name === row.name),
    );
    if (incompatible) {
      const message = `This workspace database was upgraded by another Tabs version or development harness (migration ${incompatible.migration_id}: ${incompatible.name}). Your saved data has been preserved. Use the compatible version or restore a verified backup; resetting Tabs would erase your history.`;
      yield* Effect.sync(() =>
        console.error(`${BACKEND_STARTUP_ERROR_PREFIX}${JSON.stringify(message)}`),
      );
      return yield* Effect.fail(new MigrationError({ kind: "Failed", message }));
    }
  }
});

const layerSetup = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* assertDatabaseCompatibility();
    // CLI and server write from separate processes; wait rather than fail with SQLITE_BUSY.
    yield* sql`PRAGMA busy_timeout = 5000;`;
    yield* sql`PRAGMA foreign_keys = ON;`;
    yield* sql`PRAGMA journal_mode = WAL;`;
    // PASSIVE checkpoints never shrink the -wal file, so it otherwise keeps its
    // largest size until the last connection closes.
    yield* sql.unsafe(`PRAGMA journal_size_limit = ${WAL_SIZE_LIMIT_BYTES};`);
    yield* runMigrations();
  }),
);

export const layerFromPath = Effect.fn("makeSqlitePersistenceLive")(function* (dbPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(dbPath), { recursive: true });

  return Layer.provideMerge(
    layerSetup,
    NodeSqliteClient.layer({
      filename: dbPath,
      spanAttributes: {
        "db.name": path.basename(dbPath),
        "service.name": "t3code-server",
      },
    }),
  );
}, Layer.unwrap);

export const layerMemory = Layer.provideMerge(
  layerSetup,
  NodeSqliteClient.layer({ filename: ":memory:" }),
);
export const SqlitePersistenceMemory = layerMemory;

export const layerConfig = Layer.unwrap(
  Effect.gen(function* () {
    const { dbPath } = yield* ServerConfig.ServerConfig;
    yield* initializeV2Database(dbPath);
    return layerFromPath(dbPath);
  }),
);
