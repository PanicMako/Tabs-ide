import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { packTabsext } from "@tabs/extension-package";
import { session as electronSession, WebContentsView } from "electron";

vi.mock("electron", () => ({
  session: { fromPartition: vi.fn() },
  WebContentsView: vi.fn(),
}));

import {
  ExtensionViewManager,
  extensionDataIdentity,
  extensionSessionPartition,
} from "./extensionViewManager";
import { ExtensionStorage } from "./extensionStorage";

const temporaryRoots: string[] = [];

function fixture(): { directory: string; manager: ExtensionViewManager } {
  const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-extension-test-"));
  temporaryRoots.push(directory);
  FS.mkdirSync(Path.join(directory, "dist"));
  FS.writeFileSync(
    Path.join(directory, "dist", "index.html"),
    "<!doctype html><title>Test</title>",
  );
  FS.writeFileSync(
    Path.join(directory, "tabs-extension.json"),
    JSON.stringify({
      manifestVersion: 1,
      publisher: "acme",
      name: "dashboard",
      version: "1.0.0",
      displayName: "Dashboard",
      description: "Test dashboard",
      engines: { tabs: ">=1.3.0 <2.0.0" },
      contributes: { tools: [{ id: "main", label: "Main", entry: "dist/index.html" }] },
    }),
  );
  const manager = new ExtensionViewManager(
    () => null,
    {} as ConstructorParameters<typeof ExtensionViewManager>[1],
    Path.join(directory, "installed.json"),
    "1.3.17",
    true,
  );
  return { directory, manager };
}

async function exchangeUpdateFixture() {
  const { directory, manager } = fixture();
  const source = Path.join(directory, "source");
  FS.mkdirSync(Path.join(source, "dist"), { recursive: true });
  FS.copyFileSync(
    Path.join(directory, "dist", "index.html"),
    Path.join(source, "dist", "index.html"),
  );
  const manifest = JSON.parse(FS.readFileSync(Path.join(directory, "tabs-extension.json"), "utf8"));
  FS.writeFileSync(Path.join(source, "tabs-extension.json"), JSON.stringify(manifest));
  const firstArchive = Path.join(directory, "first.tabsext");
  const first = await packTabsext({
    directory: source,
    destination: firstArchive,
    tabsVersion: "1.3.17",
  });
  const installed = await manager.installVerifiedExchangePackage(
    firstArchive,
    "https://exchange.tabs.example",
    first.digest,
  );
  manager.setAssignment(installed.id, {
    ...installed.assignment,
    enabledProjectIds: ["project-a"],
  });
  manifest.version = "1.0.1";
  FS.writeFileSync(Path.join(source, "tabs-extension.json"), JSON.stringify(manifest));
  const secondArchive = Path.join(directory, "second.tabsext");
  const second = await packTabsext({
    directory: source,
    destination: secondArchive,
    tabsVersion: "1.3.17",
  });
  await manager.installVerifiedExchangePackage(
    secondArchive,
    "https://exchange.tabs.example",
    second.digest,
  );
  return { directory, manager, installed, first, second };
}

function mockElectronExtensionView(loadURL: (url: string) => Promise<unknown>): void {
  vi.mocked(electronSession.fromPartition).mockReturnValue({
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    webRequest: { onBeforeRequest: vi.fn(), onHeadersReceived: vi.fn() },
    protocol: { registerFileProtocol: vi.fn() },
  } as never);
  vi.mocked(WebContentsView).mockImplementation(function MockExtensionView() {
    return {
      webContents: {
        setWindowOpenHandler: vi.fn(),
        on: vi.fn(),
        loadURL,
        close: vi.fn(),
      },
      setBounds: vi.fn(),
    } as never;
  });
}

afterEach(() => {
  vi.mocked(electronSession.fromPartition).mockReset();
  vi.mocked(WebContentsView).mockReset();
  for (const directory of temporaryRoots.splice(0))
    FS.rmSync(directory, { recursive: true, force: true });
});

