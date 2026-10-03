import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { webContentsViews, MockWebContentsView } = vi.hoisted(() => {
  class MockWebContentsView {
    readonly webContents = {
      loadURL: vi.fn(async (url: string) => {
        this.loadedUrls.push(url);
      }),
      close: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      executeJavaScript: vi.fn(async () => null),
      capturePage: vi.fn(async () => ({
        isEmpty: () => false,
        toDataURL: () => "data:image/png;base64,dGVzdA==",
      })),
      isDestroyed: vi.fn(() => false),
      isLoading: vi.fn(() => false),
      stop: vi.fn(),
      setBackgroundThrottling: vi.fn(),
    };

    readonly loadedUrls: string[] = [];
    bounds: { x: number; y: number; width: number; height: number } | null = null;

    constructor(_options: unknown) {
      webContentsViews.push(this);
    }

    setBackgroundColor(_color: string): void {}

    setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
      this.bounds = bounds;
    }
  }

  const webContentsViews: MockWebContentsView[] = [];

  return { webContentsViews, MockWebContentsView };
});

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/mock-user-data") },
  WebContentsView: MockWebContentsView,
}));

import {
  addDefaultExtensionGallery,
  CODE_OSS_EMBED_DEFAULT_SETTINGS,
  CODE_OSS_DESKTOP_PRELOAD_RELATIVE_PATH,
  CODE_OSS_DESKTOP_WORKBENCH_RELATIVE_PATH,
  CODE_OSS_NLS_MESSAGES_RELATIVE_PATH,
  CODE_OSS_PRODUCT_CONFIGURATION_RELATIVE_PATH,
  CodeHostManager,
  filterWorkspaceTabs,
  readCodeOssProtocolFile,
  isPathInsideWorkspace,
  mergeProductConfigurationDefaults,
  reconcileSharedExtensionRegistry,
  readWorkspaceTabs,
  resolveCodeHostConfig,
  resolveCodeOssAiProviderSettings,
  resolveCodeOssApplicationSettingsPaths,
  removeLegacyForcedEditorSettings,
  resolveWorkspaceRootForSession,
  resolveCodeOssExtensionPath,
  resolveCodeOssNodeModulesResource,
  resolveCodeOssWorkbenchTheme,
  shouldOpenCodeOssUrlExternally,
  writeWorkspaceTabs,
} from "./codeHostManager";

describe("addDefaultExtensionGallery", () => {
  it("adds Open VSX to an unbranded Code-OSS product", () => {
    expect(addDefaultExtensionGallery({ nameShort: "Code - OSS" })).toMatchObject({
      extensionsGallery: {
        serviceUrl: "https://open-vsx.org/vscode/gallery",
        itemUrl: "https://open-vsx.org/vscode/item",
      },
    });
  });

  it("preserves a marketplace supplied by the runtime", () => {
    const product = {
      extensionsGallery: { serviceUrl: "https://example.test/gallery" },
    };
    expect(addDefaultExtensionGallery(product)).toBe(product);
  });
});

describe("CODE_OSS_EMBED_DEFAULT_SETTINGS", () => {
  it("allows gallery-managed extensions to discover and install updates", () => {
    expect(CODE_OSS_EMBED_DEFAULT_SETTINGS).toMatchObject({
      "extensions.autoCheckUpdates": true,
      "extensions.autoUpdate": true,
    });
  });
});

describe("resolveCodeOssAiProviderSettings", () => {
  it.each(["tabs", "copilot"] as const)(
    "keeps Code-OSS AI extensions enabled for the %s provider",
    (provider) => {
      expect(resolveCodeOssAiProviderSettings(provider)["chat.disableAIFeatures"]).toBe(false);
    },
  );

  it("keeps native assistant chrome visible between providers", () => {
    expect(resolveCodeOssAiProviderSettings("tabs")).toMatchObject({
      "chat.commandCenter.enabled": true,
      "workbench.secondarySideBar.defaultVisibility": "visible",
    });
    expect(resolveCodeOssAiProviderSettings("copilot")).toMatchObject({
      "chat.commandCenter.enabled": true,
      "workbench.secondarySideBar.defaultVisibility": "visible",
    });
  });
});

