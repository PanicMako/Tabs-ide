import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { rebuildPublishedHeads, refreshPublishedHead } from "./publishedHeads.ts";

describe("published search head refresh", () => {
  it("rebuilds derived heads from only signed approved targets during migration", async () => {
    const operations: Array<{ sql: string; parameters?: unknown[] }> = [];
    const client = {
      async query(sql: string, parameters?: unknown[]) {
        operations.push({ sql, ...(parameters ? { parameters } : {}) });
        if (sql.includes("FROM exchange_versions v")) {
          return {
            rows: ["1.0.0", "1.2.0-rc.1", "1.2.0"].map((version) => ({
              namespace: "acme",
              name: "dashboard",
              version,
              digest: "a".repeat(64),
              bytes: 20,
            })),
          };
        }
        return { rows: [] };
      },
    } as unknown as PoolClient;
    expect(await rebuildPublishedHeads(client)).toBe(1);
    expect(operations.map((entry) => entry.sql)).toEqual([
      expect.stringContaining("JOIN exchange_published_targets p"),
      "DELETE FROM exchange_published_heads",
      expect.stringContaining("INSERT INTO exchange_published_heads"),
    ]);
    expect(operations[2]?.parameters).toEqual(["acme", "dashboard", "1.2.0"]);
  });

  it("falls back to the highest still-approved signed release after revocation", async () => {
    const operations: Array<{ sql: string; parameters?: unknown[] }> = [];
    const client = {
      async query(sql: string, parameters?: unknown[]) {
        operations.push({ sql, ...(parameters ? { parameters } : {}) });
        if (sql.includes("FROM exchange_versions v")) {
          return {
            rows: ["1.2.0-rc.1", "1.1.0", "1.2.0"].map((version) => ({
              namespace: "acme",
              name: "dashboard",
              version,
              digest: "a".repeat(64),
              bytes: 20,
            })),
          };
        }
        return { rows: [] };
      },
    } as unknown as PoolClient;
    await refreshPublishedHead(client, "acme", "dashboard");
    expect(operations.map((entry) => entry.sql)).toEqual([
      expect.stringContaining("JOIN exchange_published_targets p"),
      expect.stringContaining("DELETE FROM exchange_published_heads"),
      expect.stringContaining("INSERT INTO exchange_published_heads"),
    ]);
    expect(operations[2]?.parameters).toEqual(["acme", "dashboard", "1.2.0"]);
  });

  it("removes the head when no signed approved release remains", async () => {
    const operations: string[] = [];
    const client = {
      async query(sql: string) {
        operations.push(sql);
        return { rows: [] };
      },
    } as unknown as PoolClient;
    await refreshPublishedHead(client, "acme", "dashboard");
    expect(operations).toHaveLength(2);
    expect(operations[1]).toContain("DELETE FROM exchange_published_heads");
  });
});
