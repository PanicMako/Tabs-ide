import * as Crypto from "node:crypto";
import type { S3Client } from "@aws-sdk/client-s3";
import type { Pool, QueryResult } from "pg";
import { createPool, createStorage } from "./config.ts";
import { boundedObject } from "./storage.ts";

const PAGE_SIZE = 100;
const MAX_REPORTED_FAILURES = 100;

interface PackageRow {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
  readonly bytes: number;
  readonly object_key: string;
}

export interface ObjectVerificationFailure {
  readonly package: string;
  readonly reason: "key-mismatch" | "unreadable" | "size-mismatch" | "digest-mismatch";
}

export interface ObjectVerificationResult {
  readonly checked: number;
  readonly failed: number;
  readonly failures: readonly ObjectVerificationFailure[];
}

/** Audit every DB-referenced object, including private, rejected, and revoked submissions. */
export async function verifyExchangeObjects(
  pool: Pool,
  storage: S3Client,
  bucket: string,
): Promise<ObjectVerificationResult> {
  const client = await pool.connect();
  let checked = 0;
  let failed = 0;
  const failures: ObjectVerificationFailure[] = [];
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    let cursor: Pick<PackageRow, "namespace" | "name" | "version"> | null = null;
    while (true) {
      const page: QueryResult<PackageRow> = await client.query<PackageRow>(
        `SELECT namespace, name, version, digest, bytes, object_key
         FROM exchange_versions
         WHERE $1::text IS NULL OR (namespace, name, version) > ($1, $2, $3)
         ORDER BY namespace, name, version LIMIT $4`,
        [cursor?.namespace ?? null, cursor?.name ?? null, cursor?.version ?? null, PAGE_SIZE],
      );
      if (!page.rows.length) break;
      for (const row of page.rows) {
        checked++;
        const identity = `${row.namespace}.${row.name}@${row.version}`;
        const expectedKey = `quarantine/${row.namespace}/${row.name}/${row.version}/${row.digest}.tabsext`;
        let reason: ObjectVerificationFailure["reason"] | null = null;
        if (row.object_key !== expectedKey) {
          reason = "key-mismatch";
        } else {
          try {
            const bytes = await boundedObject(storage, bucket, row.object_key);
            if (bytes.length !== row.bytes) reason = "size-mismatch";
            else if (Crypto.createHash("sha256").update(bytes).digest("hex") !== row.digest) {
              reason = "digest-mismatch";
            }
          } catch {
            reason = "unreadable";
          }
        }
        if (reason) {
          failed++;
          if (failures.length < MAX_REPORTED_FAILURES) failures.push({ package: identity, reason });
        }
      }
      const last: PackageRow = page.rows.at(-1)!;
      cursor = { namespace: last.namespace, name: last.name, version: last.version };
      if (page.rows.length < PAGE_SIZE) break;
    }
    await client.query("COMMIT");
    return { checked, failed, failures };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (import.meta.main) {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("Missing S3_BUCKET.");
  const pool = createPool();
  try {
    const result = await verifyExchangeObjects(pool, createStorage(), bucket);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.failed > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
