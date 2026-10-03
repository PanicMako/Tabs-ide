import { describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  fromPartition: vi.fn(),
  showItemInFolder: vi.fn(),
  browserWindows: [] as Array<Record<string, unknown>>,
  BrowserWindow: vi.fn(function () {
    const listeners = new Map<string, () => void>();
    const children: unknown[] = [];
    const window = {
      contentView: {
        children,
        addChildView: vi.fn((view: unknown) => children.push(view)),
        removeChildView: vi.fn((view: unknown) => {
          const index = children.indexOf(view);
          if (index >= 0) children.splice(index, 1);
        }),
      },
      isDestroyed: vi.fn(() => false),
      getContentSize: vi.fn(() => [640, 420]),
      on: vi.fn((event: string, listener: () => void) => listeners.set(event, listener)),
      once: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, listener);
        if (event === "ready-to-show") listener();
      }),
      show: vi.fn(),
      focus: vi.fn(),
      close: vi.fn(() => listeners.get("closed")?.()),
    };
    electronMocks.browserWindows.push(window);
    return window;
  }),
}));

// browserHostManager imports `electron` at module load; mock it so the pure
// helper under test can be imported in a plain Node test environment.
vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/tabs-test-user-data" },
  clipboard: { write: vi.fn() },
  ClipboardItem: vi.fn(),
  nativeImage: { createFromBuffer: vi.fn() },
  BrowserWindow: electronMocks.BrowserWindow,
  WebContentsView: vi.fn(),
  Menu: { buildFromTemplate: () => ({ popup: () => undefined }) },
  session: { fromPartition: electronMocks.fromPartition },
  shell: {
    openExternal: () => Promise.resolve(),
    showItemInFolder: electronMocks.showItemInFolder,
  },
}));

import {
  BrowserHostManager,
  configurePartitionSession,
  hasReturnedToAuthenticationOrigin,
  isLikelyAuthenticationUrl,
  normalizeBrowserCookieDomain,
  normalizeBrowserProfileId,
  normalizeRemoteBrowserUrl,
  planBrowserCrashRecovery,
  sanitizeEmbeddedBrowserUserAgent,
} from "./browserHostManager";

describe("browser crash recovery", () => {
  it("uses bounded exponential backoff and resets after the recovery window", () => {
    const first = planBrowserCrashRecovery(0, null, 1_000)!;
    expect(first).toEqual({ attempts: 1, windowStartedAt: 1_000, delayMs: 250 });
    expect(planBrowserCrashRecovery(1, 1_000, 1_100)?.delayMs).toBe(500);
    expect(planBrowserCrashRecovery(2, 1_000, 1_200)?.delayMs).toBe(1_000);
    expect(planBrowserCrashRecovery(3, 1_000, 1_300)).toBeNull();
    expect(planBrowserCrashRecovery(3, 1_000, 31_000)?.delayMs).toBe(250);
  });
});

describe("hasReturnedToAuthenticationOrigin", () => {
  it("recognizes a completed redirect back to the originating site", () => {
    expect(
      hasReturnedToAuthenticationOrigin("https://chatgpt.com/", "https://www.chatgpt.com/"),
    ).toBe(true);
  });

  it("waits through provider and callback pages", () => {
    expect(
      hasReturnedToAuthenticationOrigin(
        "https://accounts.google.com/v3/signin/identifier",
        "https://chatgpt.com/",
      ),
    ).toBe(false);
    expect(
      hasReturnedToAuthenticationOrigin(
        "https://chatgpt.com/auth/callback?code=abc",
        "https://chatgpt.com/",
      ),
    ).toBe(false);
  });
});

describe("isLikelyAuthenticationUrl", () => {
  it("recognizes provider hosts and common authentication paths", () => {
    expect(isLikelyAuthenticationUrl("https://accounts.google.com/v3/signin/identifier")).toBe(
      true,
    );
    expect(isLikelyAuthenticationUrl("https://example.com/oauth/authorize?client_id=1")).toBe(true);
    expect(isLikelyAuthenticationUrl("https://example.com/account/login")).toBe(true);
  });

  it("does not route ordinary pages or unsupported URLs", () => {
    expect(isLikelyAuthenticationUrl("https://example.com/projects/authentication-guide")).toBe(
      false,
    );
    expect(isLikelyAuthenticationUrl("file:///tmp/login")).toBe(false);
    expect(isLikelyAuthenticationUrl("not a url")).toBe(false);
  });
});

describe("sanitizeEmbeddedBrowserUserAgent", () => {
  it("strips the Electron and app product tokens, leaving a vanilla Chrome UA", () => {
    const electronUserAgent =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Tabs/0.0.14 Chrome/140.0.0.0 Electron/40.6.0 Safari/537.36";

    expect(sanitizeEmbeddedBrowserUserAgent(electronUserAgent)).toBe(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    );
  });

  it("preserves the platform segment on Windows", () => {
    const windowsUserAgent =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Tabs/0.0.14 Chrome/140.0.0.0 Electron/40.6.0 Safari/537.36";

    const result = sanitizeEmbeddedBrowserUserAgent(windowsUserAgent);
    expect(result).toContain("Windows NT 10.0; Win64; x64");
    expect(result).not.toContain("Electron/");
    expect(result).not.toContain("Tabs/");
    expect(result).toContain("Chrome/140.0.0.0 Safari/537.36");
  });

  it("is a no-op for an already-clean Chrome UA", () => {
    const chromeUserAgent =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

    expect(sanitizeEmbeddedBrowserUserAgent(chromeUserAgent)).toBe(chromeUserAgent);
  });
});

