import * as Crypto from "node:crypto";
import * as FS from "node:fs/promises";
import { constants as FSConstants } from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { BaseFetcher, Updater } from "tuf-js";
import { DownloadHTTPError } from "tuf-js/dist/error";
import type { S3Client } from "@aws-sdk/client-s3";
import type { Pool, PoolClient } from "pg";
import { createPool, createStorage } from "./config.ts";
import { insertPublishedHeads, type PublishedTarget } from "./publishedHeads.ts";
import { boundedObject } from "./storage.ts";

const METADATA_NAME = /^(?:[1-9][0-9]*\.)?(?:root|snapshot|targets)\.json$|^timestamp\.json$/;
const TARGET_PATH =
  /^extensions\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})\/([0-9A-Za-z.+-]+)\.tabsext$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 25 * 1024 * 1024;

interface MetadataRow {
  readonly name: string;
  readonly bytes: Buffer;
}

interface ReleaseRow {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
  readonly bytes: number;
  readonly status: string;
  readonly object_key: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256(bytes: Buffer): string {
  return Crypto.createHash("sha256").update(bytes).digest("hex");
}

async function stageFile(directory: string, name: string): Promise<Buffer | null> {
  if (!METADATA_NAME.test(name)) throw new Error("Invalid TUF metadata filename.");
  const path = Path.join(directory, name);
  let file: FS.FileHandle;
  try {
    file = await FS.open(path, FSConstants.O_RDONLY | FSConstants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_METADATA_BYTES) {
      throw new Error(`Invalid staged metadata file: ${name}`);
    }
    const bytes = Buffer.allocUnsafe(MAX_METADATA_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await file.read(bytes, length, bytes.length - length, null);
      if (result.bytesRead === 0) return bytes.subarray(0, length);
      length += result.bytesRead;
    }
    throw new Error(`Staged metadata exceeds size limit: ${name}`);
  } finally {
    await file.close();
  }
}

class StagedMetadataFetcher extends BaseFetcher {
  constructor(private readonly directory: string) {
    super();
  }

