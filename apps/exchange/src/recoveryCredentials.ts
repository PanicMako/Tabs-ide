import type { Pool } from "pg";
import { createPool } from "./config.ts";

/** Run only while the restored registry is offline, before reopening access. */
export async function invalidateRestoredCredentials(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sessions = await client.query("DELETE FROM exchange_sessions");
    const oauth = await client.query("DELETE FROM exchange_oauth_states");
    const tokens = await client.query(
      "UPDATE exchange_access_tokens SET revoked_at = now() WHERE revoked_at IS NULL",
    );
    await client.query("COMMIT");
    return {
      sessions: sessions.rowCount ?? 0,
      oauthStates: oauth.rowCount ?? 0,
      tokens: tokens.rowCount ?? 0,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (import.meta.main) {
  if (process.argv.length !== 3 || process.argv[2] !== "--confirm-offline-restore") {
    console.error(
      "Keep the restored API and worker offline. Pass --confirm-offline-restore to invalidate all restored login state and active access tokens.",
    );
    process.exitCode = 1;
  } else {
    const pool = createPool();
    try {
      process.stdout.write(`${JSON.stringify(await invalidateRestoredCredentials(pool))}\n`);
    } catch {
      console.error(
        "Restored credentials could not be invalidated. Keep the registry offline and inspect the database locally.",
      );
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  }
}
