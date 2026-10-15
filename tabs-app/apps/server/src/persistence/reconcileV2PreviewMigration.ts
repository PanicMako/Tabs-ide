import * as Effect from "effect/Effect";
import * as Migrator from "effect/unstable/sql/Migrator";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import AutoSettleDisabledAt from "./Migrations/053_ProjectionThreadsAutoSettleDisabledAt.ts";

/** Reconcile the published Tabs V2 preview without renumbering the released Tabs ledger. */
export const reconcileV2PreviewMigration = Effect.fn("reconcileV2PreviewMigration")(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const tables =
        yield* sql`SELECT name FROM sqlite_master WHERE name = 'effect_sql_migrations'`;
      if (tables.length === 0) return [];
      const history = yield* sql<{ readonly migration_id: number; readonly name: string }>`
      SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id >= 53
    `;
      if (!history.some((row) => row.migration_id === 53 && row.name === "OrchestrationV2"))
        return [];
      if (history.length !== 1) {
        return yield* new Migrator.MigrationError({
          kind: "BadState",
          message: "Cannot upgrade V2 preview with unexpected later migrations.",
        });
      }
      yield* AutoSettleDisabledAt;
      yield* sql`UPDATE effect_sql_migrations SET migration_id = 54 WHERE migration_id = 53`;
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (53, 'ProjectionThreadsAutoSettleDisabledAt')`;
      return [[53, "ProjectionThreadsAutoSettleDisabledAt"]] as Array<readonly [number, string]>;
    }),
  );
});
