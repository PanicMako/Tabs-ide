import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { migrateExchangeSchema } from "./migration.ts";

describe("Exchange schema migration", () => {
  it("locks publication before schema work and atomically rebuilds catalog heads", async () => {
    const operations: string[] = [];
    const client = {
      async query(sql: string) {
        operations.push(sql);
        return { rows: [] };
      },
      release() {
        operations.push("RELEASE");
      },
    };
    const pool = {
      async connect() {
        return client;
      },
    } as unknown as Pool;
    expect(await migrateExchangeSchema(pool, "CREATE TABLE example (id int)")).toBe(0);
    expect(operations).toEqual([
      "BEGIN",
      "SELECT pg_advisory_xact_lock(1261492744)",
      "CREATE TABLE example (id int)",
      expect.stringContaining("JOIN exchange_published_targets p"),
      "DELETE FROM exchange_published_heads",
      "COMMIT",
      "RELEASE",
    ]);
  });

  it("rolls back and releases the connection when head rebuilding fails", async () => {
    const operations: string[] = [];
    const client = {
      async query(sql: string) {
        operations.push(sql);
        if (sql === "DELETE FROM exchange_published_heads") throw new Error("database failure");
        return { rows: [] };
      },
      release() {
        operations.push("RELEASE");
      },
    };
    const pool = {
      async connect() {
        return client;
      },
    } as unknown as Pool;
    await expect(migrateExchangeSchema(pool, "SCHEMA")).rejects.toThrow(/database failure/);
    expect(operations.slice(-2)).toEqual(["ROLLBACK", "RELEASE"]);
    expect(operations).not.toContain("COMMIT");
  });
});
