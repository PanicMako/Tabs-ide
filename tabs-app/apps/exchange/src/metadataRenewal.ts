import * as Crypto from "node:crypto";
import * as FS from "node:fs/promises";
import { constants } from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import {
  Metadata,
  MetadataKind,
  MetaFile,
  Signature,
  Snapshot,
  Targets,
  Timestamp,
  type Root,
} from "@tufjs/models";
import type { Pool } from "pg";
import type { S3Client } from "@aws-sdk/client-s3";
import { createPool, createStorage } from "./config.ts";
import { publishTufMetadata } from "./tufPublish.ts";
import type { SigningBackup } from "../frontend/src/lib/releaseSigning.ts";

const DAY = 86_400_000;
const RENEW_WITHIN_MS = 12 * 60 * 60 * 1_000;
const ROLES = ["targets", "snapshot", "timestamp"] as const;
type OnlineRole = (typeof ROLES)[number];
export interface OnlineSigningConfig {
  readonly format: "tabs-online-signing-v1";
  readonly origin: string;
  readonly rootSha256: string;
  readonly keys: Record<OnlineRole, { readonly id: string; readonly privateKey: string }>;
}
export interface RenewalRelease {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
  readonly bytes: number;
  readonly status: "approved" | "revoked";
}
const hash = (bytes: Buffer) => Crypto.createHash("sha256").update(bytes).digest("hex");
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function onlineKeys(
  configuration: OnlineSigningConfig,
  root: Metadata<Root>,
): Record<OnlineRole, { id: string; privateKey: Crypto.KeyObject }> {
  return Object.fromEntries(
    ROLES.map((role) => {
      const key = configuration.keys[role];
      const privateKey = Crypto.createPrivateKey({
        key: Buffer.from(key.privateKey, "base64"),
        format: "der",
        type: "pkcs8",
      });
      const publicHex = Crypto.createPublicKey(privateKey)
        .export({ format: "der", type: "spki" })
        .subarray(-32)
        .toString("hex");
      const trusted = root.signed.keys[key.id];
      if (
        privateKey.asymmetricKeyType !== "ed25519" ||
        !root.signed.roles[role]?.keyIDs.includes(key.id) ||
        trusted?.keyVal.public !== publicHex ||
        root.signed.roles.root!.keyIDs.some(
          (id) => root.signed.keys[id]?.keyVal.public === publicHex,
        )
      ) {
        throw new Error(`The ${role} signer is unauthorized or contains a root private key.`);
      }
      return [role, { id: key.id, privateKey }];
    }),
  ) as Record<OnlineRole, { id: string; privateKey: Crypto.KeyObject }>;
}

export function onlineSigningConfig(backup: SigningBackup): OnlineSigningConfig {
  const configuration = parseOnlineSigningConfig(
    {
      format: "tabs-online-signing-v1",
      origin: backup.origin,
      rootSha256: hash(Buffer.from(backup.root)),
      keys: Object.fromEntries(ROLES.map((role) => [role, { ...backup.keys[role] }])),
    },
    backup.origin,
  );
  const root = Metadata.fromJSON(MetadataKind.Root, JSON.parse(backup.root));
  root.verifyDelegate("root", root);
  onlineKeys(configuration, root);
  return configuration;
}

export function parseOnlineSigningConfig(value: unknown, origin: string): OnlineSigningConfig {
  const url = new URL(origin);
  if (url.origin !== origin || url.protocol !== "https:")
    throw new Error("Signing requires an exact HTTPS registry origin.");
  if (
    !record(value) ||
    value.format !== "tabs-online-signing-v1" ||
    value.origin !== origin ||
    typeof value.rootSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.rootSha256) ||
    Object.keys(value).some((key) => !["format", "origin", "rootSha256", "keys"].includes(key)) ||
    !record(value.keys) ||
    Object.keys(value.keys).length !== 3
  ) {
    throw new Error("Invalid online signer configuration. Root private keys are never accepted.");
  }
  for (const role of ROLES) {
    const key = value.keys[role];
    if (
      !record(key) ||
      Object.keys(key).length !== 2 ||
      typeof key.id !== "string" ||
      !/^[a-f0-9]{64}$/.test(key.id) ||
      typeof key.privateKey !== "string" ||
      key.privateKey.length > 1024 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(key.privateKey)
    ) {
      throw new Error(`Invalid ${role} signing key.`);
    }
  }
  return value as unknown as OnlineSigningConfig;
}

