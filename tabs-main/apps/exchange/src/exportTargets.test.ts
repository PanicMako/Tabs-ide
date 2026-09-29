import * as Crypto from "node:crypto";
import { Readable } from "node:stream";
import type { S3Client } from "@aws-sdk/client-s3";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { exportApprovedTargets } from "./exportTargets.ts";

const archive = Buffer.from("approved package");
const digest = Crypto.createHash("sha256").update(archive).digest("hex");

function fixture() {
  const queries: string[] = [];
  const rows = [
    {
      namespace: "acme",
      name: "dashboard",
      version: "1.0.0",
      digest,
      bytes: archive.length,
      object_key: `quarantine/acme/dashboard/1.0.0/${digest}.tabsext`,
    },
  ];
  let stored: Buffer = archive;
  const pool = {
    async connect() {
      return {
        async query(sql: string) {
          queries.push(sql);
          return { rows };
        },
        release() {},
      };
    },
  } as unknown as Pool;
  const storage = {
    async send() {
      return { Body: Readable.from([stored]) };
    },
  } as unknown as S3Client;
  return { pool, storage, rows, queries, setStored: (bytes: Buffer) => (stored = bytes) };
}

describe("offline signing target export", () => {
  it("exports only exact approved object hashes and lengths", async () => {
    const subject = fixture();
    expect(await exportApprovedTargets(subject.pool, subject.storage, "quarantine")).toEqual({
      "extensions/acme/dashboard/1.0.0.tabsext": {
        length: archive.length,
        hashes: { sha256: digest },
      },
    });
    expect(subject.queries).toContain("COMMIT");
  });

  it("aborts if an approved object has changed or its key is wrong", async () => {
    const subject = fixture();
    subject.setStored(Buffer.from("changed package"));
    await expect(
      exportApprovedTargets(subject.pool, subject.storage, "quarantine"),
    ).rejects.toThrow(/digest verification/);
    expect(subject.queries).toContain("ROLLBACK");
    subject.rows[0]!.object_key = "quarantine/unexpected.tabsext";
    await expect(
      exportApprovedTargets(subject.pool, subject.storage, "quarantine"),
    ).rejects.toThrow(/invalid object identity/);
  });

  it("rejects a malformed approved identity before exporting it", async () => {
    const subject = fixture();
    subject.rows[0]!.version = "../unsafe";
    await expect(
      exportApprovedTargets(subject.pool, subject.storage, "quarantine"),
    ).rejects.toThrow(/invalid target metadata/);
  });
});
