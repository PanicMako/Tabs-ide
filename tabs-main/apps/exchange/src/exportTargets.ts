import type { S3Client } from "@aws-sdk/client-s3";
import type { Pool } from "pg";
import { createPool, createStorage } from "./config.ts";
import { verifiedPackageObject } from "./storage.ts";

const ID = /^[a-z][a-z0-9-]{1,62}$/;
const VERSION = /^[0-9A-Za-z.+-]{1,128}$/;
const SHA256 = /^[a-f0-9]{64}$/;

interface ApprovedRow {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
  readonly bytes: number;
  readonly object_key: string;
}

export interface UnsignedTarget {
  readonly length: number;
  readonly hashes: { readonly sha256: string };
}

/** Export an unsigned target map for an offline signer; this never publishes metadata. */
export async function exportApprovedTargets(
  pool: Pool,
  storage: S3Client,
  bucket: string,
): Promise<Record<string, UnsignedTarget>> {
  if (!bucket) throw new Error("A package object bucket is required.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const approved = await client.query<ApprovedRow>(
      `SELECT namespace, name, version, digest, bytes, object_key
       FROM exchange_versions WHERE status = 'approved'
       ORDER BY namespace, name, version`,
    );
    const targets: Record<string, UnsignedTarget> = {};
    for (const row of approved.rows) {
      if (
        !ID.test(row.namespace) ||
        !ID.test(row.name) ||
        !VERSION.test(row.version) ||
        !SHA256.test(row.digest) ||
        !Number.isSafeInteger(row.bytes) ||
        row.bytes <= 0 ||
        row.bytes > 25 * 1024 * 1024
      ) {
        throw new Error("Approved release has invalid target metadata.");
      }
      const path = `extensions/${row.namespace}/${row.name}/${row.version}.tabsext`;
      const expectedKey = `quarantine/${row.namespace}/${row.name}/${row.version}/${row.digest}.tabsext`;
      if (row.object_key !== expectedKey || Object.hasOwn(targets, path)) {
        throw new Error(`Approved release has an invalid object identity: ${path}`);
      }
      await verifiedPackageObject(storage, bucket, expectedKey, row.bytes, row.digest);
      targets[path] = { length: row.bytes, hashes: { sha256: row.digest } };
    }
    await client.query("COMMIT");
    return targets;
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
    const targets = await exportApprovedTargets(pool, createStorage(), bucket);
    process.stdout.write(`${JSON.stringify({ targets }, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}
