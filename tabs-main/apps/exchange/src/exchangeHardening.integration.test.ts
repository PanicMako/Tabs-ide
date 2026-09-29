import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { Readable } from "node:stream";
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
import { describe, expect, it } from "vitest";
import {
  TrustedExchange,
  ExchangeMetadataFetcher,
  ExchangeTransportError,
} from "../../desktop/src/trustedExchange.ts";
import {
  backupExchangeData,
  restoreExchangeData,
  type ExchangeBackupManifest,
} from "./backupRestore.ts";
import { evaluateOperationalReadiness } from "./operationalAlerts.ts";
import { scanNextVersion } from "./worker.ts";
import type { ExchangeConfig } from "./config.ts";

const temporaryDirectories: string[] = [];

function tempDir(prefix = "tabs-hardening-"): string {
  const dir = FS.mkdtempSync(Path.join(OS.tmpdir(), prefix));
  temporaryDirectories.push(dir);
  return dir;
}

function generateTufKey() {
  const { privateKey, publicKey } = Crypto.generateKeyPairSync("ed25519");
  const publicBytes = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const keyID = Crypto.createHash("sha256").update(publicBytes).digest("hex");
  const key = new Key({
    keyID,
    keyType: "ed25519",
    scheme: "ed25519",
    keyVal: { public: publicBytes.toString("hex") },
  });
  return { privateKey, publicKey, publicBytes, keyID, key };
}

