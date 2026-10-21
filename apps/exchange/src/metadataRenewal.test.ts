import * as Crypto from "node:crypto";
import * as FS from "node:fs/promises";
import * as OS from "node:os";
import * as Path from "node:path";
import { Readable } from "node:stream";
import type { Pool } from "pg";
import type { S3Client } from "@aws-sdk/client-s3";
import { afterEach, expect, it, vi } from "vitest";
import {
  createSigningBackup,
  lockBackup,
  signRelease,
} from "../frontend/src/lib/releaseSigning.ts";
import { exportOnlineSigning } from "./exportOnlineSigning.ts";
import {
  onlineSigningConfig,
  parseOnlineSigningConfig,
  readOnlineSigningConfig,
  renewedMetadata,
  renewPublishedMetadata,
  type RenewalRelease,
} from "./metadataRenewal.ts";

const origin = "https://exchange.example";
const DAY = 86_400_000;
const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const directory of directories.splice(0))
    await FS.rm(directory, { recursive: true, force: true });
});
async function temporaryDirectory() {
  const directory = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-renewal-test-"));
  directories.push(directory);
  return directory;
}
async function fixture() {
  const backup = await createSigningBackup(origin);
  const configuration = onlineSigningConfig(backup);
  const archive = Buffer.from("previously reviewed immutable package");
  const digest = Crypto.createHash("sha256").update(archive).digest("hex");
  const path = "extensions/maker/tool/1.0.0.tabsext";
  const release: RenewalRelease = {
    namespace: "maker",
    name: "tool",
    version: "1.0.0",
    digest,
    bytes: archive.length,
    status: "approved",
  };
  const files = await signRelease(
    {
      origin,
      root: backup.root,
      pin: configuration.rootSha256,
      versions: { root: 1, targets: 0, snapshot: 0, timestamp: 0 },
      targets: { [path]: { length: archive.length, hashes: { sha256: digest } } },
    },
    backup,
  );
  const metadata = new Map<string, Buffer>(
    Object.entries(files).map(([name, value]) => [name, Buffer.from(value)]),
  );
  const now = new Date(Date.now() + 2 * DAY);
  return { backup, configuration, archive, path, release, metadata, now };
}

function database(subject: Awaited<ReturnType<typeof fixture>>, releases = [subject.release]) {
  const queries: string[] = [];
  const stored = new Map(subject.metadata);
  let transaction = new Map(stored);
  const client = {
    async query(sql: string, parameters: readonly unknown[] = []) {
      queries.push(sql);
      if (sql === "BEGIN") transaction = new Map(stored);
      if (sql === "COMMIT") {
        stored.clear();
        for (const [key, value] of transaction) stored.set(key, value);
      }
      if (sql.startsWith("SELECT name, bytes FROM exchange_tuf_metadata"))
        return { rows: Array.from(transaction, ([name, bytes]) => ({ name, bytes })) };
      if (sql.startsWith("SELECT namespace, name, version, digest, bytes, status"))
        return {
          rows: releases.map((release) => ({
            ...release,
            object_key: `quarantine/${release.namespace}/${release.name}/${release.version}/${release.digest}.tabsext`,
          })),
        };
      if (sql.includes("INSERT INTO exchange_tuf_metadata"))
        transaction.set(parameters[0] as string, parameters[1] as Buffer);
      return { rows: [], rowCount: 0 };
    },
    release: vi.fn(),
  };
  const pool = { connect: async () => client } as unknown as Pool;
  const storage = { send: vi.fn(async () => ({ Body: Readable.from([subject.archive]) })) };
  return {
    pool,
    storage: storage as unknown as S3Client,
    send: storage.send,
    queries,
    stored,
    client,
  };
}

it("exports only separate non-root role keys bound to the existing registry and public root", async () => {
  const subject = await fixture();
  expect(Object.keys(subject.configuration.keys)).toEqual(["targets", "snapshot", "timestamp"]);
  expect(JSON.stringify(subject.configuration)).not.toContain(subject.backup.keys.root.privateKey);
  expect(() =>
    onlineSigningConfig({
      ...subject.backup,
      keys: { ...subject.backup.keys, targets: subject.backup.keys.root },
    }),
  ).toThrow("root private key");
  expect(() =>
    parseOnlineSigningConfig({ ...subject.configuration, root: subject.backup.keys.root }, origin),
  ).toThrow("Root private keys");
  expect(() => parseOnlineSigningConfig(subject.configuration, "https://other.example")).toThrow();
});

it("renews an expired publication through the real verifier, preserving approval and immutable digests", async () => {
  const subject = await fixture();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(subject.now);
  const db = database(subject, [subject.release, { ...subject.release, version: "2.0.0" }]);
  expect(
    await renewPublishedMetadata(db.pool, db.storage, "test", subject.configuration, subject.now),
  ).toBe(6);
  const targets = JSON.parse(db.stored.get("targets.json")!.toString()).signed;
  expect(targets.version).toBe(2);
  expect(Object.keys(targets.targets)).toEqual([subject.path]);
  expect(targets.targets[subject.path].hashes.sha256).toBe(subject.release.digest);
  expect(db.stored.get("root.json")).toEqual(subject.metadata.get("root.json"));
  const timestamp = JSON.parse(db.stored.get("timestamp.json")!.toString()).signed;
  expect(Date.parse(timestamp.expires)).toBe(subject.now.getTime() + DAY);
  expect(db.queries.indexOf("SELECT pg_advisory_xact_lock(1261492744)")).toBeLessThan(
    db.queries.findIndex((sql) => sql.startsWith("SELECT name, bytes")),
  );
  expect(db.queries.at(-1)).toBe("COMMIT");
  expect(db.send).toHaveBeenCalledOnce();
  expect(db.client.release).toHaveBeenCalledOnce();
});