export async function readOnlineSigningConfig(
  file: string,
  origin: string,
): Promise<OnlineSigningConfig> {
  if (!Path.isAbsolute(file)) throw new Error("Select an absolute online signing key file.");
  const handle = await FS.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.size > 32 * 1024 ||
      (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
    ) {
      throw new Error("Online signing keys require a private regular file (mode 0600).");
    }
    let value: unknown;
    try {
      value = JSON.parse(await handle.readFile("utf8"));
    } catch {
      // JSON parser errors can include an excerpt of private key material.
      throw new Error("The online signing key file could not be parsed.");
    }
    return parseOnlineSigningConfig(value, origin);
  } finally {
    await handle.close();
  }
}

/** Renew only previously signed releases; approval of new versions remains manual. */
export function renewedMetadata(
  current: ReadonlyMap<string, Buffer>,
  releases: readonly RenewalRelease[],
  configuration: OnlineSigningConfig,
  now = new Date(),
): Map<string, Buffer> | null {
  const bytes = (name: string) => {
    const value = current.get(name);
    if (!value) throw new Error(`Missing published ${name}; first publication must be manual.`);
    return value;
  };
  const rootBytes = bytes("root.json");
  if (hash(rootBytes) !== configuration.rootSha256)
    throw new Error("Published trust root differs from the provisioned signer pin.");
  const root = Metadata.fromJSON(MetadataKind.Root, JSON.parse(rootBytes.toString("utf8")));
  root.verifyDelegate("root", root);
  if (root.signed.isExpired(now))
    throw new Error("The offline root has expired; operator root rotation is required.");
  const targets = Metadata.fromJSON(
    MetadataKind.Targets,
    JSON.parse(bytes("targets.json").toString("utf8")),
  );
  const snapshot = Metadata.fromJSON(
    MetadataKind.Snapshot,
    JSON.parse(bytes("snapshot.json").toString("utf8")),
  );
  const timestamp = Metadata.fromJSON(
    MetadataKind.Timestamp,
    JSON.parse(bytes("timestamp.json").toString("utf8")),
  );
  root.verifyDelegate("targets", targets);
  root.verifyDelegate("snapshot", snapshot);
  root.verifyDelegate("timestamp", timestamp);
  timestamp.signed.snapshotMeta.verify(bytes("snapshot.json"));
  const targetsMeta = snapshot.signed.meta["targets.json"];
  if (
    !targetsMeta ||
    timestamp.signed.snapshotMeta.version !== snapshot.signed.version ||
    targetsMeta.version !== targets.signed.version
  ) {
    throw new Error("Published metadata versions do not form a consistent chain.");
  }
  targetsMeta.verify(bytes("targets.json"));
  if (targets.signed.delegations)
    throw new Error("Delegated target roles require a dedicated renewal policy.");
  const keys = onlineKeys(configuration, root);
  const byPath = new Map(
    releases.map((release) => [
      `extensions/${release.namespace}/${release.name}/${release.version}.tabsext`,
      release,
    ]),
  );
  const retained: Record<string, (typeof targets.signed.targets)[string]> = {};
  let removed = false;
  for (const [path, target] of Object.entries(targets.signed.targets)) {
    const release = byPath.get(path);
    if (!release || release.digest !== target.hashes.sha256 || release.bytes !== target.length) {
      throw new Error("A published target no longer matches its immutable reviewed package.");
    }
    if (release.status === "revoked") removed = true;
    else if (release.status === "approved") retained[path] = target;
    else throw new Error("Published package has an unsupported review status.");
  }
  if (
    !removed &&
    [targets, snapshot, timestamp].every(
      (metadata) => Date.parse(metadata.signed.expires) > now.getTime() + RENEW_WITHIN_MS,
    )
  )
    return null;
  const fields = (signed: Targets | Snapshot | Timestamp, days: number) => {
    if (!Number.isSafeInteger(signed.version + 1)) throw new Error("Metadata version exhausted.");
    return {
      version: signed.version + 1,
      specVersion: signed.specVersion,
      expires: new Date(now.getTime() + days * DAY).toISOString(),
    };
  };
  const sign = <T extends Targets | Snapshot | Timestamp>(role: OnlineRole, signed: T) => {
    const metadata = new Metadata(signed);
    const key = keys[role];
    metadata.sign(
      (data) =>
        new Signature({
          keyID: key.id,
          sig: Crypto.sign(null, data, key.privateKey).toString("hex"),
        }),
    );
    root.verifyDelegate(role, metadata);
    return Buffer.from(JSON.stringify(metadata.toJSON()));
  };
  const nextTargets = sign(
    "targets",
    new Targets({
      ...fields(targets.signed, 30),
      targets: retained,
      unrecognizedFields: targets.signed.unrecognizedFields,
    }),
  );
  const meta = (value: Buffer, version: number) =>
    new MetaFile({ version, length: value.length, hashes: { sha256: hash(value) } });
  const nextSnapshot = sign(
    "snapshot",
    new Snapshot({
      ...fields(snapshot.signed, 7),
      meta: { "targets.json": meta(nextTargets, targets.signed.version + 1) },
    }),
  );
  const nextTimestamp = sign(
    "timestamp",
    new Timestamp({
      ...fields(timestamp.signed, 1),
      snapshotMeta: meta(nextSnapshot, snapshot.signed.version + 1),
    }),
  );
  return new Map([
    ["root.json", rootBytes],
    ["targets.json", nextTargets],
    ["snapshot.json", nextSnapshot],
    ["timestamp.json", nextTimestamp],
    [`${targets.signed.version + 1}.targets.json`, nextTargets],
    [`${snapshot.signed.version + 1}.snapshot.json`, nextSnapshot],
  ]);
}