describe("resolveCodeOssApplicationSettingsPaths", () => {
  it("targets the active shared desktop profile rather than project-local profile remnants", () => {
    const stateDir = Path.join(Path.sep, "tmp", "tabs-state");

    expect(resolveCodeOssApplicationSettingsPaths(stateDir)).toEqual([
      Path.join(stateDir, "code-oss-main", "profile", "default", "settings.json"),
      Path.join(stateDir, "code-oss-desktop", "shared-profile", "default", "settings.json"),
    ]);
  });
});

describe("removeLegacyForcedEditorSettings", () => {
  it("removes only cosmetic values that an older Tabs build forced", () => {
    expect(
      removeLegacyForcedEditorSettings({
        "breadcrumbs.enabled": false,
        "editor.fontSize": 13,
        "files.autoSave": "afterDelay",
      }),
    ).toEqual({ "files.autoSave": "afterDelay" });
  });

  it("preserves user values that differ from the former forced defaults", () => {
    expect(
      removeLegacyForcedEditorSettings({
        "breadcrumbs.enabled": true,
        "editor.fontSize": 16,
      }),
    ).toEqual({
      "breadcrumbs.enabled": true,
      "editor.fontSize": 16,
    });
  });
});

describe("shouldOpenCodeOssUrlExternally", () => {
  it.each([
    "https://github.com/login",
    "http://example.com",
    "mailto:support@example.com",
    "tabs://vscode.github-authentication/did-authenticate?nonce=123",
  ])("allows safe external and authentication URLs: %s", (url) => {
    expect(shouldOpenCodeOssUrlExternally(url)).toBe(true);
  });

  it.each(["javascript:alert(1)", "data:text/html,test", "file:///tmp/secret", "not a url"])(
    "rejects unsafe popup URLs: %s",
    (url) => {
      expect(shouldOpenCodeOssUrlExternally(url)).toBe(false);
    },
  );
});

describe("resolveWorkspaceRootForSession", () => {
  it("uses an existing requested workspace", () => {
    const workspaceRoot = makeTempDir("tabs-existing-workspace-");

    expect(
      resolveWorkspaceRootForSession(
        workspaceRoot,
        { rootDir: Path.join(workspaceRoot, "tabs-app"), runtime: null },
        FS,
      ),
    ).toBe(workspaceRoot);
  });

  it("recovers a moved workspace with the same basename near the application checkout", () => {
    const checkoutRoot = makeTempDir("tabs-moved-workspace-");
    const currentWorkspace = Path.join(checkoutRoot, "project");
    FS.mkdirSync(currentWorkspace);

    expect(
      resolveWorkspaceRootForSession(
        Path.join(checkoutRoot, "deleted-parent", "project"),
        { rootDir: Path.join(checkoutRoot, "tabs-app"), runtime: null },
        FS,
      ),
    ).toBe(currentWorkspace);
  });

  it("rejects a missing workspace before starting an extension host", () => {
    const checkoutRoot = makeTempDir("tabs-missing-workspace-");
    const missingWorkspace = Path.join(checkoutRoot, "deleted-project");

    expect(() =>
      resolveWorkspaceRootForSession(
        missingWorkspace,
        { rootDir: Path.join(checkoutRoot, "tabs-app"), runtime: null },
        FS,
      ),
    ).toThrow(`The project folder no longer exists: ${missingWorkspace}`);
  });
});