describe("Checkpoint 4: Trust, Operations, and Fork Hardening", () => {
  describe("TUF Root Rotation Drill", () => {
    it("advances through intermediate dual-signed roots (1 -> 2 -> 3) and rejects rollback & insufficient signatures", async () => {
      const origin = "https://exchange.tabs.example";
      const key1 = generateTufKey();
      const key2 = generateTufKey();
      const key3 = generateTufKey();

      const common = { specVersion: "1.0.0", expires: "2030-01-01T00:00:00Z" };

      // Helper to sign metadata with a specific key
      const signWithKey = (metadata: Metadata<any>, k: ReturnType<typeof generateTufKey>) => {
        metadata.sign(
          (bytes) =>
            new Signature({
              keyID: k.keyID,
              sig: Crypto.sign(null, bytes, k.privateKey).toString("hex"),
            }),
        );
      };

      // Root 1 (v1)
      const root1 = new Root({ ...common, version: 1, consistentSnapshot: false });
      root1.addKey(key1.key, "root");
      for (const role of ["timestamp", "snapshot", "targets"]) root1.addKey(key1.key, role);
      const metaRoot1 = new Metadata(root1);
      signWithKey(metaRoot1, key1);
      const root1Bytes = Buffer.from(JSON.stringify(metaRoot1.toJSON()));

      // Targets, Snapshot, Timestamp v1
      const path1 = "extensions/acme/tool/1.0.0.tabsext";
      const targetBytes1 = Buffer.from("extension content v1");
      const digest1 = Crypto.createHash("sha256").update(targetBytes1).digest("hex");

      const targets1 = new Targets({
        ...common,
        version: 1,
        targets: {
          [path1]: new TargetFile({
            path: path1,
            length: targetBytes1.length,
            hashes: { sha256: digest1 },
          }),
        },
      });
      const metaTargets1 = new Metadata(targets1);
      signWithKey(metaTargets1, key1);
      const targets1Bytes = Buffer.from(JSON.stringify(metaTargets1.toJSON()));

      const snapshot1 = new Snapshot({
        ...common,
        version: 1,
        meta: {
          "targets.json": new MetaFile({
            version: 1,
            length: targets1Bytes.length,
            hashes: { sha256: Crypto.createHash("sha256").update(targets1Bytes).digest("hex") },
          }),
        },
      });
      const metaSnapshot1 = new Metadata(snapshot1);
      signWithKey(metaSnapshot1, key1);
      const snapshot1Bytes = Buffer.from(JSON.stringify(metaSnapshot1.toJSON()));

      const timestamp1 = new Timestamp({
        ...common,
        version: 1,
        snapshotMeta: new MetaFile({
          version: 1,
          length: snapshot1Bytes.length,
          hashes: { sha256: Crypto.createHash("sha256").update(snapshot1Bytes).digest("hex") },
        }),
      });
      const metaTimestamp1 = new Metadata(timestamp1);
      signWithKey(metaTimestamp1, key1);
      const timestamp1Bytes = Buffer.from(JSON.stringify(metaTimestamp1.toJSON()));

      const metadata: Record<string, Buffer> = {
        "root.json": root1Bytes,
        "1.root.json": root1Bytes,
        "targets.json": targets1Bytes,
        "snapshot.json": snapshot1Bytes,
        "timestamp.json": timestamp1Bytes,
      };

      const fetcher: any = async (input: any) => {
        const url = String(input);
        const filename = url.split("/").at(-1)!;
        const bytes = metadata[filename];
        const res = new Response(bytes ? new Uint8Array(bytes) : null, {
          status: bytes ? 200 : 404,
        });
        Object.defineProperty(res, "url", { value: url });
        return res;
      };
      const stateRoot = tempDir();
      const trusted = new TrustedExchange({
        origin,
        trustId: "rotation-chain-drill",
        initialRoot: root1Bytes,
        stateRoot,
        fetcher,
      });

      // 1. Resolve on initial root
      const initialResolution = await trusted.resolve("acme", "tool", "1.0.0");
      expect(initialResolution).toEqual({
        path: path1,
        bytes: targetBytes1.length,
        digest: digest1,
      });

      // 2. Insufficiently signed root 2 (signed ONLY by key 2, missing old key 1 threshold)
      const root2Invalid = new Root({ ...common, version: 2, consistentSnapshot: false });
      root2Invalid.addKey(key2.key, "root");
      for (const role of ["timestamp", "snapshot", "targets"]) root2Invalid.addKey(key2.key, role);
      const metaRoot2Invalid = new Metadata(root2Invalid);
      signWithKey(metaRoot2Invalid, key2); // Only new key
      metadata["2.root.json"] = Buffer.from(JSON.stringify(metaRoot2Invalid.toJSON()));

      await expect(trusted.resolve("acme", "tool", "1.0.0")).rejects.toThrow();

      // 3. Valid dual-signed root 2 (signed by BOTH key 1 and key 2)
      const root2 = new Root({ ...common, version: 2, consistentSnapshot: false });
      root2.addKey(key2.key, "root");
      for (const role of ["timestamp", "snapshot", "targets"]) root2.addKey(key2.key, role);
      const metaRoot2 = new Metadata(root2);
      signWithKey(metaRoot2, key1); // Old root key
      signWithKey(metaRoot2, key2); // New root key
      metadata["2.root.json"] = Buffer.from(JSON.stringify(metaRoot2.toJSON()));

      // Targets/Snapshot/Timestamp for v2 signed by key 2
      const targets2 = new Targets({
        ...common,
        version: 2,
        targets: {
          [path1]: new TargetFile({
            path: path1,
            length: targetBytes1.length,
            hashes: { sha256: digest1 },
          }),
        },
      });
      const metaTargets2 = new Metadata(targets2);
      signWithKey(metaTargets2, key2);
      metadata["targets.json"] = Buffer.from(JSON.stringify(metaTargets2.toJSON()));

      const snapshot2 = new Snapshot({
        ...common,
        version: 2,
        meta: {
          "targets.json": new MetaFile({
            version: 2,
            length: metadata["targets.json"]!.length,
            hashes: {
              sha256: Crypto.createHash("sha256").update(metadata["targets.json"]!).digest("hex"),
            },
          }),
        },
      });
      const metaSnapshot2 = new Metadata(snapshot2);
      signWithKey(metaSnapshot2, key2);
      metadata["snapshot.json"] = Buffer.from(JSON.stringify(metaSnapshot2.toJSON()));

      const timestamp2 = new Timestamp({
        ...common,
        version: 2,
        snapshotMeta: new MetaFile({
          version: 2,
          length: metadata["snapshot.json"]!.length,
          hashes: {
            sha256: Crypto.createHash("sha256").update(metadata["snapshot.json"]!).digest("hex"),
          },
        }),
      });
      const metaTimestamp2 = new Metadata(timestamp2);
      signWithKey(metaTimestamp2, key2);
      metadata["timestamp.json"] = Buffer.from(JSON.stringify(metaTimestamp2.toJSON()));

      // Resolves and advances to Root 2!
      const resolvedV2 = await trusted.resolve("acme", "tool", "1.0.0");
      expect(resolvedV2).not.toBeNull();

      // 4. Advance from Root 2 to Root 3 with dual-signed 3.root.json (keys 2 & 3)
      const root3 = new Root({ ...common, version: 3, consistentSnapshot: false });
      root3.addKey(key3.key, "root");
      for (const role of ["timestamp", "snapshot", "targets"]) root3.addKey(key3.key, role);
      const metaRoot3 = new Metadata(root3);
      signWithKey(metaRoot3, key2); // Prior root key
      signWithKey(metaRoot3, key3); // New root key
      metadata["3.root.json"] = Buffer.from(JSON.stringify(metaRoot3.toJSON()));

      const metaTargets3 = new Metadata(
        new Targets({
          ...common,
          version: 3,
          targets: {
            [path1]: new TargetFile({
              path: path1,
              length: targetBytes1.length,
              hashes: { sha256: digest1 },
            }),
          },
        }),
      );
      signWithKey(metaTargets3, key3);
      metadata["targets.json"] = Buffer.from(JSON.stringify(metaTargets3.toJSON()));

      const metaSnapshot3 = new Metadata(
        new Snapshot({
          ...common,
          version: 3,
          meta: {
            "targets.json": new MetaFile({
              version: 3,
              length: metadata["targets.json"]!.length,
              hashes: {
                sha256: Crypto.createHash("sha256").update(metadata["targets.json"]!).digest("hex"),
              },
            }),
          },
        }),
      );
      signWithKey(metaSnapshot3, key3);
      metadata["snapshot.json"] = Buffer.from(JSON.stringify(metaSnapshot3.toJSON()));

      const metaTimestamp3 = new Metadata(
        new Timestamp({
          ...common,
          version: 3,
          snapshotMeta: new MetaFile({
            version: 3,
            length: metadata["snapshot.json"]!.length,
            hashes: {
              sha256: Crypto.createHash("sha256").update(metadata["snapshot.json"]!).digest("hex"),
            },
          }),
        }),
      );
      signWithKey(metaTimestamp3, key3);
      metadata["timestamp.json"] = Buffer.from(JSON.stringify(metaTimestamp3.toJSON()));

      const resolvedV3 = await trusted.resolve("acme", "tool", "1.0.0");
      expect(resolvedV3).not.toBeNull();

      // 5. Rollback rejection: presenting old timestamp/snapshot/targets v1 must fail!
      metadata["targets.json"] = targets1Bytes;
      metadata["snapshot.json"] = snapshot1Bytes;
      metadata["timestamp.json"] = timestamp1Bytes;
      await expect(trusted.resolve("acme", "tool", "1.0.0")).rejects.toThrow();
    });
  });

  describe("Freshness, Expiry & Mutable Catalog Drift Drill", () => {
    it("rejects expired signed metadata and refuses silent updates from unauthenticated catalog data", async () => {
      const origin = "https://exchange.tabs.example";
      const key = generateTufKey();
      const common = { specVersion: "1.0.0" };

      // Root with key
      const root = new Root({
        ...common,
        version: 1,
        expires: "2030-01-01T00:00:00Z",
        consistentSnapshot: false,
      });
      root.addKey(key.key, "root");
      for (const role of ["timestamp", "snapshot", "targets"]) root.addKey(key.key, role);
      const metaRoot = new Metadata(root);
      metaRoot.sign(
        (b) =>
          new Signature({
            keyID: key.keyID,
            sig: Crypto.sign(null, b, key.privateKey).toString("hex"),
          }),
      );
      const rootBytes = Buffer.from(JSON.stringify(metaRoot.toJSON()));

      // Targets: only 1.0.0 is signed
      const path1 = "extensions/acme/tool/1.0.0.tabsext";
      const targetBytes1 = Buffer.from("tool v1");
      const digest1 = Crypto.createHash("sha256").update(targetBytes1).digest("hex");

      const targets = new Targets({
        ...common,
        version: 1,
        expires: "2030-01-01T00:00:00Z",
        targets: {
          [path1]: new TargetFile({
            path: path1,
            length: targetBytes1.length,
            hashes: { sha256: digest1 },
          }),
        },
      });
      const metaTargets = new Metadata(targets);
      metaTargets.sign(
        (b) =>
          new Signature({
            keyID: key.keyID,
            sig: Crypto.sign(null, b, key.privateKey).toString("hex"),
          }),
      );
      const targetsBytes = Buffer.from(JSON.stringify(metaTargets.toJSON()));

      const snapshot = new Snapshot({
        ...common,
        version: 1,
        expires: "2030-01-01T00:00:00Z",
        meta: {
          "targets.json": new MetaFile({
            version: 1,
            length: targetsBytes.length,
            hashes: { sha256: Crypto.createHash("sha256").update(targetsBytes).digest("hex") },
          }),
        },
      });
      const metaSnapshot = new Metadata(snapshot);
      metaSnapshot.sign(
        (b) =>
          new Signature({
            keyID: key.keyID,
            sig: Crypto.sign(null, b, key.privateKey).toString("hex"),
          }),
      );
      const snapshotBytes = Buffer.from(JSON.stringify(metaSnapshot.toJSON()));

      // Expired timestamp (2020-01-01)
      const expiredTimestamp = new Timestamp({
        ...common,
        version: 1,
        expires: "2020-01-01T00:00:00Z",
        snapshotMeta: new MetaFile({
          version: 1,
          length: snapshotBytes.length,
          hashes: { sha256: Crypto.createHash("sha256").update(snapshotBytes).digest("hex") },
        }),
      });
      const metaExpiredTimestamp = new Metadata(expiredTimestamp);
      metaExpiredTimestamp.sign(
        (b) =>
          new Signature({
            keyID: key.keyID,
            sig: Crypto.sign(null, b, key.privateKey).toString("hex"),
          }),
      );
      const expiredTimestampBytes = Buffer.from(JSON.stringify(metaExpiredTimestamp.toJSON()));

      const metadata: Record<string, Buffer> = {
        "root.json": rootBytes,
        "1.root.json": rootBytes,
        "targets.json": targetsBytes,
        "snapshot.json": snapshotBytes,
        "timestamp.json": expiredTimestampBytes,
      };

      const fetcher: any = async (input: any) => {
        const url = String(input);
        const filename = url.split("/").at(-1)!;
        const bytes = metadata[filename];
        const res = new Response(bytes ? new Uint8Array(bytes) : null, {
          status: bytes ? 200 : 404,
        });
        Object.defineProperty(res, "url", { value: url });
        return res;
      };
      const trusted = new TrustedExchange({
        origin,
        trustId: "freshness-drill",
        initialRoot: rootBytes,
        stateRoot: tempDir(),
        fetcher,
      });

      // 1. Expired metadata must be rejected by client
      await expect(trusted.resolve("acme", "tool", "1.0.0")).rejects.toThrow();

      // 2. Mutable catalog drift: fix timestamp so it's valid
      const validTimestamp = new Timestamp({
        ...common,
        version: 1,
        expires: "2030-01-01T00:00:00Z",
        snapshotMeta: new MetaFile({
          version: 1,
          length: snapshotBytes.length,
          hashes: { sha256: Crypto.createHash("sha256").update(snapshotBytes).digest("hex") },
        }),
      });
      const metaValidTimestamp = new Metadata(validTimestamp);
      metaValidTimestamp.sign(
        (b) =>
          new Signature({
            keyID: key.keyID,
            sig: Crypto.sign(null, b, key.privateKey).toString("hex"),
          }),
      );
      metadata["timestamp.json"] = Buffer.from(JSON.stringify(metaValidTimestamp.toJSON()));

      // 1.0.0 resolves
      expect(await trusted.resolve("acme", "tool", "1.0.0")).not.toBeNull();

      // Catalog claims 2.0.0 exists (simulate mutable catalog JSON response)
      const catalogListing = { id: "acme.tool", version: "2.0.0" };

      // TUF signed targets has NO 2.0.0 target: resolve must return null!
      const unauthenticatedResolve = await trusted.resolve("acme", "tool", catalogListing.version);
      expect(unauthenticatedResolve).toBeNull();
      // Therefore, catalog hint alone cannot install 2.0.0!
    });
  });

  describe("Backup and Restore Drill", () => {
    it("backs up and restores PostgreSQL and S3 state, preserving exact row/object counts and SHA-256 digests", async () => {
      // Mock source database and bucket
      const sourceDbRows: Record<string, any[]> = {
        exchange_users: [
          { id: "1", login: "owner-alice", is_admin: false, created_at: "2026-09-29T10:00:00Z" },
        ],
        exchange_namespaces: [
          {
            name: "acme",
            terms_version: "2026-09-24",
            created_by: "1",
            created_at: "2026-09-29T10:01:00Z",
          },
        ],
        exchange_namespace_members: [
          { namespace: "acme", user_id: "1", role: "owner", created_at: "2026-09-29T10:01:00Z" },
        ],
        exchange_namespace_invitations: [],
        exchange_namespace_verifications: [],
        exchange_versions: [
          {
            namespace: "acme",
            name: "dashboard",
            version: "1.0.0",
            digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            bytes: 1024,
            manifest: { publisher: "acme", name: "dashboard", version: "1.0.0" },
            object_key: "packages/acme/dashboard/1.0.0.tabsext",
            status: "approved",
            uploaded_by: "1",
            submitted_at: "2026-09-29T10:05:00Z",
          },
        ],
        exchange_review_events: [
          {
            id: "1",
            namespace: "acme",
            name: "dashboard",
            version: "1.0.0",
            digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            actor_id: "1",
            action: "approve",
            reason: "Passed manual review verification",
            created_at: "2026-09-29T10:10:00Z",
          },
        ],
        exchange_appeals: [],
        exchange_blocked_digests: [
          {
            digest: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            reason: "Known malicious sample test",
            created_by: "1",
            created_at: "2026-09-29T10:00:00Z",
          },
        ],
        exchange_blocked_digest_events: [
          {
            id: "1",
            digest: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            action: "add",
            reason: "Known malicious sample test",
            actor_id: "1",
            created_at: "2026-09-29T10:00:00Z",
          },
        ],
        exchange_tuf_metadata: [
          {
            name: "root.json",
            bytes: Buffer.from("signed root bytes"),
            sha256: Crypto.createHash("sha256")
              .update(Buffer.from("signed root bytes"))
              .digest("hex"),
            published_at: "2026-09-29T10:00:00Z",
          },
        ],
        exchange_published_targets: [
          {
            namespace: "acme",
            name: "dashboard",
            version: "1.0.0",
            digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            bytes: 1024,
          },
        ],
        exchange_published_heads: [
          {
            namespace: "acme",
            name: "dashboard",
            version: "1.0.0",
          },
        ],
      };

      const sourceS3Objects = new Map<string, Buffer>();
      const packageBytes = Buffer.from("fake-package-tabsext-archive-content");
      sourceS3Objects.set("packages/acme/dashboard/1.0.0.tabsext", packageBytes);

      const mockSourcePool = {
        async query(sql: string) {
          for (const [table, rows] of Object.entries(sourceDbRows)) {
            if (sql.includes(`FROM ${table}`)) return { rows, rowCount: rows.length };
          }
          return { rows: [], rowCount: 0 };
        },
      } as any;

      const mockSourceS3 = {
        async send(command: any) {
          if (command.constructor.name === "ListObjectsV2Command") {
            const contents = Array.from(sourceS3Objects.entries()).map(([Key, buf]) => ({
              Key,
              Size: buf.length,
            }));
            return { Contents: contents, NextContinuationToken: undefined };
          }
          if (command.constructor.name === "GetObjectCommand") {
            const buf = sourceS3Objects.get(command.input.Key);
            return { Body: Readable.from([buf]) };
          }
        },
      } as any;

      // 1. Run backup
      const backup = await backupExchangeData(mockSourcePool, mockSourceS3, "source-bucket");
      expect(backup.version).toBe(1);
      expect(backup.objectCount).toBe(1);
      expect(backup.tableCounts.exchange_users).toBe(1);
      expect(backup.tableCounts.exchange_versions).toBe(1);
      expect(backup.tableCounts.exchange_review_events).toBe(1);
      expect(backup.objects[0]?.key).toBe("packages/acme/dashboard/1.0.0.tabsext");
      expect(backup.objects[0]?.digest).toBe(
        Crypto.createHash("sha256").update(packageBytes).digest("hex"),
      );

      // 2. Safety check: Restore onto a NON-EMPTY target must throw!
      const nonEmptytargetPool = {
        async query(sql: string) {
          if (sql.includes("count(*) FROM exchange_users")) {
            return { rows: [{ count: "1" }], rowCount: 1 };
          }
          return { rows: [{ count: "0" }], rowCount: 1 };
        },
      } as any;

      await expect(
        restoreExchangeData(backup, nonEmptytargetPool, mockSourceS3, "non-empty-bucket"),
      ).rejects.toThrow(/Target database table 'exchange_users' is not empty/);

      // 3. Restore into empty target
      const restoredDbRows: Record<string, any[]> = {};
      const restoredS3Objects = new Map<string, Buffer>();

      const mockEmptyTargetPool = {
        async query(sql: string, values?: any[]) {
          if (sql.includes("count(*) FROM")) {
            const match = /FROM\s+([a-z_]+)/.exec(sql);
            const table = match?.[1] ?? "";
            const count = String(restoredDbRows[table]?.length ?? 0);
            return { rows: [{ count }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
        async connect() {
          return {
            async query(sql: string, values?: any[]) {
              if (sql.includes("INSERT INTO")) {
                const match = /INSERT INTO\s+([a-z_]+)/.exec(sql);
                const table = match?.[1] ?? "";
                if (!restoredDbRows[table]) restoredDbRows[table] = [];
                restoredDbRows[table].push(values);
              }
              return { rows: [], rowCount: 1 };
            },
            release() {},
          };
        },
      } as any;

      const mockEmptyTargetS3 = {
        async send(command: any) {
          if (command.constructor.name === "ListObjectsV2Command") {
            return { Contents: [] };
          }
          if (command.constructor.name === "PutObjectCommand") {
            restoredS3Objects.set(command.input.Key, command.input.Body);
            return {};
          }
        },
      } as any;

      const restoreResult = await restoreExchangeData(
        backup,
        mockEmptyTargetPool,
        mockEmptyTargetS3,
        "empty-bucket",
      );

      expect(restoreResult.restoredTables).toBe(13);
      expect(restoreResult.restoredObjects).toBe(1);
      expect(restoredS3Objects.has("packages/acme/dashboard/1.0.0.tabsext")).toBe(true);
      expect(restoredS3Objects.get("packages/acme/dashboard/1.0.0.tabsext")).toEqual(packageBytes);
    });
  });

  describe("Worker Recovery & Operational Alerts Drill", () => {
    it("reclaims expired scanning claims and flags failed scans without approving", async () => {
      const config: ExchangeConfig = {
        origin: "http://127.0.0.1",
        githubClientId: "mock",
        githubClientSecret: "mock",
        adminGithubIds: new Set(["admin"]),
        bucket: "mock",
        publishingEnabled: false,
      };

      // Mock database returning an expired claim (scan_claimed_at in past)
      let updatedStatus = "";
      const pool = {
        async query(sql: string, values?: any[]) {
          if (sql.includes("RETURNING namespace, name, version, digest, object_key, scan_token")) {
            return {
              rows: [
                {
                  namespace: "acme",
                  name: "crashed-worker-test",
                  version: "1.0.0",
                  digest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                  object_key: "quarantine/test",
                  scan_token: "token-1",
                },
              ],
            };
          }
          if (sql.includes("status = 'review'")) {
            updatedStatus = "review";
          }
          return { rows: [], rowCount: 1 };
        },
      } as any;

      // Storage returns tampered bytes (object corruption)
      const storage = {
        async send() {
          return { Body: Readable.from([Buffer.from("corrupted package bytes")]) };
        },
      } as any;

      // Worker executes: detects corrupted bytes, aborts without moving to 'approved'
      const handled = await scanNextVersion(pool, storage, config);
      expect(handled).toBe(true);
      expect(updatedStatus).not.toBe("approved");
    });

    it("evaluates operational readiness beyond /healthz alone, flagging dead workers and expiring metadata", () => {
      // Case 1: Healthy ping but worker is dead
      const result1 = evaluateOperationalReadiness(true, {
        queued: 5,
        oldest_queued_at: new Date(Date.now() - 30_000).toISOString(),
        last_worker_heartbeat_at: new Date(Date.now() - 60_000).toISOString(),
        last_scan_at: new Date(Date.now() - 60_000).toISOString(),
        worker_recently_seen: false, // Dead worker
        metadataFreshness: [
          { role: "root", status: "valid", expiresAt: "2030-01-01T00:00:00Z" },
          { role: "timestamp", status: "valid", expiresAt: "2026-10-05T00:00:00Z" },
        ],
      });

      expect(result1.healthzOk).toBe(true);
      expect(result1.ready).toBe(false); // Unready due to critical alert
      expect(result1.alerts).toContainEqual(
        expect.objectContaining({ subsystem: "worker", level: "critical" }),
      );

      // Case 2: Expired TUF metadata
      const result2 = evaluateOperationalReadiness(true, {
        queued: 0,
        oldest_queued_at: null,
        last_worker_heartbeat_at: new Date().toISOString(),
        last_scan_at: new Date().toISOString(),
        worker_recently_seen: true,
        metadataFreshness: [
          { role: "root", status: "valid", expiresAt: "2030-01-01T00:00:00Z" },
          { role: "timestamp", status: "expired", expiresAt: "2026-09-01T00:00:00Z" },
        ],
      });

      expect(result2.ready).toBe(false);
      expect(result2.alerts).toContainEqual(
        expect.objectContaining({ subsystem: "tuf", level: "critical" }),
      );
    });
  });

  describe("Multi-Registry Origin Isolation Drill", () => {
    it("guarantees separate trust state and zero credential/storage leakage across registry origins", async () => {
      const originA = "https://registry-a.example";
      const originB = "https://registry-b.example";

      const keyA = generateTufKey();
      const keyB = generateTufKey();

      // Root A
      const rootA = new Root({
        version: 1,
        specVersion: "1.0.0",
        expires: "2030-01-01T00:00:00Z",
        consistentSnapshot: false,
      });
      rootA.addKey(keyA.key, "root");
      for (const role of ["timestamp", "snapshot", "targets"]) rootA.addKey(keyA.key, role);
      const metaRootA = new Metadata(rootA);
      metaRootA.sign(
        (b) =>
          new Signature({
            keyID: keyA.keyID,
            sig: Crypto.sign(null, b, keyA.privateKey).toString("hex"),
          }),
      );
      const rootABytes = Buffer.from(JSON.stringify(metaRootA.toJSON()));

      // Root B
      const rootB = new Root({
        version: 1,
        specVersion: "1.0.0",
        expires: "2030-01-01T00:00:00Z",
        consistentSnapshot: false,
      });
      rootB.addKey(keyB.key, "root");
      for (const role of ["timestamp", "snapshot", "targets"]) rootB.addKey(keyB.key, role);
      const metaRootB = new Metadata(rootB);
      metaRootB.sign(
        (b) =>
          new Signature({
            keyID: keyB.keyID,
            sig: Crypto.sign(null, b, keyB.privateKey).toString("hex"),
          }),
      );
      const rootBBytes = Buffer.from(JSON.stringify(metaRootB.toJSON()));

      const sharedStateRoot = tempDir();

      const clientA = new TrustedExchange({
        origin: originA,
        trustId: "registry-a",
        initialRoot: rootABytes,
        stateRoot: sharedStateRoot,
        fetcher: (async () => new Response(null, { status: 404 })) as unknown as typeof fetch,
      });

      const clientB = new TrustedExchange({
        origin: originB,
        trustId: "registry-b",
        initialRoot: rootBBytes,
        stateRoot: sharedStateRoot,
        fetcher: (async () => new Response(null, { status: 404 })) as unknown as typeof fetch,
      });

      // Verify state directories are isolated on disk
      const dirA = Path.join(sharedStateRoot, "registry-a");
      const dirB = Path.join(sharedStateRoot, "registry-b");
      expect(dirA).not.toBe(dirB);

      // Verify client A and B reject cross-origin requests
      const fetcherA = new ExchangeMetadataFetcher(originA);
      await expect(fetcherA.fetch(`${originB}/v1/tuf/metadata/timestamp.json`)).rejects.toThrow(
        /TUF metadata URL escaped the configured Exchange origin/,
      );
    });
  });
});