  async fetch(url: string): Promise<ReadableStream<Uint8Array<ArrayBuffer>>> {
    const parsed = new URL(url);
    if (parsed.origin !== "https://exchange.invalid" || !parsed.pathname.startsWith("/metadata/")) {
      throw new Error("TUF verifier requested an unexpected URL.");
    }
    const name = parsed.pathname.slice("/metadata/".length);
    const bytes = await stageFile(this.directory, name);
    if (!bytes) throw new DownloadHTTPError("Staged metadata not found.", 404);
    const body = new Response(new Uint8Array(bytes)).body;
    if (!body) throw new Error("Could not stream staged metadata.");
    return body as ReadableStream<Uint8Array<ArrayBuffer>>;
  }
}

function signedPart(bytes: Buffer, role: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(bytes.toString("utf8"));
  if (!record(parsed) || !record(parsed.signed) || parsed.signed["_type"] !== role) {
    throw new Error(`Verified ${role} metadata has the wrong role type.`);
  }
  return parsed.signed;
}

function roleVersion(bytes: Buffer, role: string): number {
  const version = signedPart(bytes, role).version;
  if (!Number.isSafeInteger(version) || (version as number) < 1) {
    throw new Error(`Verified ${role} metadata has an invalid version.`);
  }
  return version as number;
}

export function verifyApprovedTargets(
  bytes: Buffer,
  releases: readonly ReleaseRow[],
): ReadonlyArray<PublishedTarget> {
  const signed = signedPart(bytes, "targets");
  if (!record(signed.targets) || signed.delegations !== undefined) {
    throw new Error("Tabs Exchange does not publish delegated target roles yet.");
  }
  const approved = new Map(
    releases
      .filter((release) => release.status === "approved")
      .map((release) => [
        `extensions/${release.namespace}/${release.name}/${release.version}.tabsext`,
        release,
      ]),
  );
  const published: PublishedTarget[] = [];
  for (const [path, target] of Object.entries(signed.targets)) {
    const match = TARGET_PATH.exec(path);
    if (!match || !record(target) || !record(target.hashes)) {
      throw new Error(`Invalid signed target path or metadata: ${path}`);
    }
    const release = approved.get(path);
    if (
      !release ||
      typeof target.hashes.sha256 !== "string" ||
      !SHA256.test(target.hashes.sha256) ||
      target.hashes.sha256 !== release.digest ||
      target.length !== release.bytes ||
      release.bytes <= 0 ||
      release.bytes > MAX_PACKAGE_BYTES
    ) {
      throw new Error(`Signed target is not an exact approved package: ${path}`);
    }
    published.push({
      namespace: match[1]!,
      name: match[2]!,
      version: match[3]!,
      digest: release.digest,
      bytes: release.bytes,
    });
  }
  return published;
}

async function verifiedBundle(
  client: PoolClient,
  stageDirectory: string,
  bootstrapRootDigest: string | undefined,
): Promise<{
  metadata: Map<string, Buffer>;
  targets: ReadonlyArray<PublishedTarget>;
  objectKeys: ReadonlyMap<string, string>;
}> {
  const current = await client.query<MetadataRow>(
    "SELECT name, bytes FROM exchange_tuf_metadata ORDER BY name",
  );
  const existing = new Map(current.rows.map((row) => [row.name, row.bytes]));
  const root = existing.get("root.json") ?? (await stageFile(stageDirectory, "root.json"));
  if (!root) throw new Error("A trusted root.json is required for first publication.");
  if (!existing.has("root.json")) {
    if (
      !bootstrapRootDigest ||
      !SHA256.test(bootstrapRootDigest) ||
      sha256(root) !== bootstrapRootDigest
    ) {
      throw new Error("First publication requires a matching out-of-band root SHA-256 pin.");
    }
  }
  const temporary = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-tuf-verify-"));
  try {
    for (const name of ["root.json", "timestamp.json", "snapshot.json", "targets.json"]) {
      const bytes = existing.get(name) ?? (name === "root.json" ? root : null);
      if (bytes) await FS.writeFile(Path.join(temporary, name), bytes, { flag: "wx", mode: 0o600 });
    }
    const updater = new Updater({
      metadataDir: temporary,
      metadataBaseUrl: "https://exchange.invalid/metadata",
      fetcher: new StagedMetadataFetcher(stageDirectory),
      config: {
        maxRootRotations: 32,
        maxDelegations: 0,
        rootMaxLength: 512 * 1024,
        timestampMaxLength: 64 * 1024,
        snapshotMaxLength: 1024 * 1024,
        targetsMaxLength: MAX_METADATA_BYTES,
      },
    });
    await updater.refresh();
    const result = new Map<string, Buffer>();
    for (const name of ["root.json", "timestamp.json", "snapshot.json", "targets.json"]) {
      result.set(name, await FS.readFile(Path.join(temporary, name)));
    }
    const priorRootVersion = existing.has("root.json") ? roleVersion(root, "root") : 0;
    const nextRootVersion = roleVersion(result.get("root.json")!, "root");
    for (let version = priorRootVersion + 1; version <= nextRootVersion; version++) {
      const name = `${version}.root.json`;
      const bytes = await stageFile(stageDirectory, name);
      if (bytes) result.set(name, bytes);
      else if (version !== 1) throw new Error(`Missing rotated root metadata: ${name}`);
    }
    for (const role of ["snapshot", "targets"]) {
      const verified = result.get(`${role}.json`)!;
      const name = `${roleVersion(verified, role)}.${role}.json`;
      const staged = await stageFile(stageDirectory, name);
      if (staged) {
        if (!staged.equals(verified))
          throw new Error(`Versioned ${role} metadata differs from verified bytes.`);
        result.set(name, staged);
      }
    }
    const releases = await client.query<ReleaseRow>(
      "SELECT namespace, name, version, digest, bytes, status, object_key FROM exchange_versions WHERE status IN ('approved', 'revoked') FOR SHARE",
    );
    const targets = verifyApprovedTargets(result.get("targets.json")!, releases.rows);
    for (const [name, bytes] of result) {
      if (/^[0-9]/.test(name) && existing.has(name) && !existing.get(name)!.equals(bytes)) {
        throw new Error(`Versioned TUF metadata is immutable: ${name}`);
      }
    }
    return {
      metadata: result,
      targets,
      objectKeys: new Map(
        releases.rows.map((release) => [
          `${release.namespace}/${release.name}/${release.version}`,
          release.object_key,
        ]),
      ),
    };
  } finally {
    await FS.rm(temporary, { recursive: true, force: true });
  }
}

/** Publish a pre-signed bundle; the API/worker never see private signing keys. */
export async function publishTufMetadata(
  pool: Pool,
  storage: S3Client,
  bucket: string,
  stageDirectory: string,
  bootstrapRootDigest?: string,
): Promise<number> {
  if (!bucket) throw new Error("A package object bucket is required for signed publication.");
  if (!Path.isAbsolute(stageDirectory) || !(await FS.lstat(stageDirectory)).isDirectory()) {
    throw new Error("Select an absolute staged metadata directory.");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(1261492744)");
    const bundle = await verifiedBundle(client, stageDirectory, bootstrapRootDigest);
    const prior = await client.query<PublishedTarget>(
      "SELECT namespace, name, version, digest, bytes FROM exchange_published_targets",
    );
    const priorTargets = new Set(
      prior.rows.map(
        (target) =>
          `${target.namespace}/${target.name}/${target.version}/${target.digest}/${target.bytes}`,
      ),
    );
    for (const target of bundle.targets) {
      const identity = `${target.namespace}/${target.name}/${target.version}`;
      const key = bundle.objectKeys.get(identity);
      if (key !== `quarantine/${identity}/${target.digest}.tabsext`) {
        throw new Error(`Signed target has an invalid object key: ${identity}`);
      }
      if (
        priorTargets.has(
          `${target.namespace}/${target.name}/${target.version}/${target.digest}/${target.bytes}`,
        )
      ) {
        continue;
      }
      let bytes: Buffer;
      try {
        bytes = await boundedObject(storage, bucket, key);
      } catch {
        throw new Error(`Signed target object is unreadable: ${identity}`);
      }
      if (
        bytes.length !== target.bytes ||
        Crypto.createHash("sha256").update(bytes).digest("hex") !== target.digest
      ) {
        throw new Error(`Signed target object does not match approved digest: ${identity}`);
      }
    }
    for (const [name, bytes] of bundle.metadata) {
      await client.query(
        `INSERT INTO exchange_tuf_metadata(name, bytes, sha256)
         VALUES ($1, $2, $3)
         ON CONFLICT (name) DO UPDATE SET bytes = EXCLUDED.bytes,
           sha256 = EXCLUDED.sha256, published_at = now()`,
        [name, bytes, sha256(bytes)],
      );
    }
    await client.query("DELETE FROM exchange_published_targets");
    for (const target of bundle.targets) {
      await client.query(
        `INSERT INTO exchange_published_targets(namespace, name, version, digest, bytes)
         VALUES ($1, $2, $3, $4, $5)`,
        [target.namespace, target.name, target.version, target.digest, target.bytes],
      );
    }
    await insertPublishedHeads(client, bundle.targets);
    // PostgreSQL delivers this only after COMMIT; subscribers still verify TUF themselves.
    await client.query("SELECT pg_notify('exchange_signed_metadata', 'refresh')");
    await client.query("COMMIT");
    return bundle.metadata.size;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (import.meta.main) {
  const directory = process.argv[2];
  if (!directory) throw new Error("Usage: bun src/tufPublish.ts /absolute/staged-metadata-dir");
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("Missing S3_BUCKET.");
  const pool = createPool();
  try {
    const count = await publishTufMetadata(
      pool,
      createStorage(),
      bucket,
      directory,
      process.env.EXCHANGE_TUF_BOOTSTRAP_ROOT_SHA256,
    );
    process.stdout.write(`Published ${count} verified TUF metadata files.\n`);
  } finally {
    await pool.end();
  }
}
