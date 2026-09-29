import * as Crypto from "node:crypto";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { Pool } from "pg";

export interface ExchangeBackupManifest {
  readonly version: 1;
  readonly createdAt: string;
  readonly tableRows: Record<string, ReadonlyArray<Record<string, unknown>>>;
  readonly objects: ReadonlyArray<{
    readonly key: string;
    readonly digest: string;
    readonly bytes: number;
    readonly dataBase64: string;
  }>;
  readonly tableCounts: Record<string, number>;
  readonly objectCount: number;
}

const BACKUP_TABLES_ORDER = [
  "exchange_users",
  "exchange_namespaces",
  "exchange_namespace_members",
  "exchange_namespace_invitations",
  "exchange_namespace_verifications",
  "exchange_versions",
  "exchange_review_events",
  "exchange_appeals",
  "exchange_blocked_digests",
  "exchange_blocked_digest_events",
  "exchange_tuf_metadata",
  "exchange_published_targets",
  "exchange_published_heads",
] as const;

export async function backupExchangeData(
  pool: Pool,
  storage: S3Client,
  bucket: string,
): Promise<ExchangeBackupManifest> {
  const tableRows: Record<string, ReadonlyArray<Record<string, unknown>>> = {};
  const tableCounts: Record<string, number> = {};

  for (const table of BACKUP_TABLES_ORDER) {
    const result = await pool.query(`SELECT * FROM ${table}`);
    // Convert bytea buffers to hex for deterministic JSON backup
    const sanitizedRows = result.rows.map((row) => {
      const copy: Record<string, unknown> = { ...row };
      for (const [k, v] of Object.entries(copy)) {
        if (Buffer.isBuffer(v)) {
          copy[k] = `\\x${v.toString("hex")}`;
        }
      }
      return copy;
    });
    tableRows[table] = sanitizedRows;
    tableCounts[table] = result.rowCount ?? result.rows.length;
  }

  // Backup S3 objects
  const objects: Array<{
    key: string;
    digest: string;
    bytes: number;
    dataBase64: string;
  }> = [];

  let continuationToken: string | undefined = undefined;
  do {
    const listed: ListObjectsV2CommandOutput = await storage.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      }),
    );

    for (const item of listed.Contents ?? []) {
      if (!item.Key) continue;
      const fetched = await storage.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: item.Key,
        }),
      );
      const chunks: Buffer[] = [];
      const body = fetched.Body as NodeJS.ReadableStream;
      for await (const chunk of body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);
      const digest = Crypto.createHash("sha256").update(buffer).digest("hex");
      objects.push({
        key: item.Key,
        digest,
        bytes: buffer.length,
        dataBase64: buffer.toString("base64"),
      });
    }

    continuationToken = listed.NextContinuationToken;
  } while (continuationToken);

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    tableRows,
    objects,
    tableCounts,
    objectCount: objects.length,
  };
}

export async function restoreExchangeData(
  manifest: ExchangeBackupManifest,
  pool: Pool,
  storage: S3Client,
  bucket: string,
): Promise<{ restoredTables: number; restoredObjects: number }> {
  // SAFETY CHECK: Target database MUST be empty
  for (const table of BACKUP_TABLES_ORDER) {
    const countResult = await pool.query<{ count: string }>(`SELECT count(*) FROM ${table}`);
    const count = Number.parseInt(countResult.rows[0]?.count ?? "0", 10);
    if (count > 0) {
      throw new Error(
        `Target database table '${table}' is not empty (${count} rows). Refusing to restore over live data.`,
      );
    }
  }

  // SAFETY CHECK: Target bucket MUST be empty
  const listed = await storage.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
  if ((listed.Contents ?? []).length > 0) {
    throw new Error(
      `Target object bucket '${bucket}' is not empty. Refusing to restore over live storage.`,
    );
  }

  // Restore database tables inside a single transaction
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const table of BACKUP_TABLES_ORDER) {
      const rows = manifest.tableRows[table] ?? [];
      for (const row of rows) {
        const columns = Object.keys(row);
        if (columns.length === 0) continue;
        const values = Object.values(row).map((val) => {
          if (typeof val === "object" && val !== null && !Buffer.isBuffer(val)) {
            return JSON.stringify(val);
          }
          return val;
        });
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
        const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;
        await client.query(sql, values);
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Restore objects into bucket
  for (const obj of manifest.objects) {
    const buffer = Buffer.from(obj.dataBase64, "base64");
    const digest = Crypto.createHash("sha256").update(buffer).digest("hex");
    if (digest !== obj.digest) {
      throw new Error(`Corrupted object in backup manifest for key '${obj.key}'. Digest mismatch.`);
    }
    await storage.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: obj.key,
        Body: buffer,
      }),
    );
  }

  // Verify restored row counts match expected
  for (const table of BACKUP_TABLES_ORDER) {
    const countResult = await pool.query<{ count: string }>(`SELECT count(*) FROM ${table}`);
    const actual = Number.parseInt(countResult.rows[0]?.count ?? "0", 10);
    const expected = manifest.tableCounts[table] ?? 0;
    if (actual !== expected) {
      throw new Error(
        `Restoration row count mismatch on table '${table}': expected ${expected}, got ${actual}.`,
      );
    }
  }

  return {
    restoredTables: Object.keys(manifest.tableRows).length,
    restoredObjects: manifest.objects.length,
  };
}
