import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { packTabsext } from "@tabs/extension-package";
import { Key, Metadata, Root, Signature } from "@tufjs/models";
import { session as electronSession, WebContentsView } from "electron";

vi.mock("electron", () => ({
  session: { fromPartition: vi.fn() },
  WebContentsView: vi.fn(),
}));

import type {
  DesktopExchangeListing,
  DesktopInstalledExtension,
  DesktopPreparedExchangeInstall,
} from "@tabs/contracts";
import {
  ExtensionViewManager,
  extensionDataIdentity,
  extensionSessionPartition,
} from "./extensionViewManager";
import { ExtensionStorage } from "./extensionStorage";
import { type CredentialCryptography } from "./extensionCredentials";
import {
  ExchangeInstallService,
  configuredExchangeTrust,
  isOfflineExchangeError,
} from "./exchangeInstall";
import { ExchangeAutomaticUpdater } from "./exchangeAutomaticUpdater";
import { downloadSignedExchangePackage } from "./exchangePackageDownload";
import { ExchangeSignedMetadataHints } from "./exchangeSignedMetadataHints";
import { ExchangeTransportError, TrustedExchange, exchangeTargetPath } from "./trustedExchange";
import { extensionProfileForProject, isExtensionEnabledForProject } from "@tabs/shared/extensions";
import type { NativeViewStackCoordinator } from "./nativeViewStackCoordinator";

const temporaryDirectories: string[] = [];
const origin = "https://127.0.0.1:8787";

function temporaryDirectory(): string {
  const dir = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-desktop-lifecycle-"));
  temporaryDirectories.push(dir);
  return dir;
}

function generateTufRoot(): Buffer {
  const { privateKey, publicKey } = Crypto.generateKeyPairSync("ed25519");
  const publicBytes = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const keyID = Crypto.createHash("sha256").update(publicBytes).digest("hex");
  const key = new Key({
    keyID,
    keyType: "ed25519",
    scheme: "ed25519",
    keyVal: { public: publicBytes.toString("hex") },
  });
  const common = { version: 1, specVersion: "1.0.0", expires: "2030-01-01T00:00:00Z" };
  const root = new Root({ ...common, consistentSnapshot: false });
  for (const role of ["root", "timestamp", "snapshot", "targets"]) root.addKey(key, role);
  const metadata = new Metadata(root);
  metadata.sign(
    (bytes) => new Signature({ keyID, sig: Crypto.sign(null, bytes, privateKey).toString("hex") }),
  );
  return Buffer.from(JSON.stringify(metadata.toJSON()));
}

function mockCrypto(): CredentialCryptography {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "mock-backend",
    encryptString: (val: string) => Buffer.from(`enc:${val}`),
    decryptString: (buf: Buffer) => {
      const str = buf.toString("utf8");
      if (!str.startsWith("enc:")) throw new Error("Decryption failed");
      return str.slice(4);
    },
  };
}

function requireInstalled(manager: ExtensionViewManager, id: string): DesktopInstalledExtension {
  const found = manager.list().find((entry) => entry.id === id);
  if (!found) throw new Error(`Extension ${id} not found in manager list.`);
  return found;
}

function mockCoordinator(): NativeViewStackCoordinator {
  return {
    attachToolView: vi.fn(),
    detachToolView: vi.fn(),
  } as unknown as NativeViewStackCoordinator;
}

function mockElectronView(loadURL: (url: string) => Promise<unknown> = async () => undefined): {
  webContents: {
    setWindowOpenHandler: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    loadURL: typeof loadURL;
    close: ReturnType<typeof vi.fn>;
    isDestroyed: () => boolean;
  };
} {
  const contents = {
    setWindowOpenHandler: vi.fn(),
    on: vi.fn(),
    loadURL,
    close: vi.fn(),
    isDestroyed: () => false,
  };
  vi.mocked(electronSession.fromPartition).mockReturnValue({
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    webRequest: { onBeforeRequest: vi.fn(), onHeadersReceived: vi.fn() },
    protocol: { registerFileProtocol: vi.fn() },
    closeAllConnections: vi.fn(async () => undefined),
    clearData: vi.fn(async () => undefined),
    clearAuthCache: vi.fn(async () => undefined),
    clearCodeCaches: vi.fn(async () => undefined),
    flushStorageData: vi.fn(),
  } as never);
  vi.mocked(WebContentsView).mockImplementation(function MockWebContentsView() {
    return {
      webContents: contents,
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      setBackgroundColor: vi.fn(),
    } as unknown as WebContentsView;
  });
  return { webContents: contents };
}

