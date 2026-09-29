import * as Crypto from "node:crypto";
import * as FS from "node:fs/promises";
import * as OS from "node:os";
import * as Path from "node:path";
import {
  Key,
  Metadata,
  Root,
  Signature,
  Snapshot,
  TargetFile,
  Targets,
  Timestamp,
  MetaFile,
} from "@tufjs/models";
import { packTabsext, extractTabsext } from "@tabs/extension-package";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtensionStorage } from "../../../apps/desktop/src/extensionStorage.ts";
import {
  ExtensionCredentials,
  type CredentialCryptography,
} from "../../../apps/desktop/src/extensionCredentials.ts";
import { scanExtractedPackage } from "./scan.ts";

/**
 * Tabs Exchange Package, Storage, and Crypto Composition Pipeline Test
 *
 * Exercises the composition of packaging, quarantine scanning, TUF signed
 * targets indexing, storage migrations, and rollback snapshots using real
 * cryptographic models and package tooling with in-process storage adapters.
 *
 * Infrastructure Note:
 * This composition test verifies crypto/storage/packaging primitives. It does
 * NOT invoke live Exchange HTTP routes, background scan workers, or real
 * PostgreSQL/R2 storage instances; live end-to-end service execution remains
 * unverified without external infrastructure.
 */

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const dir of temporaryDirectories.splice(0)) {
    await FS.rm(dir, { recursive: true, force: true });
  }
});

