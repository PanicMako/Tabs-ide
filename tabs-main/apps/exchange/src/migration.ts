import type { Pool } from "pg";
import { rebuildPublishedHeads } from "./publishedHeads.ts";

export async function migrateExchangeSchema(pool: Pool, schemaSql: string): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(1261492744)");
      await client.query(schemaSql);
      const heads = await rebuildPublishedHeads(client);
      await client.query("COMMIT");
      return heads;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}
