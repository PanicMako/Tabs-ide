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
  "exchange_namespace_member_events",
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

const SERIAL_TABLES = [
  "exchange_namespace_member_events",
  "exchange_namespace_invitations",
  "exchange_namespace_verifications",
  "exchange_review_events",
  "exchange_appeals",
  "exchange_blocked_digest_events",
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
  if (manifest.version !== 1 || manifest.objectCount !== manifest.objects.length) {
    throw new Error("Invalid Exchange backup manifest.");
  }
  for (const table of BACKUP_TABLES_ORDER) {
    const rows = manifest.tableRows[table];
    if (!Array.isArray(rows) || manifest.tableCounts[table] !== rows.length) {
      throw new Error(`Invalid Exchange backup row count for '${table}'.`);
    }
    if (rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
      throw new Error(`Invalid Exchange backup row for '${table}'.`);
    }
  }
  const decodedObjects = new Map<string, Buffer>();
  for (const object of manifest.objects) {
    if (!object.key || decodedObjects.has(object.key) || !/^[a-f0-9]{64}$/.test(object.digest)) {
      throw new Error("Invalid Exchange backup object identity.");
    }
    const buffer = Buffer.from(object.dataBase64, "base64");
    if (
      buffer.toString("base64") !== object.dataBase64 ||
      buffer.length !== object.bytes ||
      Crypto.createHash("sha256").update(buffer).digest("hex") !== object.digest
    ) {
      throw new Error(`Corrupted object in backup manifest for key '${object.key}'.`);
    }
    decodedObjects.set(object.key, buffer);
  }

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
        const columnNames = columns.map((column) => `"${column.replaceAll('"', '""')}"`);
        const sql = `INSERT INTO ${table} (${columnNames.join(", ")}) VALUES (${placeholders})`;
        await client.query(sql, values);
      }
    }

    for (const table of SERIAL_TABLES) {
      const result = await client.query<{ max_id: string | null }>(
        `SELECT max(id) AS max_id FROM ${table}`,
      );
      const maxId = result.rows[0]?.max_id;
      await client.query("SELECT setval(pg_get_serial_sequence($1, 'id'), $2::bigint, $3)", [
        table,
        maxId ?? "1",
        maxId !== null && maxId !== undefined,
      ]);
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
    const buffer = decodedObjects.get(obj.key)!;
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
