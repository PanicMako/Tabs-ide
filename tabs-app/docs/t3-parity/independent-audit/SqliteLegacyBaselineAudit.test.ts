import { it, assert } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Sqlite from "./SqliteLegacyBaselineAudit.ts";
const suite = it.layer(Sqlite.layer({ filename: ":memory:" }));
suite("safe integer values audit", (it) => {
  it.effect("honors safe integers on positional values before any object query", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`SELECT 9007199254740993 AS value`.values.pipe(
        Effect.provideService(SqlClient.SafeIntegers, true),
      );
      assert.deepEqual(rows, [[9007199254740993n]]);
    }),
  );
  it.effect("resets integer mode for positional values after an object query", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const query = sql`SELECT 42 AS value`;
      yield* query.pipe(Effect.provideService(SqlClient.SafeIntegers, true));
      assert.deepEqual(yield* query.values, [[42]]);
    }),
  );
});