describe("BrowserHostManager profile storage", () => {
  it("reports exact stored cookie domains without claiming authenticated state", async () => {
    electronMocks.fromPartition.mockReturnValue({
      cookies: {
        on: vi.fn(),
        get: vi.fn().mockResolvedValue([
          { domain: ".accounts.example.co.uk", name: "sessionid", value: "long-session-value" },
          { domain: ".cdn.example.co.uk", name: "preferences", value: "dark" },
        ]),
      },
    });
    const manager = new BrowserHostManager(() => null);

    await expect(manager.getProfileDomains("work")).resolves.toEqual([
      { domain: "accounts.example.co.uk", cookieCount: 1, hasSessionHint: true },
      { domain: "cdn.example.co.uk", cookieCount: 1, hasSessionHint: false },
    ]);
  });

  it("inspects profile truthfulness: returns partition, persistent state, cookie counts, and no secrets", async () => {
    const sessionCookie = {
      domain: ".github.com",
      name: "user_session",
      get value(): string {
        throw new Error("cookie values must not be inspected");
      },
    };
    electronMocks.fromPartition.mockReturnValue({
      isPersistent: () => true,
      getStoragePath: () => "/tmp/tabs-storage-work",
      cookies: {
        on: vi.fn(),
        get: vi
          .fn()
          .mockResolvedValue([
            sessionCookie,
            { domain: ".github.com", name: "__Host-csrf", value: "secret-csrf-token" },
            { domain: "docs.github.com", name: "theme", value: "dark" },
          ]),
      },
    });
    const manager = new BrowserHostManager(() => null);
    const inspection = await manager.inspectProfile("work");

    expect(inspection.profileId).toBe("work");
    expect(inspection.partition).toBe("persist:tabs-browser:profile:work");
    expect(inspection.isPersistent).toBe(true);
    expect(inspection.storagePath).toBe("/tmp/tabs-storage-work");
    expect(inspection.totalCookies).toBe(3);
    expect(inspection.totalDomains).toBe(2);
    expect(inspection.inspectedAt).toBeGreaterThan(0);

    // Verify domains are accurately summarized
    expect(inspection.domains).toEqual([
      { domain: "github.com", cookieCount: 2, hasSessionHint: true },
      { domain: "docs.github.com", cookieCount: 1, hasSessionHint: false },
    ]);

    // Critical security constraint: NEVER expose cookie values or secrets
    const serialized = JSON.stringify(inspection);
    expect(serialized).not.toContain("super-secret-token-12345");
    expect(serialized).not.toContain("secret-csrf-token");
    for (const d of inspection.domains) {
      expect((d as any).value).toBeUndefined();
      expect((d as any).name).toBeUndefined();
    }
  });

  it("handles empty profile correctly", async () => {
    electronMocks.fromPartition.mockReturnValue({
      isPersistent: () => true,
      getStoragePath: () => "/tmp/tabs-storage-personal",
      cookies: {
        on: vi.fn(),
        get: vi.fn().mockResolvedValue([]),
      },
    });
    const manager = new BrowserHostManager(() => null);
    const inspection = await manager.inspectProfile("personal");

    expect(inspection.profileId).toBe("personal");
    expect(inspection.partition).toBe("persist:tabs-browser:profile:personal");
    expect(inspection.isPersistent).toBe(true);
    expect(inspection.totalCookies).toBe(0);
    expect(inspection.totalDomains).toBe(0);
    expect(inspection.domains).toEqual([]);
  });

  it("fails truthfully when cookie inspection rejects and does not swallow into empty array", async () => {
    electronMocks.fromPartition.mockReturnValue({
      isPersistent: () => true,
      getStoragePath: () => "/tmp/tabs-storage-broken",
      cookies: {
        on: vi.fn(),
        get: vi.fn().mockRejectedValue(new Error("Chromium cookie database locked")),
      },
    });
    const manager = new BrowserHostManager(() => null);

    await expect(manager.inspectProfile("broken")).rejects.toThrow(
      "Chromium cookie database locked",
    );
  });

  it("allows retrying inspection after failure", async () => {
    const mockCookiesGet = vi
      .fn()
      .mockRejectedValueOnce(new Error("Temporary disk I/O failure"))
      .mockResolvedValueOnce([
        { domain: ".example.com", name: "sid", value: "recovered-session-id" },
      ]);

    electronMocks.fromPartition.mockReturnValue({
      isPersistent: () => true,
      getStoragePath: () => "/tmp/tabs-storage-retry",
      cookies: {
        on: vi.fn(),
        get: mockCookiesGet,
      },
    });
    const manager = new BrowserHostManager(() => null);

    // 1st attempt fails
    await expect(manager.inspectProfile("retry-profile")).rejects.toThrow(
      "Temporary disk I/O failure",
    );

    // 2nd attempt succeeds
    const recovered = await manager.inspectProfile("retry-profile");
    expect(recovered.totalDomains).toBe(1);
    expect(recovered.domains[0]?.domain).toBe("example.com");
  });

  it("keeps multiple profile partitions completely isolated", async () => {
    const manager = new BrowserHostManager(() => null);

    electronMocks.fromPartition.mockImplementation((partition: string) => ({
      isPersistent: () => true,
      getStoragePath: () => `/tmp/${partition}`,
      cookies: {
        on: vi.fn(),
        get: vi
          .fn()
          .mockResolvedValue(
            partition.includes("personal")
              ? [{ domain: "personal.org", name: "p_token", value: "tok1" }]
              : [{ domain: "work.org", name: "w_token", value: "tok2" }],
          ),
      },
    }));

    const personal = await manager.inspectProfile("personal");
    const work = await manager.inspectProfile("work");

    expect(personal.partition).toBe("persist:tabs-browser:profile:personal");
    expect(work.partition).toBe("persist:tabs-browser:profile:work");
    expect(personal.domains.map((d) => d.domain)).toEqual(["personal.org"]);
    expect(work.domains.map((d) => d.domain)).toEqual(["work.org"]);
  });

  it("clears a single domain and closes connections", async () => {
    const profileSession = {
      cookies: {
        on: vi.fn(),
        get: vi.fn().mockResolvedValue([
          { domain: ".github.com", name: "user_session", path: "/", secure: true },
          { domain: ".google.com", name: "sid", path: "/", secure: true },
        ]),
        remove: vi.fn().mockResolvedValue(undefined),
        flushStore: vi.fn().mockResolvedValue(undefined),
      },
      closeAllConnections: vi.fn().mockResolvedValue(undefined),
      clearData: vi.fn().mockResolvedValue(undefined),
      flushStorageData: vi.fn(),
    };
    electronMocks.fromPartition.mockReturnValue(profileSession);
    const manager = new BrowserHostManager(() => null);

    await manager.clearProfileDomain("work", "github.com");

    expect(profileSession.cookies.remove).toHaveBeenCalledWith(
      "https://github.com/",
      "user_session",
    );
    expect(profileSession.cookies.remove).not.toHaveBeenCalledWith(expect.anything(), "sid");
    expect(profileSession.closeAllConnections).toHaveBeenCalledOnce();
    expect(profileSession.clearData).toHaveBeenCalledWith(
      expect.objectContaining({
        origins: ["https://github.com", "http://github.com"],
      }),
    );
    expect(profileSession.cookies.flushStore).toHaveBeenCalledOnce();
  });

  it("uses comprehensive Chromium data clearing for a profile", async () => {
    const profileSession = {
      cookies: { on: vi.fn(), flushStore: vi.fn().mockResolvedValue(undefined) },
      closeAllConnections: vi.fn().mockResolvedValue(undefined),
      clearData: vi.fn().mockResolvedValue(undefined),
      flushStorageData: vi.fn(),
    };
    electronMocks.fromPartition.mockReturnValue(profileSession);
    const manager = new BrowserHostManager(() => null);

    await manager.clearProfileData("personal");

    expect(electronMocks.fromPartition).toHaveBeenCalledWith(
      "persist:tabs-browser:profile:personal",
    );
    expect(profileSession.closeAllConnections).toHaveBeenCalledOnce();
    expect(profileSession.clearData).toHaveBeenCalledWith(
      expect.objectContaining({ dataTypes: expect.arrayContaining(["cookies", "indexedDB"]) }),
    );
    expect(profileSession.flushStorageData).toHaveBeenCalledOnce();
    expect(profileSession.cookies.flushStore).toHaveBeenCalledOnce();
  });

  it("clears the exact partition owned by an active browser session", async () => {
    const storageSession = {
      cookies: { flushStore: vi.fn().mockResolvedValue(undefined) },
      closeAllConnections: vi.fn().mockResolvedValue(undefined),
      clearData: vi.fn().mockResolvedValue(undefined),
      flushStorageData: vi.fn(),
    };
    const manager = new BrowserHostManager(() => null);
    const browserSession = {
      projectId: "project-1",
      sessionId: "preview-1",
      key: "project-1::preview-1",
      currentUrl: null,
      view: { webContents: { session: storageSession } },
    };
    (manager as unknown as { sessions: Map<string, unknown> }).sessions.set(
      browserSession.key,
      browserSession,
    );

    await manager.clearSessionData("project-1", "preview-1");

    expect(storageSession.closeAllConnections).toHaveBeenCalledOnce();
    expect(storageSession.clearData).toHaveBeenCalledWith(
      expect.objectContaining({
        dataTypes: expect.arrayContaining(["cache", "cookies", "localStorage", "serviceWorkers"]),
      }),
    );
    expect(storageSession.flushStorageData).toHaveBeenCalledOnce();
    expect(storageSession.cookies.flushStore).toHaveBeenCalledOnce();
  });
});