export async function renewPublishedMetadata(
  pool: Pool,
  storage: S3Client,
  bucket: string,
  configuration: OnlineSigningConfig,
  now = new Date(),
): Promise<number> {
  const directory = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-metadata-renewal-"));
  try {
    return await publishTufMetadata(
      pool,
      storage,
      bucket,
      directory,
      undefined,
      undefined,
      async (client) => {
        const current = await client.query<{ name: string; bytes: Buffer }>(
          "SELECT name, bytes FROM exchange_tuf_metadata ORDER BY name",
        );
        const releases = await client.query<RenewalRelease>(
          "SELECT namespace, name, version, digest, bytes, status FROM exchange_versions WHERE status IN ('approved', 'revoked') FOR SHARE",
        );
        const files = renewedMetadata(
          new Map(current.rows.map((row) => [row.name, row.bytes])),
          releases.rows,
          configuration,
          now,
        );
        if (!files) return false;
        for (const [name, value] of files)
          await FS.writeFile(Path.join(directory, name), value, { flag: "wx", mode: 0o600 });
        return true;
      },
    );
  } finally {
    await FS.rm(directory, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const file = process.env.EXCHANGE_ONLINE_SIGNING_KEY_FILE;
  const origin = process.env.EXCHANGE_ORIGIN;
  const bucket = process.env.S3_BUCKET;
  if (!file || !origin || !bucket)
    throw new Error("Set EXCHANGE_ONLINE_SIGNING_KEY_FILE, EXCHANGE_ORIGIN and S3_BUCKET.");
  const configuration = await readOnlineSigningConfig(file, origin);
  const pool = createPool();
  try {
    const count = await renewPublishedMetadata(pool, createStorage(), bucket, configuration);
    process.stdout.write(
      count
        ? "Published renewed metadata for existing reviewed versions.\n"
        : "Published metadata is already fresh; no changes made.\n",
    );
  } finally {
    await pool.end();
  }
}
