import * as Crypto from "node:crypto";
import * as FS from "node:fs/promises";
import * as Path from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import {
  Key,
  MetaFile,
  Metadata,
  Root,
  Signature,
  Snapshot,
  TargetFile,
  Targets,
  Timestamp,
} from "@tufjs/models";
import { Pool } from "pg";
import { fixtureEndpoint, requireBrowserFixture } from "./browserFixture.ts";
import { publishTufMetadata } from "./tufPublish.ts";

// One-shot bootstrap for an isolated browser acceptance registry, never production signing.
async function main() {
  requireBrowserFixture(process.env);
  const directory = Path.resolve(process.argv[2] ?? "");
  const fixture = JSON.parse(await FS.readFile(Path.join(directory, "fixture.json"), "utf8"));
  const database = fixtureEndpoint(fixture.databaseUrl, ["postgres:", "postgresql:"]);
  const storageOrigin = fixtureEndpoint(fixture.s3Origin, ["http:"]);
  if (
    fixture.testOnly !== true ||
    !/^\/tabs_exchange_browser_[a-f0-9]{16}$/.test(database.pathname) ||
    !/^tabs-exchange-browser-[a-f0-9]{16}$/.test(fixture.bucket)
  )
    throw new Error("Only an isolated browser fixture may be signed.");
  const pool = new Pool({ connectionString: database.toString() });
  const storage = new S3Client({
    region: "us-east-1",
    endpoint: storageOrigin.origin,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? "test",
      secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY ?? "test",
    },
  });
  try {
    const existing = await pool.query("SELECT count(*)::int AS count FROM exchange_tuf_metadata");
    if (existing.rows[0].count !== 0)
      throw new Error("Fixture already has signing metadata; do not replace its trust root.");
    const releases = await pool.query(
      "SELECT namespace, name, version, digest, bytes FROM exchange_versions WHERE status = 'approved'",
    );
    if (!releases.rows.length) throw new Error("Approve an exact digest before signing.");
    const { privateKey, publicKey } = Crypto.generateKeyPairSync("ed25519");
    const publicBytes = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    const hash = (bytes: Buffer) => Crypto.createHash("sha256").update(bytes).digest("hex");
    const keyID = hash(publicBytes);
    const key = new Key({
      keyID,
      keyType: "ed25519",
      scheme: "ed25519",
      keyVal: { public: publicBytes.toString("hex") },
    });
    const sign = (signed: Root | Targets | Snapshot | Timestamp) => {
      const metadata = new Metadata(signed);
      metadata.sign(
        (bytes) =>
          new Signature({ keyID, sig: Crypto.sign(null, bytes, privateKey).toString("hex") }),
      );
      return Buffer.from(JSON.stringify(metadata.toJSON()));
    };
    const common = {
      specVersion: "1.0.0",
      version: 1,
      expires: new Date(Date.now() + 86400000).toISOString(),
    };
    const root = new Root({ ...common, consistentSnapshot: false });
    for (const role of ["root", "timestamp", "snapshot", "targets"]) root.addKey(key, role);
    const targets: Record<string, TargetFile> = {};
    for (const release of releases.rows) {
      const target = `extensions/${release.namespace}/${release.name}/${release.version}.tabsext`;
      targets[target] = new TargetFile({
        path: target,
        length: release.bytes,
        hashes: { sha256: release.digest },
      });
    }
    const rootBytes = sign(root);
    const targetsBytes = sign(new Targets({ ...common, targets }));
    const snapshotBytes = sign(
      new Snapshot({
        ...common,
        meta: {
          "targets.json": new MetaFile({
            version: 1,
            length: targetsBytes.length,
            hashes: { sha256: hash(targetsBytes) },
          }),
        },
      }),
    );
    const timestampBytes = sign(
      new Timestamp({
        ...common,
        snapshotMeta: new MetaFile({
          version: 1,
          length: snapshotBytes.length,
          hashes: { sha256: hash(snapshotBytes) },
        }),
      }),
    );
    const stage = await FS.mkdtemp(Path.join(directory, "signing-"));
    for (const [name, bytes] of [
      ["root.json", rootBytes],
      ["targets.json", targetsBytes],
      ["snapshot.json", snapshotBytes],
      ["timestamp.json", timestampBytes],
    ] as const)
      await FS.writeFile(Path.join(stage, name), bytes);
    const count = await publishTufMetadata(pool, storage, fixture.bucket, stage, hash(rootBytes));
    console.log(
      JSON.stringify({
        testOnly: true,
        metadataRoles: count,
        releases: releases.rows.length,
        stage,
        rootSha256: hash(rootBytes),
        expires: common.expires,
      }),
    );
  } finally {
    await pool.end();
    storage.destroy();
  }
}
if (import.meta.main)
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Fixture signing failed.");
    process.exitCode = 1;
  });