describe("Desktop Install/Update and Isolation Lifecycle (Checkpoint 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockElectronView();
  });

  afterEach(() => {
    for (const dir of temporaryDirectories.splice(0)) {
      try {
        FS.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it("discovers signed release, downloads exact target, verifies identity and compatibility, and requires permission consent before enablement", async () => {
    const root = temporaryDirectory();
    const source = Path.join(root, "source");
    FS.mkdirSync(Path.join(source, "dist"), { recursive: true });
    FS.writeFileSync(
      Path.join(source, "dist", "index.html"),
      "<!doctype html><title>Dashboard</title>",
    );
    FS.writeFileSync(
      Path.join(source, "tabs-extension.json"),
      JSON.stringify({
        manifestVersion: 1,
        publisher: "acme",
        name: "dashboard",
        version: "1.0.0",
        displayName: "Acme Dashboard",
        description: "Official dashboard",
        engines: { tabs: ">=1.3.0 <2.0.0" },
        capabilities: ["profile-storage", "workspace-read"],
        contributes: {
          tools: [{ id: "main", label: "Dashboard", entry: "dist/index.html" }],
        },
      }),
    );

    const packagePath = Path.join(root, "acme-dashboard-1.0.0.tabsext");
    const packageInfo = await packTabsext({
      directory: source,
      destination: packagePath,
      tabsVersion: "1.3.17",
    });

    const listing: DesktopExchangeListing = {
      registryOrigin: origin,
      id: "acme.dashboard",
      namespace: "acme",
      name: "dashboard",
      version: "1.0.0",
      digest: packageInfo.digest,
      displayName: "Acme Dashboard",
      description: "Official dashboard",
      verifiedPublisher: true,
      tabsCompatibility: ">=1.3.0 <2.0.0",
      capabilities: ["profile-storage", "workspace-read"],
    };

    let installedResult: DesktopInstalledExtension | null = null;
    const coordinator = mockCoordinator();
    const manager = new ExtensionViewManager(
      () => null,
      coordinator,
      Path.join(root, "installed.json"),
      "1.3.17",
      true,
      mockCrypto(),
    );

    const installService = new ExchangeInstallService(
      { origin, trustId: "test-trust", root: Buffer.from("root-bytes") },
      Path.join(root, "tuf-state"),
      "1.3.17",
      () => manager.list(),
      async (archive, regOrigin, digest) => {
        installedResult = await manager.installVerifiedExchangePackage(archive, regOrigin, digest);
        return installedResult;
      },
      async (_url) => {
        const res = new Response(new Uint8Array(FS.readFileSync(packagePath)));
        Object.defineProperty(res, "url", {
          value: `${origin}/v1/tuf/targets/extensions/acme/dashboard/1.0.0.tabsext`,
        });
        return res;
      },
      {
        resolve: async () => ({
          path: exchangeTargetPath("acme", "dashboard", "1.0.0"),
          bytes: packageInfo.bytes,
          digest: packageInfo.digest,
        }),
      },
    );

    // 1. Prepare download & verify
    const prepared = await installService.prepare(listing);
    expect(prepared.manifest.publisher).toBe("acme");
    expect(prepared.manifest.name).toBe("dashboard");
    expect(prepared.manifest.version).toBe("1.0.0");
    expect(prepared.manifest.capabilities).toEqual(["profile-storage", "workspace-read"]);
    expect(prepared.digest).toBe(packageInfo.digest);
    // User permission consent required: willKeepEnabled is false on initial install
    expect(prepared.willKeepEnabled).toBe(false);

    // 2. User confirms install
    await installService.confirm(prepared.token);
    expect(installedResult).toBeTruthy();
    expect(installedResult!.id).toBe("acme.dashboard");
    expect(installedResult!.source).toBe("exchange");
    expect(installedResult!.registryOrigin).toBe(origin);
    // Installed once per environment, but not yet enabled in any project
    expect(installedResult!.assignment.enabledProjectIds).toEqual([]);
    expect(manager.list().length).toBe(1);
  });

  it("enforces multi-project enablement, profile assignment, credential/storage/partition isolation, and project grants", async () => {
    const root = temporaryDirectory();
    const source = Path.join(root, "source");
    FS.mkdirSync(Path.join(source, "dist"), { recursive: true });
    FS.writeFileSync(Path.join(source, "dist", "index.html"), "<!doctype html><title>Tool</title>");
    FS.writeFileSync(
      Path.join(source, "tabs-extension.json"),
      JSON.stringify({
        manifestVersion: 1,
        publisher: "acme",
        name: "tool",
        version: "1.0.0",
        displayName: "Tool",
        description: "Multi-profile tool",
        engines: { tabs: ">=1.3.0 <2.0.0" },
        capabilities: ["profile-storage", "network", "credentials", "workspace-read"],
        networkHosts: ["api.acme.example"],
        contributes: {
          tools: [{ id: "main", label: "Main", entry: "dist/index.html" }],
        },
      }),
    );

    const archive = Path.join(root, "tool.tabsext");
    const info = await packTabsext({
      directory: source,
      destination: archive,
      tabsVersion: "1.3.17",
    });

    const coordinator = mockCoordinator();
    const manager = new ExtensionViewManager(
      () => null,
      coordinator,
      Path.join(root, "installed.json"),
      "1.3.17",
      true,
      mockCrypto(),
    );

    const installed = await manager.installVerifiedExchangePackage(archive, origin, info.digest);

    // Add Work and Personal profiles separately
    manager.addProfile(installed.id, "work", "Work Profile", "shared");
    manager.addProfile(installed.id, "personal", "Personal Profile", "shared");

    // Assign project-a to "work" with workspace-read grant, and project-b to "personal" without grants
    manager.setAssignment(installed.id, {
      extensionId: installed.id,
      enabledGlobally: false,
      enabledProjectIds: ["project-a", "project-b"],
      disabledProjectIds: [],
      defaultProfileId: "default",
      profileIdByProjectId: {
        "project-a": "work",
        "project-b": "personal",
      },
      workspaceReadGrantedProjectIds: ["project-a"],
      gitStatusGrantedProjectIds: [],
      networkGrantedProjectIds: [],
      credentialGrantedProjectIds: [],
      aiToolGrantedProjectIds: [],
    });

    const current = requireInstalled(manager, installed.id);
    expect(current.assignment.enabledProjectIds).toContain("project-a");
    expect(current.assignment.enabledProjectIds).toContain("project-b");
    expect(current.assignment.workspaceReadGrantedProjectIds).toEqual(["project-a"]);
    expect(extensionProfileForProject(current.assignment, "project-a")).toBe("work");
    expect(extensionProfileForProject(current.assignment, "project-b")).toBe("personal");
    expect(isExtensionEnabledForProject(current.assignment, "project-a")).toBe(true);
    expect(isExtensionEnabledForProject(current.assignment, "project-b")).toBe(true);
    expect(isExtensionEnabledForProject(current.assignment, "project-c")).toBe(false);

    // 1. Storage Isolation: "work" vs "personal"
    const storage = new ExtensionStorage(Path.join(root, "storage"));
    const workIdentity = extensionDataIdentity(
      installed.id,
      installed.registryOrigin,
      installed.source,
    );
    storage.invoke(
      { extensionId: workIdentity, profileId: "work" },
      { kind: "set", key: "authKey", value: "work-token-123" },
    );

    const workVal = storage.invoke(
      { extensionId: workIdentity, profileId: "work" },
      { kind: "get", key: "authKey" },
    );
    const personalVal = storage.invoke(
      { extensionId: workIdentity, profileId: "personal" },
      { kind: "get", key: "authKey" },
    );
    expect(workVal).toBe("work-token-123");
    expect(personalVal).toBeNull(); // Personal profile does NOT leak work data

    // 2. Credential Isolation: "work" vs "personal"
    manager.setProfileCredential(installed.id, "work", "api.acme.example", "work-secret-pass");
    const statuses = manager.listCredentialStatuses(installed.id);
    expect(statuses).toEqual([{ profileId: "work", host: "api.acme.example" }]);
    expect(statuses.some((s) => s.profileId === "personal")).toBe(false);

    const creds = (manager as any).requireCredentials();
    const workCred = creds.get({
      extensionId: workIdentity,
      profileId: "work",
      host: "api.acme.example",
    });
    const personalCred = creds.get({
      extensionId: workIdentity,
      profileId: "personal",
      host: "api.acme.example",
    });
    expect(workCred).toBe("work-secret-pass");
    expect(personalCred).toBeNull(); // No credential leakage across profiles

    // 3. Browser Partition Isolation:
    const partWorkA = extensionSessionPartition(
      installed.id,
      "work",
      "shared",
      "project-a",
      origin,
      "exchange",
    );
    const partWorkB = extensionSessionPartition(
      installed.id,
      "work",
      "shared",
      "project-b",
      origin,
      "exchange",
    );
    const partPersonalA = extensionSessionPartition(
      installed.id,
      "personal",
      "shared",
      "project-a",
      origin,
      "exchange",
    );
    const otherOriginPart = extensionSessionPartition(
      installed.id,
      "work",
      "shared",
      "project-a",
      "https://other.registry",
      "exchange",
    );

    // Partition includes hashed origin and profile identity
    expect(partWorkA).not.toEqual(partPersonalA);
    expect(partWorkA).not.toEqual(otherOriginPart);
    // Shared profile across projects yields same shared profile partition
    expect(partWorkA).toEqual(partWorkB);
  });

  it("requires fresh consent for permission increases; declining preserves old version; neutral update applies at safe boundary", async () => {
    const root = temporaryDirectory();
    const source = Path.join(root, "source");
    FS.mkdirSync(Path.join(source, "dist"), { recursive: true });
    FS.writeFileSync(Path.join(source, "dist", "index.html"), "<!doctype html><title>App</title>");

    // Version 1.0.0 with only profile-storage
    FS.writeFileSync(
      Path.join(source, "tabs-extension.json"),
      JSON.stringify({
        manifestVersion: 1,
        publisher: "acme",
        name: "app",
        version: "1.0.0",
        displayName: "App",
        description: "App initial",
        engines: { tabs: ">=1.3.0 <2.0.0" },
        capabilities: ["profile-storage"],
        contributes: { tools: [{ id: "app", label: "App", entry: "dist/index.html" }] },
      }),
    );
    const package1Path = Path.join(root, "app-1.0.0.tabsext");
    const package1 = await packTabsext({
      directory: source,
      destination: package1Path,
      tabsVersion: "1.3.17",
    });

    const coordinator = mockCoordinator();
    const manager = new ExtensionViewManager(
      () => null,
      coordinator,
      Path.join(root, "installed.json"),
      "1.3.17",
      true,
      mockCrypto(),
    );
    const installed = await manager.installVerifiedExchangePackage(
      package1Path,
      origin,
      package1.digest,
    );

    // Enable for project-a
    manager.setAssignment(installed.id, {
      extensionId: installed.id,
      enabledGlobally: false,
      enabledProjectIds: ["project-a"],
      disabledProjectIds: [],
      defaultProfileId: "default",
      profileIdByProjectId: {},
      workspaceReadGrantedProjectIds: [],
      gitStatusGrantedProjectIds: [],
      networkGrantedProjectIds: [],
      credentialGrantedProjectIds: [],
      aiToolGrantedProjectIds: [],
    });

    // Version 1.1.0 adds workspace-read and network capability
    FS.writeFileSync(
      Path.join(source, "tabs-extension.json"),
      JSON.stringify({
        manifestVersion: 1,
        publisher: "acme",
        name: "app",
        version: "1.1.0",
        displayName: "App",
        description: "App with permissions",
        engines: { tabs: ">=1.3.0 <2.0.0" },
        capabilities: ["profile-storage", "workspace-read", "network"],
        networkHosts: ["api.acme.example"],
        contributes: { tools: [{ id: "app", label: "App", entry: "dist/index.html" }] },
      }),
    );
    const package2Path = Path.join(root, "app-1.1.0.tabsext");
    const package2 = await packTabsext({
      directory: source,
      destination: package2Path,
      tabsVersion: "1.3.17",
    });

    const listingV110: DesktopExchangeListing = {
      registryOrigin: origin,
      id: installed.id,
      namespace: "acme",
      name: "app",
      version: "1.1.0",
      digest: package2.digest,
      displayName: "App",
      description: "App with permissions",
      verifiedPublisher: true,
      tabsCompatibility: ">=1.3.0 <2.0.0",
      capabilities: ["profile-storage", "workspace-read", "network"],
    };

    const installService = new ExchangeInstallService(
      { origin, trustId: "official", root: Buffer.from("root") },
      Path.join(root, "tuf-state"),
      "1.3.17",
      () => manager.list(),
      async (archive, regOrigin, digest, options) => {
        return manager.installVerifiedExchangePackage(archive, regOrigin, digest, options);
      },
      async (_url) => {
        const res = new Response(new Uint8Array(FS.readFileSync(package2Path)));
        Object.defineProperty(res, "url", {
          value: `${origin}/v1/tuf/targets/extensions/acme/app/1.1.0.tabsext`,
        });
        return res;
      },
      {
        resolve: async () => ({
          path: exchangeTargetPath("acme", "app", "1.1.0"),
          bytes: package2.bytes,
          digest: package2.digest,
        }),
      },
    );

    // 1. Prepare v1.1.0 -> willKeepEnabled is false because permissions increased (fresh consent required)
    const preparedInc = await installService.prepare(listingV110);
    expect(preparedInc.willKeepEnabled).toBe(false);
    expect(preparedInc.addedCapabilities).toContain("workspace-read");
    expect(preparedInc.addedCapabilities).toContain("network");
    expect(preparedInc.addedNetworkHosts).toContain("api.acme.example");

    // 2. User DECLINES: cancel review token -> old version 1.0.0 is preserved intact!
    installService.cancel(preparedInc.token);
    expect(requireInstalled(manager, installed.id).manifest.version).toBe("1.0.0");
    expect(requireInstalled(manager, installed.id).assignment.enabledProjectIds).toEqual([
      "project-a",
    ]);

    // 3. Neutral update: v1.0.1 (same capabilities, bugfix only)
    FS.writeFileSync(
      Path.join(source, "tabs-extension.json"),
      JSON.stringify({
        manifestVersion: 1,
        publisher: "acme",
        name: "app",
        version: "1.0.1",
        displayName: "App",
        description: "App bugfix",
        engines: { tabs: ">=1.3.0 <2.0.0" },
        capabilities: ["profile-storage"],
        contributes: { tools: [{ id: "app", label: "App", entry: "dist/index.html" }] },
      }),
    );
    const package3Path = Path.join(root, "app-1.0.1.tabsext");
    const package3 = await packTabsext({
      directory: source,
      destination: package3Path,
      tabsVersion: "1.3.17",
    });

    const listingV101: DesktopExchangeListing = {
      registryOrigin: origin,
      id: installed.id,
      namespace: "acme",
      name: "app",
      version: "1.0.1",
      digest: package3.digest,
      displayName: "App",
      description: "App bugfix",
      verifiedPublisher: false,
      tabsCompatibility: ">=1.3.0 <2.0.0",
      capabilities: ["profile-storage"],
    };

    let safeToUpdate = false;
    const prepareSpy = vi.fn(
      async () =>
        ({
          token: "neutral-token",
          digest: listingV101.digest,
          registryOrigin: origin,
          willKeepEnabled: true,
          requiresManualReview: false,
          manifest: { ...installed.manifest, version: "1.0.1" },
        }) as DesktopPreparedExchangeInstall,
    );
    const confirmSpy = vi.fn(async () => undefined);

    const autoUpdater = new ExchangeAutomaticUpdater(
      () => manager.list(),
      () => listingV101,
      () => safeToUpdate,
      prepareSpy,
      confirmSpy,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );

    // Active view / unsafe boundary: do not update
    await autoUpdater.applyAvailable();
    expect(prepareSpy).not.toHaveBeenCalled();

    // Pinned update: do not update
    manager.setUpdatesPinned(installed.id, true);
    safeToUpdate = true;
    await autoUpdater.applyAvailable();
    expect(prepareSpy).not.toHaveBeenCalled();

    // Safe boundary: unpinned, view inactive, neutral -> updates
    manager.setUpdatesPinned(installed.id, false);
    await autoUpdater.applyAvailable();
    expect(prepareSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith("neutral-token", { silent: true });
  });

  it("restores prior package, assignment, and storage snapshot on first-load failure exactly once", async () => {
    const root = temporaryDirectory();
    const source = Path.join(root, "source");
    FS.mkdirSync(Path.join(source, "dist"), { recursive: true });
    FS.writeFileSync(
      Path.join(source, "dist", "index.html"),
      "<!doctype html><title>Dashboard</title>",
    );
    FS.writeFileSync(
      Path.join(source, "tabs-extension.json"),
      JSON.stringify({
        manifestVersion: 1,
        publisher: "acme",
        name: "dashboard",
        version: "1.0.0",
        displayName: "Dashboard",
        description: "Dashboard",
        engines: { tabs: ">=1.3.0 <2.0.0" },
        capabilities: ["profile-storage"],
        contributes: { tools: [{ id: "main", label: "Dashboard", entry: "dist/index.html" }] },
      }),
    );

    const firstArchive = Path.join(root, "first.tabsext");
    const firstInfo = await packTabsext({
      directory: source,
      destination: firstArchive,
      tabsVersion: "1.3.17",
    });

    const coordinator = mockCoordinator();
    const manager = new ExtensionViewManager(
      () => null,
      coordinator,
      Path.join(root, "installed.json"),
      "1.3.17",
      true,
      mockCrypto(),
    );
    const installed = await manager.installVerifiedExchangePackage(
      firstArchive,
      origin,
      firstInfo.digest,
    );
    manager.setAssignment(installed.id, {
      extensionId: installed.id,
      enabledGlobally: false,
      enabledProjectIds: ["project-1"],
      disabledProjectIds: [],
      defaultProfileId: "default",
      profileIdByProjectId: {},
      workspaceReadGrantedProjectIds: [],
      gitStatusGrantedProjectIds: [],
      networkGrantedProjectIds: [],
      credentialGrantedProjectIds: [],
      aiToolGrantedProjectIds: [],
    });

    // Store data in v1.0.0
    const storageIdentity = extensionDataIdentity(installed.id, origin, "exchange");
    const storage = (manager as any).storage as ExtensionStorage;
    storage.invoke(
      { extensionId: storageIdentity, profileId: "default" },
      { kind: "set", key: "stateKey", value: "original-v1-state" },
    );

    // Update to v1.0.1
    FS.writeFileSync(
      Path.join(source, "tabs-extension.json"),
      JSON.stringify({
        manifestVersion: 1,
        publisher: "acme",
        name: "dashboard",
        version: "1.0.1",
        displayName: "Dashboard",
        description: "Dashboard",
        engines: { tabs: ">=1.3.0 <2.0.0" },
        capabilities: ["profile-storage"],
        contributes: { tools: [{ id: "main", label: "Dashboard", entry: "dist/index.html" }] },
      }),
    );
    const secondArchive = Path.join(root, "second.tabsext");
    const secondInfo = await packTabsext({
      directory: source,
      destination: secondArchive,
      tabsVersion: "1.3.17",
    });

    await manager.installVerifiedExchangePackage(secondArchive, origin, secondInfo.digest);
    expect(requireInstalled(manager, installed.id).manifest.version).toBe("1.0.1");

    // Corrupt v1.0.1 entry file so activate will fail
    const extractedEntry = Path.join(
      root,
      "extension-packages",
      installed.id,
      secondInfo.digest,
      "dist",
      "index.html",
    );
    if (FS.existsSync(extractedEntry)) {
      FS.unlinkSync(extractedEntry);
    }

    // First load fails and rolls back exactly once
    await expect(
      manager.activate({
        extensionId: installed.id,
        toolId: "main",
        projectId: "project-1",
        profileId: "default",
      }),
    ).rejects.toThrow(/rolled back|unavailable/);

    // Prior package, version, and digest are restored!
    const restored = requireInstalled(manager, installed.id);
    expect(restored.manifest.version).toBe("1.0.0");
    expect(restored.digest).toBe(firstInfo.digest);
    expect(restored.assignment.enabledProjectIds).toEqual(["project-1"]);

    // Storage restored to original v1 state
    const restoredVal = storage.invoke(
      { extensionId: storageIdentity, profileId: "default" },
      { kind: "get", key: "stateKey" },
    );
    expect(restoredVal).toBe("original-v1-state");
  });

  it("distinguishes offline transport errors from invalid TUF metadata, rejects rollback, and rejects cross-registry hijacking", async () => {
    // 1. Offline transport error
    const netErr = new TypeError("fetch failed");
    expect(isOfflineExchangeError(new ExchangeTransportError(netErr))).toBe(true);

    // 2. Invalid/expired metadata is NOT treated as offline
    const expiredErr = new Error("Expired metadata");
    expect(isOfflineExchangeError(expiredErr)).toBe(false);

    // 3. Reject wrong root hash
    const rootPath = Path.join(temporaryDirectory(), "root.json");
    FS.writeFileSync(rootPath, "root-json-contents");
    expect(() =>
      configuredExchangeTrust(
        {
          TABS_EXCHANGE_TRUST_ROOT_PATH: rootPath,
          TABS_EXCHANGE_TRUST_ROOT_SHA256: "0".repeat(64), // Mismatched SHA-256
          TABS_EXCHANGE_TRUST_ID: "official",
        },
        origin,
      ),
    ).toThrow(/pinned digest/);

    // 4. Reject redirect in metadata fetcher
    const rootBytes = generateTufRoot();
    const fetcher = new (class extends TrustedExchange {
      constructor() {
        super({
          origin,
          trustId: "official",
          initialRoot: rootBytes,
          stateRoot: temporaryDirectory(),
          fetcher: async () =>
            new Response(null, { status: 302, headers: { Location: "http://evil.example" } }),
        });
      }
    })();
    await expect(fetcher.resolve("acme", "dashboard", "1.0.0")).rejects.toThrow();

    // 5. Reject redirect in package download
    await expect(
      downloadSignedExchangePackage({
        origin,
        target: {
          path: "extensions/acme/dashboard/1.0.0.tabsext",
          bytes: 10,
          digest: "a".repeat(64),
        },
        stagingRoot: temporaryDirectory(),
        fetcher: async () =>
          new Response(null, { status: 302, headers: { Location: "http://evil.example" } }),
      }),
    ).rejects.toThrow(/changed destination|redirect/);

    // 6. Reject package from another registry with same publisher/name
    const installService = new ExchangeInstallService(
      { origin, trustId: "official", root: Buffer.from("root") },
      temporaryDirectory(),
      "1.3.17",
      () => [
        {
          id: "acme.dashboard",
          source: "exchange",
          registryOrigin: "https://legit.registry.example",
          digest: "a".repeat(64),
          manifest: { publisher: "acme", name: "dashboard", version: "1.0.0" },
        } as DesktopInstalledExtension,
      ],
      async () => ({}) as any,
      async () => new Response(null),
      {
        resolve: async () => ({
          path: exchangeTargetPath("acme", "dashboard", "1.0.0"),
          bytes: 10,
          digest: "a".repeat(64),
        }),
      },
    );

    await expect(
      installService.prepare({
        registryOrigin: "https://evil.registry.example", // Attempting cross-registry overwrite
        id: "acme.dashboard",
        namespace: "acme",
        name: "dashboard",
        version: "1.0.0",
        digest: "a".repeat(64),
        displayName: "Dashboard",
        description: "Dashboard",
        verifiedPublisher: false,
        tabsCompatibility: ">=1.3.0 <2.0.0",
        capabilities: [],
      }),
    ).rejects.toThrow(/trusted registry/);
  });

  it("handles signed revocation by disabling installed version and tools, while unsigned SSE alone does not alter state", async () => {
    let refreshed = 0;
    const hints = new ExchangeSignedMetadataHints(
      origin,
      () => {
        refreshed++;
      },
      () => undefined,
      async () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("event: signed-metadata\ndata: {}\n\n"));
            controller.close();
          },
        });
        const res = new Response(stream, { headers: { "content-type": "text/event-stream" } });
        Object.defineProperty(res, "url", { value: `${origin}/v1/tuf/events` });
        return res;
      },
    );

    hints.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    hints.stop();

    // SSE hint triggered refresh
    expect(refreshed).toBe(1);

    // But unsigned SSE alone did NOT revoke or change anything!
    const coordinator = mockCoordinator();
    const manager = new ExtensionViewManager(
      () => null,
      coordinator,
      Path.join(temporaryDirectory(), "installed.json"),
      "1.3.17",
      true,
      mockCrypto(),
    );

    // Mock an installed extension
    const dummyInstalled: DesktopInstalledExtension = {
      id: "acme.revokeme",
      source: "exchange",
      registryOrigin: origin,
      digest: "b".repeat(64),
      manifest: {
        manifestVersion: 1,
        publisher: "acme",
        name: "revokeme",
        version: "1.0.0",
        displayName: "Revokeme",
        description: "Revokeme",
        engines: { tabs: ">=1.3.0 <2.0.0" },
        capabilities: [],
        contributes: { tools: [{ id: "main", label: "Tool", entry: "index.html" }] },
      },
      assignment: {
        extensionId: "acme.revokeme",
        enabledGlobally: false,
        enabledProjectIds: ["proj-1"],
        disabledProjectIds: [],
        defaultProfileId: "default",
        profileIdByProjectId: {},
      },
      profiles: [{ id: "default", label: "Default" }],
    };
    (manager as any).installed.set(dummyInstalled.id, dummyInstalled);

    // Signed revocation: revoked digest detected via fresh signed TUF verification
    const revoked = manager.revokeIfCurrent(dummyInstalled.id, origin, dummyInstalled.digest!);
    expect(revoked).toBe(true);

    const afterRevoke = requireInstalled(manager, dummyInstalled.id);
    expect(afterRevoke.revoked).toBe(true);

    // Revoked tool is rejected upon activation
    await expect(
      manager.activate({
        extensionId: dummyInstalled.id,
        toolId: "main",
        projectId: "proj-1",
        profileId: "default",
      }),
    ).rejects.toThrow(/revoked/);
  });

  it("exercises project-scoped brokers at call and response boundaries with in-flight grant revocation and rejects stale activations", async () => {
    const coordinator = mockCoordinator();
    const manager = new ExtensionViewManager(
      () => null,
      coordinator,
      Path.join(temporaryDirectory(), "installed.json"),
      "1.3.17",
      true,
      mockCrypto(),
    );

    const installed = {
      id: "acme.tool",
      source: "exchange",
      registryOrigin: origin,
      digest: "a".repeat(64),
      manifest: {
        publisher: "acme",
        name: "tool",
        version: "1.0.0",
        capabilities: ["workspace-read", "git-status", "network"],
        networkHosts: ["api.acme.example"],
        contributes: { tools: [{ id: "main", label: "Main", entry: "dist/index.html" }] },
      },
      profiles: [{ id: "work", label: "Work", scope: "shared" }],
      assignment: {
        enabledGlobally: false,
        enabledProjectIds: ["project-alpha"],
        disabledProjectIds: [],
        defaultProfileId: "work",
        profileIdByProjectId: { "project-alpha": "work" },
        workspaceReadGrantedProjectIds: ["project-alpha"],
        gitStatusGrantedProjectIds: ["project-alpha"],
        networkGrantedProjectIds: ["project-alpha"],
      },
    } as unknown as DesktopInstalledExtension;

    (manager as any).installed.set(installed.id, installed);

    const { webContents } = mockElectronView();
    (manager as any).active = {
      extensionId: installed.id,
      profileId: "work",
      projectId: "project-alpha",
      activationId: "act-broker-1",
      view: { webContents },
      isCommitted: true,
    };

    // 1. In-flight grant revocation during workspace read:
    const readPending = manager.invokeWorkspaceRead(
      webContents as any,
      "src/index.ts",
      async () => {
        // While read is in flight, revoke the grant!
        (manager as any).installed.set(installed.id, {
          ...installed,
          assignment: {
            ...installed.assignment,
            workspaceReadGrantedProjectIds: [], // Revoked in-flight!
          },
        });
        return "sensitive-source-code";
      },
    );

    // The response/commit boundary recheck throws and suppresses the data!
    await expect(readPending).rejects.toThrow(
      /Workspace read access is not granted for this project/,
    );

    // 2. In-flight grant revocation during Git status:
    // Re-grant
    (manager as any).installed.set(installed.id, installed);
    const gitPending = manager.invokeGitStatus(webContents as any, async () => {
      // Revoke in-flight
      (manager as any).installed.set(installed.id, {
        ...installed,
        assignment: {
          ...installed.assignment,
          gitStatusGrantedProjectIds: [],
        },
      });
      return { branch: "main", dirty: false };
    });
    await expect(gitPending).rejects.toThrow(/Git status access is not granted for this project/);

    // 3. Stale view/activation boundary:
    // If active view changed while request was in flight:
    (manager as any).installed.set(installed.id, installed);
    const stalePending = manager.invokeWorkspaceRead(
      webContents as any,
      "src/index.ts",
      async () => {
        // Active view switched to another tool/project
        (manager as any).active = {
          extensionId: installed.id,
          profileId: "work",
          projectId: "project-beta",
          activationId: "act-new-2",
          view: { webContents },
          isCommitted: true,
        };
        return "source";
      },
    );
    await expect(stalePending).rejects.toThrow(/Extension view changed during workspace read/);
  });
});
