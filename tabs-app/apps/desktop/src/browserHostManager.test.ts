import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi, type Mock } from "vitest";
import { app, nativeImage, WebContentsView } from "electron";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import {
  PreviewTabId,
  type BrowserQuickAction,
  type BrowserQuickActionResult,
  type BrowserQuickActionTarget,
  type BrowserWorkflowBrowserRequest,
  type BrowserWorkflowDefinition,
  type BrowserWorkflowHostResult,
  type BrowserWorkflowSavedResult,
  type FigmaCanvasApproval,
  type FigmaCanvasAuthorization,
  type FigmaCanvasTarget,
  type FigmaCanvasWrite,
  type PartnerCenterStatusAuthorization,
  type PartnerCenterStatusRequest,
  type PreviewAutomationSnapshot,
} from "@tabs/contracts";
import { BROWSER_SELECTION_DRAG_MIME } from "@tabs/shared/preview";

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
  defaultPermissionMediator,
  hasReturnedToAuthenticationOrigin,
  isLikelyAuthenticationUrl,
  normalizeBrowserCookieDomain,
  normalizeBrowserProfileId,
  normalizeRemoteBrowserUrl,
  planBrowserCrashRecovery,
  sanitizeEmbeddedBrowserUserAgent,
} from "./browserHostManager";
import { BrowserSessionImporter } from "./browserImport/BrowserSessionImporter";
import { BrowserSubmissionGuards, browserWorkflowHostKey } from "./browserWorkflowHostId";
import { browserWorkflowPageScript } from "./browserWorkflowPage";
import {
  browserSelectionDragScript,
  PAGE_READY_FOR_AGENT,
  READ_BROWSER_SELECTION,
} from "./browserPageGrant";
import {
  BrowserAttachmentBookmarks,
  type BrowserAttachmentBookmark,
} from "./browserAttachmentBookmarks";

