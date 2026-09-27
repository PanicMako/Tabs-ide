import * as Crypto from "node:crypto";
import * as FS from "node:fs/promises";
import * as OS from "node:os";
import * as Path from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import { extractTabsext } from "@tabs/extension-package";
import { compareSemverVersions } from "@tabs/shared/semver";
import type { Pool } from "pg";
import { createPool, createStorage, loadConfig, type ExchangeConfig } from "./config.ts";
import { buildReviewDiff } from "./reviewDiff.ts";
import { scanExtractedPackage, type ScanResult } from "./scan.ts";
import { boundedObject } from "./storage.ts";

interface Job {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
  readonly object_key: string;
  readonly scan_token: string;
}

export async function scanNextVersion(
  pool: Pool,
  storage: S3Client,
  config: ExchangeConfig,
): Promise<boolean> {
  const claimed = await pool.query<Job>(
    `UPDATE exchange_versions SET status = 'scanning', scan_claimed_at = now(), scan_token = $1
     WHERE (namespace, name, version) IN (
       SELECT namespace, name, version FROM exchange_versions
       WHERE status = 'queued' OR (status = 'scanning' AND scan_claimed_at < now() - interval '10 minutes')
       ORDER BY submitted_at FOR UPDATE SKIP LOCKED LIMIT 1
     ) RETURNING namespace, name, version, digest, object_key, scan_token`,
    [Crypto.randomUUID()],
  );
  const job = claimed.rows[0];
  if (!job) return false;
  const temporary = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-exchange-scan-"));
  let result: ScanResult;
  try {
    const archive = Path.join(temporary, "package.tabsext");
    const bytes = await boundedObject(storage, config.bucket, job.object_key);
    const digest = Crypto.createHash("sha256").update(bytes).digest("hex");
    if (digest !== job.digest) throw new Error("Quarantined object digest changed.");
    const blocked = await pool.query<{ digest: string }>(
      "SELECT digest FROM exchange_blocked_digests",
    );
    const blockedDigests = new Set(blocked.rows.map((entry) => entry.digest));
    await FS.writeFile(archive, bytes, { flag: "wx", mode: 0o600 });
    const installed = Path.join(temporary, "extracted");
    const inspected = await extractTabsext({
      archive,
      destination: installed,
      expectedDigest: job.digest,
      tabsVersion: config.tabsVersion,
    });
    if (
      inspected.manifest.publisher !== job.namespace ||
      inspected.manifest.name !== job.name ||
      inspected.manifest.version !== job.version
    ) {
      throw new Error("Quarantined package identity changed.");
    }
    const prior = await pool.query<{
      version: string;
      digest: string;
      bytes: number;
      object_key: string;
    }>(
      `SELECT version, digest, bytes, object_key FROM exchange_versions WHERE namespace = $1 AND name = $2
       AND status = 'approved'`,
      [job.namespace, job.name],
    );
    let priorDirectory: string | undefined;
    let priorInspected: typeof inspected | undefined;
    let priorFiles: Record<string, string> = {};
    const priorVersion = prior.rows
      .filter((entry) => compareSemverVersions(entry.version, job.version) < 0)
      .reduce<(typeof prior.rows)[number] | undefined>(
        (closest, entry) =>
          !closest || compareSemverVersions(entry.version, closest.version) > 0 ? entry : closest,
        undefined,
      );
    if (priorVersion) {
      const priorBytes = await boundedObject(storage, config.bucket, priorVersion.object_key);
      if (
        priorBytes.length !== priorVersion.bytes ||
        Crypto.createHash("sha256").update(priorBytes).digest("hex") !== priorVersion.digest
      ) {
        throw new Error("Previously approved package failed digest verification.");
      }
      const priorArchive = Path.join(temporary, "prior.tabsext");
      await FS.writeFile(priorArchive, priorBytes, { flag: "wx", mode: 0o600 });
      priorDirectory = Path.join(temporary, "prior-extracted");
      priorInspected = await extractTabsext({
        archive: priorArchive,
        destination: priorDirectory,
        expectedDigest: priorVersion.digest,
        tabsVersion: config.tabsVersion,
      });
      if (
        priorInspected.manifest.publisher !== job.namespace ||
        priorInspected.manifest.name !== job.name ||
        priorInspected.manifest.version !== priorVersion.version
      ) {
        throw new Error("Previously approved package identity changed.");
      }
      priorFiles = (await scanExtractedPackage(priorDirectory, priorInspected)).files;
    }
    result = await scanExtractedPackage(
      installed,
      inspected,
      priorInspected?.manifest,
      priorFiles,
      priorVersion?.version,
      blockedDigests,
    );
    result = {
      ...result,
      reviewDiff: await buildReviewDiff({
        currentDirectory: installed,
        currentFiles: inspected.files,
        ...(priorDirectory ? { priorDirectory } : {}),
        ...(priorInspected ? { priorFiles: priorInspected.files } : {}),
        changedFiles: [
          ...result.changes.added,
          ...result.changes.modified,
          ...result.changes.removed,
        ],
      }),
    };
  } catch (error) {
    result = {
      passed: false,
      digest: job.digest,
      scannedAt: new Date().toISOString(),
      issues: [{ severity: "blocking", code: "scan-failed" }],
      files: {},
      capabilityChanges: { added: [], removed: [] },
      changes: { added: [], modified: [], removed: [] },
    };
    process.stderr.write(
      `Exchange scan failed for ${job.namespace}.${job.name}@${job.version}: ${String(error)}\n`,
    );
  } finally {
    await FS.rm(temporary, { recursive: true, force: true });
  }
  await pool.query(
    `UPDATE exchange_versions SET status = 'review', scan_result = $5::jsonb, scan_claimed_at = NULL, scan_token = NULL
     WHERE namespace = $1 AND name = $2 AND version = $3 AND digest = $4 AND status = 'scanning' AND scan_token = $6`,
    [job.namespace, job.name, job.version, job.digest, JSON.stringify(result), job.scan_token],
  );
  return true;
}

if (import.meta.main) {
  const config = loadConfig();
  const pool = createPool();
  const storage = createStorage();
  for (;;) {
    try {
      if (!(await scanNextVersion(pool, storage, config))) {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
      }
    } catch (error) {
      process.stderr.write(`Exchange worker error: ${String(error)}\n`);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}