describe("BrowserHostManager picture in picture", () => {
  it("reparents the live view and restores it to the active main window on close", () => {
    electronMocks.browserWindows.length = 0;
    const mainChildren: unknown[] = [];
    const mainWindow = {
      contentView: {
        children: mainChildren,
        addChildView: vi.fn((view: unknown) => mainChildren.push(view)),
        removeChildView: vi.fn((view: unknown) => {
          const index = mainChildren.indexOf(view);
          if (index >= 0) mainChildren.splice(index, 1);
        }),
      },
      isDestroyed: () => false,
      webContents: { send: vi.fn(), getZoomFactor: () => 1 },
    };
    const manager = new BrowserHostManager(() => mainWindow as never);
    const view = {
      setBounds: vi.fn(),
      webContents: { isDestroyed: () => false },
    };
    const session = {
      projectId: "project-1",
      sessionId: "preview-1",
      key: "project-1::preview-1",
      view,
      bounds: { x: 10, y: 20, width: 800, height: 600 },
      pageTitle: "Preview",
      pictureInPictureWindow: null,
    };
    mainChildren.push(view);
    (manager as unknown as { activeKey: string | null }).activeKey = session.key;
    (manager as unknown as { sessions: Map<string, unknown> }).sessions.set(session.key, session);

    manager.openPictureInPicture({ projectId: "project-1", sessionId: "preview-1" });
    expect(mainChildren).toEqual([]);
    expect(electronMocks.browserWindows).toHaveLength(1);
    const browserWindow = electronMocks.browserWindows[0];
    expect(browserWindow).toBeDefined();
    expect((browserWindow!.contentView as { children: unknown[] }).children).toEqual([view]);
    expect(manager.getSessionState("project-1", "preview-1").pictureInPicture).toBe(true);

    manager.closePictureInPicture({ projectId: "project-1", sessionId: "preview-1" });
    expect(mainChildren).toEqual([view]);
    expect(view.setBounds).toHaveBeenLastCalledWith(session.bounds);
    expect(manager.getSessionState("project-1", "preview-1").pictureInPicture).toBe(false);
  });
});

describe("BrowserHostManager appearance", () => {
  it("applies and exposes a persistent prefers-color-scheme override", async () => {
    const sendCommand = vi.fn().mockResolvedValue(undefined);
    const manager = new BrowserHostManager(() => null);
    const session = {
      projectId: "project-1",
      sessionId: "preview-1",
      key: "project-1::preview-1",
      view: {
        webContents: {
          isDestroyed: () => false,
          isDevToolsOpened: () => false,
          debugger: {
            isAttached: () => false,
            attach: vi.fn(),
            sendCommand,
          },
        },
      },
      colorScheme: "system",
      pictureInPictureWindow: null,
    };
    (manager as unknown as { sessions: Map<string, unknown> }).sessions.set(session.key, session);

    await manager.setColorScheme({
      projectId: "project-1",
      sessionId: "preview-1",
      colorScheme: "dark",
    });

    expect(sendCommand).toHaveBeenCalledWith("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "dark" }],
    });
    expect(manager.getSessionState("project-1", "preview-1").colorScheme).toBe("dark");
  });
});

