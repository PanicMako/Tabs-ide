import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@tabs/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("061_Teammates", (it) => {
  it.effect("creates the teammate tables", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 61 });
      const tables = yield* sql<{ name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'teammate%' ORDER BY name
      `;
      assert.deepEqual(
        tables.map((table) => table.name),
        [
          "teammate_items",
          "teammate_memory_facts",
          "teammate_suggestions",
          "teammate_threads",
          "teammates",
        ],
      );
    }),
  );
});