describe("development extension installation", () => {
  it("disables active tools without erasing assignments or profiles", async () => {
    const { directory, manager } = fixture();
    const installed = manager.installDevelopment(directory);
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a"],
    });
    manager.addProfile(installed.id, "work", "Work");
    const detachToolView = vi.fn();
    const close = vi.fn();
    const internal = manager as unknown as {
      coordinator: { detachToolView: typeof detachToolView };
      active: { extensionId: string; view: { webContents: { close: typeof close } } } | null;
    };
    internal.coordinator.detachToolView = detachToolView;
    internal.active = { extensionId: installed.id, view: { webContents: { close } } };
    manager.setDisabled(installed.id, true);
    expect(detachToolView).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(manager.list()[0]).toMatchObject({
      disabled: true,
      assignment: { enabledProjectIds: ["project-a"] },
      profiles: [{ id: "default" }, { id: "work" }],
    });
    await expect(
      manager.activate({
        extensionId: installed.id,
        toolId: "main",
        projectId: "project-a",
        profileId: "default",
      }),
    ).rejects.toThrow(/disabled/);
    const restarted = new ExtensionViewManager(
      () => null,
      {} as ConstructorParameters<typeof ExtensionViewManager>[1],
      Path.join(directory, "installed.json"),
      "1.3.17",
      true,
    );
    expect(restarted.list()[0]?.disabled).toBe(true);
    restarted.installDevelopment(directory);
    expect(restarted.list()[0]?.disabled).toBe(true);
    restarted.setDisabled(installed.id, false);
    expect(restarted.list()[0]?.disabled).toBeUndefined();
    expect(restarted.list()[0]?.assignment.enabledProjectIds).toEqual(["project-a"]);
  });

  it("rejects update pinning for non-Exchange extensions", () => {
    const { directory, manager } = fixture();
    const installed = manager.installDevelopment(directory);
    expect(() => manager.setUpdatesPinned(installed.id, true)).toThrow(/Only Exchange/);
  });
  it("uses separate browser partitions for project-isolated profiles", () => {
    expect(extensionSessionPartition("acme.dashboard", "work", "shared", "project-a")).toBe(
      extensionSessionPartition("acme.dashboard", "work", "shared", "project-b"),
    );
    expect(extensionSessionPartition("acme.dashboard", "work", "project", "project-a")).not.toBe(
      extensionSessionPartition("acme.dashboard", "work", "project", "project-b"),
    );
    expect(
      extensionSessionPartition(
        "acme.dashboard",
        "work",
        "shared",
        "project-a",
        "https://registry-a.example",
      ),
    ).not.toBe(
      extensionSessionPartition(
        "acme.dashboard",
        "work",
        "shared",
        "project-a",
        "https://registry-b.example",
      ),
    );
    expect(extensionDataIdentity("acme.dashboard", "https://registry-a.example")).not.toBe(
      extensionDataIdentity("acme.dashboard", "https://registry-b.example"),
    );
    expect(extensionDataIdentity("acme.dashboard", undefined, "development")).not.toBe(
      extensionDataIdentity("acme.dashboard", undefined, "local-package"),
    );
  });

  it("records an immutable scope for each new profile", () => {
    const { directory, manager } = fixture();
    const installed = manager.installDevelopment(directory);
    manager.addProfile(installed.id, "work", "Work", "project");
    expect(manager.list()[0]?.profiles).toContainEqual({
      id: "work",
      label: "Work",
      scope: "project",
    });
    const restarted = new ExtensionViewManager(
      () => null,
      {} as ConstructorParameters<typeof ExtensionViewManager>[1],
      Path.join(directory, "installed.json"),
      "1.3.17",
      true,
    );
    expect(restarted.list()[0]?.profiles).toContainEqual({
      id: "work",
      label: "Work",
      scope: "project",
    });
  });

  it("binds storage to the active view and a project grant", () => {
    const { directory, manager } = fixture();
    const manifestPath = Path.join(directory, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
    manifest.capabilities = ["profile-storage"];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    const installed = manager.installDevelopment(directory);
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a"],
      storageGrantedProjectIds: ["project-a"],
    });
    const sender = { isDestroyed: () => false };
    const internal = manager as unknown as {
      active: {
        key: string;
        view: { webContents: typeof sender };
        extensionId: string;
        projectId: string;
        profileId: string;
      } | null;
    };
    internal.active = {
      key: "active",
      view: { webContents: sender },
      extensionId: installed.id,
      projectId: "project-a",
      profileId: "default",
    };
    expect(() =>
      manager.invokeStorage({ isDestroyed: () => false } as never, {
        kind: "get",
        key: "theme",
      }),
    ).toThrow(/no longer active/);
    manager.invokeStorage(sender as never, { kind: "set", key: "theme", value: "dark" });
    expect(manager.invokeStorage(sender as never, { kind: "get", key: "theme" })).toBe("dark");
    internal.active = null;
    manager.setAssignment(installed.id, {
      ...manager.list()[0]!.assignment,
      storageGrantedProjectIds: [],
    });
    internal.active = {
      key: "stale",
      view: { webContents: sender },
      extensionId: installed.id,
      projectId: "project-a",
      profileId: "default",
    };
    expect(() => manager.invokeStorage(sender as never, { kind: "get", key: "theme" })).toThrow(
      /not granted/,
    );
  });

  it("binds workspace reads to the active project and revokes in-flight access", async () => {
    const { directory, manager } = fixture();
    const manifestPath = Path.join(directory, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
    manifest.capabilities = ["workspace-read"];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    const installed = manager.installDevelopment(directory);
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a"],
      workspaceReadGrantedProjectIds: ["project-a"],
    });
    const sender = { isDestroyed: () => false, close: vi.fn() };
    const internal = manager as unknown as {
      active: unknown;
      coordinator: unknown;
    };
    internal.coordinator = { detachToolView: vi.fn() };
    internal.active = {
      key: "active",
      view: { webContents: sender },
      extensionId: installed.id,
      projectId: "project-a",
      profileId: "default",
    };
    const read = vi.fn(async (projectId: string) => `${projectId}:hello`);
    await expect(manager.invokeWorkspaceRead(sender as never, "docs/intro.md", read)).resolves.toBe(
      "project-a:hello",
    );
    expect(read).toHaveBeenCalledWith("project-a", "docs/intro.md");
    await expect(
      manager.invokeWorkspaceRead({ isDestroyed: () => false } as never, "docs/intro.md", read),
    ).rejects.toThrow(/no longer active/);
    manager.setAssignment(installed.id, {
      ...manager.list()[0]!.assignment,
      workspaceReadGrantedProjectIds: [],
    });
    internal.active = {
      key: "revoked-grant",
      view: { webContents: sender },
      extensionId: installed.id,
      projectId: "project-a",
      profileId: "default",
    };
    await expect(
      manager.invokeWorkspaceRead(sender as never, "docs/intro.md", read),
    ).rejects.toThrow(/not granted/);
    manager.setAssignment(installed.id, {
      ...manager.list()[0]!.assignment,
      workspaceReadGrantedProjectIds: ["project-a"],
    });
    internal.active = {
      key: "renewed-grant",
      view: { webContents: sender },
      extensionId: installed.id,
      projectId: "project-a",
      profileId: "default",
    };
    let resolveRead: (value: string) => void = () => {};
    const pending = new Promise<string>((resolve) => {
      resolveRead = resolve;
    });
    const inFlight = manager.invokeWorkspaceRead(sender as never, "docs/intro.md", () => pending);
    manager.setDisabled(installed.id, true);
    resolveRead("secret");
    await expect(inFlight).rejects.toThrow(/changed during workspace read/);
  });

  it("clears the network grant when a development update adds a destination", () => {
    const { directory, manager } = fixture();
    const manifestPath = Path.join(directory, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
    manifest.capabilities = ["network"];
    manifest.networkHosts = ["api.example.com"];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    const installed = manager.installDevelopment(directory);
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a"],
      networkGrantedProjectIds: ["project-a"],
    });
    manifest.networkHosts.push("new.example.com");
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    manager.installDevelopment(directory);
    expect(manager.list()[0]?.assignment.networkGrantedProjectIds).toEqual([]);
  });

  it("keeps one named project-isolated profile separate across projects", () => {
    const { directory, manager } = fixture();
    const manifestPath = Path.join(directory, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
    manifest.capabilities = ["profile-storage"];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    const installed = manager.installDevelopment(directory);
    manager.addProfile(installed.id, "work", "Work", "project");
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a", "project-b"],
      storageGrantedProjectIds: ["project-a", "project-b"],
      defaultProfileId: "work",
    });
    const sender = { isDestroyed: () => false };
    const internal = manager as unknown as {
      active: {
        key: string;
        view: { webContents: typeof sender };
        extensionId: string;
        projectId: string;
        profileId: string;
      } | null;
    };
    internal.active = {
      key: "a",
      view: { webContents: sender },
      extensionId: installed.id,
      projectId: "project-a",
      profileId: "work",
    };
    manager.invokeStorage(sender as never, { kind: "set", key: "value", value: "a" });
    internal.active = { ...internal.active, key: "b", projectId: "project-b" };
    expect(manager.invokeStorage(sender as never, { kind: "get", key: "value" })).toBeNull();
  });

  it("clears stale storage grants when an update first requests storage", () => {
    const { directory, manager } = fixture();
    const first = manager.installDevelopment(directory);
    manager.setAssignment(first.id, {
      ...first.assignment,
      storageGrantedProjectIds: ["project-a"],
    });
    const manifestPath = Path.join(directory, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
    manifest.version = "1.0.1";
    manifest.capabilities = ["profile-storage"];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(manager.installDevelopment(directory).assignment.storageGrantedProjectIds).toEqual([]);
  });

  it("installs a manifest once and preserves project assignments", () => {
    const { directory, manager } = fixture();
    const installed = manager.installDevelopment(directory);
    expect(installed.id).toBe("acme.dashboard");
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a"],
    });
    expect(manager.list()[0]?.assignment.enabledProjectIds).toEqual(["project-a"]);
    manager.addProfile(installed.id, "personal", "Personal");
    expect(manager.list()[0]?.profiles.map((profile) => profile.id)).toEqual([
      "default",
      "personal",
    ]);
  });

  it("uninstalls a development tool without deleting its source or retained profiles", () => {
    const { directory, manager } = fixture();
    const installed = manager.installDevelopment(directory);
    const firstIndex = JSON.parse(FS.readFileSync(Path.join(directory, "installed.json"), "utf8"));
    expect(firstIndex[0].dataInventoryVersion).toBe(1);
    expect(firstIndex[0].usedPartitions).toEqual([]);
    manager.addProfile(installed.id, "work", "Work", "project");
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a"],
    });
    manager.uninstall(installed.id);
    expect(manager.list()).toEqual([]);
    expect(FS.existsSync(Path.join(directory, "tabs-extension.json"))).toBe(true);
    const reinstalled = manager.installDevelopment(directory);
    expect(reinstalled.profiles.map((profile) => profile.id)).toEqual(["default", "work"]);
    expect(reinstalled.assignment.enabledProjectIds).toEqual([]);
    const nextIndex = JSON.parse(FS.readFileSync(Path.join(directory, "installed.json"), "utf8"));
    expect(nextIndex[0].dataInventoryVersion).toBe(1);
  });

  it("deletes inventoried local data and profiles only after an explicit choice", async () => {
    const { directory, manager } = fixture();
    let installed = manager.installDevelopment(directory);
    manager.addProfile(installed.id, "work", "Work", "project");
    manager.uninstall(installed.id);
    installed = manager.installDevelopment(directory);
    expect(installed.profiles.map((profile) => profile.id)).toEqual(["default", "work"]);
    expect(installed.dataDeletionAvailable).toBe(true);
    const storage = new ExtensionStorage(Path.join(directory, "extension-storage"));
    const identity = {
      extensionId: extensionDataIdentity(installed.id),
      profileId: "work",
      projectId: "project-a",
    };
    const secondIdentity = { ...identity, projectId: "project-b" };
    storage.invoke(identity, { kind: "set", key: "value", value: "private" });
    storage.invoke(secondIdentity, { kind: "set", key: "value", value: "other" });
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a", "project-b"],
      defaultProfileId: "work",
    });
    await expect(
      manager.activate({
        extensionId: installed.id,
        toolId: "main",
        projectId: "project-a",
        profileId: "work",
      }),
    ).rejects.toThrow();
    await expect(
      manager.activate({
        extensionId: installed.id,
        toolId: "main",
        projectId: "project-b",
        profileId: "work",
      }),
    ).rejects.toThrow();
    const partition = extensionSessionPartition(installed.id, "work", "project", "project-a");
    const secondPartition = extensionSessionPartition(installed.id, "work", "project", "project-b");
    const clearData = vi.fn(async () => undefined);
    const fakeSession = {
      closeAllConnections: vi.fn(async () => undefined),
      clearData,
      clearAuthCache: vi.fn(async () => undefined),
      clearCodeCaches: vi.fn(async () => undefined),
      flushStorageData: vi.fn(),
      cookies: { flushStore: vi.fn(async () => undefined) },
    };
    vi.mocked(electronSession.fromPartition)
      .mockReset()
      .mockReturnValue(fakeSession as never);
    await manager.uninstallAndDeleteData(installed.id);
    expect(electronSession.fromPartition).toHaveBeenCalledWith(partition);
    expect(electronSession.fromPartition).toHaveBeenCalledWith(secondPartition);
    expect(clearData).toHaveBeenCalledTimes(2);
    expect(storage.invoke(identity, { kind: "get", key: "value" })).toBeNull();
    expect(storage.invoke(secondIdentity, { kind: "get", key: "value" })).toBeNull();
    expect(manager.list()).toEqual([]);
    expect(manager.installDevelopment(directory).profiles.map((profile) => profile.id)).toEqual([
      "default",
    ]);
  });

  it("keeps an installation available for retry when browser data clearing fails", async () => {
    const { directory, manager } = fixture();
    const installed = manager.installDevelopment(directory);
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a"],
    });
    await expect(
      manager.activate({
        extensionId: installed.id,
        toolId: "main",
        projectId: "project-a",
        profileId: "default",
      }),
    ).rejects.toThrow();
    vi.mocked(electronSession.fromPartition).mockReturnValue({
      closeAllConnections: vi.fn(async () => undefined),
      clearData: vi.fn(async () => {
        throw new Error("clear failed");
      }),
    } as never);
    const deletion = manager.uninstallAndDeleteData(installed.id);
    expect(() => manager.setAssignment(installed.id, installed.assignment)).toThrow(/in progress/);
    await expect(deletion).rejects.toThrow(/clear failed/);
    expect(manager.list()[0]?.id).toBe(installed.id);
  });

  it("refuses complete deletion of an older installation without an inventory", async () => {
    const { directory, manager } = fixture();
    const legacy = Path.join(directory, "extension-storage", "ab");
    FS.mkdirSync(legacy, { recursive: true });
    FS.writeFileSync(Path.join(legacy, `${"a".repeat(64)}.json`), "{}");
    const installed = manager.installDevelopment(directory);
    expect(installed.dataDeletionAvailable).toBe(false);
    await expect(manager.uninstallAndDeleteData(installed.id)).rejects.toThrow(/inventory/);
    expect(manager.list()[0]?.id).toBe(installed.id);
  });

  it("discards an extracted package when a data deletion invalidates an in-flight install", () => {
    const { directory, manager } = fixture();
    const extracted = Path.join(directory, "extension-packages", "acme.dashboard", "digest");
    FS.mkdirSync(extracted, { recursive: true });
    FS.writeFileSync(Path.join(extracted, "stale.txt"), "stale");
    const internal = manager as unknown as {
      deletionEpoch: number;
      assertInstallEpoch: (id: string, expected: number, extracted: string) => void;
    };
    internal.deletionEpoch = 1;
    expect(() => internal.assertInstallEpoch("acme.dashboard", 0, extracted)).toThrow(/retry/);
    expect(FS.existsSync(extracted)).toBe(false);
  });

  it("does not claim a complete deletion inventory when legacy storage exists", () => {
    const { directory, manager } = fixture();
    const legacyDirectory = Path.join(directory, "extension-storage", "ab");
    FS.mkdirSync(legacyDirectory, { recursive: true });
    FS.writeFileSync(Path.join(legacyDirectory, `${"a".repeat(64)}.json`), "{}");
    manager.installDevelopment(directory);
    const index = JSON.parse(FS.readFileSync(Path.join(directory, "installed.json"), "utf8"));
    expect(index[0].dataInventoryVersion).toBeUndefined();
  });

  it("records a browser partition before attempting to create its view", async () => {
    const { directory, manager } = fixture();
    const installed = manager.installDevelopment(directory);
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a"],
    });
    await expect(
      manager.activate({
        extensionId: installed.id,
        toolId: "main",
        projectId: "project-a",
        profileId: "default",
      }),
    ).rejects.toThrow(); // Electron is mocked; inventory must precede view creation.
    const index = JSON.parse(FS.readFileSync(Path.join(directory, "installed.json"), "utf8"));
    expect(index[0].usedPartitions).toEqual([
      extensionSessionPartition(
        installed.id,
        "default",
        undefined,
        "project-a",
        undefined,
        "development",
      ),
    ]);
  });

  it("rejects symlinked package assets", () => {
    const { directory, manager } = fixture();
    FS.symlinkSync(
      Path.join(directory, "dist", "index.html"),
      Path.join(directory, "dist", "linked.html"),
    );
    expect(() => manager.installDevelopment(directory)).toThrow(/regular files/);
  });

  it("rejects unsupported manifest execution fields", () => {
    const { directory, manager } = fixture();
    const path = Path.join(directory, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(path, "utf8"));
    manifest.runtime = { entry: "dist/index.js" };
    FS.writeFileSync(path, JSON.stringify(manifest));
    expect(() => manager.installDevelopment(directory)).toThrow(/Unsupported manifest field/);
  });

  it("does not load development folders in a packaged build", () => {
    const { directory, manager } = fixture();
    manager.installDevelopment(directory);
    const packaged = new ExtensionViewManager(
      () => null,
      {} as ConstructorParameters<typeof ExtensionViewManager>[1],
      Path.join(directory, "installed.json"),
      "1.3.17",
      false,
    );
    expect(packaged.list()).toEqual([]);
    expect(() => packaged.installDevelopment(directory)).toThrow(/disabled/);
  });

  it("loads verified Exchange packages in packaged builds and rejects registry replacement", async () => {
    const { directory, manager } = fixture();
    const archive = Path.join(directory, "exchange.tabsext");
    const info = await packTabsext({
      directory,
      destination: archive,
      tabsVersion: "1.3.17",
    });
    const installed = await manager.installVerifiedExchangePackage(
      archive,
      "https://exchange.tabs.example",
      info.digest,
    );
    expect(installed.source).toBe("exchange");
    expect(installed.assignment.enabledGlobally).toBe(false);
    manager.setUpdatesPinned(installed.id, true);
    expect(manager.list()[0]?.updatesPinned).toBe(true);
    const packaged = new ExtensionViewManager(
      () => null,
      {} as ConstructorParameters<typeof ExtensionViewManager>[1],
      Path.join(directory, "installed.json"),
      "1.3.17",
      false,
    );
    expect(packaged.list()[0]?.digest).toBe(info.digest);
    expect(packaged.list()[0]?.updatesPinned).toBe(true);
    packaged.setUpdatesPinned(installed.id, false);
    expect(packaged.list()[0]?.updatesPinned).toBeUndefined();
    await expect(
      packaged.installVerifiedExchangePackage(archive, "https://evil.example", info.digest),
    ).rejects.toThrow(/another registry/);
    await expect(
      packaged.installVerifiedExchangePackage(
        archive,
        "https://exchange.tabs.example",
        "0".repeat(64),
      ),
    ).rejects.toThrow(/digest differs/);
    expect(
      packaged.revokeIfCurrent(installed.id, "https://exchange.tabs.example", "0".repeat(64)),
    ).toBe(false);
    packaged.setUpdatesPinned(installed.id, true);
    expect(
      packaged.revokeIfCurrent(installed.id, "https://exchange.tabs.example", info.digest),
    ).toBe(true);
    expect(packaged.list()[0]?.revoked).toBe(true);
    expect(packaged.list()[0]?.updatesPinned).toBe(true);
    expect(() => packaged.setAssignment(installed.id, installed.assignment)).toThrow(/revoked/);
    const staleSender = { isDestroyed: () => false };
    (packaged as unknown as { active: unknown }).active = {
      key: "stale",
      view: { webContents: staleSender },
      extensionId: installed.id,
      projectId: "project-a",
      profileId: "default",
    };
    expect(() =>
      packaged.invokeStorage(staleSender as never, { kind: "get", key: "value" }),
    ).toThrow(/revoked/);
    (packaged as unknown as { active: unknown }).active = null;
    await expect(
      packaged.activate({
        extensionId: installed.id,
        toolId: "main",
        projectId: "project-a",
        profileId: "default",
      }),
    ).rejects.toThrow(/revoked/);
    const restarted = new ExtensionViewManager(
      () => null,
      {} as ConstructorParameters<typeof ExtensionViewManager>[1],
      Path.join(directory, "installed.json"),
      "1.3.17",
      false,
    );
    expect(restarted.list()[0]?.revoked).toBe(true);
  });

  it("persists a verified rollback checkpoint and restores it when the update cannot load", async () => {
    const { directory, manager, installed, first, second } = await exchangeUpdateFixture();
    expect(manager.list()[0]?.digest).toBe(second.digest);
    expect(manager.list()[0]?.assignment.enabledProjectIds).toEqual(["project-a"]);
    const restarted = new ExtensionViewManager(
      () => null,
      {} as ConstructorParameters<typeof ExtensionViewManager>[1],
      Path.join(directory, "installed.json"),
      "1.3.17",
      false,
    );
    expect(restarted.list()[0]?.digest).toBe(second.digest);
    expect(restarted.list()[0]).not.toHaveProperty("pendingRollback");
    FS.unlinkSync(
      Path.join(directory, "extension-packages", installed.id, second.digest, "dist", "index.html"),
    );
    await expect(
      restarted.activate({
        extensionId: installed.id,
        toolId: "main",
        projectId: "project-a",
        profileId: "default",
      }),
    ).rejects.toThrow(/rolled back/);
    expect(restarted.list()[0]?.digest).toBe(first.digest);
    expect(restarted.list()[0]?.assignment.enabledProjectIds).toEqual(["project-a"]);
    const recovered = new ExtensionViewManager(
      () => null,
      {} as ConstructorParameters<typeof ExtensionViewManager>[1],
      Path.join(directory, "installed.json"),
      "1.3.17",
      false,
    );
    expect(recovered.list()[0]?.digest).toBe(first.digest);
  });

  it("commits an Exchange update only after its first view loads", async () => {
    const { directory, manager, installed, second } = await exchangeUpdateFixture();
    const attachToolView = vi.fn();
    const detachToolView = vi.fn();
    (manager as unknown as { coordinator: unknown }).coordinator = {
      attachToolView,
      detachToolView,
    };
    const loadURL = vi.fn(async () => undefined);
    mockElectronExtensionView(loadURL);
    await manager.activate({
      extensionId: installed.id,
      toolId: "main",
      projectId: "project-a",
      profileId: "default",
    });
    expect(loadURL).toHaveBeenCalledOnce();
    expect(attachToolView).toHaveBeenCalledOnce();
    expect(manager.list()[0]?.digest).toBe(second.digest);
    const persisted = JSON.parse(FS.readFileSync(Path.join(directory, "installed.json"), "utf8"));
    expect(persisted[0]).not.toHaveProperty("pendingRollback");
    const restarted = new ExtensionViewManager(
      () => null,
      {} as ConstructorParameters<typeof ExtensionViewManager>[1],
      Path.join(directory, "installed.json"),
      "1.3.17",
      false,
    );
    expect(restarted.list()[0]?.digest).toBe(second.digest);
  });

  it("rolls back an Exchange update when Electron rejects the first navigation", async () => {
    const { manager, installed, first } = await exchangeUpdateFixture();
    (manager as unknown as { coordinator: unknown }).coordinator = {
      attachToolView: vi.fn(),
      detachToolView: vi.fn(),
    };
    const loadURL = vi.fn(async () => {
      throw new Error("renderer load failed");
    });
    mockElectronExtensionView(loadURL);
    await expect(
      manager.activate({
        extensionId: installed.id,
        toolId: "main",
        projectId: "project-a",
        profileId: "default",
      }),
    ).rejects.toThrow(/rolled back/);
    expect(loadURL).toHaveBeenCalledOnce();
    expect(manager.list()[0]?.digest).toBe(first.digest);
  });

  it("disables a failed update when the retained rollback package is missing", async () => {
    const { directory, manager, installed, first, second } = await exchangeUpdateFixture();
    FS.rmSync(Path.join(directory, "extension-packages", installed.id, first.digest), {
      recursive: true,
    });
    FS.unlinkSync(
      Path.join(directory, "extension-packages", installed.id, second.digest, "dist", "index.html"),
    );
    const restartedBeforeActivation = new ExtensionViewManager(
      () => null,
      {} as ConstructorParameters<typeof ExtensionViewManager>[1],
      Path.join(directory, "installed.json"),
      "1.3.17",
      false,
    );
    expect(restartedBeforeActivation.list()[0]).toMatchObject({
      digest: second.digest,
      disabled: true,
    });
    await expect(
      manager.activate({
        extensionId: installed.id,
        toolId: "main",
        projectId: "project-a",
        profileId: "default",
      }),
    ).rejects.toThrow(/unavailable/);
    expect(manager.list()[0]).toMatchObject({ digest: second.digest, disabled: true });
    const restarted = new ExtensionViewManager(
      () => null,
      {} as ConstructorParameters<typeof ExtensionViewManager>[1],
      Path.join(directory, "installed.json"),
      "1.3.17",
      false,
    );
    expect(restarted.list()[0]).toMatchObject({ digest: second.digest, disabled: true });
  });

  it("does not inherit development profiles or grants when switching package source", async () => {
    const { directory, manager } = fixture();
    const development = manager.installDevelopment(directory);
    manager.addProfile(development.id, "work", "Work");
    const archive = Path.join(directory, "source-change.tabsext");
    const info = await packTabsext({ directory, destination: archive, tabsVersion: "1.3.17" });
    await expect(
      manager.installVerifiedExchangePackage(archive, "https://exchange.tabs.example", info.digest),
    ).rejects.toThrow(/Uninstall the existing extension/);
    expect(manager.list()[0]?.source).toBe("development");
  });

  it("refuses to uninstall through a replaced package-directory symlink", async () => {
    const { directory, manager } = fixture();
    const archive = Path.join(directory, "symlink-uninstall.tabsext");
    const info = await packTabsext({ directory, destination: archive, tabsVersion: "1.3.17" });
    const installed = await manager.installVerifiedExchangePackage(
      archive,
      "https://exchange.tabs.example",
      info.digest,
    );
    const packageDirectory = Path.join(directory, "extension-packages", installed.id);
    const backup = `${packageDirectory}-backup`;
    FS.renameSync(packageDirectory, backup);
    const outside = Path.join(directory, "outside");
    FS.mkdirSync(outside);
    FS.writeFileSync(Path.join(outside, "keep.txt"), "keep");
    FS.symlinkSync(outside, packageDirectory);
    expect(() => manager.uninstall(installed.id)).toThrow(/symbolic link/);
    expect(FS.readFileSync(Path.join(outside, "keep.txt"), "utf8")).toBe("keep");
    expect(manager.list()[0]?.id).toBe(installed.id);
  });

  it("requires fresh project consent when an Exchange update adds privileged access", async () => {
    const { directory, manager } = fixture();
    const source = Path.join(directory, "source");
    FS.mkdirSync(Path.join(source, "dist"), { recursive: true });
    FS.copyFileSync(
      Path.join(directory, "dist", "index.html"),
      Path.join(source, "dist", "index.html"),
    );
    const manifestPath = Path.join(source, "tabs-extension.json");
    const manifest = JSON.parse(
      FS.readFileSync(Path.join(directory, "tabs-extension.json"), "utf8"),
    );
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    const firstArchive = Path.join(directory, "first-exchange.tabsext");
    const first = await packTabsext({
      directory: source,
      destination: firstArchive,
      tabsVersion: "1.3.17",
    });
    const installed = await manager.installVerifiedExchangePackage(
      firstArchive,
      "https://exchange.tabs.example",
      first.digest,
    );
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a"],
      storageGrantedProjectIds: ["project-a"],
    });
    manager.addProfile(installed.id, "work", "Work");
    manager.setDisabled(installed.id, true);
    manager.setUpdatesPinned(installed.id, true);
    manifest.version = "1.0.1";
    manifest.capabilities = ["profile-storage", "workspace-read"];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    const updateArchive = Path.join(directory, "updated-exchange.tabsext");
    const update = await packTabsext({
      directory: source,
      destination: updateArchive,
      tabsVersion: "1.3.17",
    });
    const updated = await manager.installVerifiedExchangePackage(
      updateArchive,
      "https://exchange.tabs.example",
      update.digest,
    );
    expect(updated.disabled).toBe(true);
    expect(updated.updatesPinned).toBe(true);
    manager.setDisabled(installed.id, false);
    await expect(
      manager.installVerifiedExchangePackage(
        firstArchive,
        "https://exchange.tabs.example",
        first.digest,
      ),
    ).rejects.toThrow(/downgrade/);
    expect(manager.list()[0]?.digest).toBe(update.digest);
    expect(updated.assignment.enabledProjectIds).toEqual([]);
    expect(updated.assignment.storageGrantedProjectIds).toEqual([]);
    expect(updated.assignment.workspaceReadGrantedProjectIds).toEqual([]);
    expect(updated.profiles.map((profile) => profile.id)).toEqual(["default", "work"]);
    expect(
      FS.existsSync(Path.join(directory, "extension-packages", installed.id, first.digest)),
    ).toBe(true);
    manager.setAssignment(installed.id, {
      ...updated.assignment,
      enabledProjectIds: ["project-a"],
      storageGrantedProjectIds: ["project-a"],
    });
    const sender = { isDestroyed: () => false };
    const internal = manager as unknown as { active: unknown };
    internal.active = {
      key: "original-registry",
      view: { webContents: sender },
      extensionId: installed.id,
      projectId: "project-a",
      profileId: "default",
    };
    manager.invokeStorage(sender as never, { kind: "set", key: "private", value: "registry-a" });
    internal.active = null;
    manager.uninstall(installed.id);
    expect(manager.list()).toEqual([]);
    expect(FS.existsSync(Path.join(directory, "extension-packages", installed.id))).toBe(false);
    const otherRegistry = await manager.installVerifiedExchangePackage(
      updateArchive,
      "https://other.example",
      update.digest,
    );
    expect(otherRegistry.profiles.map((profile) => profile.id)).toEqual(["default"]);
    manager.setAssignment(installed.id, {
      ...otherRegistry.assignment,
      enabledProjectIds: ["project-a"],
      storageGrantedProjectIds: ["project-a"],
    });
    internal.active = {
      key: "other-registry",
      view: { webContents: sender },
      extensionId: installed.id,
      projectId: "project-a",
      profileId: "default",
    };
    expect(manager.invokeStorage(sender as never, { kind: "get", key: "private" })).toBeNull();
    internal.active = null;
    manager.uninstall(installed.id);
    const reinstalled = await manager.installVerifiedExchangePackage(
      updateArchive,
      "https://exchange.tabs.example",
      update.digest,
    );
    expect(reinstalled.profiles.map((profile) => profile.id)).toEqual(["default", "work"]);
    expect(reinstalled.assignment.enabledProjectIds).toEqual([]);
    manager.setAssignment(installed.id, {
      ...reinstalled.assignment,
      enabledProjectIds: ["project-a"],
      storageGrantedProjectIds: ["project-a"],
    });
    internal.active = {
      key: "restored-registry",
      view: { webContents: sender },
      extensionId: installed.id,
      projectId: "project-a",
      profileId: "default",
    };
    expect(manager.invokeStorage(sender as never, { kind: "get", key: "private" })).toBe(
      "registry-a",
    );
    internal.active = null;
  });

  it("imports a local package once and preserves assignments across replacement", async () => {
    const { directory, manager } = fixture();
    const archiveRoot = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-extension-archive-test-"));
    temporaryRoots.push(archiveRoot);
    const firstArchive = Path.join(archiveRoot, "first.tabsext");
    await packTabsext({ directory, destination: firstArchive, tabsVersion: "1.3.17" });
    const first = await manager.installLocalPackage(firstArchive);
    expect(first.source).toBe("local-package");
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
    manager.setAssignment(first.id, { ...first.assignment, enabledProjectIds: ["project-a"] });
    manager.addProfile(first.id, "work", "Work");
    expect(await manager.installLocalPackage(firstArchive)).toEqual(manager.list()[0]);

    const manifestPath = Path.join(directory, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
    manifest.version = "1.0.1";
    const updatedSource = Path.join(archiveRoot, "updated-source");
    FS.mkdirSync(Path.join(updatedSource, "dist"), { recursive: true });
    FS.copyFileSync(
      Path.join(directory, "dist", "index.html"),
      Path.join(updatedSource, "dist", "index.html"),
    );
    FS.writeFileSync(Path.join(updatedSource, "tabs-extension.json"), JSON.stringify(manifest));
    const secondArchive = Path.join(archiveRoot, "second.tabsext");
    await packTabsext({
      directory: updatedSource,
      destination: secondArchive,
      tabsVersion: "1.3.17",
    });
    const updated = await manager.installLocalPackage(secondArchive);
    expect(updated.manifest.version).toBe("1.0.1");
    expect(updated.assignment.enabledProjectIds).toEqual(["project-a"]);
    expect(updated.profiles.map((profile) => profile.id)).toEqual(["default", "work"]);
    expect(updated.digest).not.toBe(first.digest);

    const restarted = new ExtensionViewManager(
      () => null,
      {} as ConstructorParameters<typeof ExtensionViewManager>[1],
      Path.join(directory, "installed.json"),
      "1.3.17",
      true,
    );
    expect(restarted.list()).toEqual([updated]);
  });

  it("keeps local packages unavailable in production builds", async () => {
    const { directory } = fixture();
    const packaged = new ExtensionViewManager(
      () => null,
      {} as ConstructorParameters<typeof ExtensionViewManager>[1],
      Path.join(directory, "installed.json"),
      "1.3.17",
      false,
    );
    await expect(packaged.installLocalPackage("/tmp/example.tabsext")).rejects.toThrow(/disabled/);
  });
});
