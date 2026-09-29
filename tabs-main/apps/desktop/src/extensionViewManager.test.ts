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
  extensionAiToolName,
  extensionDataIdentity,
  extensionSessionPartition,
} from "./extensionViewManager";
import { ExtensionStorage } from "./extensionStorage";
import type { CredentialCryptography } from "./extensionCredentials";

const temporaryRoots: string[] = [];

function fixture(
  cryptography?: CredentialCryptography,
  networkGetText?: ConstructorParameters<typeof ExtensionViewManager>[6],
  logicRun?: ConstructorParameters<typeof ExtensionViewManager>[7],
): {
  directory: string;
  manager: ExtensionViewManager;
} {
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
    cryptography,
    networkGetText,
    logicRun,
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
  it("removes a newly extracted local package when installation cannot be saved", async () => {
    const { directory, manager } = fixture();
    const archive = Path.join(directory, "local.tabsext");
    const packageInfo = await packTabsext({
      directory,
      destination: archive,
      tabsVersion: "1.3.17",
    });
    const save = vi.spyOn(manager as unknown as { save: () => void }, "save");
    save.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    await expect(manager.installLocalPackage(archive)).rejects.toThrow("disk full");
    save.mockRestore();
    expect(manager.list()).toEqual([]);
    expect(
      FS.existsSync(
        Path.join(directory, "extension-packages", "acme.dashboard", packageInfo.digest),
      ),
    ).toBe(false);
    expect((await manager.installLocalPackage(archive)).digest).toBe(packageInfo.digest);
  });

  it("keeps the prior Exchange package and allows retry after a failed update save", async () => {
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
    manifest.version = "1.0.1";
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    const secondArchive = Path.join(directory, "second.tabsext");
    const second = await packTabsext({
      directory: source,
      destination: secondArchive,
      tabsVersion: "1.3.17",
    });
    const save = vi.spyOn(manager as unknown as { save: () => void }, "save");
    save.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    await expect(
      manager.installVerifiedExchangePackage(
        secondArchive,
        "https://exchange.tabs.example",
        second.digest,
      ),
    ).rejects.toThrow("disk full");
    save.mockRestore();
    expect(manager.list()[0]?.digest).toBe(installed.digest);
    expect(
      FS.existsSync(Path.join(directory, "extension-packages", installed.id, first.digest)),
    ).toBe(true);
    expect(
      FS.existsSync(Path.join(directory, "extension-packages", installed.id, second.digest)),
    ).toBe(false);
    expect(
      (
        await manager.installVerifiedExchangePackage(
          secondArchive,
          "https://exchange.tabs.example",
          second.digest,
        )
      ).digest,
    ).toBe(second.digest);
  });

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
    const sender = { isDestroyed: () => false, close: vi.fn() };
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

  it("binds Git status to the active project's explicit grant", async () => {
    const { directory, manager } = fixture();
    const manifestPath = Path.join(directory, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
    manifest.engines.api = "^1.5.0";
    manifest.capabilities = ["git-status"];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    const installed = manager.installDevelopment(directory);
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a"],
      gitStatusGrantedProjectIds: ["project-a"],
    });
    const sender = { isDestroyed: () => false, close: vi.fn() };
    const internal = manager as unknown as { active: unknown; coordinator: unknown };
    internal.coordinator = { detachToolView: vi.fn() };
    const active = () => {
      internal.active = {
        key: "git-status",
        view: { webContents: sender },
        extensionId: installed.id,
        projectId: "project-a",
        profileId: "default",
      };
    };
    active();
    const read = vi.fn(async () => ({ branch: "main", dirty: true }));
    await expect(manager.invokeGitStatus(sender as never, read)).resolves.toEqual({
      branch: "main",
      dirty: true,
    });
    expect(read).toHaveBeenCalledWith("project-a");
    await expect(
      manager.invokeGitStatus({ isDestroyed: () => false } as never, read),
    ).rejects.toThrow(/no longer active/);
    manager.setAssignment(installed.id, {
      ...manager.list()[0]!.assignment,
      gitStatusGrantedProjectIds: [],
    });
    active();
    await expect(manager.invokeGitStatus(sender as never, read)).rejects.toThrow(/not granted/);
    manager.setAssignment(installed.id, {
      ...manager.list()[0]!.assignment,
      gitStatusGrantedProjectIds: ["project-a"],
    });
    active();
    let resolveRead: (value: { branch: string; dirty: boolean }) => void = () => {};
    const pending = new Promise<{ branch: string; dirty: boolean }>((resolve) => {
      resolveRead = resolve;
    });
    const inFlight = manager.invokeGitStatus(sender as never, () => pending);
    manager.setDisabled(installed.id, true);
    resolveRead({ branch: "main", dirty: false });
    await expect(inFlight).rejects.toThrow(/changed during Git status request/);
  });

  it("clears the network grant when a development update adds a destination", () => {
    const { directory, manager } = fixture();
    const manifestPath = Path.join(directory, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
    manifest.capabilities = ["network", "credentials"];
    manifest.networkHosts = ["api.example.com"];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    const installed = manager.installDevelopment(directory);
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a"],
      networkGrantedProjectIds: ["project-a"],
      credentialGrantedProjectIds: ["project-a"],
    });
    manifest.networkHosts.push("new.example.com");
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    manager.installDevelopment(directory);
    expect(manager.list()[0]?.assignment.networkGrantedProjectIds).toEqual([]);
    expect(manager.list()[0]?.assignment.credentialGrantedProjectIds).toEqual([]);
  });

  it("binds credential use to the active view, project grant, host, and named profile", async () => {
    const cryptography: CredentialCryptography = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => "gnome_libsecret",
      encryptString: (value) => Buffer.from(`encrypted:${value}`),
      decryptString: (value) => value.toString().replace(/^encrypted:/, ""),
    };
    const networkGet = vi.fn(
      async (
        _url: string,
        _hosts: readonly string[],
        _token?: string,
        _transport?: unknown,
        _signal?: AbortSignal,
      ) => "hello",
    );
    const { directory, manager } = fixture(cryptography, networkGet);
    const manifestPath = Path.join(directory, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
    manifest.capabilities = ["network", "credentials"];
    manifest.networkHosts = ["api.example.com"];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    const installed = manager.installDevelopment(directory);
    manager.addProfile(installed.id, "work", "Work", "shared");
    manager.addProfile(installed.id, "personal", "Personal", "shared");
    manager.setProfileCredential(installed.id, "work", "api.example.com", "work-token");
    manager.setProfileCredential(installed.id, "personal", "api.example.com", "personal-token");
    expect(manager.listCredentialStatuses(installed.id)).toEqual([
      { profileId: "work", host: "api.example.com" },
      { profileId: "personal", host: "api.example.com" },
    ]);
    expect(() =>
      manager.setProfileCredential(installed.id, "work", "other.example.com", "token"),
    ).toThrow(/did not request/);
    manager.setAssignment(installed.id, {
      ...manager.list()[0]!.assignment,
      enabledProjectIds: ["project-a"],
      networkGrantedProjectIds: ["project-a"],
      credentialGrantedProjectIds: ["project-a"],
      defaultProfileId: "work",
    });
    const sender = { isDestroyed: () => false, close: vi.fn() };
    const internal = manager as unknown as { active: unknown; coordinator: unknown };
    internal.coordinator = { detachToolView: vi.fn() };
    internal.active = {
      key: "work",
      view: { webContents: sender },
      extensionId: installed.id,
      projectId: "project-a",
      profileId: "work",
    };
    await expect(
      manager.invokeNetworkGetText(sender as never, "https://api.example.com/me", true),
    ).resolves.toBe("hello");
    expect(networkGet).toHaveBeenCalledWith(
      "https://api.example.com/me",
      ["api.example.com"],
      "work-token",
      undefined,
      expect.any(AbortSignal),
    );
    manager.setAssignment(installed.id, {
      ...manager.list()[0]!.assignment,
      defaultProfileId: "personal",
    });
    internal.active = {
      key: "personal",
      view: { webContents: sender },
      extensionId: installed.id,
      projectId: "project-a",
      profileId: "personal",
    };
    await manager.invokeNetworkGetText(sender as never, "https://api.example.com/me", true);
    expect(networkGet).toHaveBeenLastCalledWith(
      "https://api.example.com/me",
      ["api.example.com"],
      "personal-token",
      undefined,
      expect.any(AbortSignal),
    );
    await expect(
      manager.invokeNetworkGetText(sender as never, "https://other.example.com/me", true),
    ).rejects.toThrow(/not declared/);
    networkGet.mockImplementationOnce(
      async (_url, _hosts, _token, _transport, signal) =>
        new Promise<string>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
        }),
    );
    const inFlight = manager.invokeNetworkGetText(
      sender as never,
      "https://api.example.com/me",
      true,
    );
    manager.setAssignment(installed.id, {
      ...manager.list()[0]!.assignment,
      credentialGrantedProjectIds: [],
    });
    await expect(inFlight).rejects.toThrow(/cancelled/);
    internal.active = {
      key: "revoked",
      view: { webContents: sender },
      extensionId: installed.id,
      projectId: "project-a",
      profileId: "personal",
    };
    await expect(
      manager.invokeNetworkGetText(sender as never, "https://api.example.com/me", true),
    ).rejects.toThrow(/not granted/);
    manager.setProfileCredential(installed.id, "work", "api.example.com", null);
    expect(manager.listCredentialStatuses(installed.id)).toEqual([
      { profileId: "personal", host: "api.example.com" },
    ]);
    manifest.capabilities = ["network"];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    manager.installDevelopment(directory);
    manager.setProfileCredential(installed.id, "personal", "api.example.com", null);
    expect(manager.listCredentialStatuses(installed.id)).toEqual([]);
  });

  it("binds a pure logic command to its active package, view, and project", async () => {
    const logicRun = vi.fn(async (_source: string, request: unknown) => request);
    const { directory, manager } = fixture(undefined, undefined, logicRun);
    const manifestPath = Path.join(directory, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
    manifest.logic = { entry: "dist/logic.js" };
    manifest.engines.api = "^1.2.0";
    manifest.contributes.commands = [{ id: "sum", label: "Sum", description: "Add values" }];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    FS.writeFileSync(Path.join(directory, "dist", "logic.js"), "globalThis.run = () => 3;");
    const installed = manager.installDevelopment(directory);
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a"],
    });
    const sender = { isDestroyed: () => false, close: vi.fn() };
    const internal = manager as unknown as { active: unknown; coordinator: unknown };
    internal.coordinator = { detachToolView: vi.fn() };
    internal.active = {
      key: "logic",
      view: { webContents: sender },
      extensionId: installed.id,
      projectId: "project-a",
      profileId: "default",
    };
    await expect(manager.invokeLogic(sender as never, "sum", { a: 1, b: 2 })).resolves.toEqual({
      commandId: "sum",
      input: { a: 1, b: 2 },
    });
    expect(logicRun).toHaveBeenCalledWith(
      "globalThis.run = () => 3;",
      { commandId: "sum", input: { a: 1, b: 2 } },
      { signal: expect.any(AbortSignal) },
    );
    await expect(
      manager.invokeLogic({ isDestroyed: () => false } as never, "sum", null),
    ).rejects.toThrow(/no longer active/);
    await expect(manager.invokeLogic(sender as never, "other", null)).rejects.toThrow(
      /unavailable/,
    );
    internal.active = {
      key: "other-project",
      view: { webContents: sender },
      extensionId: installed.id,
      projectId: "project-b",
      profileId: "default",
    };
    await expect(manager.invokeLogic(sender as never, "sum", null)).rejects.toThrow(/unavailable/);
  });

  it("exposes AI commands only for granted projects and rechecks profile changes", async () => {
    let finish: ((value: unknown) => void) | undefined;
    const logicRun = vi.fn(
      async () =>
        new Promise<unknown>((resolve) => {
          finish = resolve;
        }),
    );
    const { directory, manager } = fixture(undefined, undefined, logicRun);
    const manifestPath = Path.join(directory, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
    manifest.logic = { entry: "dist/logic.js" };
    manifest.engines.api = "^1.3.0";
    manifest.capabilities = ["ai-tools"];
    manifest.contributes.commands = [
      { id: "sum", label: "Sum", description: "Add values", aiCallable: true },
      { id: "private", label: "Private", description: "UI only" },
    ];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    FS.writeFileSync(Path.join(directory, "dist", "logic.js"), "globalThis.run = () => 3;");
    const installed = manager.installDevelopment(directory);
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a", "project-b"],
      aiToolGrantedProjectIds: ["project-a"],
    });
    const name = extensionAiToolName(installed.id, "sum", undefined, "development");
    expect(manager.listAiToolsForProject("project-a")).toEqual([
      expect.objectContaining({ name, commandId: "sum" }),
    ]);
    expect(manager.listAiToolsForProject("project-b")).toEqual([]);
    await expect(manager.invokeAiTool("project-b", name, {})).rejects.toThrow(/unavailable/);
    await expect(manager.invokeAiTool("project-a", "private", {})).rejects.toThrow(/unavailable/);
    const pending = manager.invokeAiTool("project-a", name, { a: 1, b: 2 });
    manager.addProfile(installed.id, "work", "Work", "shared");
    manager.setAssignment(installed.id, {
      ...manager.list()[0]!.assignment,
      profileIdByProjectId: { "project-a": "work" },
    });
    finish?.(3);
    await expect(pending).rejects.toThrow(/profile changed/);
    expect(logicRun).toHaveBeenCalledOnce();
    manager.setDisabled(installed.id, true);
    expect(manager.listAiToolsForProject("project-a")).toEqual([]);
  });

  it("runs a granted AI command in the disposable runtime", async () => {
    const { directory, manager } = fixture();
    const manifestPath = Path.join(directory, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
    manifest.logic = { entry: "dist/logic.js" };
    manifest.engines.api = "^1.3.0";
    manifest.capabilities = ["ai-tools"];
    manifest.contributes.commands = [
      { id: "sum", label: "Sum", description: "Add numbers", aiCallable: true },
    ];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    FS.writeFileSync(
      Path.join(directory, "dist", "logic.js"),
      "globalThis.run = ({ input }) => input.first + input.second;",
    );
    const installed = manager.installDevelopment(directory);
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a"],
      aiToolGrantedProjectIds: ["project-a"],
    });
    const tool = manager.listAiToolsForProject("project-a")[0]!;
    await expect(
      manager.invokeAiTool("project-a", tool.name, { first: 3, second: 4 }),
    ).resolves.toBe(7);
  });

  it("cancels an in-flight AI command when its project grant is revoked", async () => {
    const logicRun = vi.fn(
      async (_source: string, _request: unknown, options?: { signal?: AbortSignal }) =>
        new Promise<unknown>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), {
            once: true,
          });
        }),
    );
    const { directory, manager } = fixture(undefined, undefined, logicRun);
    const manifestPath = Path.join(directory, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
    manifest.logic = { entry: "dist/logic.js" };
    manifest.engines.api = "^1.3.0";
    manifest.capabilities = ["ai-tools"];
    manifest.contributes.commands = [
      { id: "sum", label: "Sum", description: "Add numbers", aiCallable: true },
    ];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    FS.writeFileSync(Path.join(directory, "dist", "logic.js"), "globalThis.run = () => 0;");
    const installed = manager.installDevelopment(directory);
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a"],
      aiToolGrantedProjectIds: ["project-a"],
    });
    const tool = manager.listAiToolsForProject("project-a")[0]!;
    const pending = manager.invokeAiTool("project-a", tool.name, {});
    manager.setAssignment(installed.id, {
      ...manager.list()[0]!.assignment,
      aiToolGrantedProjectIds: [],
    });
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(manager.listAiToolsForProject("project-a")).toEqual([]);
  });

  it("cancels in-flight logic when the extension is disabled", async () => {
    const logicRun = vi.fn(
      async (_source: string, _request: unknown, options?: { signal?: AbortSignal }) =>
        new Promise<unknown>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), {
            once: true,
          });
        }),
    );
    const { directory, manager } = fixture(undefined, undefined, logicRun);
    const manifestPath = Path.join(directory, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
    manifest.logic = { entry: "dist/logic.js" };
    manifest.engines.api = "^1.2.0";
    manifest.contributes.commands = [{ id: "sum", label: "Sum", description: "Add values" }];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    FS.writeFileSync(Path.join(directory, "dist", "logic.js"), "globalThis.run = () => 3;");
    const installed = manager.installDevelopment(directory);
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a"],
    });
    const sender = { isDestroyed: () => false, close: vi.fn() };
    const internal = manager as unknown as { active: unknown; coordinator: unknown };
    internal.coordinator = { detachToolView: vi.fn() };
    internal.active = {
      key: "logic",
      view: { webContents: sender },
      extensionId: installed.id,
      projectId: "project-a",
      profileId: "default",
    };
    const pending = manager.invokeLogic(sender as never, "sum", { a: 1 });
    const second = manager.invokeLogic(sender as never, "sum", { a: 2 });
    await expect(manager.invokeLogic(sender as never, "sum", { a: 3 })).rejects.toThrow(
      /Too many extension commands/,
    );
    manager.setDisabled(installed.id, true);
    await expect(pending).rejects.toThrow(/cancelled/);
    await expect(second).rejects.toThrow(/cancelled/);
  });

  it("executes a declared packaged command in the disposable runtime", async () => {
    const { directory, manager } = fixture();
    const manifestPath = Path.join(directory, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
    manifest.logic = { entry: "dist/logic.js" };
    manifest.engines.api = "^1.2.0";
    manifest.contributes.commands = [{ id: "sum", label: "Sum", description: "Add values" }];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    FS.writeFileSync(
      Path.join(directory, "dist", "logic.js"),
      "globalThis.run = ({ commandId, input }) => commandId === 'sum' ? input.a + input.b : null;",
    );
    const installed = manager.installDevelopment(directory);
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a"],
    });
    const sender = { isDestroyed: () => false, close: vi.fn() };
    const internal = manager as unknown as { active: unknown };
    internal.active = {
      key: "logic",
      view: { webContents: sender },
      extensionId: installed.id,
      projectId: "project-a",
      profileId: "default",
    };
    await expect(manager.invokeLogic(sender as never, "sum", { a: 3, b: 4 })).resolves.toBe(7);
  });

  it("executes a verified local archive command after extraction", async () => {
    const { directory, manager } = fixture();
    const source = Path.join(directory, "packaged-source");
    FS.mkdirSync(Path.join(source, "dist"), { recursive: true });
    FS.copyFileSync(
      Path.join(directory, "dist", "index.html"),
      Path.join(source, "dist", "index.html"),
    );
    const manifest = JSON.parse(
      FS.readFileSync(Path.join(directory, "tabs-extension.json"), "utf8"),
    );
    manifest.engines.api = "^1.2.0";
    manifest.logic = { entry: "dist/logic.js" };
    manifest.contributes.commands = [{ id: "sum", label: "Sum", description: "Add values" }];
    FS.writeFileSync(Path.join(source, "tabs-extension.json"), JSON.stringify(manifest));
    FS.writeFileSync(
      Path.join(source, "dist", "logic.js"),
      "globalThis.run = ({ input }) => input.a + input.b;",
    );
    const archive = Path.join(directory, "calculator.tabsext");
    await packTabsext({ directory: source, destination: archive, tabsVersion: "1.3.17" });
    const installed = await manager.installLocalPackage(archive);
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a"],
    });
    const sender = { isDestroyed: () => false, close: vi.fn() };
    const internal = manager as unknown as { active: unknown };
    internal.active = {
      key: "packaged-logic",
      view: { webContents: sender },
      extensionId: installed.id,
      projectId: "project-a",
      profileId: "default",
    };
    await expect(manager.invokeLogic(sender as never, "sum", { a: 8, b: 5 })).resolves.toBe(13);
  });

  it("deletes encrypted credentials only with the explicit data-deletion uninstall", async () => {
    const cryptography: CredentialCryptography = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => "gnome_libsecret",
      encryptString: (value) => Buffer.from(`encrypted:${value}`),
      decryptString: (value) => value.toString().replace(/^encrypted:/, ""),
    };
    const { directory, manager } = fixture(cryptography);
    const manifestPath = Path.join(directory, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
    manifest.capabilities = ["network", "credentials"];
    manifest.networkHosts = ["api.example.com"];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    const installed = manager.installDevelopment(directory);
    manager.setProfileCredential(installed.id, "default", "api.example.com", "secret");
    manager.uninstall(installed.id);
    manager.installDevelopment(directory);
    expect(manager.listCredentialStatuses(installed.id)).toEqual([
      { profileId: "default", host: "api.example.com" },
    ]);
    await manager.uninstallAndDeleteData(installed.id);
    manager.installDevelopment(directory);
    expect(manager.listCredentialStatuses(installed.id)).toEqual([]);
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

  it("keeps an active extension untouched by a silent update", async () => {
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
    const firstArchive = Path.join(directory, "first-silent.tabsext");
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
    expect(manager.canApplySilentUpdate(installed.id)).toBe(true);
    manifest.version = "1.0.1";
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    const secondArchive = Path.join(directory, "second-silent.tabsext");
    const second = await packTabsext({
      directory: source,
      destination: secondArchive,
      tabsVersion: "1.3.17",
    });
    (manager as unknown as { active: unknown }).active = {
      extensionId: installed.id,
      key: "active",
    };
    expect(manager.canApplySilentUpdate(installed.id)).toBe(false);
    await expect(
      manager.installVerifiedExchangePackage(
        secondArchive,
        "https://exchange.tabs.example",
        second.digest,
        { silent: true },
      ),
    ).rejects.toThrow(/safe update boundary/);
    expect(manager.list()[0]?.digest).toBe(first.digest);
    (manager as unknown as { active: unknown }).active = null;
    const updated = await manager.installVerifiedExchangePackage(
      secondArchive,
      "https://exchange.tabs.example",
      second.digest,
      { silent: true },
    );
    expect(updated.digest).toBe(second.digest);
    expect(updated.assignment.enabledProjectIds).toEqual(["project-a"]);
  });

  it("requires review and fresh grants when an update exposes a new AI command", async () => {
    const { directory, manager } = fixture();
    const source = Path.join(directory, "ai-update-source");
    FS.mkdirSync(Path.join(source, "dist"), { recursive: true });
    FS.copyFileSync(
      Path.join(directory, "dist", "index.html"),
      Path.join(source, "dist", "index.html"),
    );
    FS.writeFileSync(Path.join(source, "dist", "logic.js"), "globalThis.run = () => 1;");
    const manifestPath = Path.join(source, "tabs-extension.json");
    const manifest = JSON.parse(
      FS.readFileSync(Path.join(directory, "tabs-extension.json"), "utf8"),
    );
    manifest.engines.api = "^1.3.0";
    manifest.capabilities = ["ai-tools"];
    manifest.logic = { entry: "dist/logic.js" };
    manifest.contributes.commands = [
      { id: "sum", label: "Sum", description: "Add", aiCallable: true },
    ];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    const firstArchive = Path.join(directory, "ai-first.tabsext");
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
      aiToolGrantedProjectIds: ["project-a"],
    });
    manifest.version = "1.0.1";
    manifest.contributes.commands.push({
      id: "divide",
      label: "Divide",
      description: "Divide",
      aiCallable: true,
    });
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    const secondArchive = Path.join(directory, "ai-second.tabsext");
    const second = await packTabsext({
      directory: source,
      destination: secondArchive,
      tabsVersion: "1.3.17",
    });
    await expect(
      manager.installVerifiedExchangePackage(
        secondArchive,
        "https://exchange.tabs.example",
        second.digest,
        { silent: true },
      ),
    ).rejects.toThrow(/AI tools/);
    expect(manager.list()[0]?.digest).toBe(first.digest);
    expect(manager.listAiToolsForProject("project-a")).toHaveLength(1);
    const reviewed = await manager.installVerifiedExchangePackage(
      secondArchive,
      "https://exchange.tabs.example",
      second.digest,
    );
    expect(reviewed.assignment.enabledProjectIds).toEqual([]);
    expect(reviewed.assignment.aiToolGrantedProjectIds).toEqual([]);
    expect(manager.listAiToolsForProject("project-a")).toEqual([]);
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

  it.each([
    {
      name: "commits migrated profile data after successful activation",
      failActivation: false,
      failCleanup: false,
    },
    {
      name: "restores profile data when migration activation fails",
      failActivation: true,
      failCleanup: false,
    },
    {
      name: "reports successful activation when backup cleanup fails",
      failActivation: false,
      failCleanup: true,
    },
  ])("$name", async ({ failActivation, failCleanup }) => {
    const { directory, manager } = fixture();
    const source = Path.join(directory, "migration-source");
    FS.mkdirSync(Path.join(source, "dist"), { recursive: true });
    FS.copyFileSync(
      Path.join(directory, "dist", "index.html"),
      Path.join(source, "dist", "index.html"),
    );
    const manifestPath = Path.join(source, "tabs-extension.json");
    const manifest = JSON.parse(
      FS.readFileSync(Path.join(directory, "tabs-extension.json"), "utf8"),
    );
    manifest.capabilities = ["profile-storage"];
    manifest.engines.api = "^1.4.0";
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    const firstArchive = Path.join(directory, "migration-first.tabsext");
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
    const storage = new ExtensionStorage(Path.join(directory, "extension-storage"));
    const identity = {
      extensionId: extensionDataIdentity(installed.id, installed.registryOrigin, installed.source),
      profileId: "default",
    };
    storage.invoke(identity, { kind: "set", key: "oldTheme", value: "dark" });
    manifest.version = "1.0.1";
    manifest.storage = {
      version: 2,
      migrations: [{ from: 1, to: 2, renames: [{ from: "oldTheme", to: "theme" }] }],
    };
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    const secondArchive = Path.join(directory, "migration-second.tabsext");
    const second = await packTabsext({
      directory: source,
      destination: secondArchive,
      tabsVersion: "1.3.17",
    });
    await expect(
      manager.installVerifiedExchangePackage(
        secondArchive,
        "https://exchange.tabs.example",
        second.digest,
        { silent: true },
      ),
    ).rejects.toThrow(/migrate profile storage/);
    await manager.installVerifiedExchangePackage(
      secondArchive,
      "https://exchange.tabs.example",
      second.digest,
    );
    const activatedManager = new ExtensionViewManager(
      () => null,
      {} as ConstructorParameters<typeof ExtensionViewManager>[1],
      Path.join(directory, "installed.json"),
      "1.3.17",
      false,
    );
    (activatedManager as unknown as { coordinator: unknown }).coordinator = {
      attachToolView: vi.fn(),
      detachToolView: vi.fn(),
    };
    if (failCleanup) {
      const managerStorage = (activatedManager as unknown as { storage: ExtensionStorage }).storage;
      vi.spyOn(managerStorage, "discardAllUpdateSnapshots").mockImplementationOnce(() => {
        throw new Error("Backup cleanup failed");
      });
    }
    mockElectronExtensionView(async () => {
      expect(storage.invoke(identity, { kind: "get", key: "theme" })).toBe("dark");
      if (failActivation) {
        storage.invoke(identity, { kind: "set", key: "newData", value: true });
        throw new Error("UI failed to load");
      }
    });
    const activation = activatedManager.activate({
      extensionId: installed.id,
      toolId: "main",
      projectId: "project-a",
      profileId: "default",
    });
    if (failActivation) {
      await expect(activation).rejects.toThrow(/rolled back/);
      expect(activatedManager.list()[0]?.digest).toBe(first.digest);
      expect(storage.invoke(identity, { kind: "get", key: "oldTheme" })).toBe("dark");
      expect(storage.invoke(identity, { kind: "get", key: "theme" })).toBeNull();
      expect(storage.invoke(identity, { kind: "get", key: "newData" })).toBeNull();
    } else {
      await activation;
      expect(activatedManager.list()[0]?.digest).toBe(second.digest);
      expect(storage.invoke(identity, { kind: "get", key: "oldTheme" })).toBeNull();
      expect(storage.invoke(identity, { kind: "get", key: "theme" })).toBe("dark");
      const persisted = JSON.parse(FS.readFileSync(Path.join(directory, "installed.json"), "utf8"));
      expect(persisted[0]).not.toHaveProperty("pendingRollback");
      if (failCleanup) {
        const rollbackDirectory = Path.join(directory, "extension-storage", "rollback");
        expect(FS.readdirSync(rollbackDirectory)).toHaveLength(1);
        new ExtensionViewManager(
          () => null,
          {} as ConstructorParameters<typeof ExtensionViewManager>[1],
          Path.join(directory, "installed.json"),
          "1.3.17",
          false,
        );
        expect(FS.readdirSync(rollbackDirectory)).toHaveLength(0);
      }
    }
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

  it("does not let a superseded view commit or close the current view", async () => {
    const { manager, installed, second } = await exchangeUpdateFixture();
    manager.setAssignment(installed.id, {
      ...manager.list()[0]!.assignment,
      enabledProjectIds: ["project-a", "project-b"],
    });
    const coordinator = { attachToolView: vi.fn(), detachToolView: vi.fn() };
    (manager as unknown as { coordinator: unknown }).coordinator = coordinator;
    let resolveFirst!: () => void;
    const firstLoad = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const loadURL = vi
      .fn()
      .mockImplementationOnce(() => firstLoad)
      .mockResolvedValueOnce(undefined);
    mockElectronExtensionView(loadURL);
    const firstActivation = manager.activate({
      extensionId: installed.id,
      toolId: "main",
      projectId: "project-a",
      profileId: "default",
    });
    await manager.activate({
      extensionId: installed.id,
      toolId: "main",
      projectId: "project-b",
      profileId: "default",
    });
    resolveFirst();
    await firstActivation;
    expect(manager.list()[0]?.digest).toBe(second.digest);
    expect(coordinator.detachToolView).toHaveBeenCalledTimes(1);
  });

  it("waits for an in-flight activation when the same tool is selected again", async () => {
    const { manager, installed, first } = await exchangeUpdateFixture();
    const coordinator = { attachToolView: vi.fn(), detachToolView: vi.fn() };
    (manager as unknown as { coordinator: unknown }).coordinator = coordinator;
    let rejectLoad!: (error: Error) => void;
    const load = new Promise<void>((_resolve, reject) => {
      rejectLoad = reject;
    });
    const loadURL = vi.fn(() => load);
    mockElectronExtensionView(loadURL);
    const input = {
      extensionId: installed.id,
      toolId: "main",
      projectId: "project-a",
      profileId: "default",
    };
    const firstActivation = manager.activate(input);
    const repeatedActivation = manager.activate(input);
    rejectLoad(new Error("renderer load failed"));
    await expect(firstActivation).rejects.toThrow(/rolled back/);
    await expect(repeatedActivation).rejects.toThrow(/rolled back/);
    expect(manager.list()[0]?.digest).toBe(first.digest);
    expect(loadURL).toHaveBeenCalledOnce();
    expect(coordinator.attachToolView).toHaveBeenCalledTimes(2);
  });

  it("starts a new activation when a retry has a new ID while the old load is unresolved", async () => {
    const { manager, installed, second } = await exchangeUpdateFixture();
    const coordinator = { attachToolView: vi.fn(), detachToolView: vi.fn() };
    (manager as unknown as { coordinator: unknown }).coordinator = coordinator;
    const loadURL = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>(() => undefined))
      .mockResolvedValueOnce(undefined);
    mockElectronExtensionView(loadURL);
    const input = {
      extensionId: installed.id,
      toolId: "main",
      projectId: "project-a",
      profileId: "default",
    };

    const oldActivation = manager.activate({ ...input, activationId: "attempt-1" });
    await manager.activate({ ...input, activationId: "attempt-2" });
    await expect(oldActivation).resolves.toBeUndefined();

    expect(loadURL).toHaveBeenCalledTimes(2);
    expect(
      (manager as unknown as { active: { activationId: string } | null }).active?.activationId,
    ).toBe("attempt-2");
    expect(manager.list()[0]?.digest).toBe(second.digest);
    expect(coordinator.detachToolView).toHaveBeenCalledTimes(1);
  });

  it("does not roll back a successful replacement when an older load fails late", async () => {
    const { manager, installed, second } = await exchangeUpdateFixture();
    manager.setAssignment(installed.id, {
      ...manager.list()[0]!.assignment,
      enabledProjectIds: ["project-a", "project-b"],
    });
    const coordinator = { attachToolView: vi.fn(), detachToolView: vi.fn() };
    (manager as unknown as { coordinator: unknown }).coordinator = coordinator;
    let rejectFirst!: (error: Error) => void;
    const firstLoad = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject;
    });
    mockElectronExtensionView(
      vi
        .fn()
        .mockImplementationOnce(() => firstLoad)
        .mockResolvedValueOnce(undefined),
    );
    const firstActivation = manager.activate({
      extensionId: installed.id,
      toolId: "main",
      projectId: "project-a",
      profileId: "default",
    });
    await manager.activate({
      extensionId: installed.id,
      toolId: "main",
      projectId: "project-b",
      profileId: "default",
    });
    await expect(firstActivation).resolves.toBeUndefined();
    rejectFirst(new Error("old renderer failed"));
    await Promise.resolve();
    expect(manager.list()[0]?.digest).toBe(second.digest);
    expect(coordinator.detachToolView).toHaveBeenCalledTimes(1);
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
    const sender = { isDestroyed: () => false, close: vi.fn() };
    const internal = manager as unknown as { active: unknown; coordinator: unknown };
    internal.coordinator = { detachToolView: vi.fn() };
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

  it("migrates local package storage and rolls back a failed first load", async () => {
    const { directory, manager } = fixture();
    const source = Path.join(directory, "local-migration-source");
    FS.mkdirSync(Path.join(source, "dist"), { recursive: true });
    FS.copyFileSync(
      Path.join(directory, "dist", "index.html"),
      Path.join(source, "dist", "index.html"),
    );
    const manifestPath = Path.join(source, "tabs-extension.json");
    const manifest = JSON.parse(
      FS.readFileSync(Path.join(directory, "tabs-extension.json"), "utf8"),
    );
    manifest.engines.api = "^1.4.0";
    manifest.capabilities = ["profile-storage"];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    const firstArchive = Path.join(directory, "local-first.tabsext");
    const first = await packTabsext({
      directory: source,
      destination: firstArchive,
      tabsVersion: "1.3.17",
    });
    const installed = await manager.installLocalPackage(firstArchive);
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a"],
      storageGrantedProjectIds: ["project-a"],
    });
    const storage = new ExtensionStorage(Path.join(directory, "extension-storage"));
    const identity = {
      extensionId: extensionDataIdentity(installed.id, undefined, "local-package"),
      profileId: "default",
    };
    storage.invoke(identity, { kind: "set", key: "oldTheme", value: "dark" });
    manifest.version = "1.0.1";
    manifest.storage = {
      version: 2,
      migrations: [{ from: 1, to: 2, renames: [{ from: "oldTheme", to: "theme" }] }],
    };
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    const secondArchive = Path.join(directory, "local-second.tabsext");
    const second = await packTabsext({
      directory: source,
      destination: secondArchive,
      tabsVersion: "1.3.17",
    });
    manifest.version = "1.0.0";
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    const sameVersionArchive = Path.join(directory, "local-same-version.tabsext");
    await packTabsext({
      directory: source,
      destination: sameVersionArchive,
      tabsVersion: "1.3.17",
    });
    await expect(manager.installLocalPackage(sameVersionArchive)).rejects.toThrow(
      /increase its version/,
    );
    await manager.installLocalPackage(secondArchive);
    await expect(manager.installLocalPackage(firstArchive)).rejects.toThrow(
      /pending local-package/,
    );
    const restarted = new ExtensionViewManager(
      () => null,
      {} as ConstructorParameters<typeof ExtensionViewManager>[1],
      Path.join(directory, "installed.json"),
      "1.3.17",
      true,
    );
    (restarted as unknown as { coordinator: unknown }).coordinator = {
      attachToolView: vi.fn(),
      detachToolView: vi.fn(),
    };
    mockElectronExtensionView(async () => {
      expect(storage.invoke(identity, { kind: "get", key: "theme" })).toBe("dark");
      throw new Error("UI failed to load");
    });
    await expect(
      restarted.activate({
        extensionId: installed.id,
        toolId: "main",
        projectId: "project-a",
        profileId: "default",
      }),
    ).rejects.toThrow(/rolled back/);
    expect(restarted.list()[0]?.digest).toBe(first.digest);
    expect(storage.invoke(identity, { kind: "get", key: "oldTheme" })).toBe("dark");
    expect(storage.invoke(identity, { kind: "get", key: "theme" })).toBeNull();
    expect(restarted.list()[0]?.assignment.enabledProjectIds).toEqual(["project-a"]);
    expect(second.digest).not.toBe(first.digest);
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

  it("closes the failed view, clears active state, and surfaces error on renderer crash after first load", async () => {
    const { manager, installed } = await exchangeUpdateFixture();
    const coordinator = { attachToolView: vi.fn(), detachToolView: vi.fn() };
    (manager as unknown as { coordinator: unknown }).coordinator = coordinator;
    const send = vi.fn();
    (manager as unknown as { getWindow: () => unknown }).getWindow = () => ({
      isDestroyed: () => false,
      webContents: { send },
    });
    let crashHandler!: (event: unknown, details: { reason: string }) => void;
    let viewClose!: () => void;
    vi.mocked(electronSession.fromPartition).mockReturnValue({
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      webRequest: { onBeforeRequest: vi.fn(), onHeadersReceived: vi.fn() },
      protocol: { registerFileProtocol: vi.fn() },
    } as never);
    vi.mocked(WebContentsView).mockImplementation(function MockExtensionView() {
      viewClose = vi.fn();
      return {
        webContents: {
          setWindowOpenHandler: vi.fn(),
          on: vi.fn((event: string, listener: any) => {
            if (event === "render-process-gone") crashHandler = listener;
          }),
          isDestroyed: vi.fn(() => false),
          loadURL: vi.fn(async () => undefined),
          close: viewClose,
        },
        setBounds: vi.fn(),
      } as never;
    });

    const input = {
      extensionId: installed.id,
      toolId: "main",
      projectId: "project-a",
      profileId: "default",
      activationId: "attempt-1",
    };
    await manager.activate(input);
    expect(coordinator.attachToolView).toHaveBeenCalledOnce();
    expect((manager as unknown as { active: unknown }).active).not.toBeNull();

    // Trigger crash after first load
    crashHandler({}, { reason: "crashed" });

    // Host must detach the view from coordinator and close it
    expect(coordinator.detachToolView).toHaveBeenCalledOnce();
    expect(viewClose).toHaveBeenCalledOnce();
    expect((manager as unknown as { active: unknown }).active).toBeNull();

    // Host must send EXTENSION_VIEW_ERROR_CHANNEL event with project, tool, and activation identity
    expect(send).toHaveBeenCalledWith("desktop:extension:view-error", {
      projectId: "project-a",
      extensionId: installed.id,
      toolId: "main",
      profileId: "default",
      activationId: "attempt-1",
      error: "The extension crashed (crashed).",
    });

    // Safe retry: reactivating creates a fresh view with new activationId
    await manager.activate({ ...input, activationId: "attempt-2" });
    expect(coordinator.attachToolView).toHaveBeenCalledTimes(2);
    expect((manager as unknown as { active: unknown }).active).not.toBeNull();
  });

  it("settles activation as failure and rolls back pending update exactly once on crash during unresolved first load", async () => {
    const { manager, installed } = await exchangeUpdateFixture();
    const coordinator = { attachToolView: vi.fn(), detachToolView: vi.fn() };
    (manager as unknown as { coordinator: unknown }).coordinator = coordinator;
    const send = vi.fn();
    (manager as unknown as { getWindow: () => unknown }).getWindow = () => ({
      isDestroyed: () => false,
      webContents: { send },
    });

    let crashHandler!: (event: unknown, details: { reason: string }) => void;
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
          on: vi.fn((event: string, listener: any) => {
            if (event === "render-process-gone") crashHandler = listener;
          }),
          isDestroyed: vi.fn(() => false),
          loadURL: vi.fn(async () => {
            await new Promise<void>(() => {});
          }),
          close: vi.fn(),
        },
        setBounds: vi.fn(),
      } as never;
    });

    const input = {
      extensionId: installed.id,
      toolId: "main",
      projectId: "project-a",
      profileId: "default",
      activationId: "update-attempt-1",
    };

    expect(manager.list()[0]!.manifest.version).toBe("1.0.1");
    const internalInstalled = (manager as unknown as { installed: Map<string, any> }).installed;
    expect(internalInstalled.get(installed.id)?.pendingRollback).toBeDefined();

    const activationPromise = manager.activate(input);
    await new Promise((r) => setTimeout(r, 10));

    // Crash while loadURL is still unresolved
    crashHandler({}, { reason: "oom" });

    // Activation settles as a failure
    await expect(activationPromise).rejects.toThrow(/crashed during initial load|rolled back/);

    // Pending update rolls back to 1.0.0 exactly once
    const rolledBack = manager.list()[0]!;
    expect(rolledBack.manifest.version).toBe("1.0.0");
    expect(internalInstalled.get(installed.id)?.pendingRollback).toBeUndefined();

    // Active view must be cleared and detached
    expect((manager as unknown as { active: unknown }).active).toBeNull();
    expect(coordinator.detachToolView).toHaveBeenCalled();

    // Unresolved crash must NOT emit a committed view error event
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores crash from older view after retry with the same project, extension, tool, and profile", async () => {
    const { manager, installed } = await exchangeUpdateFixture();
    const coordinator = { attachToolView: vi.fn(), detachToolView: vi.fn() };
    (manager as unknown as { coordinator: unknown }).coordinator = coordinator;
    const send = vi.fn();
    (manager as unknown as { getWindow: () => unknown }).getWindow = () => ({
      isDestroyed: () => false,
      webContents: { send },
    });

    const crashHandlers: Array<(event: unknown, details: { reason: string }) => void> = [];
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
          on: vi.fn((event: string, listener: any) => {
            if (event === "render-process-gone") crashHandlers.push(listener);
          }),
          isDestroyed: vi.fn(() => false),
          loadURL: vi.fn(async () => undefined),
          close: vi.fn(),
        },
        setBounds: vi.fn(),
      } as never;
    });

    const input = {
      extensionId: installed.id,
      toolId: "main",
      projectId: "project-a",
      profileId: "default",
    };

    // Attempt 1: activate with activationId "attempt-1"
    await manager.activate({ ...input, activationId: "attempt-1" });
    const view1Handler = crashHandlers[0]!;

    // Attempt 2: retry with activationId "attempt-2" for SAME project/extension/tool/profile
    await manager.activate({ ...input, activationId: "attempt-2" });
    expect((manager as unknown as { active: { activationId: string } }).active?.activationId).toBe(
      "attempt-2",
    );

    // Old view 1 crashes delayed
    view1Handler({}, { reason: "crashed" });

    // Host sends NO error event for stale view 1!
    expect(send).not.toHaveBeenCalled();

    // Active view 2 remains active and unaffected
    expect((manager as unknown as { active: { activationId: string } }).active?.activationId).toBe(
      "attempt-2",
    );
  });

  it("rejects stale cleanup and bounds messages from previous activation attempts", async () => {
    const { manager, installed } = await exchangeUpdateFixture();
    const coordinator = { attachToolView: vi.fn(), detachToolView: vi.fn() };
    (manager as unknown as { coordinator: unknown }).coordinator = coordinator;

    const views: any[] = [];
    vi.mocked(electronSession.fromPartition).mockReturnValue({
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      webRequest: { onBeforeRequest: vi.fn(), onHeadersReceived: vi.fn() },
      protocol: { registerFileProtocol: vi.fn() },
    } as never);
    vi.mocked(WebContentsView).mockImplementation(function MockExtensionView() {
      const v = {
        webContents: {
          setWindowOpenHandler: vi.fn(),
          on: vi.fn(),
          isDestroyed: vi.fn(() => false),
          loadURL: vi.fn(async () => undefined),
          close: vi.fn(),
        },
        setBounds: vi.fn(),
      };
      views.push(v);
      return v as never;
    });

    const input = {
      extensionId: installed.id,
      toolId: "main",
      projectId: "project-a",
      profileId: "default",
    };

    await manager.activate({ ...input, activationId: "attempt-1" });
    await manager.activate({ ...input, activationId: "attempt-2" });
    expect(views.length).toBe(2);
    const view2 = views[1]!;

    // Stale bounds from attempt-1 must NOT resize view 2
    manager.setBounds({
      ...input,
      activationId: "attempt-1",
      x: 999,
      y: 999,
      width: 999,
      height: 999,
      visible: true,
    });
    expect(view2.setBounds).not.toHaveBeenCalledWith(expect.objectContaining({ x: 999 }));

    // Missing activation identity must not resize a replacement with the same tool tuple.
    manager.setBounds({
      ...input,
      activationId: "",
      x: 998,
      y: 998,
      width: 998,
      height: 998,
      visible: true,
    });
    expect(view2.setBounds).not.toHaveBeenCalledWith(expect.objectContaining({ x: 998 }));

    // Stale hide from attempt-1 cleanup must NOT hide view 2
    manager.hide({ activationId: "attempt-1" });
    expect((manager as unknown as { active: { activationId: string } }).active?.activationId).toBe(
      "attempt-2",
    );

    // A malformed scoped request must not become an unscoped hide.
    manager.hide({});
    manager.hide({ activationId: "invalid id" });
    expect((manager as unknown as { active: { activationId: string } }).active?.activationId).toBe(
      "attempt-2",
    );

    // Matching hide for attempt-2 does hide it
    manager.hide({ activationId: "attempt-2" });
    expect((manager as unknown as { active: unknown }).active).toBeNull();
  });

  it("intentional hide emits no crash error", async () => {
    const { manager, installed } = await exchangeUpdateFixture();
    const coordinator = { attachToolView: vi.fn(), detachToolView: vi.fn() };
    (manager as unknown as { coordinator: unknown }).coordinator = coordinator;
    const send = vi.fn();
    (manager as unknown as { getWindow: () => unknown }).getWindow = () => ({
      isDestroyed: () => false,
      webContents: { send },
    });

    let crashHandler!: (event: unknown, details: { reason: string }) => void;
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
          on: vi.fn((event: string, listener: any) => {
            if (event === "render-process-gone") crashHandler = listener;
          }),
          isDestroyed: vi.fn(() => false),
          loadURL: vi.fn(async () => undefined),
          close: vi.fn(() => {
            crashHandler?.({}, { reason: "killed" });
          }),
        },
        setBounds: vi.fn(),
      } as never;
    });

    await manager.activate({
      extensionId: installed.id,
      toolId: "main",
      projectId: "project-a",
      profileId: "default",
      activationId: "intent-hide",
    });

    manager.hide();
    expect(send).not.toHaveBeenCalled();
    expect((manager as unknown as { active: unknown }).active).toBeNull();
  });

  it("rejects activation and hides view if extension is disabled while loading", async () => {
    const { directory, manager } = fixture();
    const installed = manager.installDevelopment(directory);
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a"],
    });

    const coordinator = { attachToolView: vi.fn(), detachToolView: vi.fn() };
    (manager as unknown as { coordinator: unknown }).coordinator = coordinator;

    let resolveLoad!: () => void;
    const loadPromise = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });
    mockElectronExtensionView(async () => {
      await loadPromise;
    });

    const activation = manager.activate({
      extensionId: installed.id,
      toolId: "main",
      projectId: "project-a",
      profileId: "default",
      activationId: "disable-test",
    });

    // Disable extension while load is in flight
    manager.setDisabled(installed.id, true);

    resolveLoad();
    await expect(activation).rejects.toThrow(/disabled/);

    expect((manager as unknown as { active: unknown }).active).toBeNull();
    expect(coordinator.detachToolView).toHaveBeenCalled();
  });

  it("rejects activation and hides view if extension is revoked while loading", async () => {
    const { manager, installed, second } = await exchangeUpdateFixture();
    const coordinator = { attachToolView: vi.fn(), detachToolView: vi.fn() };
    (manager as unknown as { coordinator: unknown }).coordinator = coordinator;

    let resolveLoad!: () => void;
    const loadPromise = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });
    mockElectronExtensionView(async () => {
      await loadPromise;
    });

    const activation = manager.activate({
      extensionId: installed.id,
      toolId: "main",
      projectId: "project-a",
      profileId: "default",
      activationId: "revoke-test",
    });

    // Revoke extension while load is in flight
    manager.revokeIfCurrent(installed.id, "https://exchange.tabs.example", second.digest);

    resolveLoad();
    await expect(activation).rejects.toThrow(/revoked|rolled back/);

    expect((manager as unknown as { active: unknown }).active).toBeNull();
    expect(coordinator.detachToolView).toHaveBeenCalled();
  });

  it("UI-view crash does not cancel agent-origin logic", async () => {
    let finishLogic!: (value: unknown) => void;
    const logicRun = vi.fn(
      async (_source: string, _request: unknown, options?: { signal?: AbortSignal }) =>
        new Promise((resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          finishLogic = resolve;
        }),
    );
    const { directory, manager } = fixture(undefined, undefined, logicRun);
    const manifestPath = Path.join(directory, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
    manifest.logic = { entry: "dist/logic.js" };
    manifest.capabilities = ["ai-tools"];
    manifest.engines = { tabs: ">=1.3.0 <2.0.0", api: "^1.3.0" };
    manifest.contributes.commands = [
      { id: "ai-command", label: "AI Cmd", description: "AI Tool", aiCallable: true },
    ];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    FS.writeFileSync(Path.join(directory, "dist", "logic.js"), "globalThis.run = () => 42;");
    const installed = manager.installDevelopment(directory);
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a"],
      aiToolGrantedProjectIds: ["project-a"],
    });

    const coordinator = { attachToolView: vi.fn(), detachToolView: vi.fn() };
    (manager as unknown as { coordinator: unknown }).coordinator = coordinator;

    let crashHandler!: (event: unknown, details: { reason: string }) => void;
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
          on: vi.fn((event: string, listener: any) => {
            if (event === "render-process-gone") crashHandler = listener;
          }),
          isDestroyed: vi.fn(() => false),
          loadURL: vi.fn(async () => undefined),
          close: vi.fn(),
        },
        setBounds: vi.fn(),
      } as never;
    });

    // 1. Activate UI view
    await manager.activate({
      extensionId: installed.id,
      toolId: "main",
      projectId: "project-a",
      profileId: "default",
      activationId: "ui-view-1",
    });

    // 2. Start agent-origin logic tool
    const aiToolName = extensionAiToolName(installed.id, "ai-command", undefined, "development");
    const agentLogicPromise = manager.invokeAiTool("project-a", aiToolName, { input: 123 });

    // 3. UI view crashes
    crashHandler({}, { reason: "crashed" });

    // Active UI view is cleared
    expect((manager as unknown as { active: unknown }).active).toBeNull();

    // Agent-origin logic is NOT aborted and successfully finishes
    finishLogic(42);
    await expect(agentLogicPromise).resolves.toBe(42);
  });

  it("enforces extension-to-extension and sender isolation", async () => {
    const { directory, manager } = fixture();
    const manifestPath = Path.join(directory, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
    manifest.capabilities = ["profile-storage"];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    const ext1 = manager.installDevelopment(directory);
    manager.setAssignment(ext1.id, {
      ...ext1.assignment,
      enabledProjectIds: ["project-a"],
      storageGrantedProjectIds: ["project-a"],
    });

    const sender1 = { isDestroyed: () => false };
    const alienSender = { isDestroyed: () => false };
    const internal = manager as unknown as { active: unknown };
    internal.active = {
      key: "project-a:ext1",
      view: { webContents: sender1 },
      extensionId: ext1.id,
      projectId: "project-a",
      profileId: "default",
    };

    // Extension 1 sets data
    manager.invokeStorage(sender1 as never, { kind: "set", key: "secret", value: "data1" });
    expect(manager.invokeStorage(sender1 as never, { kind: "get", key: "secret" })).toBe("data1");

    // Alien sender calling invokeStorage for ext1 must be rejected
    expect(() =>
      manager.invokeStorage(alienSender as never, { kind: "get", key: "secret" }),
    ).toThrow(/Extension view is no longer active/);
  });

  it("keeps project-isolated credentials strictly segregated between projects", async () => {
    const { directory, manager } = fixture();
    const manifestPath = Path.join(directory, "tabs-extension.json");
    const manifest = JSON.parse(FS.readFileSync(manifestPath, "utf8"));
    manifest.capabilities = ["network", "credentials"];
    manifest.networkHosts = ["api.example.com"];
    FS.writeFileSync(manifestPath, JSON.stringify(manifest));
    const installed = manager.installDevelopment(directory);
    manager.addProfile(installed.id, "work", "Work", "project");
    manager.setAssignment(installed.id, {
      ...installed.assignment,
      enabledProjectIds: ["project-a", "project-b"],
      networkGrantedProjectIds: ["project-a", "project-b"],
      credentialGrantedProjectIds: ["project-a", "project-b"],
      defaultProfileId: "work",
    });

    const cryptography: CredentialCryptography = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => "mock",
      encryptString: (val) => Buffer.from(val),
      decryptString: (buf) => buf.toString(),
    };
    const managerWithCreds = new ExtensionViewManager(
      () => null,
      {} as ConstructorParameters<typeof ExtensionViewManager>[1],
      Path.join(directory, "installed.json"),
      "1.3.17",
      true,
      cryptography,
      async (_url, _hosts, bearer) => `token:${bearer}`,
    );

    // Save credential in project-a for project-isolated profile "work"
    managerWithCreds.setProfileCredential(
      installed.id,
      "work",
      "api.example.com",
      "secret-token-a",
      "project-a",
    );

    const sender = { isDestroyed: () => false };
    const internal = managerWithCreds as unknown as { active: unknown };

    // Active in project-a: can retrieve and use credential
    internal.active = {
      key: "a",
      view: { webContents: sender },
      extensionId: installed.id,
      projectId: "project-a",
      profileId: "work",
    };
    await expect(
      managerWithCreds.invokeNetworkGetText(sender as never, "https://api.example.com/data", true),
    ).resolves.toBe("token:secret-token-a");

    // Active in project-b: project-isolated profile must NOT see credential from project-a
    internal.active = {
      key: "b",
      view: { webContents: sender },
      extensionId: installed.id,
      projectId: "project-b",
      profileId: "work",
    };
    await expect(
      managerWithCreds.invokeNetworkGetText(sender as never, "https://api.example.com/data", true),
    ).rejects.toThrow(/No credential is saved/);
  });
});
