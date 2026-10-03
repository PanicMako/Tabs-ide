import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

// Add the provider instance routing key to persisted runtime rows. Nullable so
// rows written before the driver/instance split survive; the directory promotes
// a null value to the default instance id for the row's driver on read.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE provider_session_runtime
    ADD COLUMN provider_instance_id TEXT
  `;
});
