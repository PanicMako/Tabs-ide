import { describe } from "vitest";

// `node:sqlite` is a Node.js-only built-in (≥22.5). When tests run under bun,
// this module doesn't exist and the top-level import in NodeSqliteClient.ts
// causes an immediate import failure. Skip the entire suite on bun.
const isBun = process.versions.bun !== undefined;

describe.skipIf(isBun)("NodeSqliteClient", async () => {
  const { assert, it } = await import("@effect/vitest");
  const { Effect } = await import("effect");
  const SqlClient = await import("effect/unstable/sql/SqlClient");
  const SqliteClient = await import("./NodeSqliteClient.ts");

  const layer = it.layer(SqliteClient.layerMemory());

  layer("NodeSqliteClient", (it) => {
    it.effect("runs prepared queries and returns positional values", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        yield* sql`CREATE TABLE entries(id INTEGER PRIMARY KEY, name TEXT NOT NULL)`;
        yield* sql`INSERT INTO entries(name) VALUES (${"alpha"}), (${"beta"})`;

        const rows = yield* sql<{ readonly id: number; readonly name: string }>`
        SELECT id, name FROM entries ORDER BY id
      `;
        assert.equal(rows.length, 2);
        assert.equal(rows[0]?.name, "alpha");
        assert.equal(rows[1]?.name, "beta");

        const values = yield* sql`SELECT id, name FROM entries ORDER BY id`.values;
        assert.equal(values.length, 2);
        assert.equal(values[0]?.[1], "alpha");
        assert.equal(values[1]?.[1], "beta");
      }),
    );
  });
});
