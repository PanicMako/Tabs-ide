import * as FS from "node:fs/promises";
import * as Path from "node:path";
import { createPool } from "./config.ts";
import { migrateExchangeSchema } from "./migration.ts";

const pool = createPool();
try {
  const sql = await FS.readFile(Path.join(import.meta.dirname, "schema.sql"), "utf8");
  const heads = await migrateExchangeSchema(pool, sql);
  process.stdout.write(`Exchange schema is ready; ${heads} signed search heads rebuilt.\n`);
} finally {
  await pool.end();
}
