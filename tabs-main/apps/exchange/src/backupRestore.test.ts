import type { Pool } from "pg";
import type { S3Client } from "@aws-sdk/client-s3";
import { expect, it } from "vitest";
import { backupExchangeData, restoreExchangeData } from "./backupRestore.ts";

async function fixture() {
  const date = new Date("2026-10-01T01:02:03.456Z");
  const sourceRows: Record<string, Array<Record<string, unknown>>> = {
    exchange_users: [{ id: "42", login: "publisher" }],
    exchange_reviewers: [
      {
        user_id: "42",
        active: true,
        changed_by: "42",
        reason: "Trusted reviewer",
        changed_at: date,
      },
    ],
    exchange_reviewer_events: [
      {
        id: "1",
        user_id: "42",
        actor_id: "42",
        action: "grant",
        reason: "Trusted reviewer",
        created_at: date,
      },
    ],
    exchange_publisher_agreements: [
      { user_id: "42", terms_version: "test-terms", accepted_at: date },
    ],
    exchange_versions: [{ namespace: "acme", name: "tool", version: "1.0.0" }],
    exchange_publication_history: [
      {
        namespace: "acme",
        name: "tool",
        version: "1.0.0",
        digest: "a".repeat(64),
        first_published_at: date,
      },
    ],
  };
  const source = {
    async query(sql: string) {
      const rows = sourceRows[sql.replace("SELECT * FROM ", "")] ?? [];
      return { rows, rowCount: rows.length };
    },
  } as unknown as Pool;
  const storage = {
    async send() {
      return { Contents: [] };
    },
  } as unknown as S3Client;
  const manifest = await backupExchangeData(source, storage, "test");
  const restored = new Map<string, unknown[][]>();
  const operations: string[] = [];
  const target = {
    async query(sql: string) {
      operations.push(sql);
      const table = sql.replace("SELECT count(*) FROM ", "");
      return { rows: [{ count: String(restored.get(table)?.length ?? 0) }] };
    },
    async connect() {
      return {
        async query(sql: string, values?: unknown[]) {
          operations.push(sql);
          const table = /^INSERT INTO ([a-z_]+)/.exec(sql)?.[1];
          if (table) restored.set(table, [...(restored.get(table) ?? []), values ?? []]);
          return { rows: [{ max_id: null }] };
        },
        release() {},
      };
    },
  } as unknown as Pool;
  return { manifest, target, storage, restored, operations };
}

it("preserves reviewer access, audit events, consent and publication timestamps in v3 backups", async () => {
  const subject = await fixture();
  expect(subject.manifest.version).toBe(3);
  expect(subject.manifest.tableRows.exchange_publisher_agreements?.[0]?.accepted_at).toBe(
    "2026-10-01T01:02:03.456Z",
  );
  expect(subject.manifest.tableCounts.exchange_publication_history).toBe(1);
  expect(subject.manifest.tableRows).not.toHaveProperty("exchange_tokens");
  await restoreExchangeData(subject.manifest, subject.target, subject.storage, "test");
  expect(subject.restored.get("exchange_reviewers")?.[0]).toContain(true);
  expect(subject.restored.get("exchange_reviewer_events")?.[0]).toContain("grant");
  expect(subject.restored.get("exchange_publisher_agreements")?.[0]).toEqual([
    "42",
    "test-terms",
    "2026-10-01T01:02:03.456Z",
  ]);
  expect(subject.restored.get("exchange_publication_history")?.[0]).toContain(
    "2026-10-01T01:02:03.456Z",
  );
  const inserts = subject.operations.filter((sql) => sql.startsWith("INSERT INTO"));
  expect(inserts.findIndex((sql) => sql.startsWith("INSERT INTO exchange_users "))).toBeLessThan(
    inserts.findIndex((sql) => sql.startsWith("INSERT INTO exchange_publisher_agreements ")),
  );
  expect(inserts.findIndex((sql) => sql.startsWith("INSERT INTO exchange_versions "))).toBeLessThan(
    inserts.findIndex((sql) => sql.startsWith("INSERT INTO exchange_publication_history ")),
  );
});

it("restores v2 backups without inventing delegated reviewer access", async () => {
  const subject = await fixture();
  const tableRows = { ...subject.manifest.tableRows };
  const tableCounts = { ...subject.manifest.tableCounts };
  for (const table of ["exchange_reviewers", "exchange_reviewer_events"]) {
    delete tableRows[table];
    delete tableCounts[table];
  }
  const legacy = { ...subject.manifest, version: 2 as const, tableRows, tableCounts };
  await restoreExchangeData(legacy, subject.target, subject.storage, "test");
  expect(subject.restored.has("exchange_reviewers")).toBe(false);
  expect(subject.restored.has("exchange_reviewer_events")).toBe(false);
  expect(legacy.tableRows).not.toHaveProperty("exchange_reviewers");
});

it("restores legacy backups without inferring consent or publication times or mutating the input", async () => {
  const subject = await fixture();
  const tableRows = { ...subject.manifest.tableRows };
  const tableCounts = { ...subject.manifest.tableCounts };
  for (const table of [
    "exchange_publisher_agreements",
    "exchange_publication_history",
    "exchange_reviewers",
    "exchange_reviewer_events",
  ]) {
    delete tableRows[table];
    delete tableCounts[table];
  }
  const legacy = { ...subject.manifest, version: 1 as const, tableRows, tableCounts };
  await restoreExchangeData(legacy, subject.target, subject.storage, "test");
  expect(subject.restored.has("exchange_publisher_agreements")).toBe(false);
  expect(subject.restored.has("exchange_publication_history")).toBe(false);
  expect(subject.restored.has("exchange_reviewers")).toBe(false);
  expect(legacy.tableRows).not.toHaveProperty("exchange_publisher_agreements");
});

it("preserves an explicitly unknown historical date through JSON serialization", async () => {
  const subject = await fixture();
  const serialized = JSON.parse(JSON.stringify(subject.manifest)) as typeof subject.manifest;
  serialized.tableRows.exchange_publication_history![0]!.first_published_at = null;
  await restoreExchangeData(serialized, subject.target, subject.storage, "test");
  expect(subject.restored.get("exchange_publication_history")?.[0]?.at(-1)).toBeNull();
  expect(subject.restored.get("exchange_publisher_agreements")?.[0]?.at(-1)).toBe(
    "2026-10-01T01:02:03.456Z",
  );
});

it("rejects a v2 backup missing mandatory history before inspecting or writing the target", async () => {
  const subject = await fixture();
  const tableRows = { ...subject.manifest.tableRows };
  delete tableRows.exchange_publication_history;
  await expect(
    restoreExchangeData(
      { ...subject.manifest, tableRows },
      subject.target,
      subject.storage,
      "test",
    ),
  ).rejects.toThrow("exchange_publication_history");
  expect(subject.operations).toEqual([]);
});
