import * as FS from "node:fs/promises";
import * as Path from "node:path";
import { createPool } from "./config.ts";

const pool = createPool();
try {
  const sql = await FS.readFile(Path.join(import.meta.dirname, "schema.sql"), "utf8");
  await pool.query(sql);
  process.stdout.write("Exchange schema is ready.\n");
} finally {
  await pool.end();
}