describe("readCodeOssProtocolFile", () => {
  it("serves exact WASM bytes with the MIME type required by WebAssembly streaming", async () => {
    const runtimeDir = makeTempDir("tabs-code-protocol-");
    const wasmPath = Path.join(runtimeDir, "onig.wasm");
    const bytes = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    FS.writeFileSync(wasmPath, bytes);

    const response = await readCodeOssProtocolFile(wasmPath, {
      "Cache-Control": "no-cache",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/wasm");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });
});

describe("reconcileSharedExtensionRegistry", () => {
  it("keeps valid registrations and removes stale workspace registrations", () => {
    const stateDir = makeTempDir("tabs-extension-registry-");
    const desktopRoot = Path.join(stateDir, "code-oss-desktop");
    const extensionsDir = Path.join(desktopRoot, "extensions");
    const validExtensionDir = Path.join(extensionsDir, "openai.chatgpt-1.0.0");
    FS.mkdirSync(validExtensionDir, { recursive: true });
    FS.writeFileSync(Path.join(validExtensionDir, "package.json"), "{}");

    const workspaceRegistry = Path.join(desktopRoot, "workspace", "profile", "default");
    FS.mkdirSync(workspaceRegistry, { recursive: true });
    FS.writeFileSync(
      Path.join(workspaceRegistry, "extensions.json"),
      JSON.stringify([
        {
          identifier: { id: "openai.chatgpt" },
          version: "1.0.0",
          relativeLocation: "openai.chatgpt-1.0.0",
          metadata: { installedTimestamp: 2 },
        },
        {
          identifier: { id: "coderabbit.coderabbit-vscode" },
          version: "0.21.4",
          relativeLocation: "coderabbit.coderabbit-vscode-0.21.4-universal",
          metadata: { installedTimestamp: 3 },
        },
      ]),
    );

    const sharedRegistry = reconcileSharedExtensionRegistry(stateDir);

    expect(JSON.parse(FS.readFileSync(sharedRegistry, "utf8"))).toEqual([
      expect.objectContaining({
        identifier: { id: "openai.chatgpt" },
        version: "1.0.0",
      }),
    ]);
  });
});

function makeTempDir(prefix: string): string {
  return FS.mkdtempSync(Path.join(OS.tmpdir(), prefix));
}

describe("resolveCodeOssNodeModulesResource", () => {
  it.each(["node_modules.asar", "node_modules.asar.unpacked"])(
    "maps %s URLs to source-tree node_modules resources",
    (asarDirectory) => {
      const runtimeDir = makeTempDir("tabs-code-resource-");
      const wasmPath = Path.join(runtimeDir, "node_modules/vscode-oniguruma/release/onig.wasm");
      FS.mkdirSync(Path.dirname(wasmPath), { recursive: true });
      FS.writeFileSync(wasmPath, "wasm");

      expect(
        resolveCodeOssNodeModulesResource(
          Path.join(runtimeDir, asarDirectory, "vscode-oniguruma/release/onig.wasm"),
        ),
      ).toBe(wasmPath);
    },
  );
});

describe("resolveCodeOssExtensionPath", () => {
  it("uses source resources in development", () => {
    const baseDir = Path.join("/repo", "apps/desktop/dist-electron");
    const sourcePath = Path.join(
      "/repo",
      "apps/desktop/resources/code-oss-extensions/tabs-workbench-integration",
    );

    expect(
      resolveCodeOssExtensionPath(
        baseDir,
        "tabs-workbench-integration",
        (candidate) => candidate === sourcePath,
      ),
    ).toBe(sourcePath);
  });

  it("uses the unpacked production extension beside app.asar", () => {
    const baseDir = Path.join(
      "/Applications/Tabs.app/Contents/Resources/app.asar",
      "apps/desktop/dist-electron",
    );
    const unpackedPath = Path.join(
      "/Applications/Tabs.app/Contents/Resources/app.asar.unpacked",
      "apps/desktop/prod-resources/code-oss-extensions/tabs-workbench-integration",
    );

    expect(
      resolveCodeOssExtensionPath(
        baseDir,
        "tabs-workbench-integration",
        (candidate) => candidate === unpackedPath,
      ),
    ).toBe(unpackedPath);
  });
});

describe("resolveCodeOssWorkbenchTheme", () => {
  it("matches the embedded workbench to light Tabs themes", () => {
    expect(resolveCodeOssWorkbenchTheme("tabs-light")).toBe("Default Light Modern");
    expect(resolveCodeOssWorkbenchTheme("solarized-light")).toBe("Default Light Modern");
    expect(resolveCodeOssWorkbenchTheme("custom", { baseVariant: "light" })).toBe(
      "Default Light Modern",
    );
  });

  it("defaults unknown and dark themes to the dark workbench", () => {
    expect(resolveCodeOssWorkbenchTheme("tabs-dark")).toBe("Default Dark Modern");
    expect(resolveCodeOssWorkbenchTheme("custom", { baseVariant: "dark" })).toBe(
      "Default Dark Modern",
    );
  });
});

function writeVsCodeDesktopCheckout(rootDir: string): void {
  for (const relativePath of [
    CODE_OSS_DESKTOP_PRELOAD_RELATIVE_PATH,
    CODE_OSS_DESKTOP_WORKBENCH_RELATIVE_PATH,
    CODE_OSS_NLS_MESSAGES_RELATIVE_PATH,
    CODE_OSS_PRODUCT_CONFIGURATION_RELATIVE_PATH,
  ]) {
    const absolutePath = Path.join(rootDir, relativePath);
    FS.mkdirSync(Path.dirname(absolutePath), { recursive: true });
    FS.writeFileSync(absolutePath, absolutePath.endsWith(".json") ? "{}" : "// test");
  }
}

function createMockWindow() {
  const views: InstanceType<typeof MockWebContentsView>[] = [];
  return {
    contentView: {
      children: views,
      addChildView: vi.fn((view: InstanceType<typeof MockWebContentsView>) => {
        if (!views.includes(view)) views.push(view);
      }),
      removeChildView: vi.fn((view: InstanceType<typeof MockWebContentsView>) => {
        const index = views.indexOf(view);
        if (index >= 0) views.splice(index, 1);
      }),
    },
  };
}

describe("resolveCodeHostConfig", () => {
  it("selects desktop renderer when desktop assets exist", () => {
    const rootDir = makeTempDir("tabs-codehost-root-");
    const vscodeRoot = makeTempDir("vscode-root-");
    writeVsCodeDesktopCheckout(vscodeRoot);

    const config = resolveCodeHostConfig({
      rootDir,
      env: {
        TABS_CODE_OSS_BUILD_DIR: vscodeRoot,
      },
    });

    expect(config.state.available).toBe(true);
    expect(config.runtime).toMatchObject({
      kind: "desktop-renderer",
      vscodeRoot,
    });
  });

  it("selects a sibling desktop runtime", () => {
    const parentDir = makeTempDir("tabs-parent-");
    const rootDir = Path.join(parentDir, "tabs-app");
    const vscodeMainDir = Path.join(parentDir, "tabs-code-oss");
    FS.mkdirSync(rootDir, { recursive: true });
    writeVsCodeDesktopCheckout(vscodeMainDir);

    const config = resolveCodeHostConfig({
      rootDir,
      env: {},
    });

    expect(config.state.available).toBe(true);
    expect(config.runtime).toMatchObject({
      kind: "desktop-renderer",
      vscodeRoot: vscodeMainDir,
    });
  });

  it("returns an actionable message when the desktop build is missing", () => {
    const parentDir = makeTempDir("tabs-parent-");
    const rootDir = Path.join(parentDir, "tabs-app");
    const vscodeMainDir = Path.join(parentDir, "tabs-code-oss");
    FS.mkdirSync(rootDir, { recursive: true });
    FS.mkdirSync(vscodeMainDir, { recursive: true });
    const markerPath = Path.join(vscodeMainDir, CODE_OSS_DESKTOP_PRELOAD_RELATIVE_PATH);
    FS.mkdirSync(Path.dirname(markerPath), { recursive: true });
    FS.writeFileSync(markerPath, "// incomplete desktop build");

    const config = resolveCodeHostConfig({
      rootDir,
      env: {},
    });

    expect(config.state.available).toBe(false);
    expect(config.state.reason).toContain("Code-OSS desktop runtime not found");
    expect(config.state.reason).toContain("npm run compile");
    expect(config.state.reason).toContain("tabs-code-oss");
  });
});

describe("mergeProductConfigurationDefaults", () => {
  const defaults = {
    "security.workspace.trust.enabled": false,
    "chat.disableAIFeatures": true,
  };

  it("adds configurationDefaults to a product without any", () => {
    const { product, changed } = mergeProductConfigurationDefaults({ nameShort: "Code" }, defaults);
    expect(changed).toBe(true);
    expect(product.configurationDefaults).toEqual(defaults);
    expect(product.nameShort).toBe("Code");
  });

  it("preserves unrelated existing defaults", () => {
    const { product, changed } = mergeProductConfigurationDefaults(
      { configurationDefaults: { "editor.fontSize": 13 } },
      defaults,
    );
    expect(changed).toBe(true);
    expect(product.configurationDefaults).toEqual({
      "editor.fontSize": 13,
      ...defaults,
    });
  });

  it("reports unchanged when the defaults are already present", () => {
    const { changed } = mergeProductConfigurationDefaults(
      { configurationDefaults: { ...defaults, "editor.fontSize": 13 } },
      defaults,
    );
    expect(changed).toBe(false);
  });
});

describe("CodeHostManager", () => {
  it("reports the selected runtime version and re-reads it after a runtime changes", async () => {
    const vscodeRoot = makeTempDir("tabs-runtime-version-");
    const manager = new CodeHostManager(() => null, {
      state: { available: true, mode: "embedded", entry: null, reason: null },
      runtime: { kind: "desktop-renderer", vscodeRoot, stateDir: vscodeRoot },
    });
    FS.writeFileSync(Path.join(vscodeRoot, "package.json"), JSON.stringify({ version: "1.140.0" }));
    expect((await manager.getState()).version).toBe("1.140.0");
    FS.writeFileSync(Path.join(vscodeRoot, "package.json"), JSON.stringify({ version: "1.138.0" }));
    expect((await manager.getState()).version).toBe("1.138.0");
    FS.writeFileSync(Path.join(vscodeRoot, "package.json"), "invalid");
    expect(await manager.getState()).toMatchObject({ available: true, version: null });
  });

  beforeEach(() => {
    webContentsViews.length = 0;
  });

  it("registers each embedded native window with its owning Tabs project", async () => {
    const workspaceRoot = makeTempDir("tabs-native-owner-");
    const window = createMockWindow();
    const registrar = vi.fn();
    const manager = new CodeHostManager(() => window as never, {
      state: {
        available: true,
        mode: "embedded",
        entry: "http://127.0.0.1:3000",
        reason: null,
      },
      runtime: null,
    });
    manager.setNativeWebContentsRegistrar(registrar);

    await manager.ensureSession({ projectId: "project-owner", workspaceRoot });

    const contents = webContentsViews[0]!.webContents;
    Object.assign(contents, { id: 42 });
    expect(manager.ownsWebContents(42)).toBe(true);
    expect(manager.ownsWebContents(43)).toBe(false);
    contents.isDestroyed.mockReturnValueOnce(true);
    expect(manager.ownsWebContents(42)).toBe(false);
    expect(registrar).toHaveBeenCalledOnce();
    expect(registrar.mock.calls[0]?.[2]).toBe("project-owner");
  });

  it.each(["Bloomberg Terminal Alternative", "literal%20folder", "hash#question?", "café folder"])(
    "passes decoded URI components to Code-OSS for %s",
    (folderName) => {
      const manager = new CodeHostManager(() => createMockWindow() as never, {
        state: { available: true, mode: "embedded", entry: "http://127.0.0.1:3000", reason: null },
        runtime: null,
      });
      const folderPath = Path.join(Path.sep, "projects", folderName);
      const component = (
        manager as unknown as {
          toFileUriComponent(path: string): { scheme: string; path: string };
        }
      ).toFileUriComponent(folderPath);
      expect(component.scheme).toBe("file");
      expect(component.path).toBe(
        `${process.platform === "win32" ? "/" : ""}${Path.resolve(folderPath).replaceAll(Path.sep, "/")}`,
      );
    },
  );

  it("does not create a workbench or extension host for a missing project folder", async () => {
    const window = createMockWindow();
    const missingWorkspace = Path.join(makeTempDir("tabs-deleted-session-"), "gone");
    const manager = new CodeHostManager(() => window as never, {
      state: {
        available: true,
        mode: "embedded",
        entry: "http://127.0.0.1:3000",
        reason: null,
      },
      runtime: null,
    });

    await expect(
      manager.ensureSession({ projectId: "missing", workspaceRoot: missingWorkspace }),
    ).rejects.toThrow(`The project folder no longer exists: ${missingWorkspace}`);
    expect(webContentsViews).toHaveLength(0);
  });

  it("switches active sessions by detaching the previous WebContentsView", async () => {
    const workspaceA = makeTempDir("tabs-session-a-");
    const workspaceB = makeTempDir("tabs-session-b-");
    const window = createMockWindow();
    const manager = new CodeHostManager(() => window as never, {
      state: {
        available: true,
        mode: "embedded",
        entry: "http://127.0.0.1:3000",
        reason: null,
      },
      runtime: null,
    });

    await manager.ensureSession({ projectId: "a", workspaceRoot: workspaceA });
    await manager.ensureSession({ projectId: "b", workspaceRoot: workspaceB });
    manager.setBounds({
      projectId: "a",
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      visible: true,
    });
    manager.setBounds({
      projectId: "b",
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      visible: true,
    });

    await manager.activateSession({ projectId: "a" });
    await manager.activateSession({ projectId: "b" });

    expect(window.contentView.removeChildView).toHaveBeenCalledTimes(1);
    expect(window.contentView.addChildView).toHaveBeenCalledTimes(2);
    expect(window.contentView.children).toHaveLength(1);
    expect(webContentsViews[0]!.webContents.setBackgroundThrottling).toHaveBeenCalledWith(true);
    expect(webContentsViews[1]!.webContents.setBackgroundThrottling).not.toHaveBeenCalledWith(
      false,
    );
  });

  it("captures an embedded session for transient native-surface overlays", async () => {
    const workspace = makeTempDir("tabs-session-capture-");
    const window = createMockWindow();
    const manager = new CodeHostManager(() => window as never, {
      state: {
        available: true,
        mode: "embedded",
        entry: "http://127.0.0.1:3000",
        reason: null,
      },
      runtime: null,
    });

    await manager.ensureSession({ projectId: "capture", workspaceRoot: workspace });

    await expect(manager.captureSession("capture")).resolves.toBe("data:image/png;base64,dGVzdA==");
    await expect(manager.captureSession("missing")).resolves.toBeNull();
  });

  it("hides the active session and disposes stale sessions on sync", async () => {
    const workspaceA = makeTempDir("tabs-session-a-");
    const workspaceB = makeTempDir("tabs-session-b-");
    const window = createMockWindow();
    const manager = new CodeHostManager(() => window as never, {
      state: {
        available: true,
        mode: "embedded",
        entry: "http://127.0.0.1:3000",
        reason: null,
      },
      runtime: null,
    });

    await manager.ensureSession({ projectId: "a", workspaceRoot: workspaceA });
    await manager.ensureSession({ projectId: "b", workspaceRoot: workspaceB });
    manager.setBounds({
      projectId: "a",
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      visible: true,
    });
    await manager.activateSession({ projectId: "a" });

    manager.hideActiveSession();
    manager.syncSessions(["b"]);

    expect(window.contentView.removeChildView).toHaveBeenCalled();
    expect(webContentsViews[0]!.webContents.close).toHaveBeenCalledWith({
      waitForBeforeUnload: false,
    });
    expect(webContentsViews[1]!.webContents.close).not.toHaveBeenCalled();
  });

  it("keeps only bounded warm Code sessions (CO-003)", async () => {
    const window = createMockWindow();
    const manager = new CodeHostManager(() => window as never, {
      state: {
        available: true,
        mode: "embedded",
        entry: "http://127.0.0.1:3000",
        reason: null,
      },
      runtime: null,
    });

    for (const projectId of ["a", "b", "c", "d"]) {
      await manager.ensureSession({
        projectId,
        workspaceRoot: makeTempDir(`tabs-session-${projectId}-`),
      });
      manager.setBounds({ projectId, x: 0, y: 0, width: 800, height: 600, visible: true });
      await manager.activateSession({ projectId });
    }

    // CO-003: With MAX_WARM_CODE_SESSIONS = 2, older sessions (a and b) are pruned,
    // and only the 2 most recent sessions (c and d) remain warm.
    expect(webContentsViews[0]!.webContents.close).toHaveBeenCalledWith({
      waitForBeforeUnload: false,
    });
    expect(webContentsViews[1]!.webContents.close).toHaveBeenCalledWith({
      waitForBeforeUnload: false,
    });
    expect(
      webContentsViews.slice(2).every((view) => !view.webContents.close.mock.calls.length),
    ).toBe(true);
  });

  it("re-syncs the active theme ID (not generic dark/light) on extension host reconnect", async () => {
    let extensionHostConnectedHandler: ((projectId: string) => void) | null = null;
    const mockControlChannel = {
      onExtensionHostConnected: vi.fn((handler) => {
        extensionHostConnectedHandler = handler;
      }),
      onChromeState: vi.fn(),
      setTheme: vi.fn(),
      openFile: vi.fn(),
    };

    const window = createMockWindow();
    const manager = new CodeHostManager(
      () => window as never,
      {
        state: {
          available: true,
          mode: "embedded",
          entry: "http://127.0.0.1:3000",
          reason: null,
        },
        runtime: null,
      },
      mockControlChannel as never,
    );

    // Set a non-default theme (e.g. dracula)
    manager.setTheme("dracula", { colors: { background: "#282a36" } });

    // Simulate extension host connection
    expect(extensionHostConnectedHandler).not.toBeNull();
    extensionHostConnectedHandler!("project-1");

    // Verify controlChannel.setTheme was called with "dracula" and custom config, not generic "dark"
    expect(mockControlChannel.setTheme).toHaveBeenCalledWith("dracula", {
      colors: { background: "#282a36" },
    });
  });

  it("verifies setTheme executes cleanly across all 7 built-in themes plus custom theme", async () => {
    const workspaceRoot = makeTempDir("tabs-all-themes-");
    const window = createMockWindow();
    const manager = new CodeHostManager(() => window as never, {
      state: {
        available: true,
        mode: "embedded",
        entry: "http://127.0.0.1:3000",
        reason: null,
      },
      runtime: null,
    });

    await manager.ensureSession({
      projectId: "proj-all-themes",
      workspaceRoot,
    });

    const themesToTest = [
      "tabs-dark",
      "true-black",
      "tabs-light",
      "abyss",
      "dracula",
      "deep-blue",
      "solarized-light",
      "custom",
    ];

    for (const themeId of themesToTest) {
      expect(() => manager.setTheme(themeId)).not.toThrow();
    }
  });

  describe("readWorkspaceTabs & writeWorkspaceTabs", () => {
    it("writes and reads workspace tab persistence correctly", () => {
      const testDir = makeTempDir("tab-test-");
      try {
        const projectId = "test-proj-123";
        const sampleTabs = [
          {
            filePath: "/path/to/fileA.ts",
            viewColumn: 1,
            active: false,
            pinned: true,
          },
          {
            filePath: "/path/to/fileB.ts",
            viewColumn: 1,
            active: true,
            pinned: false,
          },
        ];

        writeWorkspaceTabs(projectId, sampleTabs, testDir);
        const readBack = readWorkspaceTabs(projectId, testDir);

        expect(readBack).toEqual(sampleTabs);
      } finally {
        FS.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("returns null for non-existent workspace tab file", () => {
      const testDir = makeTempDir("tab-test-none-");
      try {
        const readBack = readWorkspaceTabs("non-existent-project-xyz", testDir);
        expect(readBack).toBeNull();
      } finally {
        FS.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("keeps only tabs contained by the project workspace", () => {
      const workspaceRoot = Path.join(Path.sep, "projects", "tabs");
      const tabs = [
        { filePath: Path.join(workspaceRoot, "src", "index.ts"), active: true },
        { filePath: "README.md", active: false },
        {
          filePath: Path.join(Path.sep, "projects", "throttle", "app.json"),
          active: false,
        },
        {
          filePath: Path.join("..", "throttle", "package.json"),
          active: false,
        },
      ];

      expect(filterWorkspaceTabs(workspaceRoot, tabs)).toEqual(tabs.slice(0, 2));
      expect(isPathInsideWorkspace(workspaceRoot, workspaceRoot)).toBe(false);
    });
  });
});