// Most fixtures script the guest's replies in order; account hints have their own tests.
beforeEach(() => {
  vi.spyOn(BrowserHostManager.prototype as any, "readAccountMarker").mockResolvedValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("browser crash recovery", () => {
  it("uses bounded exponential backoff and resets after the recovery window", () => {
    const first = planBrowserCrashRecovery(0, null, 1_000)!;
    expect(first).toEqual({
      attempts: 1,
      windowStartedAt: 1_000,
      delayMs: 250,
    });
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
          {
            domain: ".accounts.example.co.uk",
            name: "sessionid",
            value: "long-session-value",
          },
          { domain: ".cdn.example.co.uk", name: "preferences", value: "dark" },
        ]),
      },
    });
    const manager = new BrowserHostManager(() => null);

    await expect(manager.getProfileDomains("work")).resolves.toEqual([
      {
        domain: "accounts.example.co.uk",
        cookieCount: 1,
        hasSessionHint: true,
      },
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
        get: vi.fn().mockResolvedValue([
          sessionCookie,
          {
            domain: ".github.com",
            name: "__Host-csrf",
            value: "secret-csrf-token",
          },
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
          {
            domain: ".github.com",
            name: "user_session",
            path: "/",
            secure: true,
          },
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
      cookies: {
        on: vi.fn(),
        flushStore: vi.fn().mockResolvedValue(undefined),
      },
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
      expect.objectContaining({
        dataTypes: expect.arrayContaining(["cookies", "indexedDB"]),
      }),
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
      view: {
        webContents: {
          session: storageSession,
          isDestroyed: () => false,
          getURL: () => "",
        },
      },
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

    manager.openPictureInPicture({
      projectId: "project-1",
      sessionId: "preview-1",
    });
    expect(mainChildren).toEqual([]);
    expect(electronMocks.browserWindows).toHaveLength(1);
    const browserWindow = electronMocks.browserWindows[0];
    expect(browserWindow).toBeDefined();
    expect((browserWindow!.contentView as { children: unknown[] }).children).toEqual([view]);
    expect(manager.getSessionState("project-1", "preview-1").pictureInPicture).toBe(true);

    manager.closePictureInPicture({
      projectId: "project-1",
      sessionId: "preview-1",
    });
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
      view: {
        webContents: { isDestroyed: () => false, executeJavaScript: vi.fn() },
      },
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
      expect.objectContaining({
        status: "interrupted",
        error: expect.stringContaining("human"),
      }),
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
  it("captures viewport pixels in memory without producing a saved artifact", async () => {
    const manager = new BrowserHostManager(() => null);
    const capturePage = vi.fn().mockResolvedValue({
      isEmpty: () => false,
      toJPEG: () => Buffer.from("test"),
    });
    (manager as unknown as { sessions: Map<string, unknown> }).sessions.set("p::tab", {
      view: { webContents: { isDestroyed: () => false, capturePage } },
    });
    await expect(manager.captureSession({ projectId: "p", sessionId: "tab" })).resolves.toBe(
      "data:image/jpeg;base64,dGVzdA==",
    );
    await expect(manager.captureSession({ projectId: "missing" })).resolves.toBeNull();
    capturePage.mockRejectedValueOnce(new Error("page closed"));
    await expect(manager.captureSession({ projectId: "p", sessionId: "tab" })).resolves.toBeNull();
  });
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

  it("does not reuse remembered permissions from other partitions for temporary agent tabs", () => {
    const origin = "https://maps.example.test";
    const first = "tabs-browser-ephemeral:agent:first";
    const second = "tabs-browser-ephemeral:agent:second";
    const configure = (partition: string) => {
      const session = {
        cookies: { on: vi.fn() },
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler:
          vi.fn<
            (check: (contents: undefined, permission: string, origin: string) => boolean) => void
          >(),
      };
      configurePartitionSession(session as never, partition);
      return session.setPermissionCheckHandler.mock.calls[0]![0];
    };
    defaultPermissionMediator.recordDecision(origin, "geolocation", true, "default");
    defaultPermissionMediator.recordDecision(origin, "geolocation", true, first);
    try {
      expect(configure("persist:tabs-browser:p")(undefined, "geolocation", origin)).toBe(true);
      expect(configure(first)(undefined, "geolocation", origin)).toBe(true);
      expect(configure(second)(undefined, "geolocation", origin)).toBe(false);
    } finally {
      defaultPermissionMediator.revokeDecision("default", origin, "geolocation");
      defaultPermissionMediator.revokeDecision(first, origin, "geolocation");
    }
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
      isCrashed: vi.fn(() => false),
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
      instanceId: "mock-browser-instance",
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

  function mockNavigation(
    manager: BrowserHostManager,
    fixture: Pick<ReturnType<typeof createMockSession>, "session" | "webContents">,
    historyUrls: string[] = [],
  ) {
    const { session, webContents } = fixture;
    const events = new EventEmitter();
    const goToIndex = vi.fn();
    const stop = vi.fn();
    const loadURL = vi.fn(async (url: string) => {
      session.currentUrl = url;
      events.emit("did-navigate", {}, url);
    });
    Object.assign(webContents, {
      getURL: () => session.currentUrl,
      getTitle: () => session.pageTitle,
      getZoomFactor: () => 1,
      canGoBack: () => true,
      canGoForward: () => true,
      setWindowOpenHandler: vi.fn(),
      on: events.on.bind(events),
      removeListener: events.removeListener.bind(events),
      navigationHistory: {
        getAllEntries: () => historyUrls.map((url) => ({ url })),
        goToIndex,
      },
      loadURL,
      stop,
    });
    const internals = manager as any;
    internals.sessions.set(session.key, session);
    internals.registerSessionEvents(session);
    return { events, goToIndex, loadURL, stop };
  }

  it("reuses the selected Work guest for an agent open without a partition", async () => {
    const manager = new BrowserHostManager(() => null);
    const { session } = createMockSession({
      profileId: "work",
      partition: "persist:tabs-browser:profile:work",
    });
    (manager as unknown as { sessions: Map<string, unknown> }).sessions.set(session.key, session);
    const recreate = vi.spyOn(manager, "recreateSession").mockResolvedValue(undefined);
    await manager.ensureSession({
      projectId: session.projectId,
      sessionId: session.sessionId,
      initialUrl: "",
      taskId: "thread-1",
      requireExisting: true,
    });
    expect(recreate).not.toHaveBeenCalled();
    expect(session.assignedTaskId).toBe("thread-1");
  });

  it("requires a human grant for the exact companion tab, profile, thread and destination", async () => {
    const manager = new BrowserHostManager(() => null);
    const sessionId = "agents-surface-work";
    const { session, webContents, executeJavaScript } = createMockSession({
      sessionId,
      key: "project-1::" + sessionId,
      profileId: "work",
      partition: "persist:tabs-browser:profile:work",
      currentUrl: "https://app.test/draft?token=private",
    });
    const safe = vi.fn().mockResolvedValue(true);
    Object.assign(webContents, {
      getURL: () => session.currentUrl,
      executeJavaScriptInIsolatedWorld: safe,
    });
    (manager as unknown as { sessions: Map<string, unknown> }).sessions.set(session.key, session);
    const target = { projectId: session.projectId, sessionId, taskId: "qa" };
    const agent = { ...target, source: "agent" as const };
    const grant = {
      ...target,
      source: "human" as const,
      operation: "authorizeBrowserPage",
      input: { url: session.currentUrl, profileId: "work" },
    };
    await expect(
      manager.ensureSession({
        ...target,
        requireExisting: true,
        initialUrl: "",
      }),
    ).rejects.toThrow("Approve");
    await expect(manager.runAutomation({ ...agent, operation: "status" })).rejects.toThrow(
      "Approve",
    );
    await expect(manager.runAutomation({ ...grant, source: "agent" })).rejects.toThrow("approve");
    await expect(
      manager.runAutomation({
        ...grant,
        input: { ...grant.input, profileId: "personal" },
      }),
    ).rejects.toThrow("Recheck");
    await manager.runAutomation(grant);
    await expect(manager.runAutomation({ ...agent, operation: "status" })).resolves.toMatchObject({
      url: "https://app.test/draft",
    });
    for (const operation of ["evaluate", "recordStatus", "recordStop"]) {
      await expect(
        manager.runAutomation({
          ...agent,
          operation,
          input: { expression: "1" },
        }),
      ).rejects.toThrow("approved page");
    }
    await expect(
      manager.runAutomation({ ...agent, taskId: "other", operation: "status" }),
    ).rejects.toThrow("Approve");
    await expect(
      manager.runAutomation({
        ...agent,
        operation: "navigate",
        input: { url: "https://other.test" },
      }),
    ).rejects.toThrow("destination");
    safe.mockResolvedValueOnce(false);
    await expect(manager.runAutomation({ ...agent, operation: "snapshot" })).rejects.toThrow(
      "protected",
    );
    expect(executeJavaScript).not.toHaveBeenCalled();
    session.currentUrl = "https://app.test/mfa";
    await expect(manager.runAutomation({ ...agent, operation: "status" })).rejects.toThrow(
      "signing in",
    );
    session.currentUrl = grant.input.url;
    await manager.runAutomation({ ...grant, operation: "revokeBrowserPage" });
    await expect(manager.runAutomation({ ...agent, operation: "status" })).rejects.toThrow(
      "Approve",
    );
  });

  it("claims only the exact idle, unowned browser tab when moving it to a thread", async () => {
    const manager = new BrowserHostManager(() => null);
    const sessionId = "agents-surface-move";
    const { session, webContents } = createMockSession({
      sessionId,
      key: `project-1::${sessionId}`,
      profileId: "work",
      partition: "persist:tabs-browser:profile:work",
      currentUrl: "https://app.test/draft/42",
    });
    Object.assign(webContents, {
      getURL: () => session.currentUrl,
      isLoadingMainFrame: () => false,
    });
    (manager as unknown as { sessions: Map<string, unknown> }).sessions.set(session.key, session);
    const state = manager.getSessionState(session.projectId, sessionId);
    const move = {
      projectId: session.projectId,
      sessionId,
      taskId: "receiving",
      source: "human",
      operation: "authorizeBrowserPage",
      input: {
        url: session.currentUrl,
        profileId: "work",
        instanceId: state.instanceId,
        pageApprovalToken: state.pageApprovalToken,
        adoptOpenTab: true,
      },
    } as const;
    const run = () => manager.runAutomation(move);
    Object.assign(session, { assignedTaskId: "origin" });
    await expect(run()).rejects.toThrow("another thread");
    session.assignedTaskId = null;
    Object.assign(session, { verificationLease: Symbol("running") });
    await expect(run()).rejects.toThrow("Finish using");
    Object.assign(session, { verificationLease: undefined });
    await expect(
      manager.runAutomation({
        ...move,
        input: { ...move.input, pageApprovalToken: "changed" },
      }),
    ).rejects.toThrow("page changed");
    expect(session.assignedTaskId).toBeNull();
    await expect(run()).resolves.toMatchObject({ approved: true });
    expect(manager.getSessionState(session.projectId, sessionId)).toMatchObject({
      instanceId: state.instanceId,
      currentUrl: state.currentUrl,
      profileId: "work",
      assignedTaskId: "receiving",
      browserPageAuthorized: true,
    });
    await expect(run()).rejects.toThrow("Finish using");
  });

  it("reads an excerpt only on the original browser page after a human request", async () => {
    const manager = new BrowserHostManager(() => null);
    const sessionId = "agents-surface-excerpt";
    const fixture = createMockSession({
      sessionId,
      key: `project-1::${sessionId}`,
      profileId: "work",
    });
    const { session, webContents } = fixture;
    const { events } = mockNavigation(manager, fixture);
    const select = vi.fn().mockResolvedValue("Only this excerpt");
    Object.assign(webContents, { executeJavaScriptInIsolatedWorld: select });
    const state = () => manager.getSessionState(session.projectId, sessionId);
    const request = {
      projectId: session.projectId,
      sessionId,
      taskId: "qa",
      source: "human" as const,
      operation: "readBrowserSelection",
      input: {
        pageRef: state().pageRef,
        instanceId: session.instanceId,
        profileId: "work",
      },
    };
    await expect(manager.runAutomation({ ...request, source: "agent" })).rejects.toThrow("Review");
    for (const changed of [
      { profileId: "personal" },
      { instanceId: "replaced" },
      { pageRef: "other" },
    ]) {
      await expect(
        manager.runAutomation({
          ...request,
          input: { ...request.input, ...changed },
        }),
      ).rejects.toThrow("changed");
    }
    expect(select).not.toHaveBeenCalled();
    await expect(manager.runAutomation(request)).resolves.toEqual({
      text: "Only this excerpt",
    });
    expect(state()).toMatchObject({
      assignedTaskId: null,
      browserPageAuthorized: false,
    });
    select.mockImplementationOnce(async () => {
      events.emit("did-navigate", {}, session.currentUrl);
      return "An excerpt from before a reload";
    });
    await expect(manager.runAutomation(request)).rejects.toThrow("changed");
    select.mockResolvedValueOnce("x".repeat(1001));
    await expect(manager.runAutomation(request)).rejects.toThrow("1,000 characters");
  });

  it("keeps the user in control if a new takeover interrupts return from a demonstration", async () => {
    const manager = new BrowserHostManager(() => null);
    const sessionId = "agents-surface-demonstration";
    const fixture = createMockSession({
      sessionId,
      key: `project-1::${sessionId}`,
    });
    const { session, webContents } = fixture;
    mockNavigation(manager, fixture);
    let finishRead!: (observedChanges: string[]) => void;
    const observation = new Promise<string[]>((resolve) => {
      finishRead = resolve;
    });
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ role: "button", label: "Export" })
      .mockReturnValueOnce(observation);
    Object.assign(webContents, { executeJavaScriptInIsolatedWorld: execute });
    const target = { projectId: session.projectId, sessionId, taskId: "qa" };
    await manager.runAutomation({
      ...target,
      source: "human",
      operation: "authorizeBrowserPage",
      input: { url: session.currentUrl, profileId: "default" },
    });
    manager.takeControl({ ...target, demonstrate: true });
    const state = () => manager.getSessionState(session.projectId, sessionId);
    await vi.waitFor(() => expect(state().demonstratedControl).toContain("Export"));
    const returning = manager.resumeAgent({
      ...target,
      expectedGeneration: {
        instanceId: session.instanceId,
        controlEpoch: session.controlEpoch,
      },
    });
    expect(state().controller).toBe("human");
    expect(execute).toHaveBeenCalledTimes(2);
    manager.takeControl(target);
    finishRead(["Control expanded"]);
    await expect(returning).rejects.toThrow("tab changed while returning control");
    expect(state().controller).toBe("human");
    expect(session.actionTimeline).toEqual([]);
  });

  it.each([null, { role: "button", label: "Export" }])(
    "returns control without a receipt when the demonstration cannot be verified (%j)",
    async (observedControl) => {
      const manager = new BrowserHostManager(() => null);
      const sessionId = "agents-surface-demonstration";
      const fixture = createMockSession({
        sessionId,
        key: `project-1::${sessionId}`,
      });
      const { session, webContents } = fixture;
      mockNavigation(manager, fixture);
      const execute = vi.fn().mockResolvedValueOnce(observedControl).mockResolvedValueOnce(null);
      Object.assign(webContents, { executeJavaScriptInIsolatedWorld: execute });
      const target = { projectId: session.projectId, sessionId, taskId: "qa" };
      await manager.runAutomation({
        ...target,
        source: "human",
        operation: "authorizeBrowserPage",
        input: { url: session.currentUrl, profileId: "default" },
      });
      manager.takeControl({ ...target, demonstrate: true });
      if (observedControl)
        await vi.waitFor(() =>
          expect(
            manager.getSessionState(target.projectId, target.sessionId).demonstratedControl,
          ).toContain("Export"),
        );
      await expect(
        manager.resumeAgent({
          ...target,
          expectedGeneration: {
            instanceId: session.instanceId,
            controlEpoch: session.controlEpoch,
          },
          meaning: "Export just the selected rows.",
        }),
      ).resolves.toBeUndefined();
      expect(execute).toHaveBeenCalledTimes(observedControl ? 2 : 1);
      expect(session.controller).toBe("none");
    },
  );

  it("rejects explicit returns after the tab leaves the granted page", async () => {
    const manager = new BrowserHostManager(() => null);
    const sessionId = "agents-surface-demonstration";
    const fixture = createMockSession({
      sessionId,
      key: `project-1::${sessionId}`,
    });
    const { session } = fixture;
    const { events } = mockNavigation(manager, fixture);
    const target = { projectId: session.projectId, sessionId, taskId: "qa" };
    await manager.runAutomation({
      ...target,
      source: "human",
      operation: "authorizeBrowserPage",
      input: { url: session.currentUrl, profileId: "default" },
    });
    manager.takeControl(target);
    events.emit("did-navigate", {}, "https://other.example/");
    await expect(
      manager.resumeAgent({
        ...target,
        expectedGeneration: {
          instanceId: session.instanceId,
          controlEpoch: session.controlEpoch,
        },
      }),
    ).rejects.toThrow("tab changed while returning control");
    expect(session.controller).toBe("human");
    expect(session.actionTimeline).toEqual([]);
  });

  it.skipIf(process.env.TABS_QA_BROWSER !== "1")(
    "reads visible Chromium selection and excludes protected or editable content",
    async () => {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.setContent(`<p id="review">Before <span id="excerpt">selected report</span> after</p>
          <div id="editor" contenteditable="plaintext-only">private editor text</div>
          <p id="long">${"x".repeat(1001)}</p>`);
        const cdp = await page.context().newCDPSession(page);
        const { frameTree } = await cdp.send("Page.getFrameTree");
        const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
          frameId: frameTree.frame.id,
          worldName: "reviewed-selection",
        });
        const read = async () => {
          const { exceptionDetails, result } = await cdp.send("Runtime.evaluate", {
            expression: READ_BROWSER_SELECTION,
            contextId: executionContextId,
            returnByValue: true,
          });
          expect(exceptionDetails).toBeUndefined();
          return result.value;
        };
        const choose = (id: string) =>
          page.evaluate(
            (id) => window.getSelection()!.selectAllChildren(document.getElementById(id)!),
            id,
          );
        expect(await read()).toBeNull();
        await choose("excerpt");
        expect(await read()).toBe("selected report");
        for (const id of ["editor", "long"]) {
          await choose(id);
          expect(await read()).toBeNull();
        }
        await choose("excerpt");
        await page
          .locator("body")
          .evaluate((body) =>
            body.insertAdjacentHTML("beforeend", '<input type="password" value="private">'),
          );
        expect(await read()).toBeNull();
      } finally {
        await browser.close();
      }
    },
  );

  it("rechecks the dropped text and token against the selected guest document", async () => {
    const manager = new BrowserHostManager(() => null);
    const sessionId = "agents-surface-drag";
    const fixture = createMockSession({
      sessionId,
      key: `project-1::${sessionId}`,
    });
    const { session, webContents } = fixture;
    const { events } = mockNavigation(manager, fixture);
    const select = vi.fn().mockResolvedValue("selected report");
    Object.assign(webContents, { executeJavaScriptInIsolatedWorld: select });
    events.emit("dom-ready");
    const drag = (session as typeof session & { selectionDrag?: { token: string } }).selectionDrag;
    expect(drag?.token).toBeTypeOf("string");
    expect(select.mock.calls[0]?.[1][0].code).toContain(BROWSER_SELECTION_DRAG_MIME);
    const state = () => manager.getSessionState(session.projectId, sessionId);
    const request = {
      projectId: session.projectId,
      sessionId,
      taskId: "qa",
      source: "human" as const,
      operation: "readBrowserSelection",
      input: {
        pageRef: state().pageRef,
        instanceId: session.instanceId,
        profileId: "default",
        dragToken: drag?.token,
        droppedText: "selected report",
      },
    };
    await expect(
      manager.runAutomation({
        ...request,
        input: { ...request.input, dragToken: "old-token" },
      }),
    ).rejects.toThrow("dragged selection changed");
    expect(select).toHaveBeenCalledTimes(1);
    await expect(
      manager.runAutomation({
        ...request,
        input: { ...request.input, droppedText: "different" },
      }),
    ).rejects.toThrow("dragged selection changed");
    await expect(manager.runAutomation(request)).resolves.toEqual({
      text: "selected report",
    });
    events.emit("did-navigate", {}, session.currentUrl);
    events.emit("dom-ready");
    await expect(manager.runAutomation(request)).rejects.toThrow("dragged selection changed");
    expect(state()).toMatchObject({
      assignedTaskId: null,
      browserPageAuthorized: false,
    });
  });

  it.skipIf(process.env.TABS_QA_BROWSER !== "1")(
    "marks a real Chromium text drag for review and delivers its payload to a different origin",
    async () => {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        const thread = await browser.newPage();
        const sourceUrl = "https://work.tabs.test/";
        const targetUrl = "https://thread.tabs.test/";
        await page.route(sourceUrl, (route) =>
          route.fulfill({
            contentType: "text/html",
            body: `<p><span>Selected report</span></p>
              <script>window.addEventListener('dragstart', event => {
                document.body.dataset.token = event.dataTransfer.getData('${BROWSER_SELECTION_DRAG_MIME}');
                document.body.dataset.text = event.dataTransfer.getData('text/plain');
              });</script>`,
          }),
        );
        await thread.route(targetUrl, (route) =>
          route.fulfill({
            contentType: "text/html",
            body: `<div id="drop" style="width:280px;height:160px">Drop the report</div>
            <script>
              document.querySelector('#drop').addEventListener('dragover', event => event.preventDefault());
              document.querySelector('#drop').addEventListener('drop', event => {
                event.preventDefault();
                event.currentTarget.dataset.token = event.dataTransfer.getData('${BROWSER_SELECTION_DRAG_MIME}');
                event.currentTarget.dataset.text = event.dataTransfer.getData('text/plain');
              });
            </script>`,
          }),
        );
        await thread.goto(targetUrl);
        await page.goto(sourceUrl);
        await page.bringToFront();
        const cdp = await page.context().newCDPSession(page);
        const { frameTree } = await cdp.send("Page.getFrameTree");
        const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
          frameId: frameTree.frame.id,
          worldName: "selection-drag",
        });
        const token = "fixture-drag-token";
        const installed = await cdp.send("Runtime.evaluate", {
          expression: browserSelectionDragScript(sourceUrl, token),
          contextId: executionContextId,
        });
        expect(installed.exceptionDetails).toBeUndefined();
        const selection = page.locator("span");
        await selection.click();
        await selection.evaluate((element) => window.getSelection()!.selectAllChildren(element));
        expect(
          await selection.evaluate((element) => {
            const data = new DataTransfer();
            element.dispatchEvent(
              new DragEvent("dragstart", { bubbles: true, dataTransfer: data }),
            );
            return data.types;
          }),
        ).toEqual([]);
        const start = (await selection.boundingBox())!;
        const x = start.x + start.width / 2;
        const y = start.y + start.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        // macOS waits for a short hold before dragging selected text.
        if (process.platform === "darwin") await page.waitForTimeout(550);
        await page.mouse.move(x + 16, y, { steps: 5 });
        await page.mouse.move(340, 150, { steps: 20 });
        await page.mouse.up();
        const source = page.locator("body");
        await vi.waitFor(async () => expect(await source.getAttribute("data-token")).toBe(token));
        const data = {
          items: [
            {
              mimeType: BROWSER_SELECTION_DRAG_MIME,
              data: (await source.getAttribute("data-token"))!,
            },
            {
              mimeType: "text/plain",
              data: (await source.getAttribute("data-text"))!,
            },
          ],
          dragOperationsMask: 1,
        };
        // CDP delivers the captured payload to the second page without relying on OS window focus.
        const destination = await thread.context().newCDPSession(thread);
        for (const type of ["dragEnter", "dragOver", "drop"] as const) {
          await destination.send("Input.dispatchDragEvent", {
            type,
            x: 30,
            y: 30,
            data,
          });
        }
        const drop = thread.locator("#drop");
        expect(await drop.getAttribute("data-token")).toBe(token);
        expect(await drop.getAttribute("data-text")).toBe("Selected report");
      } finally {
        await browser.close();
      }
    },
  );

  it("keeps a grant within its Google document and account through navigation and redirects", async () => {
    const manager = new BrowserHostManager(() => null);
    const sessionId = "agents-surface-work";
    const url = "https://docs.google.com/document/u/0/d/one";
    const sameDocument = "https://docs.google.com/document/d/one/edit?authuser=0#heading=h.qa";
    const otherDocument = "https://docs.google.com/document/d/two?authuser=0";
    const otherAccount = "https://docs.google.com/document/u/1/d/one";
    const fixture = createMockSession({
      sessionId,
      key: `project-1::${sessionId}`,
      currentUrl: url,
      partition: "persist:tabs-browser:profile:work",
      profileId: "work",
    });
    const { events, loadURL } = mockNavigation(manager, fixture);
    Object.assign(fixture.webContents, {
      executeJavaScriptInIsolatedWorld: vi.fn().mockResolvedValue(true),
    });
    const target = {
      projectId: fixture.session.projectId,
      sessionId,
      taskId: "qa",
    };
    await manager.runAutomation({
      ...target,
      source: "human",
      operation: "authorizeBrowserPage",
      input: { url, profileId: "work" },
    });
    await manager.ensureSession({
      ...target,
      requireExisting: true,
      temporaryAgentTab: true,
      initialUrl: "",
      profileId: "default",
    });
    expect(fixture.session.partition).toBe("persist:tabs-browser:profile:work");
    const navigate = (destination: string) =>
      manager.runAutomation({
        ...target,
        source: "agent",
        operation: "navigate",
        input: { url: destination },
      });
    for (const destination of [
      otherDocument,
      otherAccount,
      `${otherAccount}?authuser=0`,
      "https://docs.google.com/document/d/one?authuser=0&authuser=1",
      "https://docs.google.com/document/u/%31/d/one",
      "https://docs.google.com/document/d/one",
      "https://drive.google.com/drive/u/0",
      "https://docs.google.com/login?authuser=0",
    ]) {
      await expect(navigate(destination)).rejects.toThrow("destination");
    }
    expect(loadURL).not.toHaveBeenCalled();
    await expect(navigate(sameDocument)).resolves.toBeUndefined();
    const preventDefault = vi.fn();
    loadURL.mockImplementationOnce(async () => {
      events.emit("will-redirect", {
        isMainFrame: false,
        url: otherAccount,
        preventDefault,
      });
      events.emit("will-navigate", { url: sameDocument, preventDefault });
      expect(preventDefault).not.toHaveBeenCalled();
      events.emit("will-redirect", {
        isMainFrame: true,
        url: otherDocument,
        preventDefault,
      });
      if (preventDefault.mock.calls.length) throw new Error("Redirect blocked");
    });
    await expect(navigate(sameDocument)).rejects.toThrow("Redirect blocked");
    expect(preventDefault).toHaveBeenCalledOnce();
    events.emit("did-navigate-in-page", {}, otherDocument, true);
    events.emit("did-navigate-in-page", {}, sameDocument, true);
    expect(manager.getSessionState(target.projectId, sessionId).browserPageAuthorized).toBe(false);
    await expect(navigate(sameDocument)).rejects.toThrow("Approve");
  });

  it("revokes same-URL Google grants for the affected browser storage before dispatch", async () => {
    const manager = new BrowserHostManager(() => null);
    const work = { cookies: new EventEmitter() };
    const personal = { cookies: new EventEmitter() };
    const document = "https://docs.google.com/document/u/0/d/one";
    const prepare = async (id: string, profileId: string, url: string, storage: typeof work) => {
      const sessionId = `agents-surface-${id}`;
      const partition = `persist:tabs-browser:profile:${profileId}`;
      const fixture = createMockSession({
        sessionId,
        key: `project-1::${sessionId}`,
        currentUrl: url,
        profileId,
        partition,
      });
      const safe = vi.fn().mockResolvedValue(true);
      Object.assign(fixture.webContents, {
        session: storage,
        isLoadingMainFrame: () => false,
        executeJavaScriptInIsolatedWorld: safe,
      });
      mockNavigation(manager, fixture);
      (
        manager as unknown as {
          observeProfileSession: (partition: string, storage: typeof work) => void;
        }
      ).observeProfileSession(partition, storage);
      const target = {
        projectId: fixture.session.projectId,
        sessionId,
        taskId: "qa",
      };
      const approve = (pageApprovalToken?: string) =>
        manager.runAutomation({
          ...target,
          source: "human",
          operation: "authorizeBrowserPage",
          input: { url, profileId, pageApprovalToken },
        });
      await approve();
      return {
        ...fixture,
        safe,
        approve,
        state: () => manager.getSessionState(target.projectId, sessionId),
        agent: { ...target, source: "agent" as const },
      };
    };
    const workDocument = await prepare("work-doc", "work", document, work);
    const workSheet = await prepare(
      "work-sheet",
      "work",
      "https://docs.google.com/spreadsheets/d/sheet",
      work,
    );
    const workDraft = await prepare("work-draft", "work", "https://qa.example.test/draft", work);
    const personalDocument = await prepare("personal-doc", "personal", document, personal);
    expect(work.cookies.listenerCount("changed")).toBe(1);

    const action = {
      id: crypto.randomUUID(),
      label: "Save document",
      origin: "https://docs.google.com",
      steps: [{ action: "click", selector: "#save" }],
      outcome: { selector: "#confirmation", description: "Saved" },
    };
    const human = { ...workDocument.agent, source: "human" as const };
    const targets = (await manager.runAutomation({
      ...human,
      operation: "listQuickActionTargets",
      input: { action },
    })) as { sessionId: string; token: string }[];
    const token = targets.find(
      ({ sessionId }) => sessionId === workDocument.agent.sessionId,
    )!.token;
    const { id } = (await manager.runAutomation({
      ...human,
      operation: "authorizeQuickAction",
      input: { action, token },
    })) as { id: string };

    const before = workDocument.state().controlEpoch!;
    const reviewed = workDocument.state().pageApprovalToken;
    expect(reviewed).toBeTypeOf("string");
    for (const cookie of [
      { domain: ".google.com", name: "NID" },
      { domain: ".google.com", name: "__Secure-1PSIDTS" },
      { domain: ".notgoogle.com", name: "SID" },
    ])
      work.cookies.emit("changed", {}, cookie, "explicit", false);
    expect(workDocument.state()).toMatchObject({
      browserPageAuthorized: true,
      controlEpoch: before,
    });

    let finishCheck!: (result: boolean) => void;
    workDocument.safe.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finishCheck = resolve;
      }),
    );
    const click = manager.runAutomation({
      ...workDocument.agent,
      operation: "click",
      input: { selector: "#save" },
    });
    const rejected = expect(click).rejects.toThrow("Approve access");
    await vi.waitFor(() => expect(workDocument.safe).toHaveBeenCalledOnce());
    work.cookies.emit(
      "changed",
      {},
      {
        domain: ".google.com",
        name: "SID",
        get value() {
          throw new Error("The cookie value must never be read");
        },
      },
      "overwrite",
      true,
    );
    finishCheck(true);
    await rejected;

    expect(workDocument.sendInputEvent).not.toHaveBeenCalled();
    expect(workDocument.safe).toHaveBeenCalledOnce();
    expect(workDocument.state()).toMatchObject({
      browserPageAuthorized: false,
      currentUrl: document,
      controlEpoch: before + 1,
    });
    expect(workSheet.state().browserPageAuthorized).toBe(false);
    expect(workDraft.state().browserPageAuthorized).toBe(true);
    expect(personalDocument.state().browserPageAuthorized).toBe(true);
    await expect(workDocument.approve(reviewed)).rejects.toThrow("page changed during review");
    await workDocument.approve(workDocument.state().pageApprovalToken);
    await expect(
      manager.runAutomation({
        ...workDocument.agent,
        operation: "runQuickAction",
        input: { actionId: action.id, approvalId: id },
      }),
    ).rejects.toThrow("exact tab and thread");
    await expect(
      manager.runAutomation({ ...workDocument.agent, operation: "status" }),
    ).resolves.toMatchObject({ url: document });
  });

  function openCookieChangeTab(
    manager: BrowserHostManager,
    id: string,
    url: string,
    storage: { cookies: EventEmitter },
    profileId = "work",
  ) {
    const sessionId = `agents-surface-${id}`;
    const partition = `persist:tabs-browser:profile:${profileId}`;
    const fixture = createMockSession({
      sessionId,
      key: `project-1::${sessionId}`,
      currentUrl: url,
      profileId,
      partition,
    });
    let documentTime = performance.timeOrigin + performance.now() - 1000;
    const evaluate = vi.fn(
      async (_world: number, scripts: { code: string }[]): Promise<unknown> =>
        scripts[0]?.code === "performance.timeOrigin" ? documentTime : true,
    );
    const { events } = mockNavigation(manager, fixture);
    Object.assign(fixture.webContents, {
      session: storage,
      isLoadingMainFrame: () => fixture.session.loading,
      executeJavaScriptInIsolatedWorld: evaluate,
    });
    (manager as any).observeProfileSession(partition, storage);
    const route = {
      projectId: fixture.session.projectId,
      sessionId,
      taskId: "qa",
    };
    const state = () => manager.getSessionState(route.projectId, sessionId);
    const source = { hostId: "local", deviceId: "sim" };
    const approve = (pageApprovalToken = state().pageApprovalToken) =>
      manager.runAutomation({
        ...route,
        source: "human",
        operation: "authorizeBrowserPage",
        input: { url, profileId, pageApprovalToken },
      });
    const approveScreenshot = () =>
      manager.runAutomation({
        ...route,
        source: "human",
        operation: "authorizeDeviceScreenshot",
        input: {
          ...source,
          url,
          profileId,
          pageApprovalToken: state().pageApprovalToken,
        },
      }) as Promise<{ grantId: string }>;
    return {
      ...fixture,
      evaluate,
      events,
      state,
      approve,
      approveScreenshot,
      showDocument(time: number) {
        documentTime = time;
        events.emit("did-navigate", {}, url);
      },
      act: (
        operation: Parameters<BrowserHostManager["runAutomation"]>[0]["operation"],
        input = {},
      ) => manager.runAutomation({ ...route, source: "agent", operation, input }),
      transfer: (grantId: string, png?: string) =>
        manager.runAutomation(
          {
            ...route,
            source: "agent",
            operation: "deviceScreenshotUpload",
            input: {
              ...source,
              grantId,
              ...(png === undefined ? { phase: "inspect" } : { phase: "attach", png }),
              selector: "#evidence",
            },
          },
          undefined,
          async () => true,
        ),
    };
  }

  describe.skip("saved browser workflow results", () => {
    async function setup(
      currentUrl?: string,
      historyUrls?: string[],
      sessionId = "agents-surface-workflow-result",
    ) {
      const userData = await mkdtemp(join(tmpdir(), "tabs-saved-workflow-result-"));
      const dataPath = vi.spyOn(app, "getPath").mockReturnValue(userData);
      onTestFinished(async () => {
        dataPath.mockRestore();
        await rm(userData, { recursive: true, force: true });
      });

      const manager = new BrowserHostManager(() => null);
      const url = "https://app.test/draft/42?view=review";
      const fixture = createMockSession({
        sessionId,
        key: "project-1::" + sessionId,
        profileId: "work",
        partition: "persist:tabs-browser:profile:work",
        currentUrl: currentUrl ?? url,
      });
      const { session, webContents } = fixture;
      const navigation = mockNavigation(manager, fixture, historyUrls);
      const storagePath = join(userData, "Partitions", "work");
      Object.assign(webContents.session, { storagePath });
      const saved: BrowserWorkflowSavedResult = {
        target: {
          projectId: session.projectId,
          tabId: PreviewTabId.make(sessionId),
          profileId: "work",
          hostKey: browserWorkflowHostKey(userData, storagePath),
        },
        definition: {
          url,
          identitySelector: "#draft-id",
          resourceId: "42",
          statusSelector: "#status",
          submitSelector: "#submit",
          states: {
            uploaded: "Uploaded",
            submitted: "Submitted",
            certified: "Certified",
            published: "Published",
          },
          breakpoint: {
            selector: "#replacement",
            pauseText: "Replacing",
            clearText: "Clear",
          },
        },
        stage: "submitted",
      };
      const visible = {
        identity: "42",
        status: "Certified",
        password: false,
        hideIdentity: false,
        duplicateIdentity: false,
        documentUrl: undefined as string | undefined,
      };
      const submit = vi.fn();
      class HTMLElement {
        constructor(
          readonly innerText: string,
          readonly password = false,
          readonly hidden = false,
        ) {}
        getBoundingClientRect() {
          return { width: this.hidden ? 0 : 100, height: 20 };
        }
        getClientRects() {
          return [this.getBoundingClientRect()];
        }
        closest() {
          return null;
        }
        matches(selector: string) {
          return this.password && (selector.startsWith("input,") || selector.includes("password"));
        }
        click() {
          submit();
        }
      }
      const querySelectorAll = vi.fn((selector: string) => {
        switch (selector) {
          case "*":
            return visible.password ? [new HTMLElement("", true)] : [];
          case "#draft-id":
            return [
              new HTMLElement(visible.identity, false, visible.hideIdentity),
              ...(visible.duplicateIdentity ? [new HTMLElement(visible.identity)] : []),
            ];
          case "#status":
            return [new HTMLElement(visible.status)];
          case "#submit":
            return [new HTMLElement("Submit")];
          default:
            return [];
        }
      });
      const evaluate = vi.fn(async (_world: number, [script]: { code: string }[]) =>
        runInNewContext(script!.code, {
          location: { href: visible.documentUrl ?? session.currentUrl },
          document: { readyState: "complete", querySelectorAll },
          HTMLElement,
          HTMLButtonElement: HTMLElement,
          getComputedStyle: () => ({
            visibility: "visible",
            display: "block",
            opacity: "1",
          }),
        }),
      );
      const focus = vi.fn();
      const setBounds = vi.fn();
      Object.assign(webContents, {
        executeJavaScriptInIsolatedWorld: evaluate,
        isLoadingMainFrame: () => session.loading,
        focus,
      });
      Object.assign(session.view, { setBounds });
      const request = {
        projectId: session.projectId,
        sessionId,
        taskId: "workflow-thread",
        source: "human" as const,
        operation: "enterBrowserWorkflowResult",
      };
      const monitorInput: BrowserWorkflowBrowserRequest = {
        phase: "monitor",
        profileId: saved.target.profileId,
        definition: saved.definition,
        target: saved.target,
        workflowId: "a".repeat(64),
        statusOnly: true,
      };
      const monitorRequest = {
        ...request,
        source: "agent" as const,
        operation: "browserWorkflow",
      };
      return {
        ...fixture,
        ...navigation,
        manager,
        saved,
        visible,
        userData,
        url,
        request,
        evaluate,
        focus,
        setBounds,
        submit,
        querySelectorAll,
        enter: (input = saved) => manager.runAutomation({ ...request, input }),
        authorize: () =>
          manager.runAutomation({
            ...request,
            operation: "authorizeBrowserPage",
            input: { url, profileId: saved.target.profileId },
          }),
        monitorRequest,
        monitorInput,
        monitor: (input: Partial<BrowserWorkflowBrowserRequest> = {}) =>
          manager.runAutomation({
            ...monitorRequest,
            input: { ...monitorInput, ...input },
          }),
      };
    }

    describe.skip("Partner Center status consent", () => {
      async function setupStatus() {
        const url = "https://partner.microsoft.com/dashboard/store/submissions/42?account=work";
        const f = await setup(url);
        const input: PartnerCenterStatusRequest = {
          target: f.saved.target,
          definition: { ...f.saved.definition, url },
          workflowId: "a".repeat(64),
          applicationId: "9STOREAPP",
          tenantId: "00000000-0000-0000-0000-000000000001",
          clientId: "00000000-0000-0000-0000-000000000002",
        };
        const agent = { ...f.monitorRequest, operation: "partnerCenterStatus" };
        const human = {
          ...f.request,
          operation: "authorizePartnerCenterStatus",
        };
        return {
          ...f,
          url,
          input,
          agent,
          human,
          grant: () =>
            f.manager.runAutomation({
              ...f.request,
              operation: "authorizeBrowserPage",
              input: { url, profileId: input.target.profileId },
            }),
          status: (override: Partial<PartnerCenterStatusRequest> = {}) =>
            f.manager.runAutomation({
              ...agent,
              input: { ...input, ...override },
            }) as Promise<PartnerCenterStatusAuthorization>,
          consent: (approvalId: string) =>
            f.manager.runAutomation({ ...human, input: { approvalId } }),
          pending: () =>
            f.manager.getSessionState(f.request.projectId, f.request.sessionId)
              .pendingPartnerCenterStatus,
        };
      }
    });

    describe.skip("monitor", () => {
    });
  });

  it("does not create a replacement for an explicitly attached tab that closed", async () => {
    const manager = new BrowserHostManager(() => null);
    await expect(
      manager.ensureSession({
        projectId: "p",
        sessionId: "closed",
        initialUrl: "",
        requireExisting: true,
        taskId: "thread-1",
      }),
    ).rejects.toThrow("no longer open");
  });

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((complete) => {
      resolve = complete;
    });
    return { promise, resolve };
  }

  function createUploadFixture(overrides: Record<string, unknown> = {}) {
    const manager = new BrowserHostManager(() => null);
    const { session, webContents } = createMockSession({
      profileId: "work",
      partition: "persist:tabs-browser:profile:work",
      ...overrides,
    });
    (manager as unknown as { sessions: Map<string, unknown> }).sessions.set(session.key, session);
    const attach = vi.fn().mockResolvedValue(true);
    Object.assign(webContents, {
      getURL: () => session.currentUrl,
      executeJavaScriptInIsolatedWorld: attach,
      isLoadingMainFrame: () => session.loading,
    });
    const target = {
      projectId: session.projectId,
      sessionId: session.sessionId,
      taskId: "thread-1",
    };
    const source = {
      hostId: "build-mac",
      deviceId: "same-id",
      profileId: "work",
      url: session.currentUrl,
    };
    const pairDestination = {
      url: source.url,
      profileId: source.profileId,
      instanceId: session.instanceId,
    };
    return {
      session,
      webContents,
      attach,
      manager,
      target,
      authorize: (from: "agent" | "human" = "human", approval: Record<string, unknown> = {}) =>
        manager.runAutomation({
          ...target,
          source: from,
          operation: "authorizeDeviceScreenshot",
          input: { ...source, ...approval },
        }) as Promise<{ grantId: string }>,
      authorizePair: (
        frames: unknown,
        approval: Record<string, unknown> = {},
        request: { source?: "agent" | "human"; taskId?: string } = {},
      ) =>
        manager.runAutomation({
          ...target,
          source: "human",
          ...request,
          operation: "authorizeDeviceScreenshotPair",
          input: { ...pairDestination, frames, ...approval },
        }) as Promise<{ grantIds: [string, string] }>,
      transfer: (
        grantId: string,
        input: Record<string, unknown> = {},
        authorize: () => Promise<boolean> = async () => true,
      ) =>
        manager.runAutomation(
          {
            ...target,
            source: "agent",
            operation: "deviceScreenshotUpload",
            input: {
              grantId,
              ...source,
              phase: "attach",
              selector: "#file",
              png: "AAAA",
              ...input,
            },
          },
          undefined,
          authorize,
        ),
    };
  }

  const evidenceRunId = "92724452-d32a-42f1-9771-75656595c621";
  const sourceDevice = { hostId: "build-mac", deviceId: "same-id" };
  const targetDevice = { ...sourceDevice, hostId: "remote" };
  const sourceFrame = { runId: evidenceRunId, step: 3, side: "source" };
  const targetFrame = { ...sourceFrame, side: "target" };

  function createEvidenceFixture(overrides: Record<string, unknown> = {}) {
    const sessionId = "agents-surface-draft";
    const f = createUploadFixture({
      sessionId,
      key: `project-1::${sessionId}`,
      instanceId: crypto.randomUUID(),
      ...overrides,
    });
    const state = () => f.manager.getSessionState(f.target.projectId, f.target.sessionId);
    const input = {
      url: f.session.currentUrl,
      profileId: "work",
      pageRef: state().pageRef,
      instanceId: f.session.instanceId,
      runId: evidenceRunId,
      source: sourceDevice,
      target: targetDevice,
    };
    return {
      ...f,
      state,
      authorizePage: () =>
        f.manager.runAutomation({
          ...f.target,
          source: "human",
          operation: "authorizeBrowserPage",
          input,
        }),
      authorizeEvidence: (
        changes: Record<string, unknown> = {},
        request: Partial<Parameters<BrowserHostManager["runAutomation"]>[0]> = {},
      ) =>
        f.manager.runAutomation({
          ...f.target,
          source: "human",
          operation: "authorizeDeviceComparisonEvidence",
          input: { ...input, ...changes },
          ...request,
        }) as Promise<{ grantIds: [string, string] }>,
    };
  }

  describe.skip("first-difference evidence approval", () => {
  });

  describe.skip("device screenshot pair approval", () => {
    const runId = "92724452-d32a-42f1-9771-75656595c621";
    const source = {
      hostId: "build-mac",
      deviceId: "same-id",
      frame: { runId, side: "source", step: 2 },
    };
    const target = {
      ...source,
      hostId: "remote",
      frame: { ...source.frame, side: "target" },
    };
  });

  async function connectChromiumPage(
    page: import("playwright").Page,
    fixture: {
      evaluate: Mock<(world: number, scripts: { code: string }[]) => Promise<unknown>>;
    },
  ) {
    const cdp = await page.context().newCDPSession(page);
    fixture.evaluate.mockImplementation(async (_world, [script]) => {
      const { frameTree } = await cdp.send("Page.getFrameTree");
      const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
        frameId: frameTree.frame.id,
        worldName: "attachment-fixture",
      });
      const result = await cdp.send("Runtime.evaluate", {
        expression: script!.code,
        contextId: executionContextId,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    });
  }

  describe.skipIf(process.env.TABS_QA_BROWSER !== "1")("snapshot findText in Chromium", () => {
    const url = "https://docs.google.com/document/u/0/d/receipt-42/edit";
    const resourceId = String.raw`Receipt "42" \ archive`;
    const statusText = "Ready for certification";

    async function setup(body: string) {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch();
      onTestFinished(() => browser.close());
      const viewport = { width: 640, height: 420 };
      const page = await browser.newPage({ viewport });
      await page.route("https://docs.google.com/**", (route) =>
        route.fulfill({ contentType: "text/html", body }),
      );
      await page.goto(url);

      const manager = new BrowserHostManager(() => null);
      const sessionId = "agents-surface-receipt";
      const fixture = createMockSession({
        sessionId,
        key: `project-1::${sessionId}`,
        profileId: "work",
        partition: "persist:tabs-browser:profile:work",
        currentUrl: url,
      });
      const navigation = mockNavigation(manager, fixture);
      const evaluate = vi.fn<(world: number, scripts: { code: string }[]) => Promise<unknown>>();
      await connectChromiumPage(page, { evaluate });
      const capturePage = vi.fn(async () => {
        const bytes = await page.screenshot();
        return { toPNG: () => bytes };
      });
      Object.assign(fixture.webContents, {
        getURL: () => page.url(),
        isLoadingMainFrame: () => fixture.session.loading,
        executeJavaScriptInIsolatedWorld: evaluate,
        capturePage,
      });
      const createImage = vi.mocked(nativeImage.createFromBuffer).mockImplementation(
        (bytes) =>
          ({
            getSize: () => viewport,
            toPNG: () => bytes,
          }) as ReturnType<typeof nativeImage.createFromBuffer>,
      );
      onTestFinished(() => {
        createImage.mockReset();
      });

      const agent = {
        projectId: fixture.session.projectId,
        sessionId,
        taskId: "receipt-thread",
        source: "agent" as const,
      };
      const authorize = () =>
        manager.runAutomation({
          ...agent,
          source: "human",
          operation: "authorizeBrowserPage",
          input: { url, profileId: "work" },
        });
      const snapshot = (input?: unknown) =>
        manager.runAutomation({
          ...agent,
          operation: "snapshot",
          input,
        }) as Promise<PreviewAutomationSnapshot>;

      return {
        ...fixture,
        ...navigation,
        manager,
        page,
        evaluate,
        capturePage,
        agent,
        authorize,
        snapshot,
      };
    }

    it("finds exact visible labels and reuses their selectors to observe a later workflow stage", async () => {
      const userData = await mkdtemp(join(tmpdir(), "tabs-browser-find-text-"));
      const dataPath = vi.spyOn(app, "getPath").mockReturnValue(userData);
      onTestFinished(async () => {
        dataPath.mockRestore();
        await rm(userData, { recursive: true, force: true });
      });
      const sensitiveId = "session-token-fixture";
      const f = await setup(`
        <section hidden><p>${resourceId}</p></section>
        <p style="opacity: 0">${statusText}</p>
        <p inert>${statusText}</p>
        <p aria-hidden="true">${statusText}</p>
        <p contenteditable>${resourceId}</p>
        <main>
          <h1><span><strong id="${sensitiveId}"> ${resourceId} </strong></span></h1>
          <div data-status><span><strong>${statusText}</strong></span></div>
          <div><span>Needs review</span></div>
          <div><span>Needs review</span></div>
          <p>${resourceId} copy</p>
          <p>${resourceId.toLowerCase()}</p>
          <p>Approved with warnings</p>
        </main>`);
      Object.assign(f.webContents.session, {
        storagePath: join(userData, "Partitions", "work"),
      });
      await f.authorize();

      const { textMatches } = await f.snapshot({
        findText: [resourceId, statusText, "Needs review", "Approved"],
      });
      expect(textMatches).toEqual([
        { text: resourceId, status: "matched", selector: expect.any(String) },
        { text: statusText, status: "matched", selector: expect.any(String) },
        { text: "Needs review", status: "ambiguous" },
        { text: "Approved", status: "not_found" },
      ]);
      const [identity, status] = textMatches ?? [];
      if (identity?.status !== "matched" || status?.status !== "matched")
        throw new Error("Expected selectors for the receipt ID and status.");
      expect(identity.selector).not.toContain(sensitiveId);
      for (const match of [identity, status]) {
        const tagName = await f.page.locator(match.selector).evaluate((element) => element.tagName);
        expect(tagName).toBe("STRONG");
      }

      const workflow: BrowserWorkflowBrowserRequest = {
        phase: "inspect",
        profileId: "work",
        definition: {
          url,
          identitySelector: identity.selector,
          resourceId,
          statusSelector: status.selector,
          readOnly: true,
          states: { submitted: statusText, certified: "Certified" },
        },
      };
      const observe = (input: BrowserWorkflowBrowserRequest) =>
        f.manager.runAutomation({
          ...f.agent,
          operation: "browserWorkflow",
          input,
        }) as Promise<BrowserWorkflowHostResult>;
      const first = await observe(workflow);
      expect(first).toMatchObject({
        disposition: "observed",
        observation: {
          stage: "submitted",
          statusText,
          submitAvailable: false,
        },
        target: { tabId: f.agent.sessionId, profileId: "work" },
        submissionApproved: false,
      });

      await f.page.locator("[data-status] strong").evaluate((element) => {
        element.textContent = "Certified";
      });
      await expect(
        observe({
          ...workflow,
          phase: "monitor",
          statusOnly: true,
          target: first.target,
          workflowId: "a".repeat(64),
        }),
      ).resolves.toMatchObject({
        disposition: "observed",
        observation: {
          stage: "certified",
          statusText: "Certified",
          submitAvailable: false,
        },
        target: first.target,
      });
      expect(f.loadURL).not.toHaveBeenCalled();
      expect(f.sendInputEvent).not.toHaveBeenCalled();
      expect(f.page.url()).toBe(url);
    });

    it("validates findText and refuses to read a protected or out-of-scope page", async () => {
      const f = await setup(
        `<p>${resourceId}</p><button id="print-receipt">Print receipt</button>`,
      );
      const input = { findText: [resourceId] };
      await expect(f.snapshot(input)).rejects.toThrow("Approve");
      expect(f.evaluate).not.toHaveBeenCalled();
      await f.authorize();
      const plain = await f.snapshot();
      expect(f.evaluate).toHaveBeenCalledWith(
        999,
        [{ code: expect.stringContaining("visibleText:") }],
        true,
      );
      expect(plain).not.toHaveProperty("textMatches");
      expect(plain.interactiveElements).toMatchObject([{ selector: "#print-receipt" }]);
      const maxLengthText = "x".repeat(300);
      const { textMatches } = await f.snapshot({ findText: [maxLengthText] });
      expect(textMatches).toEqual([{ text: maxLengthText, status: "not_found" }]);
      f.evaluate.mockClear();
      f.capturePage.mockClear();

      for (const findText of [
        [],
        ["", resourceId],
        [" padded "],
        ["x".repeat(301)],
        [42],
        Array(5).fill(resourceId),
      ]) {
        await expect(f.snapshot({ findText })).rejects.toThrow();
      }
      expect(f.evaluate).not.toHaveBeenCalled();
      expect(f.capturePage).not.toHaveBeenCalled();

      await f.page.locator("body").evaluate((body) => {
        body.insertAdjacentHTML("beforeend", '<input type="password">');
      });
      await expect(f.snapshot(input)).rejects.toThrow(/protected/i);
      expect(f.capturePage).not.toHaveBeenCalled();

      const password = f.page.locator('input[type="password"]');
      await password.evaluate((element) => element.remove());
      const evaluate = f.evaluate.getMockImplementation()!;
      let evaluatedDuringProtectedInput = false;
      f.evaluate.mockImplementation(async (world, scripts) => {
        if (!scripts[0]?.code.includes("textMatches:")) return evaluate(world, scripts);
        await f.page.locator("body").evaluate((body) => {
          body.insertAdjacentHTML("beforeend", '<input type="password">');
        });
        try {
          evaluatedDuringProtectedInput = true;
          return await evaluate(world, scripts);
        } finally {
          await password.evaluate((element) => element.remove());
        }
      });
      await expect(f.snapshot(input)).rejects.toThrow(/protected/i);
      expect(evaluatedDuringProtectedInput).toBe(true);
      expect(await password.count()).toBe(0);
      expect(f.capturePage).not.toHaveBeenCalled();

      const otherResource = url.replace("/receipt-42/", "/receipt-43/");
      await f.page.goto(otherResource);
      f.events.emit("did-navigate", {}, otherResource);
      f.evaluate.mockClear();
      await expect(f.snapshot(input)).rejects.toThrow("Approve");
      expect(f.evaluate).not.toHaveBeenCalled();
      expect(f.capturePage).not.toHaveBeenCalled();
    });

    it("reports an unobservable match when the bounded scan cannot establish uniqueness", async () => {
      const filler = "<span>Other</span>";
      const f = await setup(`<p>${resourceId}</p>${filler.repeat(4_000)}`);
      await f.authorize();
      const input = { findText: [resourceId, "Absent label"] };
      const withinBudget = await f.snapshot(input);
      expect(withinBudget.textMatches).toEqual([
        { text: resourceId, status: "matched", selector: expect.any(String) },
        { text: "Absent label", status: "not_found" },
      ]);

      await f.page.locator("body").evaluate(
        (body, html) => {
          body.insertAdjacentHTML("beforeend", html);
        },
        `${filler.repeat(2_000)}<p>${resourceId}</p>`,
      );
      const overBudget = await f.snapshot(input);
      expect(overBudget.textMatches).toEqual([
        { text: resourceId, status: "unobservable" },
        { text: "Absent label", status: "unobservable" },
      ]);
    });

    it("rejects selectors if a same-URL navigation occurs during snapshot capture", async () => {
      const f = await setup(`<p>${resourceId}</p>`);
      await f.authorize();
      const started = deferred<void>();
      const release = deferred<void>();
      const capture = f.capturePage.getMockImplementation()!;
      f.capturePage.mockImplementationOnce(async () => {
        started.resolve();
        await release.promise;
        return capture();
      });
      const input = { findText: [resourceId] };
      const pending = f.snapshot(input);
      try {
        await Promise.race([started.promise, pending]);
        await f.page.evaluate(() => history.replaceState({ revised: true }, "", location.href));
        f.events.emit("did-navigate-in-page", {}, url, true);
        expect(f.page.url()).toBe(url);
      } finally {
        release.resolve();
      }
      await expect(pending).rejects.toThrow(/changed/i);
      await expect(f.snapshot(input)).resolves.toMatchObject({
        textMatches: [
          {
            text: resourceId,
            status: "matched",
            selector: expect.any(String),
          },
        ],
      });
    });
  });

  describe.skip("saved browser attachments", () => {
    async function setup(address = "https://app.test/reports/42?view=review#overview") {
      const userData = await mkdtemp(join(tmpdir(), "tabs-browser-attachments-"));
      const dataPath = vi.spyOn(app, "getPath").mockReturnValue(userData);
      onTestFinished(async () => {
        dataPath.mockRestore();
        await rm(userData, { recursive: true, force: true });
      });
      const manager = new BrowserHostManager(() => null);
      const sessionId = "agents-surface-report";
      const partition = "persist:tabs-browser:profile:work";
      const storagePath = join(userData, "Partitions", "work");
      const tab = (
        host: BrowserHostManager,
        currentUrl: string,
        overrides: Record<string, unknown> = {},
      ) => {
        const fixture = createMockSession({
          sessionId,
          key: `project-1::${sessionId}`,
          instanceId: crypto.randomUUID(),
          profileId: "work",
          partition,
          currentUrl,
          ...overrides,
        });
        const fields = { password: false };
        const evaluate = vi.fn(async (_world: number, [script]: { code: string }[]) =>
          runInNewContext(script!.code, {
            location: { href: fixture.session.currentUrl },
            document: {
              querySelectorAll: () =>
                fields.password
                  ? [
                      {
                        getClientRects: () => [{}],
                        matches: (selector: string) => selector.startsWith("input"),
                      },
                    ]
                  : [],
            },
            getComputedStyle: () => ({ visibility: "visible" }),
          }),
        );
        Object.assign(fixture.webContents, {
          executeJavaScriptInIsolatedWorld: evaluate,
          isLoadingMainFrame: () => fixture.session.loading,
        });
        Object.assign(fixture.webContents.session, { storagePath });
        return {
          ...fixture,
          ...mockNavigation(host, fixture),
          evaluate,
          fields,
        };
      };
      const original = tab(manager, address);
      const request = {
        projectId: "project-1",
        sessionId,
        taskId: "reports",
        source: "human" as const,
      };
      const input = {
        pageRef: manager.getSessionState(request.projectId, sessionId).pageRef,
        instanceId: original.session.instanceId,
        profileId: "work",
      };
      const capture = (target: Partial<Parameters<BrowserHostManager["runAutomation"]>[0]> = {}) =>
        manager.runAutomation({
          ...request,
          operation: "captureAttachedPage",
          input,
          ...target,
        }) as Promise<{ attachmentId: string | null }>;
      const enter = (
        host: BrowserHostManager,
        attachmentId: string | null,
        target: Partial<Parameters<BrowserHostManager["runAutomation"]>[0]> = {},
      ) =>
        host.runAutomation({
          ...request,
          operation: "enterSavedAttachedPage",
          input: { attachmentId, profileId: "work" },
          ...target,
        });
      return {
        ...original,
        tab,
        manager,
        address,
        userData,
        request,
        input,
        capture,
        enter,
      };
    }

    describe.skip("Figma canvas consent", () => {
      const address = "https://www.figma.com/design/mainKey/branch/branchKey/Project?node-id=35-12";

      async function setupFigma(url = address) {
        const f = await setup(url);
        const { attachmentId } = await f.capture();
        if (!attachmentId) throw new Error("The test requires a saved page attachment.");
        const agent = {
          ...f.request,
          source: "agent" as const,
          operation: "figmaCanvas",
        };
        return {
          ...f,
          attachmentId,
          grant: (host = f.manager, url = f.session.currentUrl) =>
            host.runAutomation({
              ...f.request,
              operation: "authorizeBrowserPage",
              input: { url, profileId: f.input.profileId },
            }),
          inspect: (
            input = { attachmentId, profileId: f.input.profileId },
            request: Partial<typeof agent> = {},
            host = f.manager,
          ) =>
            host.runAutomation({
              ...agent,
              ...request,
              input: { action: "inspect", ...input },
            }) as Promise<FigmaCanvasTarget>,
          authorize: (write: FigmaCanvasWrite) =>
            f.manager.runAutomation({
              ...agent,
              input: { action: "authorize", ...write },
            }) as Promise<FigmaCanvasAuthorization>,
          dispatch: (approval: FigmaCanvasApproval) =>
            f.manager.runAutomation({
              ...agent,
              input: { action: "dispatch", approval },
            }),
          confirm: (approvalId: string, request: Partial<typeof f.request> = {}) =>
            f.manager.runAutomation({
              ...f.request,
              ...request,
              operation: "authorizeFigmaCanvas",
              input: { approvalId },
            }),
          pending: () =>
            f.manager.getSessionState(f.request.projectId, f.request.sessionId).pendingFigmaCanvas,
        };
      }

      async function proposed(f: Awaited<ReturnType<typeof setupFigma>>) {
        await f.grant();
        const target = await f.inspect();
        const write = {
          target,
          operationId: "a".repeat(64),
          email: "design@example.com",
          frame: {
            name: "Reviewed frame",
            text: "First line\nSecond line",
            width: 360,
            height: 240,
          },
        };
        const { approval, status } = await f.authorize(write);
        expect(status).toBe("approval_required");
        return { approval, write };
      }
    });
  });

  describe.skip("saved screenshot drafts", () => {
    async function setup(
      draftUrl = "https://app.test/drafts/42?view=review#receipt",
      sourceUrl = "https://app.test/drafts/new",
      approvePair: boolean | "first-difference" = false,
      {
        targetStep = targetFrame.step,
        sourcePng = "AAAA",
        targetPng = "AAAA",
        sessionId = "agents-surface-draft",
        page,
        lostSelectionReply,
        interruptSecond,
      }: {
        targetStep?: number;
        sourcePng?: string;
        targetPng?: string;
        sessionId?: string;
        page?: import("playwright").Page;
        lostSelectionReply?: "first" | "second";
        interruptSecond?: "takeover" | "revoke-source" | "human-input" | "navigate-then-revoke";
      } = {},
    ) {
      const userData = await mkdtemp(join(tmpdir(), "tabs-screenshot-drafts-"));
      const dataPath = vi.spyOn(app, "getPath").mockReturnValue(userData);
      onTestFinished(async () => {
        dataPath.mockRestore();
        await rm(userData, { recursive: true, force: true });
      });
      const directory = join(userData, "browser-attachment-bookmarks");
      const storagePath = join(userData, "Partitions", "work");
      const key = `project-1::${sessionId}`;
      const f = createEvidenceFixture({
        sessionId,
        key,
        currentUrl: sourceUrl,
      });
      const original = mockNavigation(f.manager, f);
      if (page) await connectChromiumPage(page, { evaluate: f.attach });
      Object.assign(f.webContents.session, { storagePath });
      const pageRef = f.manager.getSessionState(f.target.projectId, sessionId).pageRef!;
      let grantId: string;
      let pairedGrantId: string | undefined;
      if (approvePair === "first-difference") {
        await f.authorizePage();
        if (interruptSecond) f.attach.mockResolvedValueOnce("same-origin-png");
        ({
          grantIds: [grantId, pairedGrantId],
        } = await f.authorizeEvidence());
        if (page) {
          await f.transfer(grantId, {
            phase: "inspect",
            selector: "#evidence",
          });
          await f.transfer(pairedGrantId, {
            phase: "inspect",
            selector: "#comparison",
          });
        }
        const select = async (
          order: "first" | "second",
          id: string,
          input: Record<string, unknown>,
        ) => {
          if (order === "second" && interruptSecond) {
            const dispatched = deferred<void>();
            const reply = deferred<boolean>();
            f.attach.mockImplementationOnce(() => {
              dispatched.resolve();
              return reply.promise;
            });
            const rejected = expect(f.transfer(id, input)).rejects.toThrow();
            await dispatched.promise;
            expect(await readdir(directory)).toEqual([
              expect.stringMatching(/^device-comparison-pending-/),
            ]);
            if (interruptSecond === "takeover") f.manager.takeControl(f.target);
            else if (interruptSecond === "human-input")
              original.events.emit("before-input-event", {}, { type: "keyDown" });
            else {
              if (interruptSecond === "navigate-then-revoke")
                original.events.emit("did-start-navigation", { isMainFrame: true }, sourceUrl);
              await f.manager.runAutomation({
                ...f.target,
                source: "human",
                operation: "revokeDeviceScreenshot",
                input: { grantId },
              });
            }
            reply.resolve(true);
            await rejected;
          } else if (order === lostSelectionReply) {
            const evaluate = f.attach.getMockImplementation()!;
            f.attach.mockImplementationOnce(async (...args) => {
              expect(await evaluate(...args)).toBe(true);
              throw new Error(`Lost ${order} selection reply`);
            });
            await expect(f.transfer(id, input)).rejects.toThrow(`Lost ${order} selection reply`);
          } else {
            await expect(f.transfer(id, input)).resolves.toEqual({
              attached: true,
            });
          }
        };
        await select("first", grantId, {
          frame: sourceFrame,
          png: sourcePng,
          ...(page && { selector: "#evidence" }),
        });
        await select("second", pairedGrantId, {
          ...targetDevice,
          frame: { ...targetFrame, step: targetStep },
          png: targetPng,
          ...(page && { selector: "#comparison" }),
        });
      } else if (approvePair) {
        const source = {
          hostId: "build-mac",
          deviceId: "same-id",
          frame: sourceFrame,
        };
        const target = {
          ...source,
          hostId: "remote",
          frame: targetFrame,
        };
        ({
          grantIds: [grantId, pairedGrantId],
        } = await f.authorizePair([source, target]));
        await f.transfer(grantId, source);
        await f.transfer(pairedGrantId, { ...target, png: targetPng });
      } else {
        ({ grantId } = await f.authorize());
        if (page)
          await f.transfer(grantId, {
            phase: "inspect",
            selector: "#evidence",
          });
        await f.transfer(grantId, {
          png: sourcePng,
          ...(page && { selector: "#evidence" }),
        });
      }
      const file = join(directory, `screenshot-draft-${grantId}`);
      const digest = createHash("sha256").update(Buffer.from(sourcePng, "base64")).digest("hex");
      const targetDigest = createHash("sha256")
        .update(Buffer.from(targetPng, "base64"))
        .digest("hex");
      const screenshot = Buffer.from("screenshot");
      const image = vi.mocked(nativeImage.createFromBuffer).mockReturnValue({
        toPNG: () => screenshot,
        getSize: () => ({ width: 10, height: 10 }),
      } as ReturnType<typeof nativeImage.createFromBuffer>);
      const capture = vi
        .spyOn(f.manager as any, "captureSessionImage")
        .mockResolvedValue(screenshot);
      onTestFinished(() => {
        image.mockReset();
        capture.mockRestore();
      });
      const receipt = { text: digest, images: true };
      if (!page)
        f.attach.mockImplementation(async (_world: number, scripts: { code: string }[]) => {
          const code = scripts[0]?.code ?? "";
          if (code.includes("interactiveElements"))
            return { visibleText: receipt.text, interactiveElements: [] };
          // Model an image receipt: the page displays an image for each digest it prints.
          if (code.includes("crypto.subtle")) {
            if (!receipt.images) return false;
            const shown = receipt.text.split(/\s+/u);
            const wanted = JSON.parse(
              /\["[a-f0-9]{64}"(?:,"[a-f0-9]{64}")*\]/u.exec(code)?.[0] ?? "[]",
            );
            return (wanted as string[]).every((digest) => {
              const index = shown.indexOf(digest);
              if (index < 0) return false;
              shown.splice(index, 1);
              return true;
            });
          }
          return true;
        });
      const showDraft = (url = draftUrl) => original.events.emit("did-navigate", {}, url);
      if (draftUrl !== sourceUrl) showDraft();
      if (draftUrl !== sourceUrl || approvePair !== "first-difference")
        await f.manager.runAutomation({
          ...f.target,
          source: "human",
          operation: "authorizeBrowserPage",
          input: { url: draftUrl, profileId: "work" },
        });
      const observe = () =>
        f.manager.runAutomation({
          ...f.target,
          source: "agent",
          operation: "snapshot",
        });
      const verify = async () => {
        await observe();
        showDraft();
        await observe();
      };
      const tab = (host: BrowserHostManager, overrides: Record<string, unknown> = {}) => {
        const fixture = createMockSession({
          sessionId,
          key,
          instanceId: crypto.randomUUID(),
          profileId: "work",
          partition: f.session.partition,
          currentUrl: "",
          ...overrides,
        });
        const content = { text: `Saved screenshot ${digest}`, password: false };
        const evaluate = vi.fn(async (_world: number, [script]: { code: string }[]) =>
          runInNewContext(script!.code, {
            location: {
              href: fixture.session.currentUrl,
              origin: fixture.session.currentUrl.replace(/^(https?:\/\/[^/]+).*$/u, "$1"),
            },
            URL,
            AbortController,
            setTimeout,
            clearTimeout,
            // Hex-text "bytes" hash to themselves, so every printed digest has a displayed image.
            crypto: {
              subtle: {
                digest: async (_algorithm: string, bytes: Uint8Array) =>
                  Buffer.from(new TextDecoder().decode(bytes), "hex"),
              },
            },
            fetch: async (url: string) => {
              const bytes = Buffer.from(new URL(url).pathname.split("/").at(-1)!);
              return {
                status: 200,
                headers: {
                  get: (name: string) => (name === "content-type" ? "image/png" : null),
                },
                body: {
                  getReader: () => {
                    let done = false;
                    return {
                      read: async () => {
                        const result = done ? { done: true } : { done: false, value: bytes };
                        done = true;
                        return result;
                      },
                    };
                  },
                },
              };
            },
            document: {
              images: content.text
                .split(/\s+/u)
                .filter((word) => /^[a-f0-9]{64}$/u.test(word))
                .map((digest) => ({
                  isConnected: true,
                  complete: true,
                  naturalWidth: 1,
                  getClientRects: () => [{}],
                  checkVisibility: () => true,
                  currentSrc: `${fixture.session.currentUrl.split(/[?#]/u)[0]}/img/${digest}`,
                  src: "",
                })),
              body: { innerText: content.text },
              querySelectorAll: () =>
                content.password
                  ? [
                      {
                        getClientRects: () => [{}],
                        matches: (selector: string) => selector.startsWith("input"),
                      },
                    ]
                  : [],
            },
            getComputedStyle: () => ({ visibility: "visible" }),
          }),
        );
        Object.assign(fixture.webContents, {
          executeJavaScriptInIsolatedWorld: evaluate,
          isLoadingMainFrame: () => fixture.session.loading,
        });
        Object.assign(fixture.webContents.session, { storagePath });
        return {
          ...fixture,
          ...mockNavigation(host, fixture),
          content,
          evaluate,
        };
      };
      const input = {
        grantId,
        pageRef,
        profileId: "work",
        ...(pairedGrantId ? { pairedGrantId } : {}),
      };
      const enter = (
        host: BrowserHostManager,
        target: Partial<Parameters<BrowserHostManager["runAutomation"]>[0]> = {},
      ) =>
        host.runAutomation({
          ...f.target,
          source: "human",
          operation: "enterSavedScreenshotDraft",
          input,
          ...target,
        });
      const comparisonRef = { runId: evidenceRunId, step: sourceFrame.step };
      const findComparison = (
        host: BrowserHostManager,
        overrides: Partial<Parameters<BrowserHostManager["runAutomation"]>[0]> = {},
      ) =>
        host.runAutomation({
          projectId: f.target.projectId,
          taskId: f.target.taskId,
          source: "human",
          operation: "findDeviceComparisonDraft",
          input: comparisonRef,
          ...overrides,
        });
      const enterComparison = (
        host: BrowserHostManager,
        overrides: Partial<Parameters<BrowserHostManager["runAutomation"]>[0]> = {},
      ) =>
        host.runAutomation({
          ...f.target,
          source: "human",
          operation: "enterDeviceComparisonDraft",
          input: { ...comparisonRef, profileId: input.profileId },
          ...overrides,
        });
      return {
        ...f,
        directory,
        userData,
        storagePath,
        file,
        digest,
        targetDigest,
        receipt,
        draftUrl,
        input,
        observe,
        showDraft,
        verify,
        tab,
        enter,
        findComparison,
        enterComparison,
      };
    }
  });

  it("cancels queued automation operations when human takes control before execution", async () => {
    const manager = new BrowserHostManager(() => null);
    const { session, executeJavaScript } = createMockSession({
      assignedTaskId: "owner-thread",
    });
    (manager as unknown as { sessions: Map<string, unknown> }).sessions.set(session.key, session);
    const operationState = () => manager.getSessionState(session.projectId, session.sessionId);

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
      taskId: "owner-thread",
      source: "agent",
      operation: "evaluate",
      input: { expression: "1 + 1" },
    });

    // Wait until first automation is actively executing
    await firstStartedPromise;

    // Schedule second automation that queues behind the first
    const queuedPromise = manager.runAutomation({
      projectId: "project-1",
      sessionId: "tab-1",
      taskId: "owner-thread",
      source: "agent",
      operation: "press",
      input: { key: "Enter" },
    });
    expect(operationState().activeAgentAction).toBe("evaluate");

    // Human takes control while first is running and second is queued!
    manager.takeControl({ projectId: "project-1", sessionId: "tab-1" });
    expect(session.controller).toBe("human");
    expect(session.controlEpoch).toBe(1);
    expect(operationState().activeAgentAction).toBeUndefined();

    // Unblock the first operation
    unblockFirst();
    await expect(firstPromise).rejects.toThrow(
      "Browser automation was interrupted by human input during execution.",
    );

    // Queued input must be rejected before delivery.
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

  it("does not publish late activity from a closed tab after its replacement opens", async () => {
    const { session, executeJavaScript } = createMockSession({
      assignedTaskId: "owner-thread",
    });
    const send = vi.fn();
    const window = {
      isDestroyed: () => false,
      webContents: { send },
      contentView: { children: [session.view] },
    };
    const manager = new BrowserHostManager(() => window as any);
    const { sessions } = manager as unknown as {
      sessions: Map<string, unknown>;
    };
    sessions.set(session.key, session);
    let markStarted!: () => void;
    let finishAction!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const finish = new Promise<void>((resolve) => {
      finishAction = resolve;
    });
    executeJavaScript.mockImplementationOnce(() => {
      markStarted();
      return finish;
    });
    const target = {
      projectId: session.projectId,
      sessionId: session.sessionId,
    };
    const running = manager.runAutomation({
      ...target,
      source: "agent",
      taskId: "owner-thread",
      operation: "evaluate",
      input: { expression: "1" },
    });
    await started;
    expect(send).toHaveBeenLastCalledWith(
      "desktop:browser-host:session-state",
      expect.objectContaining({ activeAgentAction: "evaluate" }),
    );
    manager.destroySession(target, false);
    sessions.set(session.key, createMockSession({ instanceId: "replacement" }).session);
    send.mockClear();
    finishAction();
    await expect(running).rejects.toThrow("interrupted");
    expect(send).not.toHaveBeenCalled();
    expect(manager.getSessionState(session.projectId, session.sessionId).instanceId).toBe(
      "replacement",
    );
  });

  it("does not execute an action after takeover while preparing a background surface", async () => {
    const window = {
      isDestroyed: () => false,
      contentView: {
        children: [],
        addChildView: vi.fn(),
        removeChildView: vi.fn(),
      },
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
      const { session, webContents } = createMockSession({
        assignedTaskId: "task-A",
      });
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

  it("counts page console errors, publishes them throttled and clears them on navigation", () => {
    vi.useFakeTimers();
    try {
      const manager = new BrowserHostManager(() => null);
      const { session, webContents } = createMockSession();
      Object.assign(webContents, {
        setWindowOpenHandler: vi.fn(),
        canGoBack: () => false,
        canGoForward: () => false,
      });
      (manager as any).sessions.set(session.key, session);
      const emit = vi.spyOn(manager as any, "emitState").mockImplementation(() => undefined);
      (manager as any).registerSessionEvents(session);
      const handler = (name: string) =>
        session.view.webContents.on.mock.calls.find(([event]) => event === name)?.[1];
      const consoleMessage = handler("console-message");
      for (let index = 0; index < 50; index++) {
        consoleMessage({
          level: "error",
          message: `boom ${index}`,
          sourceId: "http://localhost:5173/src/App.tsx",
          lineNumber: 42,
        });
      }
      consoleMessage({
        level: "info",
        message: "fine",
        sourceId: "",
        lineNumber: 1,
      });
      expect((session as any).pageErrors).toMatchObject({
        count: 50,
        latest: { text: "boom 49" },
      });
      // A page logging in a loop publishes once, not fifty times.
      expect(emit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300);
      expect(emit).toHaveBeenCalledTimes(1);
      handler("did-navigate")(undefined, "http://localhost:5173/next");
      expect((session as any).pageErrors).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rests an out-of-sight page and brings back the same history entry when shown", async () => {
    const window = { isDestroyed: () => false, webContents: { send: vi.fn() } };
    const manager = new BrowserHostManager(() => window as never);
    const { session, webContents } = createMockSession({
      currentUrl: "http://localhost:5173/cart",
      pageTitle: "Cart",
      lastActiveAt: 0,
    });
    let active = 2;
    const history = {
      getActiveIndex: vi.fn(() => active),
      canGoToOffset: vi.fn(() => true),
      goToIndex: vi.fn((index: number) => {
        active = index;
      }),
      removeEntryAtIndex: vi.fn(() => true),
    };
    Object.assign(webContents, {
      navigationHistory: history,
      loadURL: vi.fn(async () => {
        active = 3;
      }),
    });
    (manager as any).sessions.set(session.key, session);
    manager.setRestAfterMinutes(10);
    await manager.restIdleSessions(20 * 60_000);
    expect((webContents as any).loadURL).toHaveBeenCalledWith("about:blank");
    expect((session as any).resting?.historyIndex).toBe(2);
    // The UI keeps showing the real page, never the placeholder.
    window.webContents.send.mockClear();
    (manager as any).emitState(session);
    expect(window.webContents.send).not.toHaveBeenCalled();
    expect((manager as any).snapshotSession(session)).toMatchObject({
      currentUrl: "http://localhost:5173/cart",
      resting: true,
    });
    await manager.activateSession({
      projectId: "project-1",
      sessionId: "tab-1",
    });
    expect(history.goToIndex).toHaveBeenCalledWith(2);
    expect(history.removeEntryAtIndex).toHaveBeenCalledWith(3);
    expect((session as any).resting).toBeUndefined();
    expect((session as any).currentUrl).toBe("http://localhost:5173/cart");
    manager.setRestAfterMinutes(0);
  });

  it("rests after anything from five minutes up to a week", () => {
    const manager = new BrowserHostManager(() => null);
    const restMs = () => (manager as any).restAfterMs as number;
    manager.setRestAfterMinutes(7 * 24 * 60);
    expect(restMs()).toBe(7 * 24 * 60 * 60_000);
    manager.setRestAfterMinutes(30 * 24 * 60);
    expect(restMs()).toBe(7 * 24 * 60 * 60_000);
    manager.setRestAfterMinutes(1);
    expect(restMs()).toBe(5 * 60_000);
    manager.setRestAfterMinutes(0);
    expect(restMs()).toBe(0);
  });

  it("never rests pages an agent, a recording or a pop-out depends on", async () => {
    const manager = new BrowserHostManager(() => null);
    manager.setRestAfterMinutes(10);
    for (const overrides of [
      { assignedTaskId: "task-1" },
      { controller: "agent" },
      { devToolsOpen: true },
      { loading: true },
      { lastActiveAt: undefined },
    ]) {
      const { session, webContents } = createMockSession({
        currentUrl: "http://localhost:5173/",
        lastActiveAt: 0,
        ...overrides,
      });
      Object.assign(webContents, {
        loadURL: vi.fn(),
        navigationHistory: { getActiveIndex: () => 0 },
      });
      (manager as any).sessions.clear();
      (manager as any).sessions.set(session.key, session);
      await manager.restIdleSessions(60 * 60_000);
      expect((webContents as any).loadURL).not.toHaveBeenCalled();
    }
    manager.setRestAfterMinutes(0);
  });

  it("invalidates queued work when tab ownership changes", () => {
    const manager = new BrowserHostManager(() => null);
    const { session } = createMockSession({ assignedTaskId: "task-A" });
    (manager as any).sessions.set(session.key, session);
    manager.assignTabTask({
      projectId: "project-1",
      sessionId: "tab-1",
      taskId: "task-B",
    });
    manager.assignTabTask({
      projectId: "project-1",
      sessionId: "tab-1",
      taskId: "task-A",
    });
    expect(session.controlEpoch).toBe(2);
  });

  it("requires identity for assigned-tab observations but permits explicit human controls", async () => {
    const manager = new BrowserHostManager(() => null);
    const { session } = createMockSession({ assignedTaskId: "task-A" });
    (manager as any).sessions.set(session.key, session);
    await expect(
      manager.runAutomation({
        projectId: "project-1",
        sessionId: "tab-1",
        operation: "status",
      }),
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

    const closed = manager.cleanupAgentTabs({
      projectId: "project-1",
      taskId: "task-agent",
    });

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

describe("opening a browser that is shown on screen", () => {
  function managerWithView() {
    const webContents = {
      id: 7,
      isDestroyed: () => false,
      isDevToolsOpened: () => false,
      getURL: () => "",
      getTitle: () => "",
      canGoBack: () => false,
      canGoForward: () => false,
      setWindowOpenHandler: vi.fn(),
      loadURL: vi.fn(async () => undefined),
      debugger: { on: vi.fn(), isAttached: () => false },
      setZoomFactor: vi.fn(),
      setAudioMuted: vi.fn(),
      getZoomFactor: () => 1,
      on: vi.fn(),
      session: {
        cookies: { on: vi.fn(), flushStore: vi.fn(async () => undefined) },
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
        setUserAgent: vi.fn(),
        getUserAgent: () => "Mozilla/5.0",
        on: vi.fn(),
        webRequest: {
          onBeforeSendHeaders: vi.fn(),
          onHeadersReceived: vi.fn(),
        },
      },
    };
    vi.mocked(WebContentsView).mockImplementation(function MockView() {
      return {
        webContents,
        setBackgroundColor: vi.fn(),
        setBounds: vi.fn(),
      } as never;
    });
    const manager = new BrowserHostManager(() => null);
    for (const method of [
      "registerSessionEvents",
      "observeAutomationNetwork",
      "observeProfileSession",
      "recordPartition",
      "applyColorScheme",
    ])
      vi.spyOn(manager as any, method).mockImplementation(() => Promise.resolve());
    let finishLoad!: () => void;
    const loadUrl = vi
      .spyOn(manager as any, "loadUrl")
      .mockImplementation(() => new Promise<void>((resolve) => (finishLoad = resolve)));
    return { manager, loadUrl, finish: () => finishLoad?.() };
  }

  it("is ready to attach before a slow first page finishes loading", async () => {
    const { manager, loadUrl, finish } = managerWithView();
    let settled = false;
    const ensured = manager
      .ensureSession({
        projectId: "p",
        sessionId: "browser",
        initialUrl: "https://slow.example/",
        waitForLoad: false,
      })
      .then(() => (settled = true));
    await ensured;
    // Resolved while the page is still loading, so the view can be shown now.
    expect(settled).toBe(true);
    expect(loadUrl).toHaveBeenCalledTimes(1);
    finish();
  });

  it("still waits for a loaded page by default, for automation", async () => {
    const { manager, finish } = managerWithView();
    let settled = false;
    const ensured = manager
      .ensureSession({
        projectId: "p",
        sessionId: "auto",
        initialUrl: "https://slow.example/",
      })
      .then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    finish();
    await ensured;
    expect(settled).toBe(true);
  });

  it("gives new temporary agent tabs independent in-memory browser partitions", async () => {
    const { manager } = managerWithView();
    const make = (sessionId: string, taskId: string) => ({
      projectId: "p",
      sessionId,
      taskId,
      initialUrl: "",
      temporaryAgentTab: true,
    });
    const options = vi.mocked(WebContentsView);
    const first = make("tab_1", "thread-1");
    await manager.ensureSession({
      ...first,
      partition: "persist:tabs-browser:profile:work",
      profileId: "work",
    });
    const firstPartition = options.mock.lastCall?.[0]?.webPreferences?.partition;
    await manager.ensureSession(make("tab_2", "thread-1"));
    const secondPartition = options.mock.lastCall?.[0]?.webPreferences?.partition;
    await manager.ensureSession(make("tab_3", "thread-2"));
    const thirdPartition = options.mock.lastCall?.[0]?.webPreferences?.partition;
    const partitions = [firstPartition, secondPartition, thirdPartition];
    for (const partition of partitions) expect(partition).toMatch(/^tabs-browser-ephemeral:agent:/);
    expect(new Set(partitions).size).toBe(3);
    expect(manager.getSessionState(first.projectId, first.sessionId).profileId).toBeUndefined();
    const created = options.mock.calls.length;
    await manager.ensureSession({
      ...first,
      partition: "persist:tabs-browser:p",
    });
    await expect(manager.ensureSession(make("agents-surface-private", "thread-1"))).rejects.toThrow(
      "Open the user’s browser tab",
    );
    expect(options).toHaveBeenCalledTimes(created);
  });
});