describe("BrowserHostManager automation", () => {
  it("routes status and evaluation to the requested persistent session", async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({ heading: "Ready" });
    const manager = new BrowserHostManager(() => null);
    const sessions = (
      manager as unknown as {
        sessions: Map<string, unknown>;
      }
    ).sessions;
    const browserSession = {
      projectId: "project-1",
      sessionId: "preview-1",
      key: "project-1::preview-1",
      view: {
        webContents: {
          isDestroyed: () => false,
          executeJavaScript,
        },
      },
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      currentUrl: "https://example.com/",
      pageTitle: "Example",
      loading: false,
      consoleEntries: [],
      networkEntries: [],
      actionTimeline: [],
    };
    sessions.set("project-1::preview-1", browserSession);

    await expect(
      manager.runAutomation({
        projectId: "project-1",
        sessionId: "preview-1",
        operation: "status",
      }),
    ).resolves.toMatchObject({
      available: true,
      tabId: "preview-1",
      url: "https://example.com/",
      viewport: { width: 800, height: 600 },
    });
    await expect(
      manager.runAutomation({
        projectId: "project-1",
        sessionId: "preview-1",
        operation: "evaluate",
        input: { expression: "({ heading: document.title })" },
      }),
    ).resolves.toEqual({ heading: "Ready" });
    expect(executeJavaScript).toHaveBeenCalledWith("({ heading: document.title })", true);
    expect(browserSession.actionTimeline).toEqual([
      expect.objectContaining({
        action: "evaluate",
        status: "succeeded",
        startedAt: expect.any(String),
        completedAt: expect.any(String),
      }),
    ]);
  });

  it("retains failed automation details for the next diagnostic snapshot", async () => {
    const manager = new BrowserHostManager(() => null);
    const browserSession = {
      projectId: "project-1",
      sessionId: "preview-1",
      key: "project-1::preview-1",
      view: {
        webContents: {
          isDestroyed: () => false,
          executeJavaScript: vi.fn().mockRejectedValue(new Error("page execution failed")),
        },
      },
      bounds: null,
      currentUrl: "https://example.com/",
      pageTitle: "Example",
      loading: false,
      consoleEntries: [],
      networkEntries: [],
      actionTimeline: [],
    };
    (
      manager as unknown as {
        sessions: Map<string, unknown>;
      }
    ).sessions.set("project-1::preview-1", browserSession);

    await expect(
      manager.runAutomation({
        projectId: "project-1",
        sessionId: "preview-1",
        operation: "evaluate",
        input: { expression: "broken()" },
      }),
    ).rejects.toThrow("page execution failed");
    expect(browserSession.actionTimeline).toEqual([
      expect.objectContaining({
        action: "evaluate",
        status: "failed",
        error: "page execution failed",
        completedAt: expect.any(String),
      }),
    ]);
  });

  it("marks an action interrupted when human input advances the control epoch", async () => {
    const manager = new BrowserHostManager(() => null);
    const browserSession = {
      projectId: "project-1",
      sessionId: "preview-1",
      key: "project-1::preview-1",
      view: { webContents: { isDestroyed: () => false, executeJavaScript: vi.fn() } },
      bounds: null,
      currentUrl: "https://example.com/",
      pageTitle: "Example",
      loading: false,
      consoleEntries: [],
      networkEntries: [],
      actionTimeline: [],
      controller: "none",
      controlEpoch: 0,
      dispatchingAgentInput: false,
      humanControlTimer: null,
    };
    browserSession.view.webContents.executeJavaScript.mockImplementation(async () => {
      browserSession.controlEpoch += 1;
      browserSession.controller = "human";
      return "late result";
    });
    (
      manager as unknown as {
        sessions: Map<string, unknown>;
      }
    ).sessions.set("project-1::preview-1", browserSession);

    await expect(
      manager.runAutomation({
        projectId: "project-1",
        sessionId: "preview-1",
        operation: "evaluate",
        input: { expression: "slowOperation()" },
      }),
    ).rejects.toThrow("interrupted by human input");
    expect(browserSession.actionTimeline).toEqual([
      expect.objectContaining({ status: "interrupted", error: expect.stringContaining("human") }),
    ]);
    expect(browserSession.controller).toBe("human");
  });

  it("serializes automation actions for one browser session", async () => {
    let releaseFirst!: () => void;
    const firstResult = new Promise<string>((resolve) => {
      releaseFirst = () => resolve("first");
    });
    const executeJavaScript = vi
      .fn()
      .mockImplementationOnce(() => firstResult)
      .mockResolvedValueOnce("second");
    const manager = new BrowserHostManager(() => null);
    (
      manager as unknown as {
        sessions: Map<string, unknown>;
      }
    ).sessions.set("project-1::preview-1", {
      projectId: "project-1",
      sessionId: "preview-1",
      key: "project-1::preview-1",
      view: { webContents: { isDestroyed: () => false, executeJavaScript } },
      actionTimeline: [],
      controller: "none",
      controlEpoch: 0,
      automationTail: Promise.resolve(),
    });

    const first = manager.runAutomation({
      projectId: "project-1",
      sessionId: "preview-1",
      operation: "evaluate",
      input: { expression: "first()" },
    });
    const second = manager.runAutomation({
      projectId: "project-1",
      sessionId: "preview-1",
      operation: "evaluate",
      input: { expression: "second()" },
    });
    await Promise.resolve();
    expect(executeJavaScript).toHaveBeenCalledTimes(1);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
    expect(executeJavaScript).toHaveBeenCalledTimes(2);
  });

  it("rejects automation for a missing session", async () => {
    const manager = new BrowserHostManager(() => null);
    await expect(
      manager.runAutomation({ projectId: "missing", operation: "status" }),
    ).rejects.toThrow("browser session was not found");
  });
});