it("skips fresh metadata without object downloads, writes or repeated version bumps", async () => {
  const subject = await fixture();
  const db = database(subject);
  expect(await renewPublishedMetadata(db.pool, db.storage, "test", subject.configuration)).toBe(0);
  expect(db.send).not.toHaveBeenCalled();
  expect(db.queries.some((sql) => sql.includes("INSERT"))).toBe(false);
  expect(db.stored.get("timestamp.json")).toEqual(subject.metadata.get("timestamp.json"));
});

it("publishes explicit revocations promptly even when the timestamp is still fresh", async () => {
  const subject = await fixture();
  const db = database(subject, [{ ...subject.release, status: "revoked" }]);
  await renewPublishedMetadata(db.pool, db.storage, "test", subject.configuration);
  expect(JSON.parse(db.stored.get("targets.json")!.toString()).signed.targets).toEqual({});
  expect(db.send).not.toHaveBeenCalled();
});

it("does not erase reviewed versions on incomplete or inconsistent database state", async () => {
  const subject = await fixture();
  for (const releases of [[], [{ ...subject.release, digest: "b".repeat(64) }]]) {
    expect(() =>
      renewedMetadata(subject.metadata, releases, subject.configuration, subject.now),
    ).toThrow("immutable reviewed package");
  }
});

it("rejects changed root pins, forged metadata and root private keys disguised as an online role", async () => {
  const subject = await fixture();
  expect(() =>
    renewedMetadata(
      subject.metadata,
      [subject.release],
      { ...subject.configuration, rootSha256: "b".repeat(64) },
      subject.now,
    ),
  ).toThrow("signer pin");
  const forged = new Map(subject.metadata);
  const targets = JSON.parse(forged.get("targets.json")!.toString());
  targets.signed.version++;
  forged.set("targets.json", Buffer.from(JSON.stringify(targets)));
  expect(() =>
    renewedMetadata(forged, [subject.release], subject.configuration, subject.now),
  ).toThrow();
  const disguised = {
    ...subject.configuration,
    keys: { ...subject.configuration.keys, targets: subject.backup.keys.root },
  };
  expect(() =>
    renewedMetadata(subject.metadata, [subject.release], disguised, subject.now),
  ).toThrow("root private key");
});

it("requires operator root rotation instead of re-signing an expired root", async () => {
  const subject = await fixture();
  expect(() =>
    renewedMetadata(
      subject.metadata,
      [subject.release],
      subject.configuration,
      new Date(Date.now() + 370 * DAY),
    ),
  ).toThrow("root rotation");
});

it("rolls back a failed renewal without publishing partially updated metadata", async () => {
  const subject = await fixture();
  const db = database(subject);
  db.send.mockImplementation(async () => {
    throw new Error("storage unavailable");
  });
  await expect(
    renewPublishedMetadata(db.pool, db.storage, "test", subject.configuration, subject.now),
  ).rejects.toThrow("unreadable");
  expect(db.queries.at(-1)).toBe("ROLLBACK");
  expect(db.queries.some((sql) => sql.includes("INSERT INTO exchange_tuf_metadata"))).toBe(false);
  expect(db.stored).toEqual(subject.metadata);
});

it("exports from an encrypted backup into a private new file without overwriting an existing secret", async () => {
  const subject = await fixture();
  const directory = await temporaryDirectory();
  const backupFile = Path.join(directory, "backup.json"),
    outputFile = Path.join(directory, "online.json");
  await FS.writeFile(backupFile, await lockBackup(subject.backup, "correct backup password"));
  await expect(
    exportOnlineSigning(backupFile, outputFile, origin, "wrong password"),
  ).rejects.toThrow("Could not unlock");
  await exportOnlineSigning(backupFile, outputFile, origin, "correct backup password");
  expect(await readOnlineSigningConfig(outputFile, origin)).toEqual(subject.configuration);
  expect(await FS.readFile(outputFile, "utf8")).not.toContain(subject.backup.keys.root.privateKey);
  await expect(
    exportOnlineSigning(backupFile, outputFile, origin, "correct backup password"),
  ).rejects.toThrow();
  if (process.platform !== "win32") {
    await FS.chmod(outputFile, 0o644);
    await expect(readOnlineSigningConfig(outputFile, origin)).rejects.toThrow(
      "private regular file",
    );
  }
});

it("does not include malformed private file excerpts in error messages", async () => {
  const file = Path.join(await temporaryDirectory(), "bad.json");
  await FS.writeFile(file, "private-key-sentinel THIS IS NOT JSON", { mode: 0o600 });
  await expect(readOnlineSigningConfig(file, origin)).rejects.toThrow(
    /^The online signing key file could not be parsed\.$/,
  );
});