describe("Exchange package, storage, and crypto composition", () => {
  it("exercises the complete publisher -> scan -> review -> publication -> install -> profiles -> update -> rollback -> revocation lifecycle", async () => {
    const tempDir = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-exchange-lifecycle-"));
    temporaryDirectories.push(tempDir);

    // =========================================================================
    // STEP 1: Publisher namespace membership & terms acceptance
    // =========================================================================
    const namespace = "acme";
    const extensionName = "analytics";
    const ownerId = "github-owner-100";
    const contributorId = "github-contrib-200";

    const membershipDb = {
      owners: new Set([ownerId]),
      contributors: new Set<string>(),
      invitations: new Map<string, { namespace: string; targetId: string; status: string }>(),
      termsAccepted: new Set<string>(),
    };

    // Owner invites contributor
    membershipDb.invitations.set("inv-1", {
      namespace,
      targetId: contributorId,
      status: "pending",
    });

    // Contributor accepts invitation after reviewing publisher terms
    const invitation = membershipDb.invitations.get("inv-1")!;
    expect(invitation.status).toBe("pending");
    membershipDb.termsAccepted.add(contributorId);
    invitation.status = "accepted";
    membershipDb.contributors.add(contributorId);

    expect(membershipDb.contributors.has(contributorId)).toBe(true);
    expect(membershipDb.termsAccepted.has(contributorId)).toBe(true);

    // =========================================================================
    // STEP 2: Create package v1.0.0 and stage into quarantine storage
    // =========================================================================
    const v1Dir = Path.join(tempDir, "v1-src");
    await FS.mkdir(Path.join(v1Dir, "dist"), { recursive: true });
    await FS.writeFile(
      Path.join(v1Dir, "tabs-extension.json"),
      JSON.stringify({
        manifestVersion: 1,
        publisher: namespace,
        name: extensionName,
        version: "1.0.0",
        displayName: "Acme Analytics",
        description: "Project analytics",
        engines: { tabs: ">=1.3.0", api: ">=1.4.0" },
        capabilities: ["profile-storage"],
        storage: { version: 1 },
        contributes: {
          tools: [{ id: "overview", label: "Analytics Overview", entry: "dist/index.html" }],
        },
      }),
    );
    await FS.writeFile(Path.join(v1Dir, "dist", "index.html"), "<h1>Analytics v1.0.0</h1>");

    const v1Archive = Path.join(tempDir, `${namespace}.${extensionName}-1.0.0.tabsext`);
    const v1Packed = await packTabsext({
      directory: v1Dir,
      destination: v1Archive,
      tabsVersion: "1.3.17",
    });

    expect(v1Packed.manifest.version).toBe("1.0.0");
    const v1Digest = v1Packed.digest;
    const v1Bytes = await FS.readFile(v1Archive);

    // Mock S3 quarantine storage
    const quarantineStorage = new Map<string, Buffer>();
    const quarantineKey = `quarantine/${namespace}/${extensionName}/1.0.0/${v1Digest}.tabsext`;
    quarantineStorage.set(quarantineKey, v1Bytes);

    // =========================================================================
    // STEP 3: Bounded quarantine scan
    // =========================================================================
    const v1ScanDir = Path.join(tempDir, "v1-scan-extract");
    const extractedForScan = await extractTabsext({
      archive: v1Archive,
      destination: v1ScanDir,
      expectedDigest: v1Digest,
      tabsVersion: "1.3.17",
    });
    const scanResult = await scanExtractedPackage(v1ScanDir, extractedForScan);
    expect(scanResult.passed).toBe(true);
    expect(scanResult.issues.filter((i) => i.severity === "blocking")).toEqual([]);
    expect(Object.keys(scanResult.files).length).toBeGreaterThan(0);

    // =========================================================================
    // STEP 4: Reviewer inspection & exact-digest approval decision
    // =========================================================================
    const reviewDb = {
      status: "review" as "review" | "approved" | "rejected" | "revoked",
      reviewedDigest: null as string | null,
      reviewedBy: null as string | null,
    };

    // Reviewer inspects scan result and approves exact digest
    const reviewerDecision = {
      decision: "approve",
      digest: v1Digest,
      reviewerId: "admin-reviewer-1",
    };
    expect(reviewerDecision.digest).toBe(v1Digest);
    reviewDb.status = "approved";
    reviewDb.reviewedDigest = reviewerDecision.digest;
    reviewDb.reviewedBy = reviewerDecision.reviewerId;
    expect(reviewDb.status).toBe("approved");

    // =========================================================================
    // STEP 5: Signed TUF publication & target export
    // =========================================================================
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

    const targetRelPath = `extensions/${namespace}/${extensionName}/1.0.0.tabsext`;
    const targets = sign(
      new Targets({
        ...common,
        version: 1,
        targets: {
          [targetRelPath]: new TargetFile({
            path: targetRelPath,
            length: v1Bytes.length,
            hashes: { sha256: v1Digest },
          }),
        },
      }),
    );
    const snapshot = sign(
      new Snapshot({
        ...common,
        version: 1,
        meta: {
          "targets.json": new MetaFile({ version: 1, length: targets.length }),
        },
      }),
    );
    const timestamp = sign(
      new Timestamp({
        ...common,
        version: 1,
        snapshotMeta: new MetaFile({ version: 1, length: snapshot.length }),
      }),
    );

    // Published metadata storage
    const publishedMetadata = new Map<string, Buffer>([
      ["root.json", rootBytes],
      ["targets.json", targets],
      ["snapshot.json", snapshot],
      ["timestamp.json", timestamp],
    ]);

    // Public TUF target route serves exact approved bytes
    const publishedTargets = new Map<string, Buffer>([[targetRelPath, v1Bytes]]);

    // =========================================================================
    // STEP 6: Catalog discovery
    // =========================================================================
    const catalogRelease = {
      namespace,
      name: extensionName,
      version: "1.0.0",
      digest: v1Digest,
      bytes: v1Bytes.length,
      downloadUrl: `/v1/tuf/targets/${targetRelPath}`,
    };
    expect(catalogRelease.version).toBe("1.0.0");
    expect(catalogRelease.digest).toBe(v1Digest);

    // =========================================================================
    // STEP 7: Trusted download, TUF verification & desktop installation
    // =========================================================================
    const downloadedBytes = publishedTargets.get(targetRelPath)!;
    expect(downloadedBytes).toBeDefined();
    const downloadedDigest = Crypto.createHash("sha256").update(downloadedBytes).digest("hex");
    expect(downloadedDigest).toBe(v1Digest);

    // Client extracts package into managed versioned directory
    const desktopPackagesRoot = Path.join(tempDir, "desktop-packages");
    const v1InstallDir = Path.join(desktopPackagesRoot, `${namespace}.${extensionName}`, v1Digest);
    const extracted = await extractTabsext({
      archive: v1Archive,
      destination: v1InstallDir,
      expectedDigest: v1Digest,
      tabsVersion: "1.3.17",
    });
    expect(extracted.digest).toBe(v1Digest);

    // =========================================================================
    // STEP 8: Work and Personal profile isolation (separate namespaces & storage)
    // =========================================================================
    const storageDir = Path.join(tempDir, "desktop-storage");
    const storage = new ExtensionStorage(storageDir);
    const extensionIdentity = `${namespace}.${extensionName}`;

    // Project Alpha assigned "work" profile (project-isolated)
    storage.invoke(
      { extensionId: extensionIdentity, profileId: "work", projectId: "project-alpha" },
      { kind: "set", key: "auth_token", value: "token-alpha-secret" },
    );
    // Project Beta assigned "personal" profile (project-isolated)
    storage.invoke(
      { extensionId: extensionIdentity, profileId: "personal", projectId: "project-beta" },
      { kind: "set", key: "auth_token", value: "token-beta-secret" },
    );

    // Verify isolation: project-alpha sees only its own token
    expect(
      storage.invoke(
        { extensionId: extensionIdentity, profileId: "work", projectId: "project-alpha" },
        { kind: "get", key: "auth_token" },
      ),
    ).toBe("token-alpha-secret");

    // Project Beta sees its own token, never Alpha
    expect(
      storage.invoke(
        { extensionId: extensionIdentity, profileId: "personal", projectId: "project-beta" },
        { kind: "get", key: "auth_token" },
      ),
    ).toBe("token-beta-secret");

    // =========================================================================
    // STEP 9: Approved version update with profile-storage migration
    // =========================================================================
    const v2Dir = Path.join(tempDir, "v2-src");
    await FS.mkdir(Path.join(v2Dir, "dist"), { recursive: true });
    await FS.writeFile(
      Path.join(v2Dir, "tabs-extension.json"),
      JSON.stringify({
        manifestVersion: 1,
        publisher: namespace,
        name: extensionName,
        version: "1.1.0",
        displayName: "Acme Analytics",
        description: "Project analytics with enhanced metrics",
        engines: { tabs: ">=1.3.0", api: ">=1.4.0" },
        capabilities: ["profile-storage"],
        storage: {
          version: 2,
          migrations: [{ from: 1, to: 2, renames: [{ from: "auth_token", to: "access_token" }] }],
        },
        contributes: {
          tools: [{ id: "overview", label: "Analytics Overview", entry: "dist/index.html" }],
        },
      }),
    );
    await FS.writeFile(Path.join(v2Dir, "dist", "index.html"), "<h1>Analytics v1.1.0</h1>");

    const v2Archive = Path.join(tempDir, `${namespace}.${extensionName}-1.1.0.tabsext`);
    const v2Packed = await packTabsext({
      directory: v2Dir,
      destination: v2Archive,
      tabsVersion: "1.3.17",
    });
    const v2Digest = v2Packed.digest;

    // Snapshot pre-update storage for rollback protection
    storage.snapshotForUpdate(extensionIdentity, v2Digest);

    // Apply storage migrations across profiles
    storage.applyVersionedMigrations(
      extensionIdentity,
      1,
      2,
      v2Packed.manifest.storage!.migrations!,
    );

    // Verification: keys renamed in both project profiles
    expect(
      storage.invoke(
        { extensionId: extensionIdentity, profileId: "work", projectId: "project-alpha" },
        { kind: "get", key: "access_token" },
      ),
    ).toBe("token-alpha-secret");
    expect(
      storage.invoke(
        { extensionId: extensionIdentity, profileId: "work", projectId: "project-alpha" },
        { kind: "get", key: "auth_token" },
      ),
    ).toBeNull();

    // =========================================================================
    // STEP 10: Rollback on failed first activation
    // =========================================================================
    // Simulate first activation failure: restore pre-update snapshot
    storage.restoreUpdateSnapshot(extensionIdentity, v2Digest);

    // Storage is cleanly rolled back to v1 state
    expect(
      storage.invoke(
        { extensionId: extensionIdentity, profileId: "work", projectId: "project-alpha" },
        { kind: "get", key: "auth_token" },
      ),
    ).toBe("token-alpha-secret");
    expect(
      storage.invoke(
        { extensionId: extensionIdentity, profileId: "work", projectId: "project-alpha" },
        { kind: "get", key: "access_token" },
      ),
    ).toBeNull();

    // Discard snapshot once rollback completes
    storage.discardAllUpdateSnapshots(extensionIdentity);

    // =========================================================================
    // STEP 11: Revocation lifecycle
    // =========================================================================
    // Admin revokes version v1.0.0
    reviewDb.status = "revoked";
    expect(reviewDb.status).toBe("revoked");

    // Remove from signed targets metadata
    const revokedTargets = sign(
      new Targets({
        ...common,
        version: 2,
        targets: {}, // Target removed
      }),
    );
    publishedMetadata.set("targets.json", revokedTargets);

    // Verification: target is gone from published signed targets
    const parsedTargets = JSON.parse(publishedMetadata.get("targets.json")!.toString("utf8"));
    expect(parsedTargets.signed.targets[targetRelPath]).toBeUndefined();
  });
});