describe("BrowserHostManager artifacts", () => {
  it("reveals only files inside the managed artifact directory", () => {
    const manager = new BrowserHostManager(() => null);

    expect(() => manager.revealArtifact("/tmp/tabs-test-user-data/settings.json")).toThrow(
      "Tabs artifact directory",
    );
    manager.revealArtifact(
      "/tmp/tabs-test-user-data/browser-artifacts/browser-screenshot-test.png",
    );
    expect(electronMocks.showItemInFolder).toHaveBeenCalledWith(
      "/tmp/tabs-test-user-data/browser-artifacts/browser-screenshot-test.png",
    );
  });

  it("returns structured element context with a real page capture", async () => {
    const manager = new BrowserHostManager(() => null);
    const executeJavaScript = vi.fn().mockResolvedValue({
      pageUrl: "https://example.com/settings",
      pageTitle: "Settings",
      tagName: "button",
      selector: "#save",
      htmlPreview: '<button id="save">Save</button>',
      componentName: null,
      source: null,
      stack: [],
      styles: "display: block;",
      pickedAt: "2026-09-04T00:00:00.000Z",
      rect: { x: 10, y: 20, width: 80, height: 32 },
    });
    (
      manager as unknown as {
        sessions: Map<string, unknown>;
      }
    ).sessions.set("project-1::tab-1", {
      projectId: "project-1",
      sessionId: "tab-1",
      key: "project-1::tab-1",
      view: {
        webContents: {
          isDestroyed: () => false,
          executeJavaScript,
          capturePage: vi.fn().mockResolvedValue({
            getSize: () => ({ width: 1024, height: 768 }),
            toPNG: () => Buffer.from("real-png-bytes"),
          }),
        },
      },
    });

    await expect(
      manager.pickElement({ projectId: "project-1", sessionId: "tab-1" }),
    ).resolves.toMatchObject({
      pageUrl: "https://example.com/settings",
      elements: [
        {
          element: { selector: "#save", tagName: "button" },
          rect: { x: 10, y: 20, width: 80, height: 32 },
        },
      ],
      screenshot: {
        dataUrl: `data:image/png;base64,${Buffer.from("real-png-bytes").toString("base64")}`,
        width: 1024,
        height: 768,
      },
    });
    expect(executeJavaScript).toHaveBeenCalledOnce();
    // Parse the actual injected source: template escapes must remain valid JavaScript.
    expect(() => new Function(executeJavaScript.mock.calls[0]?.[0] as string)).not.toThrow();
  });
});

describe("configurePartitionSession", () => {
  it("configures a partition once without forging Chromium client hints", () => {
    const flushStore = vi.fn().mockResolvedValue(undefined);
    let cookieChanged: (() => void) | undefined;
    const profileSession = {
      getUserAgent: vi
        .fn()
        .mockReturnValue("Mozilla/5.0 Tabs/1.0.0 Chrome/140.0.0.0 Electron/40.6.0 Safari/537.36"),
      setUserAgent: vi.fn(),
      cookies: {
        on: vi.fn((_event: string, listener: () => void) => {
          cookieChanged = listener;
        }),
        flushStore,
      },
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
    };

    configurePartitionSession(profileSession as never);
    configurePartitionSession(profileSession as never);

    // Native user agent is preserved; setUserAgent is not called to prevent Cloudflare Turnstile error 600010
    expect(profileSession.setUserAgent).not.toHaveBeenCalled();
    expect(profileSession.setPermissionRequestHandler).toHaveBeenCalledOnce();
    expect(profileSession.cookies.on).toHaveBeenCalledOnce();

    cookieChanged?.();
    expect(flushStore).toHaveBeenCalledOnce();
  });
});

describe("browser profile input validation", () => {
  it("normalizes safe profile identifiers", () => {
    expect(normalizeBrowserProfileId(" Client_A ")).toBe("client_a");
  });

  it("rejects identifiers that could create ambiguous partitions", () => {
    expect(() => normalizeBrowserProfileId("../personal")).toThrow(
      "Invalid browser profile identifier",
    );
    expect(() => normalizeBrowserProfileId("work:other")).toThrow(
      "Invalid browser profile identifier",
    );
  });

  it("allows only HTTP and HTTPS profile-window destinations", () => {
    expect(normalizeRemoteBrowserUrl("https://example.com/login")).toBe(
      "https://example.com/login",
    );
    expect(() => normalizeRemoteBrowserUrl("file:///etc/passwd")).toThrow(
      "only support HTTP and HTTPS",
    );
  });

  it("rejects malformed cookie domains before data clearing", () => {
    expect(normalizeBrowserCookieDomain(".accounts.example.com")).toBe("accounts.example.com");
    expect(() => normalizeBrowserCookieDomain("example.com/path")).toThrow(
      "Invalid browser cookie domain",
    );
  });
});

