import * as Crypto from "node:crypto";
import * as FS from "node:fs/promises";
import * as OS from "node:os";
import * as Path from "node:path";
import { Metadata, MetadataKind } from "@tufjs/models";
import type { Pool } from "pg";
import type { S3Client } from "@aws-sdk/client-s3";
import { exportApprovedTargets } from "./exportTargets.ts";
import { publishTufMetadata } from "./tufPublish.ts";
export class ReleaseWizardError extends Error {}
function publicOnly(value: unknown, depth = 0): void {
  if (depth > 20) throw new ReleaseWizardError("Metadata is nested too deeply.");
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/private|password|encrypted|secret/i.test(key))
      throw new ReleaseWizardError("Private signing material is not accepted by the registry.");
    publicOnly(child, depth + 1);
  }
}
const hash = (value: string) => Crypto.createHash("sha256").update(value).digest("hex");
export async function releaseState(pool: Pool, origin: string) {
  const metadata = await pool.query<{ name: string; bytes: Buffer }>(
    "SELECT name, bytes FROM exchange_tuf_metadata ORDER BY name",
  );
  const pin = await pool.query<{ sha256: string }>(
    "SELECT sha256 FROM exchange_signing_setup WHERE singleton = true",
  );
  const root =
    metadata.rows.find((row) => row.name === "root.json")?.bytes.toString("utf8") ?? null;
  const versions = { root: 0, targets: 0, snapshot: 0, timestamp: 0 };
  for (const role of Object.keys(versions) as (keyof typeof versions)[]) {
    const bytes = metadata.rows.find((row) => row.name === `${role}.json`)?.bytes;
    if (bytes) {
      const version = JSON.parse(bytes.toString("utf8")).signed.version;
      if (!Number.isSafeInteger(version) || version < 1)
        throw new ReleaseWizardError("Stored signing metadata needs operator repair.");
      versions[role] = version;
    }
  }
  const configured = process.env.EXCHANGE_TUF_BOOTSTRAP_ROOT_SHA256 || undefined;
  if (configured && pin.rows[0] && configured !== pin.rows[0].sha256)
    throw new ReleaseWizardError(
      "The configured trust pin conflicts with the registered signing setup.",
    );
  return {
    origin,
    root,
    pin: root ? hash(root) : (configured ?? pin.rows[0]?.sha256 ?? null),
    versions,
  };
}
export async function registerSigningRoot(
  pool: Pool,
  actorId: string,
  origin: string,
  body: Record<string, unknown>,
) {
  if (
    Object.keys(body).some((key) => !["root", "fingerprint", "confirmOrigin"].includes(key)) ||
    typeof body.root !== "string" ||
    Buffer.byteLength(body.root) > 32000 ||
    body.fingerprint !== hash(body.root) ||
    body.confirmOrigin !== origin
  )
    throw new ReleaseWizardError("Confirm the exact root fingerprint and registry address.");
  try {
    publicOnly(JSON.parse(body.root));
    const root = Metadata.fromJSON(MetadataKind.Root, JSON.parse(body.root));
    root.verifyDelegate("root", root);
    if (
      root.signed.version !== 1 ||
      !Number.isFinite(Date.parse(root.signed.expires)) ||
      Date.parse(root.signed.expires) <= Date.now() + 86400000
    )
      throw new Error();
  } catch {
    throw new ReleaseWizardError("Provide a current, self-signed version 1 trust root.");
  }
  const configured = process.env.EXCHANGE_TUF_BOOTSTRAP_ROOT_SHA256 || undefined;
  if (configured && configured !== body.fingerprint)
    throw new ReleaseWizardError("This root does not match the operator-configured trust pin.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(1261492744)");
    const existing = await client.query(
      "SELECT sha256 FROM exchange_signing_setup WHERE singleton = true",
    );
    const published = await client.query(
      "SELECT name FROM exchange_tuf_metadata WHERE name = 'root.json'",
    );
    if (
      published.rows.length ||
      (existing.rows.length && existing.rows[0].sha256 !== body.fingerprint)
    )
      throw new ReleaseWizardError(
        "Signing is already configured. Trust roots cannot be replaced through this wizard.",
      );
    await client.query(
      "INSERT INTO exchange_signing_setup(singleton, sha256, root_bytes, created_by) VALUES(true,$1,$2,$3) ON CONFLICT DO NOTHING",
      [body.fingerprint, Buffer.from(body.root), actorId],
    );
    if (!existing.rows.length)
      await client.query(
        "INSERT INTO exchange_signing_events(actor_id, action, root_sha256) VALUES($1,'setup',$2)",
        [actorId, body.fingerprint],
      );
    await client.query("COMMIT");
    return { pin: body.fingerprint };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function releasePlan(pool: Pool, storage: S3Client, bucket: string, origin: string) {
  const state = await releaseState(pool, origin);
  const registered = await pool.query<{ root_bytes: Buffer }>(
    "SELECT root_bytes FROM exchange_signing_setup WHERE singleton = true",
  );
  const targets = await exportApprovedTargets(pool, storage, bucket);
  if (Object.keys(targets).length > 500)
    throw new ReleaseWizardError(
      "Use the offline operator tools for registries with more than 500 approved versions.",
    );
  const result = {
    ...state,
    root: state.root ?? registered.rows[0]?.root_bytes.toString("utf8") ?? null,
    targets,
  };
  if (Buffer.byteLength(JSON.stringify(result)) > 512 * 1024)
    throw new ReleaseWizardError(
      "This release plan exceeds the browser limit. Use the offline operator tools.",
    );
  return result;
}
export function signedReleaseFiles(body: Record<string, unknown>) {
  const names = ["root.json", "targets.json", "snapshot.json", "timestamp.json"];
  if (
    Object.keys(body).length !== 4 ||
    names.some(
      (name) =>
        typeof body[name] !== "string" || Buffer.byteLength(body[name] as string) > 256 * 1024,
    )
  )
    throw new ReleaseWizardError(
      "Provide only the four signed public metadata files. Never upload private keys.",
    );
  for (const name of names) {
    try {
      const metadata = JSON.parse(body[name] as string);
      publicOnly(metadata);
      const keys = Object.keys(metadata);
      if (keys.some((key) => !["signed", "signatures"].includes(key))) throw new Error();
      switch (name) {
        case "root.json":
          Metadata.fromJSON(MetadataKind.Root, metadata);
          break;
        case "targets.json":
          Metadata.fromJSON(MetadataKind.Targets, metadata);
          break;
        case "snapshot.json":
          Metadata.fromJSON(MetadataKind.Snapshot, metadata);
          break;
        case "timestamp.json":
          Metadata.fromJSON(MetadataKind.Timestamp, metadata);
          break;
      }
    } catch {
      throw new ReleaseWizardError(`Invalid public metadata: ${name}`);
    }
  }
  return names.map((name) => [name, body[name] as string] as const);
}
export async function publishBrowserRelease(
  pool: Pool,
  storage: S3Client,
  bucket: string,
  actorId: string,
  body: Record<string, unknown>,
) {
  const files = signedReleaseFiles(body);
  const directory = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-signed-release-"));
  try {
    for (const [name, value] of files)
      await FS.writeFile(Path.join(directory, name), value, { flag: "wx", mode: 0o600 });
    return {
      published: await publishTufMetadata(
        pool,
        storage,
        bucket,
        directory,
        process.env.EXCHANGE_TUF_BOOTSTRAP_ROOT_SHA256 || undefined,
        { actorId, registeredPin: true, allApproved: true },
      ),
    };
  } finally {
    await FS.rm(directory, { recursive: true, force: true });
  }
}
