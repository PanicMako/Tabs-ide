import * as Crypto from "node:crypto";
import { Readable } from "node:stream";
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { verifyExchangeObjects } from "./verifyObjects.ts";

const bytes = Buffer.from("exact reviewed package");
const digest = Crypto.createHash("sha256").update(bytes).digest("hex");

function fixture(count: number, change?: (rows: Array<Record<string, unknown>>) => void) {
  const rows = Array.from({ length: count }, (_, index) => {
    const name = `package-${String(index).padStart(3, "0")}`;
    return {
      namespace: "acme",
      name,
      version: "1.0.0",
      digest,
      bytes: bytes.length,
      object_key: `quarantine/acme/${name}/1.0.0/${digest}.tabsext`,
    };
  });
  change?.(rows);
  const queries: string[] = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push(sql);
      if (!sql.includes("FROM exchange_versions")) return { rows: [] };
      const after = params?.[1];
      const page = rows.filter((row) => after === null || row.name > String(after)).slice(0, 100);
      return { rows: page };
    }),
    release: vi.fn(),
  };
  const storage = {
    send: vi.fn(async (command: GetObjectCommand) => {
      if (!(command instanceof GetObjectCommand)) throw new Error("Unexpected S3 command.");
      return { Body: Readable.from([bytes]) };
    }),
  } as unknown as S3Client;
  return { pool: { connect: async () => client } as unknown as Pool, storage, queries, client };
}

describe("Exchange object recovery verification", () => {
  it("audits all package statuses with a stable paginated database snapshot", async () => {
    const subject = fixture(101);
    const result = await verifyExchangeObjects(subject.pool, subject.storage, "packages");
    expect(result).toEqual({ checked: 101, failed: 0, failures: [] });
    expect(subject.queries.filter((sql) => sql.includes("FROM exchange_versions"))).toHaveLength(2);
    expect(subject.queries[0]).toContain("REPEATABLE READ READ ONLY");
    expect(subject.queries).toContain("COMMIT");
    expect(subject.client.release).toHaveBeenCalledTimes(1);
  });

  it("reports bad keys, missing bytes, and digest or size changes", async () => {
    const subject = fixture(4, (rows) => {
      rows[0]!.object_key = "unexpected/key";
      rows[1]!.bytes = bytes.length + 1;
      rows[2]!.digest = "b".repeat(64);
      rows[2]!.object_key = `quarantine/acme/package-002/1.0.0/${"b".repeat(64)}.tabsext`;
    });
    let calls = 0;
    vi.spyOn(subject.storage, "send").mockImplementation(async () => {
      calls++;
      if (calls === 3) throw new Error("Object missing.");
      return { Body: Readable.from([bytes]) } as never;
    });
    const result = await verifyExchangeObjects(subject.pool, subject.storage, "packages");
    expect(result).toEqual({
      checked: 4,
      failed: 4,
      failures: [
        { package: "acme.package-000@1.0.0", reason: "key-mismatch" },
        { package: "acme.package-001@1.0.0", reason: "size-mismatch" },
        { package: "acme.package-002@1.0.0", reason: "digest-mismatch" },
        { package: "acme.package-003@1.0.0", reason: "unreadable" },
      ],
    });
  });
});