describe("reliable browser tabs and agent control", () => {
  function createMockSession(overrides: Record<string, unknown> = {}) {
    const executeJavaScript = vi.fn().mockResolvedValue(true);
    const sendInputEvent = vi.fn();
    const close = vi.fn();
    const debuggerApi = {
      isAttached: vi.fn(() => false),
      attach: vi.fn(),
      detach: vi.fn(),
      sendCommand: vi.fn().mockResolvedValue({}),
      on: vi.fn(),
    };
    const webContents = {
      id: 100,
      isDestroyed: vi.fn(() => false),
      isDevToolsOpened: vi.fn(() => false),
      close,
      executeJavaScript,
      sendInputEvent,
      debugger: debuggerApi,
      session: {
        cookies: { on: vi.fn(), flushStore: vi.fn() },
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
        flushStorageData: vi.fn().mockResolvedValue(undefined),
        isPersistent: vi.fn(() => true),
      },
      on: vi.fn(),
    };

    const session = {
      projectId: "project-1",
      sessionId: "tab-1",
      key: "project-1::tab-1",
      partition: "persist:tabs-browser:project-1",
      profileId: "default",
      view: { webContents },
      bounds: null,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      devToolsOpen: false,
      zoomFactor: 1,
      audioMuted: false,
      colorScheme: "system",
      pictureInPictureWindow: null,
      consoleEntries: [],
      networkEntries: [],
      actionTimeline: [] as Array<any>,
      controller: "none",
      controlEpoch: 0,
      assignedTaskId: null,
      temporaryAgentTab: false,
      userRetained: false,
      dispatchingAgentInput: false,
      humanControlTimer: null,
      crashRecoveryAttempts: 0,
      crashRecoveryWindowStartedAt: null,
      crashRecoveryTimer: null,
      pendingPermission: null,
      automationTail: Promise.resolve(),
      currentUrl: "https://example.com/app",
      pageTitle: "Example App",
      lastError: null,
      transientError: null,
      ...overrides,
    };
    return {
      session,
      webContents,
      executeJavaScript,
      sendInputEvent,
      close,
      flushStorageData: webContents.session.flushStorageData,
    };
  }

  it("cancels queued automation operations when human takes control before execution", async () => {
    const manager = new BrowserHostManager(() => null);
    const { session, executeJavaScript } = createMockSession();
    (manager as unknown as { sessions: Map<string, unknown> }).sessions.set(session.key, session);

    // Block the automation queue with a long-running promise
    let unblockFirst!: () => void;
    const blockingPromise = new Promise<void>((resolve) => {
      unblockFirst = resolve;
    });

    let firstStarted!: () => void;
    const firstStartedPromise = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });

    executeJavaScript.mockImplementationOnce(async () => {
      firstStarted();
      await blockingPromise;
      return 2;
    });

    // Schedule first automation
    const firstPromise = manager.runAutomation({
      projectId: "project-1",
      sessionId: "tab-1",
      operation: "evaluate",
      input: { expression: "1 + 1" },
    });

    // Wait until first automation is actively executing
    await firstStartedPromise;

    // Schedule second automation that queues behind the first
    const queuedPromise = manager.runAutomation({
      projectId: "project-1",
      sessionId: "tab-1",
      operation: "evaluate",
      input: { expression: "2 + 2" },
    });

    // Human takes control while first is running and second is queued!
    manager.takeControl({ projectId: "project-1", sessionId: "tab-1" });
    expect(session.controller).toBe("human");
    expect(session.controlEpoch).toBe(1);

    // Unblock the first operation
    unblockFirst();
    await expect(firstPromise).rejects.toThrow(
      "Browser automation was interrupted by human input during execution.",
    );

    // Queued action must be rejected without calling executeJavaScript for "2 + 2"
    await expect(queuedPromise).rejects.toThrow(
      "Browser automation was cancelled prior to execution due to human takeover or control epoch change.",
    );

    // Verify timeline recorded the cancellation
    const lastEvent = session.actionTimeline[session.actionTimeline.length - 1];
    expect(lastEvent?.status).toBe("cancelled");
  });

  it("keeps explicit human takeover latched after keyboard input until resumed", async () => {
    vi.useFakeTimers();
    try {
      const manager = new BrowserHostManager(() => null);
      const { session, webContents } = createMockSession();
      Object.assign(webContents, { setWindowOpenHandler: vi.fn() });
      const internals = manager as any;
      internals.sessions.set(session.key, session);
      internals.registerSessionEvents(session);
      manager.takeControl({ projectId: "project-1", sessionId: "tab-1" });
      const listener = (webContents.on.mock.calls as unknown as Array<[string, () => void]>).find(
        (call) => call[0] === "before-input-event",
      )?.[1] as unknown as () => void;
      listener();
      await vi.advanceTimersByTimeAsync(1000);
      expect(session.controller).toBe("human");
      manager.resumeAgent({ projectId: "project-1", sessionId: "tab-1" });
      expect(session.controller).toBe("none");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not execute an action after takeover while preparing a background surface", async () => {
    const window = {
      isDestroyed: () => false,
      contentView: { children: [], addChildView: vi.fn(), removeChildView: vi.fn() },
    };
    const manager = new BrowserHostManager(() => window as any);
    const { session } = createMockSession();
    Object.assign(session.view, { setBounds: vi.fn() });
    Object.assign(session, {
      cdpCoordinator: {
        withSession: vi.fn(async () => {
          session.controlEpoch++;
          return {};
        }),
      },
    });
    (manager as any).sessions.set(session.key, session);
    const run = vi.fn(async () => true);
    await expect((manager as any).withAutomationSurface(session, run)).rejects.toThrow(
      "interrupted during surface preparation",
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("ignores stationary hover from surface attachment but preempts real movement", () => {
    vi.useFakeTimers();
    try {
      const manager = new BrowserHostManager(() => null);
      const { session, webContents } = createMockSession({ assignedTaskId: "task-A" });
      Object.assign(webContents, { setWindowOpenHandler: vi.fn() });
      (manager as any).sessions.set(session.key, session);
      (manager as any).registerSessionEvents(session);
      const listener = session.view.webContents.on.mock.calls.find(
        ([event]) => event === "before-mouse-event",
      )?.[1];
      listener(undefined, { type: "mouseMove", movementX: 0, movementY: 0 });
      expect(session.controlEpoch).toBe(0);
      listener(undefined, { type: "mouseMove", movementX: 1, movementY: 0 });
      expect(session.controlEpoch).toBe(1);
      expect(session.controller).toBe("human");
      manager.resumeAgent({ projectId: "project-1", sessionId: "tab-1" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("invalidates queued work when tab ownership changes", () => {
    const manager = new BrowserHostManager(() => null);
    const { session } = createMockSession({ assignedTaskId: "task-A" });
    (manager as any).sessions.set(session.key, session);
    manager.assignTabTask({ projectId: "project-1", sessionId: "tab-1", taskId: "task-B" });
    manager.assignTabTask({ projectId: "project-1", sessionId: "tab-1", taskId: "task-A" });
    expect(session.controlEpoch).toBe(2);
  });

  it("requires identity for assigned-tab observations but permits explicit human controls", async () => {
    const manager = new BrowserHostManager(() => null);
    const { session } = createMockSession({ assignedTaskId: "task-A" });
    (manager as any).sessions.set(session.key, session);
    await expect(
      manager.runAutomation({ projectId: "project-1", sessionId: "tab-1", operation: "status" }),
    ).rejects.toThrow("matching task identity");
    await expect(
      manager.runAutomation({
        projectId: "project-1",
        sessionId: "tab-1",
        source: "human",
        operation: "status",
      }),
    ).resolves.toMatchObject({ available: true });
  });

  it("enforces task-to-tab ownership and rejects operations from unauthorized tasks", async () => {
    const manager = new BrowserHostManager(() => null);
    const { session } = createMockSession({ assignedTaskId: "task-A" });
    (manager as unknown as { sessions: Map<string, unknown> }).sessions.set(session.key, session);

    // Running with matching task ID succeeds
    await expect(
      manager.runAutomation({
        projectId: "project-1",
        sessionId: "tab-1",
        taskId: "task-A",
        operation: "evaluate",
        input: { expression: "true" },
      }),
    ).resolves.toBe(true);

    // Running with different task ID is rejected immediately
    await expect(
      manager.runAutomation({
        projectId: "project-1",
        sessionId: "tab-1",
        taskId: "task-B",
        operation: "evaluate",
        input: { expression: "true" },
      }),
    ).rejects.toThrow(
      'Browser tab is assigned to task "task-A"; the matching task identity is required.',
    );
  });

  it("cleans up temporary agent tabs while preserving user-retained tabs", () => {
    const manager = new BrowserHostManager(() => null);
    const sessions = (manager as unknown as { sessions: Map<string, unknown> }).sessions;

    const { session: tabA, close: closeA } = createMockSession({
      sessionId: "tab-A",
      key: "project-1::tab-A",
      assignedTaskId: "task-agent",
      temporaryAgentTab: true,
      userRetained: false,
    });
    const { session: tabB, close: closeB } = createMockSession({
      sessionId: "tab-B",
      key: "project-1::tab-B",
      assignedTaskId: "task-agent",
      temporaryAgentTab: true,
      userRetained: true, // User interacted or retained
    });
    const { session: tabC, close: closeC } = createMockSession({
      sessionId: "tab-C",
      key: "project-1::tab-C",
      assignedTaskId: "task-agent",
      temporaryAgentTab: false, // User created tab
      userRetained: false,
    });

    sessions.set(tabA.key, tabA);
    sessions.set(tabB.key, tabB);
    sessions.set(tabC.key, tabC);

    const closed = manager.cleanupAgentTabs({ projectId: "project-1", taskId: "task-agent" });

    expect(closed).toEqual(["tab-A"]);
    expect(closeA).toHaveBeenCalled();
    expect(closeB).not.toHaveBeenCalled();
    expect(closeC).not.toHaveBeenCalled();
    expect(sessions.has(tabA.key)).toBe(false);
    expect(sessions.has(tabB.key)).toBe(true);
    expect(sessions.has(tabC.key)).toBe(true);
  });

  it("records and restores recently closed tabs", () => {
    const manager = new BrowserHostManager(() => null);
    const { session } = createMockSession({
      currentUrl: "https://github.com/pulls",
      pageTitle: "Pull Requests",
    });
    (manager as unknown as { sessions: Map<string, unknown> }).sessions.set(session.key, session);

    manager.destroySession({ projectId: "project-1", sessionId: "tab-1" });

    const recent = manager.getRecentlyClosedTabs("project-1");
    expect(recent).toHaveLength(1);
    expect(recent[0]!.url).toBe("https://github.com/pulls");
    expect(recent[0]!.title).toBe("Pull Requests");

    const restored = manager.restoreRecentlyClosedTab("project-1", recent[0]!.id);
    expect(restored).toMatchObject({
      url: "https://github.com/pulls",
      title: "Pull Requests",
    });
    expect(manager.getRecentlyClosedTabs("project-1")).toHaveLength(0);
  });
});

describe("browser partition shutdown flushing", () => {
  function createMockSession(overrides: Record<string, unknown> = {}) {
    const executeJavaScript = vi.fn().mockResolvedValue(true);
    const sendInputEvent = vi.fn();
    const close = vi.fn();
    const flushStorageData = vi.fn();
    const flushStore = vi.fn().mockResolvedValue(undefined);
    const isPersistent = vi.fn(() => true);
    const debuggerApi = {
      isAttached: vi.fn(() => false),
      attach: vi.fn(),
      detach: vi.fn(),
      sendCommand: vi.fn().mockResolvedValue({}),
      on: vi.fn(),
    };
    const sessionObj = {
      cookies: { on: vi.fn(), flushStore },
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      flushStorageData,
      isPersistent,
    };
    const webContents = {
      id: 100,
      isDestroyed: vi.fn(() => false),
      isDevToolsOpened: vi.fn(() => false),
      close,
      executeJavaScript,
      sendInputEvent,
      debugger: debuggerApi,
      session: sessionObj,
      on: vi.fn(),
    };

    const session = {
      projectId: "project-1",
      sessionId: "tab-1",
      key: "project-1::tab-1",
      partition: "persist:tabs-browser:project:project-1",
      profileId: "default",
      view: { webContents },
      bounds: null,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      devToolsOpen: false,
      zoomFactor: 1,
      audioMuted: false,
      colorScheme: "system",
      pictureInPictureWindow: null,
      consoleEntries: [],
      networkEntries: [],
      actionTimeline: [] as Array<any>,
      controller: "none",
      controlEpoch: 0,
      assignedTaskId: null,
      temporaryAgentTab: false,
      userRetained: false,
      dispatchingAgentInput: false,
      humanControlLocked: false,
      humanControlTimer: null,
      crashRecoveryAttempts: 0,
      crashRecoveryWindowStartedAt: null,
      crashRecoveryTimer: null,
      pendingPermission: null,
      automationTail: Promise.resolve(),
      currentUrl: "https://example.com/app",
      pageTitle: "Example App",
      lastError: null,
      transientError: null,
      ...overrides,
    };
    return {
      session,
      webContents,
      sessionObj,
      close,
      flushStorageData,
      flushStore,
      isPersistent,
    };
  }

  it("flushes every distinct persistent session before closing views", async () => {
    const manager = new BrowserHostManager(() => null);
    const sessions = (manager as unknown as { sessions: Map<string, unknown> }).sessions;

    const callOrder: string[] = [];

    // Tab 1: Project 1 (shared project partition)
    const {
      session: tab1,
      flushStorageData: flushStorage1,
      flushStore: flushCookies1,
      close: close1,
      sessionObj: s1,
    } = createMockSession({
      sessionId: "tab-1",
      key: "proj-1::tab-1",
      partition: "persist:tabs-browser:project:proj-1",
    });
    flushCookies1.mockImplementation(async () => {
      callOrder.push("flush-proj-1");
    });
    close1.mockImplementation(() => {
      callOrder.push("close-tab-1");
    });

    // Tab 2: Project 1, second tab sharing the EXACT same partition & session object
    const { session: tab2, close: close2 } = createMockSession({
      sessionId: "tab-2",
      key: "proj-1::tab-2",
      partition: "persist:tabs-browser:project:proj-1",
    });
    // Share s1 object
    tab2.view.webContents.session = s1;
    close2.mockImplementation(() => {
      callOrder.push("close-tab-2");
    });

    // Tab 3: Named profile "work"
    const {
      session: tab3,
      flushStorageData: flushStorage3,
      flushStore: flushCookies3,
      close: close3,
    } = createMockSession({
      sessionId: "tab-3",
      key: "proj-2::tab-3",
      partition: "persist:tabs-browser:profile:work",
      profileId: "work",
    });
    flushCookies3.mockImplementation(async () => {
      callOrder.push("flush-work");
    });
    close3.mockImplementation(() => {
      callOrder.push("close-tab-3");
    });

    sessions.set(tab1.key, tab1);
    sessions.set(tab2.key, tab2);
    sessions.set(tab3.key, tab3);

    await manager.flushAndShutdownSessions();

    // Verify deduplication: proj-1 session flushed exactly ONCE despite 2 tabs sharing it
    expect(flushStorage1).toHaveBeenCalledTimes(1);
    expect(flushCookies1).toHaveBeenCalledTimes(1);
    // Work profile session flushed exactly once
    expect(flushStorage3).toHaveBeenCalledTimes(1);
    expect(flushCookies3).toHaveBeenCalledTimes(1);

    // Verify order of operations: all flushes happened BEFORE any views were closed
    const lastFlushIndex = Math.max(
      callOrder.indexOf("flush-proj-1"),
      callOrder.indexOf("flush-work"),
    );
    const firstCloseIndex = Math.min(
      callOrder.indexOf("close-tab-1"),
      callOrder.indexOf("close-tab-2"),
      callOrder.indexOf("close-tab-3"),
    );
    expect(lastFlushIndex).toBeLessThan(firstCloseIndex);

    // All views closed
    expect(close1).toHaveBeenCalledTimes(1);
    expect(close2).toHaveBeenCalledTimes(1);
    expect(close3).toHaveBeenCalledTimes(1);

    // Registry cleared
    expect(sessions.size).toBe(0);
  });

  it("handles isolated and ephemeral partitions appropriately without persisting them to disk", async () => {
    const manager = new BrowserHostManager(() => null);
    const sessions = (manager as unknown as { sessions: Map<string, unknown> }).sessions;

    const {
      session: ephemeralTab,
      flushStorageData,
      flushStore,
      close,
      isPersistent,
    } = createMockSession({
      sessionId: "ephemeral-tab",
      key: "proj-1::ephemeral-tab",
      partition: "tabs-browser-ephemeral:project:proj-1",
    });
    isPersistent.mockReturnValue(false);

    sessions.set(ephemeralTab.key, ephemeralTab);

    await manager.flushAndShutdownSessions();

    // Ephemeral partition is NOT flushed to disk
    expect(flushStorageData).not.toHaveBeenCalled();
    expect(flushStore).not.toHaveBeenCalled();
    // But view is safely closed and sessions cleared
    expect(close).toHaveBeenCalledTimes(1);
    expect(sessions.size).toBe(0);
  });

  it("continues shutdown safely if one partition flush rejects or times out", async () => {
    const manager = new BrowserHostManager(() => null);
    const sessions = (manager as unknown as { sessions: Map<string, unknown> }).sessions;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Failing partition
    const {
      session: failingTab,
      flushStore: failingFlush,
      close: failingClose,
    } = createMockSession({
      sessionId: "failing-tab",
      key: "p::failing",
      partition: "persist:tabs-browser:project:failing",
    });
    failingFlush.mockRejectedValue(new Error("Disk IO lock error"));

    // Healthy partition
    const {
      session: healthyTab,
      flushStore: healthyFlush,
      close: healthyClose,
    } = createMockSession({
      sessionId: "healthy-tab",
      key: "p::healthy",
      partition: "persist:tabs-browser:project:healthy",
    });

    sessions.set(failingTab.key, failingTab);
    sessions.set(healthyTab.key, healthyTab);

    // Shutdown should succeed without throwing
    await expect(manager.flushAndShutdownSessions({ timeoutMs: 100 })).resolves.toBeUndefined();

    // Healthy partition still flushed
    expect(healthyFlush).toHaveBeenCalledTimes(1);
    // Both views closed
    expect(failingClose).toHaveBeenCalledTimes(1);
    expect(healthyClose).toHaveBeenCalledTimes(1);
    expect(sessions.size).toBe(0);

    // Log recorded diagnostic without secrets
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "[browserHostManager] Failed to flush partition persist:tabs-browser:project:failing: Disk IO lock error",
      ),
    );

    warnSpy.mockRestore();
  });

  it("bounds a stalled cookie flush and closes the view after the timeout", async () => {
    const manager = new BrowserHostManager(() => null);
    const sessions = (manager as unknown as { sessions: Map<string, unknown> }).sessions;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { session, flushStorageData, flushStore, close } = createMockSession({
      key: "p::stalled",
      partition: "persist:tabs-browser:project:stalled",
    });
    flushStore.mockImplementation(() => new Promise<void>(() => {}));
    sessions.set(session.key, session);

    await manager.flushAndShutdownSessions({ timeoutMs: 5 });

    expect(flushStorageData).toHaveBeenCalledOnce();
    expect(flushStore).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Cookie flush timed out after 5ms"),
    );
    warnSpy.mockRestore();
  });

  it("returns the in-flight shutdown to concurrent callers", async () => {
    const manager = new BrowserHostManager(() => null);
    const sessions = (manager as unknown as { sessions: Map<string, unknown> }).sessions;
    let releaseFlush!: () => void;
    const { session, flushStore, close } = createMockSession({
      key: "p::concurrent",
      partition: "persist:tabs-browser:project:concurrent",
    });
    flushStore.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseFlush = resolve;
        }),
    );
    sessions.set(session.key, session);

    const first = manager.flushAndShutdownSessions({ timeoutMs: 1000 });
    const second = manager.flushAndShutdownSessions({ timeoutMs: 1000 });
    await vi.waitFor(() => expect(flushStore).toHaveBeenCalledOnce());
    expect(close).not.toHaveBeenCalled();

    releaseFlush();
    await Promise.all([first, second]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("is idempotent on repeated calls and when followed by dispose()", async () => {
    const manager = new BrowserHostManager(() => null);
    const sessions = (manager as unknown as { sessions: Map<string, unknown> }).sessions;

    const { session, flushStorageData, flushStore, close } = createMockSession({
      sessionId: "tab-1",
      key: "p::tab-1",
      partition: "persist:tabs-browser:project:p",
    });
    sessions.set(session.key, session);

    await manager.flushAndShutdownSessions();
    expect(flushStorageData).toHaveBeenCalledTimes(1);
    expect(flushStore).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);

    // Subsequent calls are no-ops
    await manager.flushAndShutdownSessions();
    manager.dispose();

    expect(flushStorageData).toHaveBeenCalledTimes(1);
    expect(flushStore).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
