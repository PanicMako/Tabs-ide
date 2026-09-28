import * as Crypto from "node:crypto";
import * as FS from "node:fs/promises";
import * as OS from "node:os";
import * as Path from "node:path";
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
import type { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { publishedHeads } from "./publishedHeads.ts";
import { publishTufMetadata, verifyApprovedTargets } from "./tufPublish.ts";

const temporaryDirectories: string[] = [];
const targetPath = "extensions/acme/dashboard/1.0.0.tabsext";
const archive = Buffer.from("approved extension package");
const digest = Crypto.createHash("sha256").update(archive).digest("hex");

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await FS.rm(directory, { recursive: true, force: true });
  }
});

async function fixture() {
  const directory = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-tuf-publish-test-"));
  temporaryDirectories.push(directory);
  const { privateKey, publicKey } = Crypto.generateKeyPairSync("ed25519");
  const publicBytes = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const keyID = Crypto.createHash("sha256").update(publicBytes).digest("hex");
  const key = new Key({
    keyID,
    keyType: "ed25519",
    scheme: "ed25519",
    keyVal: { public: publicBytes.toString("hex") },
  });
  const sign = <T extends Root | Targets | Snapshot | Timestamp>(signed: T): Buffer => {
    const metadata = new Metadata(signed);
    metadata.sign(
      (bytes) =>
        new Signature({ keyID, sig: Crypto.sign(null, bytes, privateKey).toString("hex") }),
    );
    return Buffer.from(JSON.stringify(metadata.toJSON()));
  };
  const common = { specVersion: "1.0.0", expires: "2030-01-01T00:00:00Z" };
  const root = new Root({ ...common, version: 1, consistentSnapshot: false });
  for (const role of ["root", "timestamp", "snapshot", "targets"]) root.addKey(key, role);
  const rootBytes = sign(root);
  await FS.writeFile(Path.join(directory, "root.json"), rootBytes);
  const publishStage = async (version: number, includeTarget: boolean) => {
    const fields = { ...common, version };
    const targets = sign(
      new Targets({
        ...fields,
        targets: includeTarget
          ? {
              [targetPath]: new TargetFile({
                path: targetPath,
                length: archive.length,
                hashes: { sha256: digest },
              }),
            }
          : {},
      }),
    );
    const snapshot = sign(
      new Snapshot({
        ...fields,
        meta: {
          "targets.json": new MetaFile({
            version,
            length: targets.length,
            hashes: { sha256: Crypto.createHash("sha256").update(targets).digest("hex") },
          }),
        },
      }),
    );
    const timestamp = sign(
      new Timestamp({
        ...fields,
        snapshotMeta: new MetaFile({
          version,
          length: snapshot.length,
          hashes: { sha256: Crypto.createHash("sha256").update(snapshot).digest("hex") },
        }),
      }),
    );
    await Promise.all([
      FS.writeFile(Path.join(directory, "targets.json"), targets),
      FS.writeFile(Path.join(directory, "snapshot.json"), snapshot),
      FS.writeFile(Path.join(directory, "timestamp.json"), timestamp),
    ]);
  };
  await publishStage(1, true);
  const stored = new Map<string, Buffer>();
  const published: unknown[][] = [];
  const heads: unknown[][] = [];
  let releaseStatus = "approved";
  const operations: string[] = [];
  const client = {
    async query(sql: string, parameters?: unknown[]) {
      operations.push(sql);
      if (sql.startsWith("SELECT name, bytes FROM exchange_tuf_metadata")) {
        return {
          rows: [...stored].map(([name, bytes]) => ({ name, bytes })),
        };
      }
      if (sql.startsWith("SELECT namespace, name, version, digest, bytes, status")) {
        return {
          rows: [
            {
              namespace: "acme",
              name: "dashboard",
              version: "1.0.0",
              digest,
              bytes: archive.length,
              status: releaseStatus,
            },
          ],
        };
      }
      if (sql.startsWith("INSERT INTO exchange_tuf_metadata")) {
        stored.set(parameters![0] as string, parameters![1] as Buffer);
      }
      if (sql.startsWith("DELETE FROM exchange_published_targets")) {
        published.length = 0;
        heads.length = 0;
      }
      if (sql.startsWith("INSERT INTO exchange_published_targets")) {
        published.push(parameters ?? []);
      }
      if (sql.startsWith("INSERT INTO exchange_published_heads")) {
        heads.push(parameters ?? []);
      }
      return { rows: [] };
    },
    release() {},
  };
  const pool = {
    async connect() {
      return client;
    },
  } as unknown as Pool;
  return {
    directory,
    rootBytes,
    pool,
    stored,
    published,
    heads,
    operations,
    publishStage,
    revoke: () => {
      releaseStatus = "revoked";
    },
  };
}

describe("offline TUF publication gate", () => {
  it("selects the highest semantic version per signed extension identity", () => {
    const target = (name: string, version: string) => ({
      namespace: "acme",
      name,
      version,
      digest,
      bytes: archive.length,
    });
    expect(
      publishedHeads([
        target("dashboard", "1.1.0"),
        target("dashboard", "1.2.0-rc.1"),
        target("dashboard", "1.0.0"),
        target("dashboard", "1.2.0"),
        target("reader", "0.3.0"),
      ]).map((entry) => `${entry.name}@${entry.version}`),
    ).toEqual(["dashboard@1.2.0", "reader@0.3.0"]);
  });

  it("rejects signed targets without exact approval", () => {
    const bytes = Buffer.from(
      JSON.stringify({
        signed: {
          _type: "targets",
          targets: { [targetPath]: { length: archive.length, hashes: { sha256: digest } } },
        },
      }),
    );
    expect(() => verifyApprovedTargets(bytes, [])).toThrow(/not an exact approved package/);
  });

  it("publishes signed metadata, removes revoked targets, and rejects rollback", async () => {
    const subject = await fixture();
    const bootstrap = Crypto.createHash("sha256").update(subject.rootBytes).digest("hex");
    await expect(
      publishTufMetadata(subject.pool, subject.directory, "f".repeat(64)),
    ).rejects.toThrow(/root SHA-256 pin/);
    expect(subject.stored.size).toBe(0);
    expect(await publishTufMetadata(subject.pool, subject.directory, bootstrap)).toBe(4);
    expect(subject.stored.has("timestamp.json")).toBe(true);
    expect(subject.published).toEqual([["acme", "dashboard", "1.0.0", digest, archive.length]]);
    expect(subject.heads).toEqual([["acme", "dashboard", "1.0.0"]]);
    subject.revoke();
    await subject.publishStage(2, false);
    expect(await publishTufMetadata(subject.pool, subject.directory)).toBe(4);
    expect(subject.published).toEqual([]);
    expect(subject.heads).toEqual([]);
    await subject.publishStage(1, true);
    await expect(publishTufMetadata(subject.pool, subject.directory)).rejects.toThrow();
    expect(subject.operations.filter((sql) => sql === "COMMIT")).toHaveLength(2);
    expect(subject.operations.filter((sql) => sql === "ROLLBACK")).toHaveLength(2);
    expect(
      subject.operations.filter((sql) => sql.includes("pg_notify('exchange_signed_metadata'")),
    ).toHaveLength(2);
  });
});
