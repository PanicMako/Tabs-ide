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

  it("revokes site approvals before profile storage is cleared, without affecting another profile", async () => {
    const manager = new BrowserHostManager(() => null);
    const storage = {
      cookies: {
        on: vi.fn(),
        get: vi.fn().mockResolvedValue([]),
        flushStore: vi.fn().mockResolvedValue(undefined),
      },
      closeAllConnections: vi.fn().mockResolvedValue(undefined),
      clearData: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      flushStorageData: vi.fn(),
    };
    const personalStorage = { ...storage };
    electronMocks.fromPartition.mockReturnValue(storage);
    const open = async (id: string, profileId: string, currentUrl: string) => {
      const sessionId = `agents-surface-${id}`;
      const f = createMockSession({
        sessionId,
        key: `project-1::${sessionId}`,
        profileId,
        partition: `persist:tabs-browser:profile:${profileId}`,
        currentUrl,
      });
      const safe = vi.fn().mockResolvedValue(true);
      Object.assign(f.webContents, {
        session: profileId === "work" ? storage : personalStorage,
        isLoadingMainFrame: () => false,
        executeJavaScriptInIsolatedWorld: safe,
      });
      const { loadURL } = mockNavigation(manager, f);
      const route = { projectId: f.session.projectId, sessionId, taskId: "qa" };
      const state = () => manager.getSessionState(route.projectId, sessionId);
      const approve = (token?: string) =>
        manager.runAutomation({
          ...route,
          source: "human",
          operation: "authorizeBrowserPage",
          input: { url: currentUrl, profileId, pageApprovalToken: token },
        });
      await approve();
      return { ...f, loadURL, route, state, approve, safe };
    };
    const url = "https://reports.example.com/draft";
    const work = await open("work-clear", "work", url);
    const otherSite = await open("other-site", "work", "https://other.test/?site=example.com");
    const personal = await open("personal-clear", "personal", url);
    const oldReview = work.state().pageApprovalToken;
    expect(oldReview).toBeTypeOf("string");

    let finishPageCheck!: (safe: boolean) => void;
    work.safe.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finishPageCheck = resolve;
      }),
    );
    const action = manager.runAutomation({
      ...work.route,
      source: "agent",
      operation: "click",
      input: { selector: "#save" },
    });
    const rejected = expect(action).rejects.toThrow("Approve access");
    await vi.waitFor(() => expect(work.safe).toHaveBeenCalledOnce());

    let finishClear!: () => void;
    storage.clearData.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishClear = resolve;
      }),
    );
    const clearing = manager.clearProfileDomain("work", "example.com");
    await vi.waitFor(() => expect(storage.clearData).toHaveBeenCalledOnce());
    expect(work.state().browserPageAuthorized).toBe(false);
    await expect(work.approve()).rejects.toThrow("finish updating site data");
    finishPageCheck(true);
    await rejected;
    expect(work.sendInputEvent).not.toHaveBeenCalled();
    expect(otherSite.state().browserPageAuthorized).toBe(true);
    expect(personal.state().browserPageAuthorized).toBe(true);

    finishClear();
    await clearing;
    expect(work.loadURL).toHaveBeenCalledWith(url);
    expect(otherSite.loadURL).not.toHaveBeenCalled();
    expect(personal.loadURL).not.toHaveBeenCalled();
    await expect(work.approve(oldReview)).rejects.toThrow("page changed during review");
    await work.approve(work.state().pageApprovalToken);
    expect(work.state().browserPageAuthorized).toBe(true);

    await manager.clearProfileData("work");
    expect(work.state().browserPageAuthorized).toBe(false);
    expect(otherSite.state().browserPageAuthorized).toBe(false);
    expect(personal.state().browserPageAuthorized).toBe(true);
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

  it("revokes the page grant when the visible signed-in account changes", async () => {
    const manager = new BrowserHostManager(() => null);
    let marker: string | null = "a".repeat(64);
    vi.spyOn(manager as any, "readAccountMarker").mockImplementation(async () => marker);
    const tab = openCookieChangeTab(
      manager,
      "account-marker",
      "https://reports.example.test/draft",
      { cookies: new EventEmitter() },
    );
    await tab.approve();
    expect(tab.state().browserPageAuthorized).toBe(true);
    // Same marker (or none visible yet) never revokes.
    await tab.act("snapshot").catch(() => undefined);
    marker = null;
    await tab.act("snapshot").catch(() => undefined);
    expect(tab.state().browserPageAuthorized).toBe(true);
    marker = "b".repeat(64);
    await expect(tab.act("snapshot")).rejects.toThrow(
      "The signed-in account on this page changed. Review access again.",
    );
    expect(tab.state().browserPageAuthorized).toBe(false);
    // A grant approved again binds to the new account.
    await tab.approve();
    expect(tab.state().browserPageAuthorized).toBe(true);
    await tab.act("snapshot").catch(() => undefined);
    expect(tab.state().browserPageAuthorized).toBe(true);
  });

  it("blocks generic input on another address of a guarded draft that shows the same visible ID", async () => {
    const userData = await mkdtemp(join(tmpdir(), "tabs-identity-guard-"));
    onTestFinished(() => rm(userData, { recursive: true, force: true }));
    const manager = new BrowserHostManager(() => null);
    (manager as any).submissionGuards = new BrowserSubmissionGuards(() => userData);
    const tab = openCookieChangeTab(manager, "identity-guard", "https://app.test/alias/42", {
      cookies: new EventEmitter(),
    });
    await tab.approve();
    (manager as any).submissionGuards.set(
      tab.session.partition,
      "https://app.test/drafts/42",
      true,
      {
        selector: "#draft-id",
        resourceId: "42",
      },
    );
    // Nothing guards /alias/42 by address, but the page shows the guarded draft's ID.
    await expect(tab.act("click", { selector: "button" })).rejects.toThrow("submission breakpoint");
    tab.evaluate.mockImplementation(async (_world, scripts) =>
      scripts[0]?.code.includes("#draft-id") ? false : true,
    );
    await expect(tab.act("click", { selector: "button" })).resolves.toEqual({
      clicked: true,
    });
  });

  it("revokes on a session-like cookie change but not on an unrelated cookie", async () => {
    const manager = new BrowserHostManager(() => null);
    const cookies = new EventEmitter();
    const tab = openCookieChangeTab(manager, "cookie-session-like", "https://app.example.test/", {
      cookies,
    });
    await tab.approve();
    const cookie = (name: string) => ({
      name,
      domain: "app.example.test",
      hostOnly: true,
      httpOnly: false,
    });
    for (const name of ["theme", "_ga", "csrftoken", "qa_profile"])
      cookies.emit("changed", {}, cookie(name), "explicit", false);
    expect(tab.state().browserPageAuthorized).toBe(true);
    cookies.emit("changed", {}, cookie("session_id"), "overwrite", false);
    expect(tab.state().browserPageAuthorized).toBe(false);
  });

  it("blocks stale screenshot transfer and active Work read and click after a shared HttpOnly change", async () => {
    const manager = new BrowserHostManager(() => null);
    const cookies = new EventEmitter();
    const storage = { cookies };
    const url = "https://reports.example.test/draft";
    const work = openCookieChangeTab(manager, "cookie-work", url, storage);
    const reader = openCookieChangeTab(manager, "cookie-reader", url, storage);
    const subdomain = openCookieChangeTab(
      manager,
      "cookie-subdomain",
      "https://sub.reports.example.test/",
      storage,
    );
    const sibling = openCookieChangeTab(
      manager,
      "cookie-sibling",
      "https://app.example.test/",
      storage,
    );
    const apex = openCookieChangeTab(manager, "cookie-apex", "https://example.test/", storage);
    const unrelated = openCookieChangeTab(
      manager,
      "cookie-other",
      "https://notexample.test/?site=example.test",
      storage,
    );
    const personal = openCookieChangeTab(
      manager,
      "cookie-personal",
      url,
      { cookies: new EventEmitter() },
      "personal",
    );
    for (const tab of [work, reader, subdomain, sibling, apex, unrelated, personal])
      await tab.approve();
    const { grantId } = await work.approveScreenshot();
    const review = work.state().pageApprovalToken;
    const metadata = {
      name: "qa_profile",
      domain: "REPORTS.Example.Test.",
      path: "/session",
      hostOnly: true,
      httpOnly: false,
      get value() {
        throw new Error("Cookie values must not be read");
      },
    };
    cookies.emit("changed", {}, metadata, "explicit", false);
    expect(work.state().pageApprovalToken).toBe(review);

    let finishClick!: (hit: boolean) => void;
    work.evaluate
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ x: 10, y: 10 })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishClick = resolve;
        }),
      );
    vi.spyOn(manager as any, "captureSessionImage").mockResolvedValue(Buffer.from("screenshot"));
    let finishRead!: (page: { visibleText: string }) => void;
    reader.evaluate.mockResolvedValueOnce(true).mockReturnValueOnce(
      new Promise((resolve) => {
        finishRead = resolve;
      }),
    );
    const click = expect(work.act("click", { selector: "button" })).rejects.toThrow("interrupted");
    const read = expect(reader.act("snapshot")).rejects.toThrow("Approve access");
    await vi.waitFor(() => {
      expect(work.evaluate).toHaveBeenCalledTimes(3);
      expect(reader.evaluate).toHaveBeenCalledTimes(2);
    });

    const beforeChange = performance.timeOrigin + performance.now() - 1;
    cookies.emit("changed", {}, Object.assign(metadata, { httpOnly: true }), "overwrite", true);
    finishClick(true);
    finishRead({ visibleText: "Work" });
    await Promise.all([click, read]);
    expect(work.sendInputEvent).not.toHaveBeenCalled();
    expect(work.state()).toMatchObject({
      browserPageAuthorized: false,
      deviceScreenshotAuthorized: false,
    });
    for (const tab of [subdomain, sibling, apex, unrelated, personal]) {
      expect(tab.state().browserPageAuthorized).toBe(true);
      await expect(tab.act("status")).resolves.toBeDefined();
    }

    const reload = "Reload this page after its browser session changed";
    await expect(work.approve()).rejects.toThrow(reload);
    await expect(work.approveScreenshot()).rejects.toThrow(reload);
    await expect(work.transfer(grantId, "AAAA")).rejects.toThrow(reload);
    work.events.emit("did-navigate-in-page", {}, url, true);
    await expect(work.approve()).rejects.toThrow(reload);
    work.events.emit("did-start-loading");
    work.showDocument(beforeChange);
    await expect(work.approve()).rejects.toThrow(reload);
    work.events.emit("did-stop-loading");
    await expect(work.approve()).rejects.toThrow(reload);

    work.showDocument(performance.timeOrigin + performance.now());
    await expect(work.approve(review)).rejects.toThrow("page changed during review");
    await expect(work.approve()).resolves.toMatchObject({ approved: true });
    await expect(work.transfer(grantId, "AAAA")).rejects.toThrow(
      "Approve this screenshot transfer again",
    );
    work.showDocument(beforeChange);
    await expect(work.act("status")).rejects.toThrow(reload);

    const documentBeforeRotation = performance.timeOrigin + performance.now();
    work.showDocument(documentBeforeRotation);
    let finishDocumentCheck!: (time: number) => void;
    work.evaluate.mockReturnValueOnce(
      new Promise((resolve) => {
        finishDocumentCheck = resolve;
      }),
    );
    const reviewDuringRotation = expect(work.approve()).rejects.toThrow(reload);
    // A domain cookie reaches the parent and subdomains with a DNS label boundary.
    cookies.emit(
      "changed",
      {},
      { domain: ".EXAMPLE.Test.", hostOnly: false, httpOnly: true },
      "explicit",
      false,
    );
    finishDocumentCheck(documentBeforeRotation);
    await reviewDuringRotation;
    for (const tab of [work, subdomain, sibling, apex]) {
      expect(tab.state().browserPageAuthorized).toBe(false);
      await expect(tab.approve()).rejects.toThrow(reload);
    }
    expect(unrelated.state().browserPageAuthorized).toBe(true);
    expect(personal.state().browserPageAuthorized).toBe(true);
  });

  it.skipIf(process.env.TABS_QA_BROWSER !== "1")(
    "blocks a Chromium screenshot transfer from stale Work DOM after a sibling switches the fixture account",
    async () => {
      const fixtureUrl = new URL("../../server/scripts/fixtures/deviceDraft.ts", import.meta.url);
      const {
        startDeviceDraftApp,
      }: {
        startDeviceDraftApp: () => Promise<{
          origin: string;
          trialCounts: () => { draftSaves: { Work: number; Personal: number } };
          close: () => Promise<void>;
        }>;
      } = await import(fixtureUrl.href);
      const { chromium } = await import("playwright");
      const site = await startDeviceDraftApp();
      onTestFinished(() => site.close());
      const browser = await chromium.launch();
      onTestFinished(() => browser.close());
      const context = await browser.newContext();
      const page = await context.newPage();
      const sibling = await context.newPage();
      const personalPage = await browser.newPage();
      const url = `${site.origin}/`;
      await page.goto(`${url}Work`);
      await personalPage.goto(`${url}Personal`);
      expect(await page.getByText("Work", { exact: true }).count()).toBe(1);

      const manager = new BrowserHostManager(() => null);
      const cookies = new EventEmitter();
      const work = openCookieChangeTab(manager, "chromium-cookie-work", url, {
        cookies,
      });
      const personal = openCookieChangeTab(
        manager,
        "chromium-cookie-personal",
        url,
        { cookies: new EventEmitter() },
        "personal",
      );
      await connectChromiumPage(page, work);
      await connectChromiumPage(personalPage, personal);
      await work.approve();
      await personal.approve();
      const { grantId } = await work.approveScreenshot();
      await expect(work.transfer(grantId)).resolves.toMatchObject({
        deviceId: "sim",
      });
      const evidence = page.locator("#evidence");
      await evidence.evaluate((field) => {
        field.addEventListener("change", () => (field as HTMLInputElement).form?.requestSubmit());
      });

      await sibling.goto(`${url}Personal`);
      expect(await sibling.getByText("Personal", { exact: true }).count()).toBe(1);
      // The Chromium fixture uses the real cookie. Bridge only Electron's change metadata to the host.
      cookies.emit(
        "changed",
        {},
        {
          name: "qa_profile",
          domain: new URL(url).hostname,
          hostOnly: true,
          httpOnly: true,
        },
        "explicit",
        false,
      );
      expect(await page.getByText("Work", { exact: true }).count()).toBe(1);
      const reload = "Reload this page after its browser session changed";
      await expect(work.approveScreenshot()).rejects.toThrow(reload);
      const png =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=";
      await expect(work.transfer(grantId, png)).rejects.toThrow(reload);
      expect(await evidence.evaluate((field) => (field as HTMLInputElement).files?.length)).toBe(0);
      expect(site.trialCounts().draftSaves).toEqual({ Work: 0, Personal: 0 });
      expect(personal.state().browserPageAuthorized).toBe(true);
      await expect(personal.act("status")).resolves.toMatchObject({ url });

      await page.reload();
      work.events.emit("did-navigate", {}, url);
      expect(await page.getByText("Personal", { exact: true }).count()).toBe(1);
      await expect(work.approve()).resolves.toMatchObject({ approved: true });
      await expect(work.transfer(grantId, png)).rejects.toThrow(
        "Approve this screenshot transfer again",
      );
    },
  );

  it("requires a fresh Work document after an interrupted cookie import", async () => {
    const manager = new BrowserHostManager(() => null);
    const url = "https://reports.example.com/draft";
    const open = async (profileId: string) => {
      const sessionId = `agents-surface-${profileId}`;
      const fixture = createMockSession({
        sessionId,
        key: `project-1::${sessionId}`,
        profileId,
        partition: `persist:tabs-browser:profile:${profileId}`,
        currentUrl: url,
      });
      let documentTime = 0;
      const safe = vi.fn(
        async (_world, scripts: { code: string }[]): Promise<number | boolean> =>
          scripts[0]?.code === "performance.timeOrigin" ? documentTime : true,
      );
      Object.assign(fixture.webContents, {
        isLoadingMainFrame: () => false,
        executeJavaScriptInIsolatedWorld: safe,
      });
      const { events } = mockNavigation(manager, fixture);
      const showDocument = (time: number) => {
        documentTime = time;
        events.emit("did-navigate", {}, url);
      };
      const route = {
        projectId: fixture.session.projectId,
        sessionId,
        taskId: "qa",
      };
      const state = () => manager.getSessionState(route.projectId, sessionId);
      const approve = (token?: string) =>
        manager.runAutomation({
          ...route,
          source: "human",
          operation: "authorizeBrowserPage",
          input: { url, profileId, pageApprovalToken: token },
        });
      await approve();
      return { ...fixture, route, state, approve, safe, showDocument };
    };
    const work = await open("work");
    const personal = await open("personal");
    const previousReview = work.state().pageApprovalToken;
    const fromPartition = electronMocks.fromPartition.mockReturnValueOnce(work.webContents.session);

    let finishSafetyCheck!: (safe: boolean) => void;
    work.safe.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finishSafetyCheck = resolve;
      }),
    );
    const click = manager.runAutomation({
      ...work.route,
      source: "agent",
      operation: "click",
      input: { selector: "#save" },
    });
    const rejected = expect(click).rejects.toThrow("Approve access");
    await vi.waitFor(() => expect(work.safe).toHaveBeenCalledOnce());

    let finishWrite!: () => void;
    const write = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const set = vi.fn(() => {
      expect(work.state().browserPageAuthorized).toBe(false);
      expect(personal.state().browserPageAuthorized).toBe(true);
      return write;
    });
    Object.assign(work.webContents.session.cookies, { set });

    const importCookies = vi.spyOn(BrowserSessionImporter.prototype, "importSelectedCookies");
    onTestFinished(() => importCookies.mockRestore());
    importCookies.mockRejectedValueOnce(new Error("Source browser is open"));
    importCookies.mockImplementationOnce(async (_input, resolveDestination, signal) => {
      const { cookies } = resolveDestination!("persist:tabs-browser:profile:work");
      await cookies.set({ url, name: "fixture", value: "synthetic" });
      await cookies.flushStore();
      return {
        cancelled: signal?.aborted ?? false,
        imported: 1,
        skipped: 0,
        skippedDomains: [],
        warnings: [],
      };
    });
    const input = {
      requestId: "import-request",
      sourceId: "chrome" as const,
      sourceProfileDirectory: "Default",
      targetProfileId: "work",
    };
    await expect(manager.importBrowserCookies(input)).rejects.toThrow("Source browser is open");
    expect(work.state().browserPageAuthorized).toBe(true);

    const importing = manager.importBrowserCookies(input);
    await vi.waitFor(() => expect(set).toHaveBeenCalledOnce());
    expect(fromPartition).toHaveBeenLastCalledWith("persist:tabs-browser:profile:work");
    manager.cancelBrowserImport(input.requestId);
    await expect(work.approve()).rejects.toThrow("finish updating site data");
    finishSafetyCheck(true);
    await rejected;
    expect(work.sendInputEvent).not.toHaveBeenCalled();
    expect(personal.state().browserPageAuthorized).toBe(true);

    finishWrite();
    await expect(importing).resolves.toMatchObject({
      cancelled: true,
      imported: 1,
    });
    await expect(work.approve(work.state().pageApprovalToken)).rejects.toThrow(
      "Reload this page after importing",
    );
    work.showDocument(performance.timeOrigin + performance.now() + 1000);
    await expect(work.approve(previousReview)).rejects.toThrow("page changed during review");
    await work.approve(work.state().pageApprovalToken);
    expect(work.state().browserPageAuthorized).toBe(true);

    // History can restore a document created before the reviewed account changed.
    work.showDocument(0);
    await expect(
      manager.runAutomation({
        ...work.route,
        source: "agent",
        operation: "click",
        input: { selector: "#save" },
      }),
    ).rejects.toThrow("Reload this page after importing");
    expect(work.sendInputEvent).not.toHaveBeenCalled();
  });

  it.skipIf(process.env.TABS_QA_BROWSER !== "1")(
    "reviews the account on a freshly loaded Chromium document after importing a session",
    async () => {
      const fixtureUrl = new URL("../../server/scripts/fixtures/deviceDraft.ts", import.meta.url);
      const {
        startDeviceDraftApp,
      }: {
        startDeviceDraftApp: () => Promise<{
          origin: string;
          trialCounts: () => {
            reportExports: { Personal: Record<string, number> };
          };
          close: () => Promise<void>;
        }>;
      } = await import(fixtureUrl.href);
      const { chromium } = await import("playwright");
      const site = await startDeviceDraftApp();
      onTestFinished(() => site.close());
      const browser = await chromium.launch();
      onTestFinished(() => browser.close());
      const page = await browser.newPage();
      const url = site.origin + "/reports/benchmark?position=0";
      await page.goto(site.origin + "/Work");
      await page.goto(url);
      expect(await page.getByText("Work", { exact: true }).count()).toBe(1);

      const manager = new BrowserHostManager(() => null);
      const sessionId = "agents-surface-import";
      const partition = "persist:tabs-browser:profile:work";
      const fixture = createMockSession({
        sessionId,
        key: `project-1::${sessionId}`,
        profileId: "work",
        partition,
        currentUrl: url,
      });
      const evaluate = vi.fn<(world: number, scripts: { code: string }[]) => Promise<unknown>>();
      await connectChromiumPage(page, { evaluate });
      const { events } = mockNavigation(manager, fixture);
      Object.assign(fixture.webContents, {
        getURL: () => page.url(),
        isLoadingMainFrame: () => false,
        executeJavaScriptInIsolatedWorld: evaluate,
      });
      const route = { projectId: "project-1", sessionId, taskId: "qa" };
      const state = () => manager.getSessionState(route.projectId, sessionId);
      const approve = () =>
        manager.runAutomation({
          ...route,
          source: "human",
          operation: "authorizeBrowserPage",
          input: {
            url,
            profileId: "work",
            pageApprovalToken: state().pageApprovalToken,
          },
        });
      await approve();
      expect(state().browserPageAuthorized).toBe(true);

      electronMocks.fromPartition.mockReturnValueOnce(fixture.webContents.session);
      const importCookies = vi.spyOn(BrowserSessionImporter.prototype, "importSelectedCookies");
      onTestFinished(() => importCookies.mockRestore());
      importCookies.mockImplementationOnce(async (_input, resolveDestination) => {
        resolveDestination!(partition);
        await page.context().addCookies([
          {
            url: site.origin,
            name: "qa_profile",
            value: "Personal",
            httpOnly: true,
            sameSite: "Strict",
          },
        ]);
        return {
          cancelled: false,
          imported: 1,
          skipped: 0,
          skippedDomains: [],
          warnings: [],
        };
      });
      await manager.importBrowserCookies({
        sourceId: "chrome",
        sourceProfileDirectory: "Default",
        targetProfileId: "work",
      });

      expect(await page.getByText("Work", { exact: true }).count()).toBe(1);
      await expect(approve()).rejects.toThrow("Reload this page after importing");
      await expect(
        manager.runAutomation({
          ...route,
          source: "agent",
          operation: "click",
          input: { selector: 'button[name="export"]' },
        }),
      ).rejects.toThrow("Reload this page after importing");
      expect(fixture.sendInputEvent).not.toHaveBeenCalled();
      expect(site.trialCounts().reportExports.Personal).toEqual({
        selected: 0,
        all: 0,
        archived: 0,
      });

      await page.reload();
      events.emit("did-navigate", {}, url);
      expect(await page.getByText("Personal", { exact: true }).count()).toBe(1);
      await expect(approve()).resolves.toMatchObject({ approved: true });
    },
  );

  it("requires fresh approval after a same-tab sign-in route in a private application", async () => {
    const manager = new BrowserHostManager(() => null);
    const sessionId = "agents-surface-private";
    const url = "https://private.example/app#/work";
    const fixture = createMockSession({
      sessionId,
      key: `project-1::${sessionId}`,
      currentUrl: url,
      partition: "persist:tabs-browser:profile:work",
      profileId: "work",
    });
    const { events, loadURL } = mockNavigation(manager, fixture);
    const inspect = vi.fn().mockResolvedValue(true);
    Object.assign(fixture.webContents, {
      executeJavaScriptInIsolatedWorld: inspect,
    });
    const target = {
      projectId: fixture.session.projectId,
      sessionId,
      taskId: "qa",
    };
    const approve = () =>
      manager.runAutomation({
        ...target,
        source: "human",
        operation: "authorizeBrowserPage",
        input: { url, profileId: "work" },
      });
    const agent = { ...target, source: "agent" as const };
    await approve();
    const navigate = (destination: string) =>
      manager.runAutomation({
        ...agent,
        operation: "navigate",
        input: { url: destination },
      });
    const login = "https://private.example/app#!%2Faccount%2Fsign-in";
    await expect(navigate(login)).rejects.toThrow("destination");
    await expect(navigate("https://private.example/%6cogin")).rejects.toThrow("destination");
    expect(loadURL).not.toHaveBeenCalled();

    await expect(navigate("https://private.example/app#/work?ref=login")).resolves.toBeUndefined();
    expect(manager.getSessionState(target.projectId, sessionId).browserPageAuthorized).toBe(true);
    inspect.mockClear();
    fixture.session.currentUrl = login;
    events.emit("did-navigate-in-page", {}, login, true);
    await expect(manager.runAutomation({ ...agent, operation: "snapshot" })).rejects.toThrow(
      "signing in",
    );
    expect(inspect).not.toHaveBeenCalled();
    fixture.session.currentUrl = url;
    events.emit("did-navigate-in-page", {}, url, true);
    inspect.mockClear();
    await expect(manager.runAutomation({ ...agent, operation: "status" })).rejects.toThrow(
      "Approve",
    );
    expect(inspect).not.toHaveBeenCalled();
    expect(fixture.sendInputEvent).not.toHaveBeenCalled();
    await approve();
    await expect(manager.runAutomation({ ...agent, operation: "status" })).resolves.toMatchObject({
      url: "https://private.example/app",
    });
  });

  it("hands the approved draft to the human when its submit breakpoint matches", async () => {
    const userData = await mkdtemp(join(tmpdir(), "tabs-browser-workflow-host-"));
    const dataPath = vi.spyOn(app, "getPath").mockReturnValue(userData);
    try {
      const manager = new BrowserHostManager(() => null);
      const sessionId = "agents-surface-workflow";
      const url = "https://docs.google.com/document/u/0/d/42";
      const { session, webContents } = createMockSession({
        sessionId,
        key: "project-1::" + sessionId,
        profileId: "work",
        partition: "persist:tabs-browser:profile:work",
        currentUrl: url,
      });
      let inspectStage = "uploaded";
      let inspectBreakpoint = "unobservable";
      const runScript = vi
        .fn()
        .mockImplementation(async (_world: number, scripts: { code: string }[]) =>
          scripts[0]?.code.includes("observeWorkflowPage")
            ? {
                disposition: "observed",
                observation: {
                  stage: inspectStage,
                  statusText: "Uploaded",
                  submitAvailable: true,
                  breakpoint: inspectBreakpoint,
                },
              }
            : true,
        );
      const loadURL = vi.fn();
      Object.assign(webContents, {
        getURL: () => session.currentUrl,
        session: { storagePath: join(userData, "Partitions", "work") },
        executeJavaScriptInIsolatedWorld: runScript,
        loadURL,
      });
      (manager as unknown as { sessions: Map<string, unknown> }).sessions.set(session.key, session);
      const target = {
        projectId: session.projectId,
        sessionId,
        taskId: "workflow-thread",
      };
      const agent = {
        ...target,
        source: "agent" as const,
        operation: "browserWorkflow",
      };
      const input = {
        phase: "inspect",
        profileId: "work",
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
      };
      await expect(manager.runAutomation({ ...agent, input })).rejects.toThrow("Approve");
      await manager.runAutomation({
        ...target,
        source: "human",
        operation: "authorizeBrowserPage",
        input: { url, profileId: "work" },
      });
      const inspected = (await manager.runAutomation({ ...agent, input })) as {
        target: unknown;
        observation: { breakpoint: string };
      };
      expect(inspected.observation.breakpoint).toBe("unobservable");
      const { BrowserSubmissionGuards } = await import("./browserWorkflowHostId");
      const afterRestart = new BrowserSubmissionGuards(() => userData);
      expect(afterRestart.has(session.partition, url)).toBe(true);
      expect(afterRestart.has(session.partition, url + "#details")).toBe(true);
      expect(afterRestart.has("persist:tabs-browser:profile:personal", url)).toBe(false);
      expect(afterRestart.has(session.partition, url + "/other")).toBe(false);
      inspectStage = "submitted";
      inspectBreakpoint = "irrelevant";
      await manager.runAutomation({
        ...agent,
        input: {
          ...input,
          definition: {
            ...input.definition,
            states: {
              ...input.definition.states,
              uploaded: "Draft",
              submitted: "Uploaded",
            },
          },
        },
      });
      expect(new BrowserSubmissionGuards(() => userData).has(session.partition, url)).toBe(true);
      inspectStage = "uploaded";
      inspectBreakpoint = "clear";
      for (const address of [url, url + "#details"]) {
        session.currentUrl = address;
        for (const operation of ["click", "press", "type"]) {
          await expect(
            manager.runAutomation({
              ...agent,
              operation,
              input: { selector: "#submit", key: "Enter" },
            }),
          ).rejects.toThrow("submission breakpoint");
        }
      }
      session.currentUrl = url;
      await expect(
        manager.runAutomation({
          ...agent,
          operation: "releaseSubmissionGuard",
          input: { url, instanceId: session.instanceId },
        }),
      ).rejects.toThrow("original draft");
      await expect(
        manager.runAutomation({
          ...agent,
          input: {
            ...input,
            phase: "enter",
            target: inspected.target,
            definition: {
              ...input.definition,
              url: url.replace("/u/0/", "/u/1/"),
            },
          },
        }),
      ).rejects.toThrow("selected persistent browser profile");
      expect(loadURL).not.toHaveBeenCalled();
      inspectBreakpoint = "matched";
      const submit = {
        ...agent,
        input: { ...input, phase: "submit", target: inspected.target },
      };
      await expect(manager.runAutomation(submit)).resolves.toMatchObject({
        disposition: "observed",
        observation: { breakpoint: "matched" },
      });
      expect(session.controller).toBe("human");
      await expect(manager.runAutomation(submit)).rejects.toThrow("Approve");
      const action = {
        id: crypto.randomUUID(),
        label: "Submit draft",
        origin: new URL(url).origin,
        steps: [{ action: "click", selector: "#submit" }],
        outcome: { selector: "#status", description: "Submitted" },
      };
      const [choice] = (await manager.runAutomation({
        ...target,
        source: "human",
        operation: "listQuickActionTargets",
        input: { action },
      })) as Array<{ token: string }>;
      expect(choice).toBeDefined();
      await expect(
        manager.runAutomation({
          ...target,
          source: "human",
          operation: "runQuickAction",
          input: { action, token: choice!.token, values: {} },
        }),
      ).rejects.toThrow("submission breakpoint");
      expect(session.controller).toBe("human");
      await manager.runAutomation({
        ...target,
        source: "human",
        operation: "releaseSubmissionGuard",
        input: { url, instanceId: session.instanceId },
      });
      expect(new BrowserSubmissionGuards(() => userData).has(session.partition, url)).toBe(false);
    } finally {
      dataPath.mockRestore();
      await rm(userData, { recursive: true, force: true });
    }
  });

  it.each(["a credential-bearing URL", "an intervening same-document change"] as const)(
    "refuses to resolve a browser workflow draft after %s",
    async (scenario) => {
      const userData = await mkdtemp(join(tmpdir(), "tabs-browser-workflow-address-"));
      const dataPath = vi.spyOn(app, "getPath").mockReturnValue(userData);
      onTestFinished(async () => {
        dataPath.mockRestore();
        await rm(userData, { recursive: true, force: true });
      });
      const manager = new BrowserHostManager(() => null);
      const sessionId = "agents-surface-workflow";
      const publicUrl = "https://workflow.test/draft/42";
      const protectedAddress = scenario === "a credential-bearing URL";
      const url = `${publicUrl}${protectedAddress ? "?__session=fixture" : "?view=build#delivery"}`;
      const fixture = createMockSession({
        sessionId,
        key: `project-1::${sessionId}`,
        profileId: "work",
        partition: "persist:tabs-browser:profile:work",
        currentUrl: url,
      });
      const { session, webContents } = fixture;
      const { events } = mockNavigation(manager, fixture);
      const evaluate = vi.fn(async (_world: number, scripts: { code: string }[]) => {
        if (!scripts[0]?.code.includes("observeWorkflowPage")) return true;
        events.emit("did-navigate-in-page", {}, `${publicUrl}?view=another`, true);
        events.emit("did-navigate-in-page", {}, url, true);
        return {
          disposition: "observed",
          observation: {
            stage: "uploaded",
            statusText: "Uploaded",
            submitAvailable: true,
            breakpoint: "clear",
          },
        };
      });
      Object.assign(webContents, {
        executeJavaScriptInIsolatedWorld: evaluate,
        isLoadingMainFrame: () => session.loading,
      });
      Object.assign(webContents.session, {
        storagePath: join(userData, "Partitions", "work"),
      });
      const owner = {
        projectId: session.projectId,
        sessionId,
        taskId: "workflow-thread",
      };
      await manager.runAutomation({
        ...owner,
        source: "human",
        operation: "authorizeBrowserPage",
        input: { url, profileId: "work" },
      });
      evaluate.mockClear();
      await expect(
        manager.runAutomation({
          ...owner,
          source: "agent",
          operation: "browserWorkflow",
          input: {
            phase: "inspect",
            profileId: "work",
            definition: {
              url: publicUrl,
              identitySelector: "#draft",
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
                selector: "#condition",
                pauseText: "Replacing",
                clearText: "Clear",
              },
            },
          },
        }),
      ).rejects.toThrow(
        protectedAddress ? "without sign-in or access credentials" : "draft changed",
      );
      if (protectedAddress) expect(evaluate).not.toHaveBeenCalled();
      expect(
        manager.getSessionState(session.projectId, sessionId).submissionGuardActive,
      ).toBeFalsy();
    },
  );

  it.skipIf(process.env.TABS_QA_BROWSER !== "1")(
    "uses a human approval once and checks the same draft button, destination and breakpoint in Chromium",
    async () => {
      const userData = await mkdtemp(join(tmpdir(), "tabs-browser-approval-"));
      const dataPath = vi.spyOn(app, "getPath").mockReturnValue(userData);
      onTestFinished(async () => {
        dataPath.mockRestore();
        await rm(userData, { recursive: true, force: true });
      });
      const { chromium } = await import("playwright");
      const browser = await chromium.launch();
      onTestFinished(async () => browser.close());
      const page = await browser.newPage();
      const publicUrl = "https://partner.microsoft.com/dashboard/draft/42";
      const url = `${publicUrl}?view=build#delivery`;
      await page.route("**/*", (route) => {
        if (route.request().url() !== publicUrl) return route.abort();
        return route.fulfill({
          contentType: "text/html",
          body: `<p id="draft">42</p><p id="status">Uploaded</p><p id="condition">Clear</p>
            <form action="/submit" method="post"><button id="submit">Submit</button></form>
            <output>0</output><script>
              document.querySelector("form").onsubmit = event => {
                event.preventDefault();
                const log = document.querySelector("output");
                log.textContent = Number(log.textContent) + 1;
              };
            </script>`,
        });
      });
      await page.goto(publicUrl);
      await page.evaluate((exact) => history.replaceState(null, "", exact), url);
      const cdp = await page.context().newCDPSession(page);
      const { frameTree } = await cdp.send("Page.getFrameTree");
      const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
        frameId: frameTree.frame.id,
        worldName: "submission-approval",
      });
      const manager = new BrowserHostManager(() => null);
      const sessionId = "agents-surface-workflow";
      const { session, webContents } = createMockSession({
        sessionId,
        key: "project-1::" + sessionId,
        profileId: "work",
        partition: "persist:tabs-browser:profile:work",
        currentUrl: url,
      });
      Object.assign(webContents, {
        getURL: () => page.url(),
        isLoadingMainFrame: () => session.loading,
        session: { storagePath: join(userData, "Partitions", "work") },
        executeJavaScriptInIsolatedWorld: async (_world: number, [script]: { code: string }[]) => {
          const evaluated = await cdp.send("Runtime.evaluate", {
            expression: script!.code,
            contextId: executionContextId,
            returnByValue: true,
          });
          if (evaluated.exceptionDetails)
            throw new Error(
              evaluated.exceptionDetails.exception?.description ?? evaluated.exceptionDetails.text,
            );
          return evaluated.result.value;
        },
      });
      (manager as unknown as { sessions: Map<string, unknown> }).sessions.set(session.key, session);
      const owner = {
        projectId: session.projectId,
        sessionId,
        taskId: "workflow-thread",
      };
      const definition = {
        url,
        identitySelector: "#draft",
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
          selector: "#condition",
          pauseText: "Replacing",
          clearText: "Clear",
        },
      };
      await manager.runAutomation({
        ...owner,
        source: "human",
        operation: "authorizeBrowserPage",
        input: { url, profileId: "work" },
      });
      const workflowId = "a".repeat(64);
      const run = (phase: "inspect" | "submit", target?: unknown, id = workflowId) =>
        manager.runAutomation({
          ...owner,
          source: "agent",
          operation: "browserWorkflow",
          input: {
            phase,
            profileId: "work",
            definition:
              phase === "inspect" && !target ? { ...definition, url: publicUrl } : definition,
            target,
            ...(target === undefined ? {} : { workflowId: id }),
          },
        });
      const state = () => manager.getSessionState(owner.projectId, owner.sessionId);
      const humanApproval = (
        approvalId: string,
        source = "human" as "human" | "agent",
        taskId = owner.taskId,
      ) =>
        manager.runAutomation({
          ...owner,
          taskId,
          source,
          operation: "authorizeBrowserSubmission",
          input: { approvalId },
        });
      await expect(
        manager.runAutomation({
          ...owner,
          source: "agent",
          operation: "status",
        }),
      ).resolves.toMatchObject({ url: publicUrl });
      const firstInspection = await run("inspect");
      expect(firstInspection).toMatchObject({
        resolvedDraftUrl: url,
        observation: { stage: "uploaded", breakpoint: "clear" },
      });
      const { target } = firstInspection as { target: unknown };
      await expect(
        manager.runAutomation({
          ...owner,
          source: "agent",
          operation: "browserWorkflow",
          input: {
            phase: "inspect",
            profileId: "work",
            definition: { ...definition, url: publicUrl },
            target,
            workflowId,
          },
        }),
      ).rejects.toThrow("selected persistent browser profile");
      expect(state().pendingSubmissionApproval).toBeUndefined();
      await expect(run("submit", target)).resolves.toMatchObject({
        disposition: "observed",
        observation: { submitAvailable: false, submitRequiresUser: true },
        submissionApproved: false,
      });
      expect(state()).toMatchObject({ submissionGuardActive: true });
      expect(state().pendingSubmissionApproval).toBeUndefined();
      expect(await page.locator("output").innerText()).toBe("0");

      await page.locator("form").evaluate((form) => {
        form.setAttribute("data-tabs-submit-idempotency", "attempt_key");
        form.insertAdjacentHTML(
          "beforeend",
          '<input type="hidden" name="attempt_key" value="original-disposable-key">',
        );
      });
      await run("inspect", target);
      const first = state().pendingSubmissionApproval!;
      expect(first).toMatchObject({
        resourceId: "42",
        url,
        controlLabel: "Submit",
        workflowId,
      });
      await expect(humanApproval(first.id, "agent")).rejects.toThrow("Review the current draft");
      await expect(humanApproval(first.id, "human", "other-thread")).rejects.toThrow(
        "Review the current draft",
      );
      await page
        .locator("#submit")
        .evaluate((button) => button.replaceWith(button.cloneNode(true)));
      await expect(humanApproval(first.id)).rejects.toThrow("Submit control changed");
      await run("inspect", target);
      const replacement = state().pendingSubmissionApproval!;
      expect(replacement.id).not.toBe(first.id);
      await expect(humanApproval(replacement.id)).resolves.toEqual({
        approved: true,
        workflowId,
      });
      await expect(humanApproval(replacement.id)).resolves.toEqual({
        approved: true,
        workflowId,
      });
      await expect(run("submit", target, "b".repeat(64))).resolves.toMatchObject({
        disposition: "observed",
        submissionApproved: false,
      });
      expect(await page.locator("output").innerText()).toBe("0");
      await run("inspect", target);
      const approvedDraft = state().pendingSubmissionApproval!;
      await humanApproval(approvedDraft.id);
      await expect(run("inspect", target)).resolves.toMatchObject({
        submissionApproved: true,
      });
      await page.locator("form").evaluate((form) => form.setAttribute("action", "/other-draft"));
      await expect(run("submit", target)).resolves.toMatchObject({
        disposition: "observed",
        submissionApproved: false,
      });
      expect(await page.locator("output").innerText()).toBe("0");

      const changedDestination = state().pendingSubmissionApproval!;
      expect(changedDestination.id).not.toBe(approvedDraft.id);
      await humanApproval(changedDestination.id);
      await page.locator("#condition").evaluate((condition) => {
        condition.textContent = "Replacing";
      });
      await expect(run("submit", target)).resolves.toMatchObject({
        observation: { breakpoint: "matched" },
      });
      expect(state().controller).toBe("human");
      expect(await page.locator("output").innerText()).toBe("0");

      await page.locator("#condition").evaluate((condition) => {
        condition.textContent = "Clear";
      });
      await manager.resumeAgent(owner);
      await run("inspect", target);
      await humanApproval(state().pendingSubmissionApproval!.id);
      manager.takeControl(owner);
      await expect(run("submit", target)).rejects.toThrow("Approve");
      await manager.resumeAgent(owner);
      await expect(run("submit", target)).resolves.toMatchObject({
        disposition: "observed",
      });
      expect(await page.locator("output").innerText()).toBe("0");

      await page.locator('input[name="attempt_key"]').evaluate((input) => input.remove());
      await expect(run("inspect", target)).resolves.toMatchObject({
        observation: { submitAvailable: false },
        reason: "Submit needs the site's unique, enabled submission key.",
      });
      expect(state().pendingSubmissionApproval).toBeUndefined();
      await page
        .locator("form")
        .evaluate((form) =>
          form.insertAdjacentHTML(
            "beforeend",
            '<input type="hidden" name="attempt_key" value="original-disposable-key">',
          ),
        );
      await run("inspect", target);
      const keyed = state().pendingSubmissionApproval!;
      expect(keyed.siteSubmissionKey).toBe(true);
      expect(JSON.stringify(keyed)).not.toContain("original-disposable-key");
      await humanApproval(keyed.id);
      await page.locator('input[name="attempt_key"]').evaluate((input: HTMLInputElement) => {
        input.value = "replacement-disposable-key";
      });
      await expect(run("submit", target)).resolves.toMatchObject({
        disposition: "observed",
        submissionApproved: false,
      });
      expect(await page.locator("output").innerText()).toBe("0");
      expect(state().pendingSubmissionApproval?.id).not.toBe(keyed.id);
      await humanApproval(state().pendingSubmissionApproval!.id);
      await expect(run("submit", target)).resolves.toMatchObject({
        disposition: "dispatched",
      });
      await expect(run("submit", target)).resolves.toMatchObject({
        disposition: "observed",
        submissionApproved: false,
      });
      expect(await page.locator("output").innerText()).toBe("1");
    },
  );

  it.skipIf(process.env.TABS_QA_BROWSER !== "1").each(["staged", "on selection"] as const)(
    "guards build upload %s and sends the approved bytes only to Work",
    async (mode) => {
      const fixture = new URL(
        "../../server/scripts/fixtures/browserSubmission.ts",
        import.meta.url,
      );
      const {
        startBrowserSubmission,
      }: {
        startBrowserSubmission: (
          port: number,
          staged: boolean,
          options?: { uploadOnSelect?: boolean },
        ) => Promise<{
          origin: string;
          definition: BrowserWorkflowDefinition;
          uploads: Record<"Work" | "Personal", Buffer[]>;
          drafts: { Work: { submits: number } };
          close: () => Promise<void>;
        }>;
      } = await import(fixture.href);
      const { chromium } = await import("playwright");
      const direct = mode === "on selection";
      const site = await startBrowserSubmission(0, !direct, {
        uploadOnSelect: direct,
      });
      onTestFinished(() => site.close());
      const browser = await chromium.launch();
      onTestFinished(() => browser.close());
      const [page, personal] = await Promise.all([browser.newPage(), browser.newPage()]);
      await Promise.all([
        page.goto(site.origin + "/Work"),
        personal.goto(site.origin + "/Personal"),
      ]);
      const userData = await mkdtemp(join(tmpdir(), "tabs-browser-upload-"));
      const dataPath = vi.spyOn(app, "getPath").mockReturnValue(userData);
      onTestFinished(async () => {
        dataPath.mockRestore();
        await rm(userData, { recursive: true, force: true });
      });
      const cdp = await page.context().newCDPSession(page);
      const { frameTree } = await cdp.send("Page.getFrameTree");
      const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
        frameId: frameTree.frame.id,
        worldName: "upload-approval",
      });
      const manager = new BrowserHostManager(() => null);
      const sessionId = "agents-surface-staged-upload";
      const { session, webContents } = createMockSession({
        sessionId,
        key: "project-1::" + sessionId,
        profileId: "work",
        partition: "persist:tabs-browser:profile:work",
        currentUrl: site.definition.url,
      });
      Object.assign(webContents, {
        getURL: () => page.url(),
        session: { storagePath: join(userData, "Partitions", "work") },
        executeJavaScriptInIsolatedWorld: async (_world: number, [script]: { code: string }[]) => {
          const evaluated = await cdp.send("Runtime.evaluate", {
            expression: script!.code,
            contextId: executionContextId,
            returnByValue: true,
          });
          if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.text);
          return evaluated.result.value;
        },
      });
      (manager as unknown as { sessions: Map<string, unknown> }).sessions.set(session.key, session);
      const owner = {
        projectId: session.projectId,
        sessionId,
        taskId: "workflow-thread",
      };
      const { definition } = site;
      await manager.runAutomation({
        ...owner,
        source: "human",
        operation: "authorizeBrowserPage",
        input: { url: definition.url, profileId: "work" },
      });
      const workflowId = "b".repeat(64);
      const run = (phase: "inspect" | "upload" | "submit", target?: unknown) =>
        manager.runAutomation({
          ...owner,
          source: "agent",
          operation: "browserWorkflow",
          input: {
            phase,
            profileId: "work",
            definition,
            ...(target === undefined ? {} : { target, workflowId }),
          },
        });
      const fileInput = page.getByLabel("Build package");
      const staged = Buffer.from("disposable signed build payload");
      const setFile = (name: string, buffer: Buffer) =>
        fileInput.setInputFiles({
          name,
          buffer,
          mimeType: "application/octet-stream",
        });
      if (!direct) await setFile("build-42.appx", staged);
      const { target } = (await run("inspect")) as { target: unknown };
      const state = () => manager.getSessionState(owner.projectId, owner.sessionId);
      const selectedFile = {
        name: "build-42.appx",
        type: "application/octet-stream",
        bytes: new Uint8Array(staged),
      };
      const approve = (includeFile = direct) =>
        manager.runAutomation({
          ...owner,
          source: "human",
          operation: "authorizeBrowserSubmission",
          input: {
            approvalId: state().pendingSubmissionApproval!.id,
            ...(includeFile && { selectedFile }),
          },
        });
      await run("inspect", target);
      expect(state().pendingSubmissionApproval).toMatchObject(
        direct
          ? { action: "upload", chooseUploadFile: true }
          : {
              action: "upload",
              controlLabel: "Upload build",
              uploadFile: { name: "build-42.appx", size: staged.length },
            },
      );
      const assertNoRequests = async () => {
        expect(site.uploads.Work).toHaveLength(0);
        expect(site.uploads.Personal).toHaveLength(0);
        if (direct) {
          expect(await fileInput.evaluate((input: HTMLInputElement) => input.files?.length)).toBe(
            0,
          );
          expect(await page.locator("#build-status").getAttribute("data-file-events")).toBe("");
        }
      };
      await expect(run("submit", target)).resolves.toMatchObject({
        disposition: "observed",
      });
      await expect(run("upload", target)).resolves.toMatchObject({
        disposition: "observed",
      });
      await assertNoRequests();

      if (direct) await expect(approve(false)).rejects.toThrow("Choose one readable file");
      await approve();
      if (direct) {
        await expect(run("submit", target)).resolves.toMatchObject({
          disposition: "observed",
        });
        await assertNoRequests();
        await fileInput.evaluate((input) => input.replaceWith(input.cloneNode()));
      } else {
        await setFile("build-42.appx", Buffer.alloc(staged.length, 120));
      }
      await expect(run("upload", target)).resolves.toMatchObject({
        disposition: "observed",
      });
      await assertNoRequests();
      if (!direct) await setFile("build-42.appx", staged);
      await run("inspect", target);
      await approve();
      await page.locator("#replacement").evaluate((node) => {
        node.textContent = "Replace existing build";
      });
      await expect(run("upload", target)).resolves.toMatchObject({
        disposition: "observed",
        observation: { stage: "ready_to_upload", breakpoint: "matched" },
      });
      await assertNoRequests();
      expect(state().controller).toBe("human");
      await page.locator("#replacement").evaluate((node) => {
        node.textContent = "No existing build";
      });
      await manager.resumeAgent(owner);
      await run("inspect", target);
      await approve();
      await expect(run("upload", target)).resolves.toMatchObject({
        disposition: "dispatched",
      });
      await page.getByText("Uploaded", { exact: true }).waitFor();
      if (direct) {
        await expect(run("upload", target)).resolves.toMatchObject({
          disposition: "observed",
        });
      }
      expect(site.uploads.Work).toHaveLength(1);
      expect(site.uploads.Work[0]!.includes(staged)).toBe(true);
      expect(site.uploads.Personal).toHaveLength(0);
      expect(await personal.locator("#build-status").innerText()).toBe("Ready to upload");
      expect(site.drafts.Work.submits).toBe(0);
      if (direct) {
        expect(await page.locator("#build-status").getAttribute("data-file-events")).toBe(
          "input change ",
        );
      }
    },
    60_000,
  );

  describe("saved browser workflow results", () => {
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

    describe("Partner Center status consent", () => {
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

      it("proposes exact read-only consent, accepts it from the original thread, and consumes it once", async () => {
        const f = await setupStatus();
        await expect(f.status()).rejects.toThrow("Approve access");
        expect(f.evaluate).not.toHaveBeenCalled();
        await f.grant();
        await expect(
          f.manager.runAutomation({
            ...f.agent,
            source: "human",
            input: f.input,
          }),
        ).rejects.toThrow("original tab and thread");
        const { status, approval } = await f.status();
        expect(status).toBe("approval_required");
        expect(approval).toEqual({
          id: expect.any(String),
          workflowId: f.input.workflowId,
          applicationId: f.input.applicationId,
          tenantId: f.input.tenantId,
          clientId: f.input.clientId,
          submissionId: f.input.definition.resourceId,
        });
        expect(f.pending()).toEqual(approval);
        await expect(f.status()).resolves.toEqual({ status, approval });
        for (const override of [{ source: "agent" }, { taskId: "another-thread" }] as const)
          await expect(
            f.manager.runAutomation({
              ...f.human,
              ...override,
              input: { approvalId: approval.id },
            }),
          ).rejects.toThrow("original tab and thread");
        await expect(f.consent("stale-id")).rejects.toThrow("original tab and thread");
        await expect(f.consent(approval.id)).resolves.toEqual({
          approved: true,
          approval,
        });
        expect(f.pending()).toBeUndefined();

        for (const change of [
          { applicationId: "different-app" },
          { tenantId: f.input.clientId },
          { clientId: f.input.tenantId },
          { workflowId: "b".repeat(64) },
          { definition: { ...f.input.definition, resourceId: "43" } },
        ])
          await expect(f.status(change)).rejects.toThrow("different request");

        const outcomes = await Promise.allSettled([f.status(), f.status()]);
        expect(outcomes).toContainEqual({
          status: "fulfilled",
          value: { status: "approved", approval },
        });
        expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
        await expect(
          f.status({
            verifyApprovalId: "44444444-4444-4444-8444-444444444444",
          }),
        ).rejects.toThrow("original tab and thread");
        await expect(f.status({ verifyApprovalId: approval.id })).resolves.toEqual({
          status: "approved",
          approval,
        });
        const next = await f.status();
        expect(next.status).toBe("approval_required");
        expect(next.approval.id).not.toBe(approval.id);
        await expect(f.consent(approval.id)).rejects.toThrow("original tab and thread");
        await expect(f.status({ verifyApprovalId: approval.id })).resolves.toEqual({
          status: "approved",
          approval,
        });
        f.manager.takeControl(f.request);
        await expect(f.status({ verifyApprovalId: approval.id })).rejects.toThrow(
          "original tab and thread",
        );
        expect(f.evaluate.mock.calls.every(([world]) => world === 999)).toBe(true);
        expect(new Set(f.querySelectorAll.mock.calls.map(([selector]) => selector))).toEqual(
          new Set(["*", "#draft-id"]),
        );
        expect(f.executeJavaScript).not.toHaveBeenCalled();
        expect(f.loadURL).not.toHaveBeenCalled();
        expect(f.submit).not.toHaveBeenCalled();
      });

      it("requires the saved target, exact HTTPS Partner Center URL and a unique visible Store ID", async () => {
        const f = await setupStatus();
        await f.grant();
        for (const target of [
          { ...f.input.target, projectId: "another-project" },
          {
            ...f.input.target,
            tabId: PreviewTabId.make("agents-surface-another"),
          },
          { ...f.input.target, profileId: "another-profile" },
          { ...f.input.target, hostKey: "another-host" },
        ])
          await expect(f.status({ target })).rejects.toThrow("original desktop browser tab");
        for (const url of [
          "http://partner.microsoft.com/submissions/42",
          "https://partner.microsoft.com.evil.test/submissions/42",
          "https://partner.microsoft.com:444/submissions/42",
          "https://user@partner.microsoft.com/submissions/42",
        ])
          await expect(f.status({ definition: { ...f.input.definition, url } })).rejects.toThrow(
            "exact HTTPS Partner Center URL",
          );
        await expect(
          f.status({
            definition: { ...f.input.definition, resourceId: "invalid id" },
          }),
        ).rejects.toThrow("Store submission ID");
        await expect(
          f.status({
            definition: {
              ...f.input.definition,
              url: f.url + "&view=different",
            },
          }),
        ).rejects.toThrow("Approve access");
        expect(f.evaluate).not.toHaveBeenCalled();
        f.visible.hideIdentity = true;
        await expect(f.status()).rejects.toThrow("did not uniquely match");
        f.visible.hideIdentity = false;
        f.visible.duplicateIdentity = true;
        await expect(f.status()).rejects.toThrow("did not uniquely match");
        expect(f.pending()).toBeUndefined();
      });

      it("checks the visible draft again at both approval and consumption", async () => {
        const f = await setupStatus();
        await f.grant();
        const first = await f.status();
        f.visible.identity = "43";
        await expect(f.consent(first.approval.id)).rejects.toThrow("did not uniquely match");
        expect(f.pending()).toBeUndefined();
        f.visible.identity = "42";
        const current = await f.status();
        await f.consent(current.approval.id);
        f.visible.identity = "43";
        await expect(f.status()).rejects.toThrow("did not uniquely match");
        f.visible.identity = "42";
        await expect(f.status()).resolves.toMatchObject({
          status: "approval_required",
        });
      });

      it.each([
        "browser generation",
        "document generation",
        "page grant replacement",
        "page grant revocation",
        "account route",
      ])("rejects stale consent after a change to %s", async (change) => {
        const f = await setupStatus();
        await f.grant();
        const { approval } = await f.status();
        if (change === "browser generation") f.session.instanceId = "replacement-browser";
        if (change === "document generation") f.events.emit("did-navigate", {}, f.url);
        if (change === "page grant replacement") await f.grant();
        if (change === "page grant revocation")
          await f.manager.runAutomation({
            ...f.human,
            operation: "revokeBrowserPage",
          });
        if (change === "account route") {
          f.events.emit(
            "did-navigate-in-page",
            {},
            f.url.replace("account=work", "account=personal"),
            true,
          );
          f.events.emit("did-navigate-in-page", {}, f.url, true);
        }
        expect(f.pending()).toBeUndefined();
        await expect(f.consent(approval.id)).rejects.toThrow("original tab and thread");
      });

      it("rejects an approval if the control epoch changes during the isolated read", async () => {
        const f = await setupStatus();
        await f.grant();
        const { approval } = await f.status();
        f.evaluate.mockImplementationOnce(async () => {
          f.manager.takeControl(f.human);
          await f.manager.resumeAgent(f.human);
          return true;
        });
        await expect(f.consent(approval.id)).rejects.toThrow("original tab and thread");
        expect(f.pending()).toBeUndefined();
        await expect(f.status()).resolves.toMatchObject({
          status: "approval_required",
        });
      });
    });

    describe("monitor", () => {
      it("advertises only a live tab with an active page grant", async () => {
        const f = await setup();
        expect(f.manager.listBrowserWorkflowTabs()).toEqual([]);
        await f.authorize();
        const expected = [
          {
            threadId: f.request.taskId,
            tabId: f.request.sessionId,
            workflowHostKey: f.saved.target.hostKey,
          },
        ];
        expect(f.manager.listBrowserWorkflowTabs()).toEqual(expected);
        f.manager.takeControl(f.request);
        expect(f.manager.listBrowserWorkflowTabs()).toEqual([]);
        await f.manager.resumeAgent(f.request);
        expect(f.manager.listBrowserWorkflowTabs()).toEqual(expected);
        await f.manager.runAutomation({
          ...f.request,
          operation: "revokeBrowserPage",
        });
        expect(f.manager.listBrowserWorkflowTabs()).toEqual([]);
      });

      it("reads the trusted status without activating the tab, inspecting Submit, or changing controls", async () => {
        const f = await setup();
        await f.authorize();
        f.visible.status = "Uploaded";
        const epoch = f.session.controlEpoch;
        const takeControl = vi.spyOn(f.manager, "takeControl");

        await expect(f.monitor()).resolves.toEqual({
          disposition: "observed",
          target: f.saved.target,
          observation: {
            stage: "uploaded",
            statusText: "Uploaded",
            breakpoint: "irrelevant",
            submitAvailable: false,
            identityText: expect.stringMatching(/\S/),
          },
        });

        expect(f.evaluate.mock.calls.map(([world]) => world)).toEqual([999]);
        expect(f.querySelectorAll).not.toHaveBeenCalledWith("#submit");
        expect(f.querySelectorAll).not.toHaveBeenCalledWith("#replacement");
        expect(f.submit).not.toHaveBeenCalled();
        expect(f.executeJavaScript).not.toHaveBeenCalled();
        expect(f.sendInputEvent).not.toHaveBeenCalled();
        expect(f.loadURL).not.toHaveBeenCalled();
        expect(f.goToIndex).not.toHaveBeenCalled();
        expect(f.focus).not.toHaveBeenCalled();
        expect(f.setBounds).not.toHaveBeenCalled();
        expect(takeControl).not.toHaveBeenCalled();
        expect(f.session).toMatchObject({
          assignedTaskId: f.request.taskId,
          controller: "none",
          controlEpoch: epoch,
          actionTimeline: [],
        });
        const state = f.manager.getSessionState(f.request.projectId, f.request.sessionId);
        expect(state?.submissionGuardActive).toBe(false);
        expect(state?.pendingSubmissionApproval).toBeUndefined();
      });

      it("requires the saved workflow ID, status-only request, exact target and original URL", async () => {
        const f = await setup();
        await f.authorize();
        for (const input of [
          { target: undefined },
          { workflowId: undefined },
          { statusOnly: false },
        ]) {
          await expect(f.monitor({ ...input, refresh: true })).rejects.toThrow("saved workflow");
        }
        await expect(
          f.manager.runAutomation({
            ...f.monitorRequest,
            source: "human",
            input: f.monitorInput,
          }),
        ).rejects.toThrow("saved workflow");
        for (const overrides of [
          { tabId: PreviewTabId.make("other-tab") },
          { projectId: "other-project" },
          { profileId: "other-profile" },
          { hostKey: "other-host" },
        ]) {
          await expect(
            f.monitor({
              target: { ...f.saved.target, ...overrides },
              refresh: true,
            }),
          ).rejects.toThrow("another browser host, profile or tab");
        }
        f.webContents.session.isPersistent.mockReturnValueOnce(false);
        await expect(f.monitor({ refresh: true })).rejects.toThrow("another browser host");
        f.session.currentUrl = f.url + "#other";
        await expect(f.monitor({ refresh: true })).rejects.toThrow("original workflow URL");
        expect(f.evaluate).not.toHaveBeenCalled();
        expect(f.loadURL).not.toHaveBeenCalled();
      });

      it("requires a live grant and discards status if the user revokes while it is being read", async () => {
        const f = await setup();
        await expect(f.monitor({ refresh: true })).rejects.toThrow("Approve access");
        expect(f.evaluate).not.toHaveBeenCalled();
        await f.authorize();
        f.evaluate.mockImplementationOnce(async () => {
          await f.manager.runAutomation({
            ...f.request,
            operation: "revokeBrowserPage",
          });
          return {
            disposition: "observed",
            observation: {
              stage: "certified",
              statusText: "Certified",
              breakpoint: "irrelevant",
              submitAvailable: false,
            },
          };
        });
        await expect(f.monitor({ refresh: true })).rejects.toThrow("Approve access");
        await expect(f.monitor()).rejects.toThrow("Approve access");
        expect(f.evaluate).toHaveBeenCalledOnce();
        expect(f.loadURL).not.toHaveBeenCalled();
      });

      it("checks protected content and draft identity before an opted-in exact URL refresh", async () => {
        const f = await setup();
        await f.authorize();
        f.visible.password = true;
        await expect(f.monitor({ refresh: true })).resolves.toMatchObject({
          disposition: "unobservable",
          reason: expect.stringContaining("Protected input"),
        });
        f.visible.password = false;
        f.visible.identity = "43";
        await expect(f.monitor({ refresh: true })).resolves.toMatchObject({
          disposition: "unobservable",
          reason: expect.stringContaining("visible draft ID"),
        });
        expect(f.loadURL).not.toHaveBeenCalled();

        f.visible.identity = "42";
        f.loadURL.mockImplementationOnce(async () => {
          f.visible.status = "Published";
          f.events.emit("did-navigate", {}, f.url);
        });
        await expect(f.monitor({ refresh: true })).resolves.toMatchObject({
          disposition: "observed",
          observation: { stage: "published" },
        });
        expect(f.loadURL).toHaveBeenCalledExactlyOnceWith(f.url);
        expect(f.submit).not.toHaveBeenCalled();
      });

      it("defers the refresh while the tab is visible and keeps an existing submission guard", async () => {
        const f = await setup();
        new BrowserSubmissionGuards(() => f.userData).set(f.session.partition, f.url, true);
        await f.authorize();
        Object.assign(f.manager, { activeKey: f.session.key });
        Object.assign(f.session, {
          bounds: { x: 0, y: 0, width: 800, height: 600 },
        });
        await expect(f.monitor({ refresh: true })).resolves.toMatchObject({
          disposition: "observed",
          observation: { stage: "certified" },
        });
        expect(f.loadURL).not.toHaveBeenCalled();
        expect(new BrowserSubmissionGuards(() => f.userData).has(f.session.partition, f.url)).toBe(
          true,
        );
      });

      it("blocks off-URL redirects during a refresh and yields to a new page navigation", async () => {
        const f = await setup();
        await f.authorize();
        const other = "https://app.test/other-draft";
        const preventDefault = vi.fn();
        f.loadURL.mockImplementationOnce(async () => {
          f.events.emit("will-redirect", {
            isMainFrame: true,
            url: other,
            preventDefault,
          });
        });
        await expect(f.monitor({ refresh: true })).rejects.toThrow(
          "refresh the original workflow URL",
        );
        expect(preventDefault).toHaveBeenCalledOnce();
        expect(f.stop).toHaveBeenCalledOnce();
        preventDefault.mockClear();
        f.stop.mockClear();

        f.loadURL.mockImplementationOnce(async () => {
          f.events.emit("will-navigate", { url: other, preventDefault });
        });
        await expect(f.monitor({ refresh: true })).rejects.toThrow(
          "refresh the original workflow URL",
        );
        expect(preventDefault).not.toHaveBeenCalled();
        expect(f.stop).not.toHaveBeenCalled();
        expect(f.evaluate).toHaveBeenCalledTimes(2);
      });
    });

    it("returns only the live stage without reloading, submitting, or giving agent access", async () => {
      const f = await setup();
      const guards = new BrowserSubmissionGuards(() => f.userData);
      guards.set(f.session.partition, f.url, true);
      await expect(f.enter()).resolves.toEqual({ stage: "certified" });
      expect(f.evaluate).toHaveBeenCalledTimes(1);
      expect(f.evaluate.mock.calls[0]![0]).toBe(999);
      expect(f.goToIndex).not.toHaveBeenCalled();
      expect(f.loadURL).not.toHaveBeenCalled();
      expect(f.submit).not.toHaveBeenCalled();
      expect(f.sendInputEvent).not.toHaveBeenCalled();
      expect(f.session).toMatchObject({
        assignedTaskId: null,
        controller: "none",
        controlEpoch: 0,
        userRetained: false,
        actionTimeline: [],
      });
      expect(f.manager.getSessionState(f.request.projectId, f.request.sessionId)).toMatchObject({
        browserPageAuthorized: false,
        deviceScreenshotAuthorized: false,
        submissionGuardActive: true,
      });
      f.visible.status = "Uploaded";
      await expect(f.enter({ ...f.saved, stage: "uploaded" })).resolves.toEqual({
        stage: "uploaded",
      });
      expect(f.querySelectorAll).not.toHaveBeenCalledWith("#submit");
      expect(f.querySelectorAll).not.toHaveBeenCalledWith("#replacement");
      expect(f.submit).not.toHaveBeenCalled();
    });

    it("requires a human and the exact existing tab, project, profile and host storage", async () => {
      const f = await setup();
      const { source, sessionId, ...request } = f.request;
      for (const invalid of [
        { ...f.request, source: "agent" as const },
        { ...request, sessionId },
        { ...f.request, taskId: "" },
        { ...request, source },
      ]) {
        await expect(f.manager.runAutomation({ ...invalid, input: f.saved })).rejects.toThrow(
          "from its thread",
        );
      }
      await expect(
        f.manager.runAutomation({
          ...f.request,
          sessionId: "absent",
          input: f.saved,
        }),
      ).rejects.toThrow("session was not found");
      for (const overrides of [
        { tabId: PreviewTabId.make("other") },
        { projectId: "another-project" },
        { profileId: "personal" },
        { hostKey: "another-host" },
      ]) {
        await expect(
          f.enter({ ...f.saved, target: { ...f.saved.target, ...overrides } }),
        ).rejects.toThrow("original desktop browser tab and profile");
      }
      f.webContents.session.isPersistent.mockReturnValueOnce(false);
      await expect(f.enter()).rejects.toThrow("original desktop browser tab and profile");
      const recordedPath = join(f.userData, "Partitions", "work");
      Object.assign(f.webContents.session, {
        storagePath: recordedPath + "-different",
      });
      await expect(f.enter()).rejects.toThrow("original desktop browser tab and profile");
      Object.assign(f.webContents.session, { storagePath: recordedPath });
      await unlink(join(f.userData, "browser-workflow-host-id"));
      await expect(f.enter()).rejects.toThrow("original desktop browser tab and profile");
      expect(() => browserWorkflowHostKey(f.userData, recordedPath, false)).toThrow("ENOENT");
      expect(f.evaluate).not.toHaveBeenCalled();
      expect(f.loadURL).not.toHaveBeenCalled();
    });

    it("rejects tabs assigned to a different thread before reading or navigating", async () => {
      const f = await setup();
      Object.assign(f.session, { assignedTaskId: "another-thread" });
      await expect(f.enter()).rejects.toThrow("another thread");
      expect(f.evaluate).not.toHaveBeenCalled();
      expect(f.loadURL).not.toHaveBeenCalled();
      Object.assign(f.session, { assignedTaskId: f.request.taskId });
      await expect(f.enter()).resolves.toEqual({ stage: "certified" });
      expect(f.session.assignedTaskId).toBe(f.request.taskId);
    });

    it("opens the exact saved URL from a blank guest", async () => {
      const f = await setup("about:blank");
      await expect(f.enter()).resolves.toEqual({ stage: "certified" });
      expect(f.loadURL).toHaveBeenCalledExactlyOnceWith(f.url);
      expect(f.session.assignedTaskId).toBeNull();
    });

    it("leaves a tab with a queued agent action on its current page", async () => {
      const f = await setup("https://app.test/work");
      Object.assign(f.session, {
        actionTimeline: [
          {
            id: "queued",
            action: "submit",
            status: "running",
            startedAt: new Date().toISOString(),
          },
        ],
      });
      await expect(f.enter()).rejects.toThrow("already in use");
      expect(f.loadURL).not.toHaveBeenCalled();
      expect(f.evaluate).not.toHaveBeenCalled();
    });

    it("loads the exact saved URL as a new request to avoid replaying a history form submission", async () => {
      const current = "https://app.test/draft/42";
      const f = await setup(current, [current + "?view=review", current]);
      await expect(f.enter()).resolves.toEqual({ stage: "certified" });
      expect(f.goToIndex).not.toHaveBeenCalled();
      expect(f.loadURL).toHaveBeenCalledExactlyOnceWith(f.url);
    });

    it("awaits an in-progress load of the saved URL without starting a new one", async () => {
      const f = await setup();
      f.session.loading = true;
      const opening = f.enter();
      expect(f.evaluate).not.toHaveBeenCalled();
      Object.assign(f.webContents, { isLoadingMainFrame: () => false });
      f.events.emit("did-finish-load");
      await expect(opening).resolves.toEqual({ stage: "certified" });
      expect(f.loadURL).not.toHaveBeenCalled();
    });

    it("checks the pending Submit receipt with a new GET even at the original URL", async () => {
      const f = await setup();
      f.visible.status = "Uploaded";
      f.loadURL.mockImplementationOnce(async (url) => {
        expect(url).toBe(f.url);
        f.visible.status = "Submitted";
        f.events.emit("did-navigate", {}, url);
      });
      await expect(
        f.enter({ ...f.saved, stage: "uploaded", pendingAction: "submit" }),
      ).resolves.toEqual({ stage: "submitted" });
      expect(f.loadURL).toHaveBeenCalledExactlyOnceWith(f.url, {
        extraHeaders: "Cache-Control: no-cache\n",
      });
      expect(f.goToIndex).not.toHaveBeenCalled();
      expect(f.submit).not.toHaveBeenCalled();
      expect(f.manager.getSessionState(f.request.projectId, f.request.sessionId)).toMatchObject({
        browserPageAuthorized: false,
      });
    });

    it.each(["chrome-error://chromewebdata/", "https://app.test/submit"])(
      "can check a pending Submit from a Chromium error document at %s",
      async (currentUrl) => {
        const f = await setup(currentUrl);
        f.visible.documentUrl = "chrome-error://chromewebdata/";
        const input = {
          ...f.saved,
          stage: "uploaded",
          pendingAction: "submit",
        } as const;
        await expect(f.enter(input)).rejects.toThrow("protected content");
        for (const failedUrl of ["https://another-app.test/submit", "https://app.test/login"]) {
          f.events.emit("did-fail-load", {}, -324, "ERR_EMPTY_RESPONSE", failedUrl, true);
          f.session.currentUrl = currentUrl;
          await expect(f.enter(input)).rejects.toThrow("protected content");
        }
        expect(f.loadURL).not.toHaveBeenCalled();
        f.events.emit(
          "did-fail-load",
          {},
          -324,
          "ERR_EMPTY_RESPONSE",
          "https://app.test/submit",
          true,
        );
        f.session.currentUrl = currentUrl;
        f.loadURL.mockImplementationOnce(async (url) => {
          f.session.currentUrl = url;
          f.visible.documentUrl = undefined;
          f.visible.status = "Submitted";
          f.events.emit("did-navigate", {}, url);
        });
        await expect(f.enter(input)).resolves.toEqual({ stage: "submitted" });
        expect(f.loadURL).toHaveBeenCalledExactlyOnceWith(f.url, {
          extraHeaders: "Cache-Control: no-cache\n",
        });
        expect(f.submit).not.toHaveBeenCalled();
      },
    );

    it("checks a pending Upload without reloading a staged file on the same page", async () => {
      const f = await setup();
      f.visible.status = "Ready to upload";
      await expect(
        f.enter({
          ...f.saved,
          definition: {
            ...f.saved.definition,
            uploadSelector: "#upload",
            states: {
              ...f.saved.definition.states,
              ready_to_upload: "Ready to upload",
            },
          },
          stage: "ready_to_upload",
          pendingAction: "upload",
        }),
      ).resolves.toEqual({ stage: "ready_to_upload" });
      expect(f.loadURL).not.toHaveBeenCalled();
    });

    it("blocks off-URL main-frame redirects and rejects an unexpected final URL", async () => {
      const f = await setup("about:blank");
      const wrongUrl = f.url + "#changed";
      const preventDefault = vi.fn();
      f.loadURL.mockImplementationOnce(async () => {
        f.events.emit("will-redirect", {
          isMainFrame: false,
          url: wrongUrl,
          preventDefault,
        });
        expect(preventDefault).not.toHaveBeenCalled();
        f.events.emit("will-redirect", {
          isMainFrame: true,
          url: wrongUrl,
          preventDefault,
        });
      });
      await expect(f.enter()).rejects.toThrow("exact saved result URL");
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(f.events.listenerCount("will-redirect")).toBe(1);
      f.loadURL.mockImplementationOnce(async () => {
        f.session.currentUrl = wrongUrl;
      });
      await expect(f.enter()).rejects.toThrow("exact saved result URL");
      expect(f.evaluate).not.toHaveBeenCalled();
    });

    it("cancels a timed-out load before releasing the redirect guard", async () => {
      const f = await setup("about:blank");
      vi.useFakeTimers();
      try {
        f.loadURL.mockReturnValueOnce(new Promise<void>(() => {}));
        f.stop.mockImplementationOnce(() => {
          expect(f.events.listenerCount("will-redirect")).toBe(2);
        });
        const rejected = expect(f.enter()).rejects.toThrow("exact saved result URL");
        await vi.advanceTimersByTimeAsync(10_000);
        await rejected;
        expect(f.stop).toHaveBeenCalledOnce();
        expect(f.events.listenerCount("will-redirect")).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("rejects auth, protected content, the wrong visible draft and stale status", async () => {
      const f = await setup();
      const login = "https://accounts.google.com/signin";
      await expect(
        f.enter({
          ...f.saved,
          definition: { ...f.saved.definition, url: login },
        }),
      ).rejects.toThrow("protected content");
      f.session.currentUrl = login;
      await expect(f.enter()).rejects.toThrow("protected content");
      expect(f.evaluate).not.toHaveBeenCalled();
      f.session.currentUrl = "https://app.test/another";
      f.visible.password = true;
      await expect(f.enter()).rejects.toThrow("protected content");
      f.session.currentUrl = f.url;
      await expect(f.enter()).rejects.toThrow("protected content");
      await expect(
        f.enter({ ...f.saved, stage: "uploaded", pendingAction: "submit" }),
      ).rejects.toThrow("protected content");
      f.visible.password = false;
      f.visible.identity = "43";
      await expect(f.enter()).rejects.toThrow("visible draft ID");
      f.visible.identity = "42";
      f.visible.status = "Uploaded";
      await expect(f.enter()).rejects.toThrow("saved workflow stage");
      expect(f.loadURL).not.toHaveBeenCalled();
      expect(f.submit).not.toHaveBeenCalled();
    });

    it("rejects a receipt from the outgoing document during a same-URL navigation", async () => {
      const f = await setup();
      const evaluate = f.evaluate.getMockImplementation()!;
      f.evaluate.mockImplementationOnce(async (...args) => {
        const result = await evaluate(...args);
        f.events.emit("did-start-navigation", {
          isMainFrame: true,
          url: f.url,
        });
        return result;
      });
      await expect(f.enter()).rejects.toThrow("page changed");
      expect(f.submit).not.toHaveBeenCalled();
    });

    it.skipIf(process.env.TABS_QA_BROWSER !== "1")(
      "observes a read-only Chromium draft and rejects forged native and isolated writes",
      async () => {
        const f = await setup();
        const { chromium } = await import("playwright");
        const browser = await chromium.launch();
        onTestFinished(() => browser.close());
        const page = await browser.newPage();
        await page.route(f.url, (route) =>
          route.fulfill({
            contentType: "text/html",
            body: '<p id="draft-id">42</p><p id="status">Uploaded</p>',
          }),
        );
        await connectChromiumPage(page, f);
        Object.assign(f.webContents, { getURL: () => page.url() });
        f.loadURL.mockImplementationOnce(async (url) => {
          await page.goto(url);
          f.events.emit("did-navigate", {}, url);
        });

        const definition = {
          url: f.url,
          identitySelector: "#draft-id",
          resourceId: "42",
          statusSelector: "#status",
          readOnly: true,
          states: { uploaded: "Uploaded", submitted: "Submitted" },
        } satisfies BrowserWorkflowDefinition;
        const initial = {
          phase: "inspect",
          profileId: "work",
          definition: { ...definition, url: f.url.split("?")[0]! },
        };
        const run = (input: unknown) => f.manager.runAutomation({ ...f.monitorRequest, input });
        const guards = () => new BrowserSubmissionGuards(() => f.userData);
        const state = () => f.manager.getSessionState(f.request.projectId, f.request.sessionId);
        const observation = {
          stage: "uploaded",
          statusText: "Uploaded",
          breakpoint: "irrelevant",
          submitAvailable: false,
          identityText: "42",
        };
        const read = { disposition: "observed", observation };
        await expect(f.enter({ ...f.saved, definition, stage: "uploaded" })).resolves.toEqual({
          stage: "uploaded",
        });
        expect(f.loadURL).toHaveBeenCalledExactlyOnceWith(f.url);
        f.loadURL.mockClear();
        await expect(run(initial)).rejects.toThrow("Approve");
        await f.authorize();
        await expect(run(initial)).resolves.toEqual({
          ...read,
          resolvedDraftUrl: f.url,
          target: f.saved.target,
          submissionApproved: false,
        });
        const targeted = {
          ...initial,
          definition,
          target: f.saved.target,
          workflowId: f.monitorInput.workflowId,
        };
        const { readOnly: _readOnly, ...incompleteGuarded } = definition;
        await expect(run({ ...targeted, definition: incompleteGuarded })).rejects.toThrow();
        await expect(run({ ...initial, profileId: "personal" })).rejects.toThrow(
          "persistent browser profile",
        );
        await expect(f.monitor({ definition })).resolves.toEqual({
          ...read,
          target: f.saved.target,
        });

        const status = page.locator("#status");
        await status.evaluate((element) => element.after(element.cloneNode(true)));
        await expect(run(targeted)).resolves.toMatchObject({
          disposition: "unobservable",
        });
        await page
          .locator("#status")
          .last()
          .evaluate((element) => element.remove());
        await status.evaluate((element) => {
          element.textContent = "Submitted";
        });
        await expect(f.monitor({ definition })).resolves.toMatchObject({
          observation: { stage: "submitted" },
        });
        await status.evaluate((element) => {
          element.textContent = "Uploaded";
        });
        expect(guards().has(f.session.partition, f.url)).toBe(false);
        expect(state().pendingSubmissionApproval).toBeUndefined();
        expect(await page.locator("button, input, form").count()).toBe(0);

        await page.evaluate(() => {
          document.body.insertAdjacentHTML(
            "beforeend",
            `<p id="replacement">Clear</p>
             <form action="/submit" method="post" data-tabs-submit-idempotency="key">
               <input type="hidden" name="key" value="fixture-key">
               <button id="submit">Submit</button>
             </form>
             <input id="upload" type="file"><output>0</output>`,
          );
          const record = () => {
            const output = document.querySelector("output")!;
            output.textContent = String(Number(output.textContent) + 1);
          };
          document.querySelector("form")!.addEventListener("submit", (event) => {
            event.preventDefault();
            record();
          });
          document.querySelector("#upload")!.addEventListener("change", record);
        });
        const guarded: BrowserWorkflowDefinition = {
          ...f.saved.definition,
          uploadInputSelector: "#upload",
          states: { ...f.saved.definition.states, ready_to_upload: "Ready" },
        };
        const forged = { ...guarded, readOnly: true } as const;
        await run({ ...initial, definition: guarded });
        expect(guards().has(f.session.partition, f.url)).toBe(true);
        expect(state().pendingSubmissionApproval).toBeUndefined();
        // Even without a live approval, refreshing a guarded draft could lose its staged state.
        await expect(f.monitor({ definition, refresh: true })).resolves.toMatchObject(read);
        await expect(run({ ...targeted, phase: "refresh" })).resolves.toMatchObject(read);
        await run({ ...targeted, definition: guarded });
        const approval = state().pendingSubmissionApproval!;
        expect(approval).toMatchObject({
          controlLabel: "Submit",
          siteSubmissionKey: true,
        });
        await f.manager.runAutomation({
          ...f.request,
          operation: "authorizeBrowserSubmission",
          input: { approvalId: approval.id },
        });
        const approved = state().pendingSubmissionApproval;
        for (const phase of ["upload", "submit"]) {
          f.evaluate.mockClear();
          await expect(run({ ...targeted, phase, statusOnly: false })).rejects.toThrow(
            /read.only/i,
          );
          await expect(
            run({ ...targeted, phase, statusOnly: false, definition: forged }),
          ).rejects.toThrow();
          expect(f.evaluate).not.toHaveBeenCalled();
        }
        await expect(
          run({ ...targeted, phase: "enter", statusOnly: false }),
        ).resolves.toMatchObject(read);
        await expect(f.enter({ ...f.saved, definition, stage: "uploaded" })).resolves.toEqual({
          stage: "uploaded",
        });
        const evalScript = (code: string) => f.evaluate(999, [{ code }]);
        const binding = { currentId: approval.id, nextId: "forged-approval" };
        await expect(
          evalScript(browserWorkflowPageScript(forged, true, false, binding, "submit")),
        ).resolves.toEqual(read);
        await expect(run({ ...targeted, definition: guarded })).resolves.toMatchObject({
          submissionApproved: true,
        });
        expect(state().pendingSubmissionApproval).toEqual(approved);

        await status.evaluate((element) => {
          element.textContent = "Ready";
        });
        await expect(
          evalScript(
            browserWorkflowPageScript(guarded, false, false, { nextId: "upload" }, "upload"),
          ),
        ).resolves.toMatchObject({
          submitControlBinding: "bound",
          chooseUploadFile: true,
        });
        const uploadBinding = { currentId: "upload", nextId: "forged-upload" };
        await expect(
          evalScript(
            browserWorkflowPageScript(forged, true, false, uploadBinding, "upload", {
              name: "build.zip",
              type: "application/zip",
              base64: "Zml4dHVyZQ==",
            }),
          ),
        ).resolves.toEqual({
          disposition: "observed",
          observation: {
            ...observation,
            stage: "ready_to_upload",
            statusText: "Ready",
          },
        });
        await expect(
          evalScript(browserWorkflowPageScript(guarded, false, false, uploadBinding, "upload")),
        ).resolves.toMatchObject({ submitControlBinding: "retained" });
        expect(
          await page.locator("#upload").evaluate((input: HTMLInputElement) => input.files?.length),
        ).toBe(0);
        expect(await page.locator("output").innerText()).toBe("0");
        expect(guards().has(f.session.partition, f.url)).toBe(true);
        expect(f.loadURL).not.toHaveBeenCalled();
        expect(f.sendInputEvent).not.toHaveBeenCalled();
      },
    );

    it.skipIf(process.env.TABS_QA_BROWSER !== "1")(
      "opens a real Chromium receipt by visible draft ID and keeps Submit untouched",
      async () => {
        const f = await setup();
        const { chromium } = await import("playwright");
        const browser = await chromium.launch();
        try {
          const page = await browser.newPage();
          await page.route(f.url, (route) =>
            route.fulfill({
              contentType: "text/html",
              body: `<p id="draft-id">42</p><p id="status">Published</p>
              <button id="submit" onclick="this.textContent='Submitted again'">Submit</button>`,
            }),
          );
          await page.goto(f.url);
          const cdp = await page.context().newCDPSession(page);
          const { frameTree } = await cdp.send("Page.getFrameTree");
          const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
            frameId: frameTree.frame.id,
            worldName: "saved-receipt",
          });
          Object.assign(f.webContents, {
            getURL: () => page.url(),
            executeJavaScriptInIsolatedWorld: async (
              _world: number,
              [script]: { code: string }[],
            ) => {
              const evaluated = await cdp.send("Runtime.evaluate", {
                expression: script!.code,
                contextId: executionContextId,
                returnByValue: true,
              });
              if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.text);
              return evaluated.result.value;
            },
          });
          await expect(f.enter()).resolves.toEqual({ stage: "published" });
          expect(await page.getByRole("button", { name: "Submit", exact: true }).count()).toBe(1);
          await page.locator("#draft-id").evaluate((element) => {
            element.textContent = "another-draft";
          });
          await expect(f.enter()).rejects.toThrow("visible draft ID");
          expect(f.loadURL).not.toHaveBeenCalled();
        } finally {
          await browser.close();
        }
      },
    );

    it.skipIf(process.env.TABS_QA_BROWSER !== "1").each([
      {
        fault: "beforeHeaders",
        manual: false,
        toolbar: false,
        action: "submit",
      },
      {
        fault: "afterHeaders",
        manual: false,
        toolbar: false,
        action: "submit",
      },
      {
        fault: "beforeHeaders",
        manual: true,
        toolbar: false,
        action: "submit",
      },
      { fault: "afterHeaders", manual: false, toolbar: true, action: "submit" },
      { fault: "afterHeaders", manual: false, toolbar: true, action: "upload" },
      {
        fault: "afterHeaders",
        manual: false,
        toolbar: true,
        action: "upload",
        direct: true,
      },
    ] as const)(
      "recovers a committed $action after its HTTP response fails ($fault, manual=$manual, toolbar=$toolbar, case %#) without another POST",
      async (scenario) => {
        const { fault, manual, toolbar, action } = scenario;
        const direct = "direct" in scenario;
        const { chromium } = await import("playwright");
        const fixtureModule = new URL(
          "../../server/scripts/fixtures/browserSubmission.ts",
          import.meta.url,
        );
        const {
          startBrowserSubmission,
        }: {
          startBrowserSubmission: (
            port: number,
            staged: boolean,
            options: {
              dropSubmitReply?: "beforeHeaders" | "afterHeaders";
              dropUploadReply?: boolean;
              uploadOnSelect?: boolean;
              closeConnections: boolean;
            },
          ) => Promise<{
            origin: string;
            definition: BrowserWorkflowDefinition;
            trialCounts: () => {
              submitRequests: { Work: number; Personal: number };
              uploads: { Work: number; Personal: number };
              droppedUploadReplies?: number;
            };
            close: () => Promise<void>;
          }>;
        } = await import(fixtureModule.href);
        const uploading = action === "upload";
        const site = await startBrowserSubmission(0, uploading && !direct, {
          ...(uploading ? { dropUploadReply: true } : { dropSubmitReply: fault }),
          uploadOnSelect: direct,
          closeConnections: fault === "beforeHeaders",
        });
        onTestFinished(() => site.close());
        const browser = await chromium.launch();
        onTestFinished(() => browser.close());
        const page = await browser.newPage();
        await page.goto(site.origin + "/Work");
        const failed = page.waitForEvent("requestfailed", (request) => request.method() === "POST");
        if (uploading) {
          await page.getByLabel("Build package").setInputFiles({
            name: "recovery-fixture.appx",
            mimeType: "application/octet-stream",
            buffer: Buffer.from("disposable upload"),
          });
        }
        if (!direct) await page.locator(uploading ? "#upload-build" : "#submit-build").click();
        const failedRequest = await failed;
        if (fault === "beforeHeaders") {
          await page.waitForURL("chrome-error://chromewebdata/", {
            waitUntil: "commit",
          });
        }
        const writes = () => ({
          uploads: site.trialCounts().uploads,
          submits: site.trialCounts().submitRequests,
        });
        const expectedWrites = {
          uploads: { Work: uploading ? 1 : 0, Personal: 0 },
          submits: { Work: uploading ? 0 : 1, Personal: 0 },
        };
        expect(writes()).toEqual(expectedWrites);
        if (uploading) expect(site.trialCounts().droppedUploadReplies).toBe(1);

        const f = await setup(undefined, undefined, toolbar ? "custom-private-qa" : undefined);
        if (!direct)
          f.events.emit(
            "did-fail-load",
            {},
            -324,
            failedRequest.failure()?.errorText ?? "HTTP response failed",
            failedRequest.url(),
            true,
          );
        const cdp = await page.context().newCDPSession(page);
        const loadURL = vi.fn(async (url: string) => {
          await page.goto(url);
        });
        Object.assign(f.webContents, {
          getURL: () => page.url(),
          loadURL,
          executeJavaScriptInIsolatedWorld: async (
            _world: number,
            [script]: { code: string }[],
          ) => {
            const { frameTree } = await cdp.send("Page.getFrameTree");
            const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
              frameId: frameTree.frame.id,
              worldName: "submission-receipt",
            });
            const result = await cdp.send("Runtime.evaluate", {
              expression: script!.code,
              contextId: executionContextId,
              returnByValue: true,
            });
            if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
            return result.result.value;
          },
        });
        const readReceipt = () =>
          f.manager.runAutomation({
            ...f.request,
            operation: "readWorkflowReceipt",
            input: {
              ...f.saved,
              definition: site.definition,
              stage: uploading ? "ready_to_upload" : "uploaded",
              ...(manual ? { submitRequiresUser: true } : { pendingAction: action }),
            },
          });
        if (direct) {
          await expect(readReceipt()).resolves.toEqual({
            target: f.saved.target,
            stage: "ready_to_upload",
            statusText: "Ready to upload",
            identityText: site.definition.resourceId,
            observedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
          });
          expect(loadURL).not.toHaveBeenCalled();
          // The user's reload reads the draft without resending the page's fetch POST.
          await page.reload();
        }
        await expect(readReceipt()).resolves.toEqual({
          target: f.saved.target,
          stage: uploading ? "uploaded" : "submitted",
          statusText: uploading
            ? site.definition.states.uploaded
            : site.definition.states.submitted,
          identityText: site.definition.resourceId,
          observedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
        });
        if (direct) expect(loadURL).not.toHaveBeenCalled();
        else
          expect(loadURL).toHaveBeenCalledExactlyOnceWith(site.definition.url, {
            extraHeaders: "Cache-Control: no-cache\n",
          });
        expect(writes()).toEqual(expectedWrites);
      },
    );
  });

  it.skipIf(process.env.TABS_QA_BROWSER !== "1")(
    "hands off the same Work tab after mouse-down without saving the draft in Chromium",
    async () => {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const url = "https://drafts.test/Work";
        await page.route(url, (route) =>
          route.fulfill({
            contentType: "text/html",
            body: `<!doctype html><title>Work draft</title>
              <form data-presses="0" data-releases="0" data-ups="0" data-saves="0" data-corrections="0">
                <button id="save">Save draft</button>
                <button type="button" id="correct">Apply correction</button>
                <output></output>
                <div id="release-area" style="width: 120px; height: 40px">Neutral area</div>
              </form>
              <script>
                const form = document.querySelector('form');
                document.addEventListener('mouseup', (event) => {
                  if (event.isTrusted && event.button === 0) form.dataset.ups++;
                }, true);
                document.querySelector('#save').addEventListener('mousedown', (event) => {
                  if (event.isTrusted) form.dataset.presses++;
                });
                document.querySelector('#release-area').addEventListener('mouseup', (event) => {
                  if (event.isTrusted && event.button === 0) form.dataset.releases++;
                });
                form.addEventListener('submit', (event) => {
                  event.preventDefault();
                  form.dataset.saves++;
                });
                document.querySelector('#correct').addEventListener('click', (event) => {
                  if (!event.isTrusted) return;
                  form.dataset.corrections++;
                  form.querySelector('output').textContent = 'Correction applied';
                });
              </script>`,
          }),
        );
        await page.goto(url);
        const effects = () => page.locator("form").evaluate((form) => ({ ...form.dataset }));
        const cdp = await page.context().newCDPSession(page);
        type ClickCommand =
          | [
              "Input.dispatchMouseEvent",
              NonNullable<Parameters<typeof cdp.send<"Input.dispatchMouseEvent">>[1]>,
            ]
          | ["Emulation.setFocusEmulationEnabled", { enabled: boolean }];
        const mouseEvents: string[] = [];
        const focusEmulation: boolean[] = [];
        let acknowledgeFocusRelease!: () => void;
        const focusReleaseReply = new Promise<void>((resolve) => {
          acknowledgeFocusRelease = resolve;
        });
        const manager = new BrowserHostManager(() => null);
        const target = {
          projectId: "project-1",
          sessionId: "agents-surface-work",
          taskId: "qa",
        };
        const { session, webContents } = createMockSession({
          sessionId: target.sessionId,
          key: `${target.projectId}::${target.sessionId}`,
          profileId: "work",
          partition: "persist:tabs-browser:profile:work",
          currentUrl: url,
          cdpCoordinator: {
            withSession: (_mode: string, run: (debug: unknown) => unknown) =>
              run({
                sendCommand: async (...[method, params]: ClickCommand) => {
                  if (method === "Input.dispatchMouseEvent") {
                    mouseEvents.push(params.type);
                    // An interrupted press is released away from every control, never over Save.
                    if (params.type === "mouseReleased" && params.x >= 0 && params.y >= 0)
                      throw new Error("The interrupted Save must never receive an agent mouse-up.");
                  }
                  const result = await cdp.send(method, params);
                  if (method === "Emulation.setFocusEmulationEnabled") {
                    focusEmulation.push(params.enabled);
                    if (params.enabled === false) await focusReleaseReply;
                  }
                  if (method === "Input.dispatchMouseEvent" && params.type === "mousePressed") {
                    expect(await effects()).toEqual({
                      presses: "1",
                      releases: "0",
                      ups: "0",
                      saves: "0",
                      corrections: "0",
                    });
                    // Withhold the reply from the host until takeover.
                    manager.takeControl({ ...target, demonstrate: true });
                  }
                  return result;
                },
              }),
          },
        });
        const evaluate = vi.fn<(world: number, scripts: { code: string }[]) => Promise<unknown>>();
        await connectChromiumPage(page, { evaluate });
        Object.assign(webContents, {
          getURL: () => page.url(),
          getZoomFactor: () => 1,
          executeJavaScriptInIsolatedWorld: evaluate,
        });
        (manager as unknown as { sessions: Map<string, unknown> }).sessions.set(
          session.key,
          session,
        );
        const state = () => manager.getSessionState(target.projectId, target.sessionId);
        await manager.runAutomation({
          ...target,
          operation: "authorizeBrowserPage",
          source: "human",
          input: { url, profileId: "work" },
        });

        const click = manager.runAutomation({
          ...target,
          operation: "click",
          source: "agent",
          input: { selector: "#save" },
        });
        const clickSettled = vi.fn();
        void click.then(clickSettled, clickSettled);
        try {
          await vi.waitFor(() => expect(focusEmulation).toEqual([true, false]));
          expect(clickSettled).not.toHaveBeenCalled();
          expect(state().controller).toBe("human");
        } finally {
          acknowledgeFocusRelease();
        }
        await expect(click).rejects.toThrow("Click interrupted by human control.");
        expect(mouseEvents).toEqual(["mousePressed", "mouseMoved", "mouseReleased"]);
        // The page saw the release (no stuck press or drag) but Save never completed.
        expect(await effects()).toEqual({
          presses: "1",
          releases: "0",
          ups: "1",
          saves: "0",
          corrections: "0",
        });
        const { instanceId, controlEpoch } = session;
        await vi.waitFor(async () =>
          expect(
            await evaluate(999, [{ code: "Boolean(globalThis.tabsBrowserDemonstration)" }]),
          ).toBe(true),
        );

        await page.locator("#release-area").hover();
        await page.mouse.up();
        expect(await effects()).toEqual({
          presses: "1",
          releases: "1",
          ups: "2",
          saves: "0",
          corrections: "0",
        });

        await page.getByRole("button", { name: "Apply correction" }).click();
        await vi.waitFor(() => expect(state().demonstratedControl).toContain("Apply correction"));
        const receipt = await manager.resumeAgent({
          ...target,
          expectedGeneration: { instanceId, controlEpoch },
        });

        expect(receipt).toEqual({
          demonstrationId: expect.any(String),
          controlEpoch: controlEpoch + 1,
        });
        expect(session.actionTimeline).toContainEqual(
          expect.objectContaining({
            id: receipt?.demonstrationId,
            observedChanges: ["Nearby status changed"],
          }),
        );
        expect(state()).toMatchObject({
          instanceId,
          sessionId: target.sessionId,
          profileId: "work",
          currentUrl: url,
          assignedTaskId: target.taskId,
          controller: "none",
          browserPageAuthorized: true,
        });
        await expect(
          manager.runAutomation({
            ...target,
            operation: "waitFor",
            source: "agent",
            input: { text: "Correction applied", timeoutMs: 1_000 },
          }),
        ).resolves.toEqual({ matched: true });
        expect(await effects()).toEqual({
          presses: "1",
          releases: "1",
          ups: "3",
          saves: "0",
          corrections: "1",
        });
      } finally {
        await browser.close();
      }
    },
    60_000,
  );

  it.skipIf(process.env.TABS_QA_BROWSER !== "1")(
    "keeps the editor independent during a canvas action and a one-step handoff in Chromium",
    async () => {
      const { chromium } = await import("playwright");
      const { nativeImage } = await import("electron");
      const browser = await chromium.launch();
      try {
        const editor = await browser.newPage();
        await editor.setContent("<textarea aria-label='Editor'></textarea>");
        const page = await browser.newPage({
          viewport: { width: 520, height: 420 },
        });
        await page.route("https://report.test/**", (route) =>
          route.fulfill({
            contentType: "text/html",
            body: `<canvas width="100" height="50" aria-label="Highlight"></canvas><output></output>
        <section aria-label="All reports"><button>Export</button></section>
        <section aria-label="Selected rows"><button aria-expanded="false">Export</button><output id="selected-status"></output><button id="download" hidden>Download</button></section>
        <section aria-label="Archived"><button>Export</button></section>
        <input type="file" id="proof">
        <script>document.querySelector('canvas').onclick = () => document.querySelector('output').textContent = 'Highlight applied';
        document.querySelectorAll('section > button:first-child').forEach(b => b.onclick = () => {
          document.querySelector('output').textContent = b.parentElement.ariaLabel;
          if (b.parentElement.ariaLabel !== 'Selected rows') return;
          b.setAttribute('aria-expanded', 'true');
          document.querySelector('#download').hidden = false;
          document.querySelector('#selected-status').textContent = 'Report ready';
        });
        </script>`,
          }),
        );
        await page.goto("https://report.test/report");
        const cdp = await page.context().newCDPSession(page);
        const { frameTree } = await cdp.send("Page.getFrameTree");
        const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
          frameId: frameTree.frame.id,
          worldName: "tabs-test-world",
        });
        const manager = new BrowserHostManager(() => null);
        const sessionId = "agents-surface-report";
        const { session, webContents } = createMockSession({
          sessionId,
          key: "project-1::" + sessionId,
          currentUrl: page.url(),
          pageTitle: "Report",
          profileId: "work",
          partition: "persist:tabs-browser:profile:work",
          cdpCoordinator: {
            withSession: (_mode: string, run: (debug: unknown) => unknown) =>
              run({ sendCommand: cdp.send.bind(cdp) }),
          },
        });
        Object.assign(webContents, {
          getURL: () => page.url(),
          getTitle: () => "Report",
          getZoomFactor: () => 1,
          isLoadingMainFrame: () => session.loading,
          executeJavaScriptInIsolatedWorld: async (_world: number, scripts: { code: string }[]) => {
            const response = await cdp.send("Runtime.evaluate", {
              expression: scripts[0]!.code,
              contextId: executionContextId,
              awaitPromise: true,
              returnByValue: true,
            });
            if (response.exceptionDetails)
              throw new Error(
                response.exceptionDetails.exception?.description ?? response.exceptionDetails.text,
              );
            return response.result.value;
          },
        });
        vi.mocked(nativeImage.createFromBuffer).mockImplementation(
          (bytes) =>
            ({
              getSize: () => ({
                width: bytes.readUInt32BE(16),
                height: bytes.readUInt32BE(20),
              }),
              toPNG: () => bytes,
            }) as ReturnType<typeof nativeImage.createFromBuffer>,
        );
        (manager as unknown as { sessions: Map<string, unknown> }).sessions.set(
          session.key,
          session,
        );
        const target = {
          projectId: session.projectId,
          sessionId,
          taskId: "qa",
        };
        const act = (operation: string, input?: unknown) =>
          manager.runAutomation(
            { ...target, operation, source: "agent", input },
            undefined,
            async () => true,
          );
        await manager.runAutomation({
          ...target,
          operation: "authorizeBrowserPage",
          source: "human",
          input: { url: page.url(), profileId: "work" },
        });
        await editor.bringToFront();
        await editor.locator("textarea").focus();
        await editor.keyboard.type("begin");
        await editor.evaluate(() => {
          const body = document.body;
          body.dataset.foregroundInterruptions = "0";
          window.addEventListener("blur", () => {
            body.dataset.foregroundInterruptions = String(
              Number(body.dataset.foregroundInterruptions) + 1,
            );
          });
        });
        const started = performance.now();
        await act("snapshot");
        // A stale visual click cannot reach the newly covering element.
        await page.evaluate(() =>
          document.body.insertAdjacentHTML(
            "beforeend",
            '<div id="overlay" style="position:fixed;inset:0;background:black"></div>',
          ),
        );
        await expect(act("click", { x: 30, y: 25 })).rejects.toThrow("screen has changed");
        await page.locator("#overlay").evaluate((element) => element.remove());
        await act("snapshot");
        await act("click", { x: 30, y: 25 });
        expect(await page.locator("output").first().innerText()).toBe("Highlight applied");
        await expect(act("click", { locator: "role=button[name='Export']" })).rejects.toThrow(
          "Several controls",
        );
        const interruptionsBeforeTakeover = Number(
          await editor.locator("body").getAttribute("data-foreground-interruptions"),
        );
        expect(interruptionsBeforeTakeover).toBe(0);
        manager.takeControl({ ...target, demonstrate: true });
        await expect(act("click", { selector: "button" })).rejects.toThrow();
        await page
          .getByRole("region", { name: "Selected rows" })
          .getByRole("button", { name: "Export" })
          .click();
        await vi.waitFor(() =>
          expect(
            manager.getSessionState(target.projectId, target.sessionId).demonstratedControl,
          ).toContain("Selected rows"),
        );
        const expectedGeneration = {
          instanceId: session.instanceId,
          controlEpoch: session.controlEpoch,
        };
        for (const staleGeneration of [
          { ...expectedGeneration, instanceId: "replacement-browser-instance" },
          {
            ...expectedGeneration,
            controlEpoch: expectedGeneration.controlEpoch - 1,
          },
        ]) {
          await expect(
            manager.resumeAgent({
              ...target,
              expectedGeneration: staleGeneration,
            }),
          ).rejects.toThrow("tab changed while returning control");
        }
        expect(session.controller).toBe("human");
        const receipt = await manager.resumeAgent({
          ...target,
          expectedGeneration,
          meaning: "Export just the selected rows.",
        });
        const snapshot = (await act("snapshot")) as {
          actionTimeline: Array<{ id: string; action: string }>;
        };
        const demonstrated = snapshot.actionTimeline.find(
          (step) =>
            step.action.includes("Selected rows") && step.action.includes("just the selected rows"),
        );
        expect(demonstrated).toMatchObject({
          observedChanges: ["Control expanded", "Nearby controls changed", "Nearby status changed"],
        });
        expect(receipt).toEqual({
          demonstrationId: demonstrated?.id,
          controlEpoch: expectedGeneration.controlEpoch + 1,
        });
        await expect(
          manager.resumeAgent({
            ...target,
            expectedGeneration: {
              ...expectedGeneration,
              controlEpoch: session.controlEpoch,
            },
          }),
        ).rejects.toThrow("tab changed while returning control");
        expect(JSON.stringify(demonstrated)).not.toContain("Report ready");
        await editor.keyboard.type(" end");
        expect(await editor.locator("textarea").inputValue()).toBe("begin end");
        expect(await page.locator("output").first().innerText()).toBe("Selected rows");
        const transfer = (await manager.runAutomation({
          ...target,
          operation: "authorizeDeviceScreenshot",
          source: "human",
          input: {
            url: page.url(),
            profileId: "work",
            deviceId: "sim",
            hostId: "local",
          },
        })) as { grantId: string };
        await act("deviceScreenshotUpload", {
          ...transfer,
          phase: "inspect",
          selector: "#proof",
        });
        await page
          .locator("#proof")
          .evaluate((element) => element.replaceWith(element.cloneNode(true)));
        await expect(
          act("deviceScreenshotUpload", {
            ...transfer,
            phase: "attach",
            hostId: "local",
            deviceId: "sim",
            selector: "#proof",
            png: "AQ==",
          }),
        ).rejects.toThrow("file input");
        expect(
          await page
            .locator("#proof")
            .evaluate((element) => (element as HTMLInputElement).files?.length),
        ).toBe(0);
        await page.evaluate(() =>
          document.body.insertAdjacentHTML(
            "beforeend",
            '<label>API key<input id="private-field" value="fixture-private-value"></label>',
          ),
        );
        await expect(act("snapshot")).rejects.toThrow();
        await page.locator("#private-field").evaluate((element) => element.remove());
        console.log(
          JSON.stringify({
            workflow: "canvas-handoff",
            elapsedMs: Math.round(performance.now() - started),
            editorText: "begin end",
            interruptionsBeforeTakeover,
            wrongTargetEffects: 0,
            recoveredSteps: 1,
          }),
        );
      } finally {
        await browser.close();
      }
    },
    60000,
  );

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

  it("consumes a browser action approval once on the selected page, profile, and thread", async () => {
    const manager = new BrowserHostManager(() => null);
    const { session, webContents } = createMockSession({
      profileId: "work",
      partition: "persist:tabs-browser:profile:work",
      currentUrl: "https://example.com/app?private=1",
    });
    const evaluate = vi.fn().mockResolvedValue("ok").mockResolvedValueOnce("missing");
    Object.assign(webContents, {
      getURL: () => session.currentUrl,
      executeJavaScriptInIsolatedWorld: evaluate,
    });
    (manager as unknown as { sessions: Map<string, unknown> }).sessions.set(session.key, session);
    const target = {
      projectId: session.projectId,
      sessionId: session.sessionId,
      taskId: "qa",
    };
    const action = {
      id: crypto.randomUUID(),
      label: "Save report",
      origin: "https://example.com",
      steps: [{ action: "click", selector: "#save" }],
      outcome: { selector: "#confirmation", description: "Report saved" },
    };
    const [tab] = (await manager.runAutomation({
      ...target,
      source: "human",
      operation: "listQuickActionTargets",
      input: { action },
    })) as [{ token: string; page: string; profileId: string }];
    expect(tab).toMatchObject({
      page: "https://example.com/app",
      profileId: "work",
    });
    const { id } = (await manager.runAutomation({
      ...target,
      source: "human",
      operation: "authorizeQuickAction",
      input: { action, token: tab.token },
    })) as { id: string };
    const invoke = (taskId: string) =>
      manager.runAutomation({
        ...target,
        taskId,
        source: "agent",
        operation: "runQuickAction",
        input: { actionId: action.id, approvalId: id },
      });
    await expect(invoke("other")).rejects.toThrow("exact tab and thread");
    const approvedUrl = session.currentUrl;
    session.currentUrl = "https://example.com/app?private=2";
    await expect(invoke("qa")).rejects.toThrow("exact tab and thread");
    session.currentUrl = approvedUrl;
    session.partition = "persist:tabs-browser:profile:personal";
    await expect(invoke("qa")).rejects.toThrow("exact tab and thread");
    session.partition = "persist:tabs-browser:profile:work";
    expect(evaluate).not.toHaveBeenCalled();
    const [first, duplicate] = await Promise.allSettled([invoke("qa"), invoke("qa")]);
    expect(first).toMatchObject({
      status: "fulfilled",
      value: { status: "pass", completedSteps: 1 },
    });
    expect(duplicate.status).toBe("rejected");
    expect(evaluate).toHaveBeenCalledTimes(3);
  });

  it.skipIf(process.env.TABS_QA_BROWSER !== "1")(
    "keeps a used Quick Action value across a fresh agent approval and edits an unused value",
    async () => {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch();
      onTestFinished(() => browser.close());
      const page = await browser.newPage();
      const origin = "https://app.test";
      const address = `${origin}/reports/new`;
      const saves: { method: string; body: unknown }[] = [];
      await page.route(address, (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<form id="report">
            <label>Month <input id="month" name="month"></label>
            <button id="continue" type="button" disabled>Continue</button>
            <fieldset id="details" hidden>
              <label>Confirm month <input id="confirm-month" name="confirmMonth"></label>
              <label>Note <input id="note" name="note"></label>
              <button id="save" type="submit">Save draft</button>
            </fieldset>
          </form>
          <output id="receipt" hidden></output>
          <script>
            const form = document.querySelector('#report');
            const month = document.querySelector('#month');
            month.addEventListener('input', () => {
              month.dataset.fills = String(Number(month.dataset.fills ?? 0) + 1);
            });
            document.querySelector('#continue').onclick = () => {
              document.querySelector('#details').hidden = false;
            };
            form.onsubmit = async (event) => {
              event.preventDefault();
              const response = await fetch('/drafts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.fromEntries(new FormData(form))),
              });
              const receipt = document.querySelector('#receipt');
              receipt.textContent = (await response.json()).id;
              receipt.hidden = false;
            };
          </script>`,
        }),
      );
      await page.route(`${origin}/drafts`, (route) => {
        const request = route.request();
        saves.push({ method: request.method(), body: request.postDataJSON() });
        return route.fulfill({ status: 201, json: { id: "draft-42" } });
      });
      await page.goto(address);

      const manager = new BrowserHostManager(() => null);
      const fixture = createMockSession({ currentUrl: address });
      mockNavigation(manager, fixture);
      const { session, webContents } = fixture;
      const evaluate = vi.fn<(world: number, scripts: { code: string }[]) => Promise<unknown>>();
      Object.assign(webContents, {
        executeJavaScriptInIsolatedWorld: evaluate,
      });
      await connectChromiumPage(page, { evaluate });
      const target = {
        projectId: session.projectId,
        sessionId: session.sessionId,
        taskId: "qa",
      };
      const action: BrowserQuickAction = {
        id: crypto.randomUUID(),
        label: "Save monthly draft",
        origin,
        steps: [
          { action: "fill", selector: "#month", parameter: "month" },
          { action: "click", selector: "#continue" },
          { action: "fill", selector: "#confirm-month", parameter: "month" },
          { action: "fill", selector: "#note", parameter: "note" },
          { action: "click", selector: "#save" },
        ],
        outcome: { selector: "#receipt", description: "Draft saved" },
      };
      const list = () =>
        manager.runAutomation({
          ...target,
          source: "human",
          operation: "listQuickActionTargets",
          input: { action },
        }) as Promise<[BrowserQuickActionTarget]>;
      const approve = (token: string, values: Record<string, string>, pauseId?: string) =>
        manager.runAutomation({
          ...target,
          source: "human",
          operation: "authorizeQuickAction",
          input: {
            action,
            token,
            values,
            ...(pauseId && { pauseId, resume: true }),
          },
        }) as Promise<{ id: string }>;
      const run = (approvalId: string) =>
        manager.runAutomation({
          ...target,
          source: "agent",
          operation: "runQuickAction",
          input: { actionId: action.id, approvalId },
        }) as Promise<BrowserQuickActionResult>;

      const initialValues = { month: "2026-11", note: "Original draft note" };
      const [initialTab] = await list();
      expect(initialTab).not.toHaveProperty("lockedParameters");
      const firstApproval = await approve(initialTab.token, initialValues);
      const paused = await run(firstApproval.id);
      const pauseId = paused.resumeRequest?.pause.pauseId;
      expect(pauseId).toEqual(expect.any(String));
      expect(paused).toMatchObject({
        status: "paused",
        completedSteps: 1,
        resumeRequest: {
          actionId: action.id,
          pause: { pauseId, tabId: session.sessionId, profileId: "default" },
        },
      });
      const month = page.locator("#month");
      expect(await month.inputValue()).toBe(initialValues.month);
      expect(await page.locator("#confirm-month").inputValue()).toBe("");
      expect(await page.locator("#note").inputValue()).toBe("");
      expect(saves).toEqual([]);

      const [pausedTab] = await list();
      const note = "Edited draft note";
      await expect(approve(pausedTab.token, { month: "2026-12", note }, pauseId)).rejects.toThrow(
        "original values for inputs already used",
      );
      expect(pausedTab).toMatchObject({
        pausedAt: 1,
        pauseOwner: { pauseId, taskId: target.taskId },
        lockedParameters: ["month"],
      });
      expect(await list()).toEqual([pausedTab]);

      await page.locator("#continue").evaluate((button: HTMLButtonElement) => {
        button.disabled = false;
      });
      const resumedApproval = await approve(pausedTab.token, { note }, pauseId);
      expect(resumedApproval.id).not.toBe(firstApproval.id);
      const listedTargets = JSON.stringify([pausedTab, ...(await list())]);
      for (const value of [initialValues.month, initialValues.note, note]) {
        expect(listedTargets).not.toContain(value);
      }
      await expect(run(resumedApproval.id)).resolves.toMatchObject({
        status: "pass",
        completedSteps: action.steps.length,
        message: "Draft saved",
      });
      await expect(run(resumedApproval.id)).rejects.toThrow("exact tab and thread");
      expect(await month.getAttribute("data-fills")).toBe("1");
      expect(await page.locator("#receipt").innerText()).toBe("draft-42");
      expect(saves).toEqual([
        {
          method: "POST",
          body: {
            month: initialValues.month,
            confirmMonth: initialValues.month,
            note,
          },
        },
      ]);
      expect((await list())[0]).not.toHaveProperty("lockedParameters");
    },
  );

  it.skipIf(process.env.TABS_QA_BROWSER !== "1").each([true, false])(
    "requires human resolution of a lost Chromium Quick Action click reply (applied: %s)",
    async (applied) => {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch();
      onTestFinished(() => browser.close());
      const page = await browser.newPage();
      const origin = "https://app.test";
      const address = `${origin}/drafts/new`;
      const values = { title: "November report", note: "Reviewed draft note" };
      const receiptId = "draft-42";
      const saves: { method: string; body: unknown }[] = [];
      await page.route(address, (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<form id="draft">
            <label>Title <input id="title" name="title" data-fills="0"></label>
            <button id="continue" type="button" data-clicks="0">Continue</button>
            <fieldset id="details" hidden>
              <label>Note <input id="note" name="note"></label>
              <button id="save" type="submit">Save draft</button>
            </fieldset>
          </form>
          <output id="receipt" hidden></output>
          <script>
            const form = document.querySelector('#draft');
            const title = document.querySelector('#title');
            title.oninput = () => title.dataset.fills++;
            const next = document.querySelector('#continue');
            next.onclick = () => {
              next.dataset.clicks++;
              document.querySelector('#details').hidden = false;
            };
            form.onsubmit = async (event) => {
              event.preventDefault();
              const response = await fetch('/drafts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.fromEntries(new FormData(form))),
              });
              const receipt = document.querySelector('#receipt');
              receipt.textContent = (await response.json()).id;
              receipt.hidden = false;
            };
          </script>`,
        }),
      );
      await page.route(`${origin}/drafts`, (route) => {
        const request = route.request();
        saves.push({ method: request.method(), body: request.postDataJSON() });
        return route.fulfill({ status: 201, json: { id: receiptId } });
      });
      await page.goto(address);

      const manager = new BrowserHostManager(() => null);
      const fixture = createMockSession({
        currentUrl: address,
        bounds: { x: 0, y: 0, width: 640, height: 480 },
      });
      mockNavigation(manager, fixture);
      const { session, webContents, sendInputEvent } = fixture;
      (manager as unknown as { activeKey: string }).activeKey = session.key;
      const evaluate = vi.fn<(world: number, scripts: { code: string }[]) => Promise<unknown>>();
      await connectChromiumPage(page, { evaluate });
      const evaluateInChromium = evaluate.getMockImplementation()!;
      let lostReply = false;
      let guestReply: unknown;
      evaluate.mockImplementation(async (world, scripts) => {
        if (!lostReply && scripts[0]!.code.includes('"action":"click","selector":"#continue"')) {
          lostReply = true;
          // One dispatch reaches the guest before its reply disappears. The other never arrives.
          if (applied) guestReply = await evaluateInChromium(world, scripts);
          throw new Error("Lost Quick Action click reply");
        }
        return evaluateInChromium(world, scripts);
      });
      Object.assign(webContents, {
        executeJavaScriptInIsolatedWorld: evaluate,
      });

      const target = {
        projectId: session.projectId,
        sessionId: session.sessionId,
        taskId: "qa",
      };
      const action: BrowserQuickAction = {
        id: crypto.randomUUID(),
        label: "Save report draft",
        origin,
        steps: [
          { action: "fill", selector: "#title", parameter: "title" },
          { action: "click", selector: "#continue" },
          { action: "fill", selector: "#note", parameter: "note" },
          { action: "click", selector: "#save" },
        ],
        outcome: { selector: "#receipt", description: "Draft saved" },
      };
      const human = (operation: string, input: object) =>
        manager.runAutomation({ ...target, source: "human", operation, input });
      const list = () =>
        human("listQuickActionTargets", { action }) as Promise<[BrowserQuickActionTarget]>;
      const approve = (token: string, pauseId?: string) =>
        human("authorizeQuickAction", {
          action,
          token,
          values,
          ...(pauseId && { pauseId, resume: true }),
        }) as Promise<{ id: string }>;
      const run = (approvalId: string) =>
        manager.runAutomation({
          ...target,
          source: "agent",
          operation: "runQuickAction",
          input: { actionId: action.id, approvalId },
        }) as Promise<BrowserQuickActionResult>;

      const [initialTab] = await list();
      const firstApproval = await approve(initialTab.token);
      const paused = await run(firstApproval.id);
      const title = page.locator("#title");
      const next = page.locator("#continue");
      expect(lostReply).toBe(true);
      expect(guestReply).toBe(applied ? "ok" : undefined);
      expect(await title.getAttribute("data-fills")).toBe("1");
      expect(await next.getAttribute("data-clicks")).toBe(applied ? "1" : "0");
      expect(await page.locator("#details").isVisible()).toBe(applied);
      expect(await page.locator("#note").inputValue()).toBe("");
      expect(saves).toEqual([]);
      expect(paused).toMatchObject({
        status: "paused",
        completedSteps: 1,
        resumeRequest: {
          actionId: action.id,
          pause: {
            pauseId: expect.any(String),
            tabId: target.sessionId,
            profileId: "default",
          },
        },
      });
      const { pauseId } = paused.resumeRequest!.pause;

      const [pausedTab] = await list();
      expect(pausedTab).toMatchObject({
        pausedAt: 1,
        pauseOwner: { pauseId, taskId: target.taskId },
        unconfirmedStepId: expect.any(String),
      });
      const resolution = {
        ...target,
        source: "human",
        operation: "resolveQuickActionStep",
        input: {
          action,
          token: pausedTab.token,
          pauseId,
          unconfirmedStepId: pausedTab.unconfirmedStepId,
          applied,
        },
      } as const;
      const probesAtPause = evaluate.mock.calls.length;
      await expect(approve(pausedTab.token, pauseId)).rejects.toThrow("step took effect");
      await expect(
        human("repairQuickAction", { action, token: pausedTab.token, pauseId }),
      ).rejects.toThrow("step took effect");
      await expect(manager.runAutomation({ ...resolution, taskId: "other" })).rejects.toThrow();
      await expect(
        manager.runAutomation({
          ...resolution,
          input: {
            ...resolution.input,
            unconfirmedStepId: crypto.randomUUID(),
          },
        }),
      ).rejects.toThrow();
      await expect(manager.runAutomation({ ...resolution, source: "agent" })).rejects.toThrow();
      expect(await list()).toEqual([pausedTab]);
      expect(evaluate).toHaveBeenCalledTimes(probesAtPause);
      expect(sendInputEvent).not.toHaveBeenCalled();

      await manager.runAutomation(resolution);
      const [resolvedTab] = await list();
      expect(resolvedTab).toMatchObject({
        pausedAt: applied ? 2 : 1,
        pauseOwner: { pauseId, taskId: target.taskId },
      });
      expect(resolvedTab.unconfirmedStepId).toBeUndefined();
      await expect(
        manager.runAutomation({
          ...resolution,
          input: { ...resolution.input, token: resolvedTab.token },
        }),
      ).rejects.toThrow();
      await expect(run(firstApproval.id)).rejects.toThrow("exact tab and thread");
      expect(evaluate).toHaveBeenCalledTimes(probesAtPause);
      expect(sendInputEvent).not.toHaveBeenCalled();
      expect(await next.getAttribute("data-clicks")).toBe(applied ? "1" : "0");
      expect(saves).toEqual([]);

      const freshApproval = await approve(resolvedTab.token, pauseId);
      expect(freshApproval.id).not.toBe(firstApproval.id);
      await expect(run(freshApproval.id)).resolves.toMatchObject({
        status: "pass",
        completedSteps: action.steps.length,
        message: "Draft saved",
      });
      expect(await title.getAttribute("data-fills")).toBe("1");
      expect(await next.getAttribute("data-clicks")).toBe("1");
      expect(await page.locator("#receipt").innerText()).toBe(receiptId);
      expect(saves).toEqual([{ method: "POST", body: values }]);
    },
  );

  it("returns a preflight file repair only after an agent verifies the new artifact", async () => {
    const manager = new BrowserHostManager(() => null);
    const fixture = createMockSession({
      bounds: { x: 0, y: 0, width: 640, height: 480 },
    });
    const { session, webContents } = fixture;
    mockNavigation(manager, fixture);
    (manager as unknown as { activeKey: string }).activeKey = session.key;
    const fileReceipt = {
      filename: "report.csv",
      byteLength: 14,
      sha256: "a".repeat(64),
    };
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce("changed")
      .mockResolvedValueOnce({ selector: "#new-receipt" })
      .mockResolvedValueOnce("missing")
      .mockResolvedValueOnce([{ ...fileReceipt, sha256: "b".repeat(64) }])
      .mockResolvedValueOnce("ok")
      .mockResolvedValueOnce(fileReceipt);
    Object.assign(webContents, { executeJavaScriptInIsolatedWorld: evaluate });
    const target = {
      projectId: session.projectId,
      sessionId: session.sessionId,
      taskId: "qa",
    };
    const action = {
      id: crypto.randomUUID(),
      label: "Save report",
      origin: "https://example.com",
      steps: [{ action: "click", selector: "#export" }],
      outcome: {
        selector: "#receipt",
        description: "Report saved",
        filenamePattern: "report.csv",
      },
    };
    const replacement = {
      ...action,
      outcome: { ...action.outcome, selector: "#new-receipt" },
    };
    const human = (operation: string, input: object) =>
      manager.runAutomation({ ...target, source: "human", operation, input });
    const approve = async (resume: boolean, pauseId?: string) => {
      const [tab] = (await human("listQuickActionTargets", { action })) as [{ token: string }];
      const { id } = (await human("authorizeQuickAction", {
        action,
        token: tab.token,
        resume,
        ...(pauseId && { pauseId }),
      })) as { id: string };
      return id;
    };
    const run = (approvalId: string) =>
      manager.runAutomation({
        ...target,
        source: "agent",
        operation: "runQuickAction",
        input: { approvalId, actionId: action.id },
      });
    const paused = (await run(await approve(false))) as {
      status: string;
      completedSteps: number;
      resumeRequest: { pause: { pauseId: string } };
    };
    expect(paused).toMatchObject({ status: "paused", completedSteps: 0 });
    expect(paused).not.toHaveProperty("verifiedRepair");
    const { pauseId } = paused.resumeRequest.pause;
    const [tab] = (await human("listQuickActionTargets", { action })) as [{ token: string }];
    await expect(
      human("repairQuickAction", { action, token: tab.token, pauseId }),
    ).resolves.toEqual({ action: replacement, pendingFileVerification: true });
    expect(evaluate).toHaveBeenCalledTimes(2);
    await expect(run(await approve(true, pauseId))).resolves.toMatchObject({
      status: "pass",
      fileReceipt,
      verifiedRepair: { previous: action, replacement },
    });
    expect(evaluate).toHaveBeenCalledTimes(6);
  });

  it("keeps the original agent pause when outcome repair picks a preexisting file and verifies the new file on resume", async () => {
    const manager = new BrowserHostManager(() => null);
    const { session, webContents } = createMockSession({
      bounds: { x: 0, y: 0, width: 640, height: 480 },
    });
    const fileReceipt = {
      filename: "qa-December.csv",
      byteLength: 14,
      sha256: "a".repeat(64),
    };
    const archiveReceipt = { ...fileReceipt, sha256: "b".repeat(64) };
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce("missing")
      .mockResolvedValueOnce([archiveReceipt])
      .mockResolvedValueOnce("ok")
      .mockResolvedValueOnce("changed")
      .mockResolvedValueOnce({ selector: "#archive" })
      .mockResolvedValueOnce(archiveReceipt)
      .mockResolvedValueOnce({ selector: "#new-receipt" })
      .mockResolvedValueOnce(fileReceipt)
      .mockResolvedValueOnce(fileReceipt);
    Object.assign(webContents, {
      getURL: () => session.currentUrl,
      executeJavaScriptInIsolatedWorld: evaluate,
    });
    const internals = manager as unknown as {
      sessions: Map<string, unknown>;
      activeKey: string;
    };
    internals.sessions.set(session.key, session);
    internals.activeKey = session.key;
    const target = {
      projectId: session.projectId,
      sessionId: session.sessionId,
      taskId: "qa",
    };
    const action = {
      id: crypto.randomUUID(),
      label: "Save report",
      origin: "https://example.com",
      steps: [{ action: "fill", selector: "#month", parameter: "month" }],
      outcome: {
        selector: "#receipt",
        description: "Report saved",
        filenamePattern: "qa-{month}.csv",
      },
    };
    const list = async (action: unknown) =>
      (await manager.runAutomation({
        ...target,
        source: "human",
        operation: "listQuickActionTargets",
        input: { action },
      })) as [
        {
          token: string;
          pausedAt?: number;
          pauseOwner?: { pauseId: string; taskId: string };
        },
      ];
    const [initialTab] = await list(action);
    const { id: firstApproval } = (await manager.runAutomation({
      ...target,
      source: "human",
      operation: "authorizeQuickAction",
      input: { action, token: initialTab.token, values: { month: "December" } },
    })) as { id: string };
    const paused = await manager.runAutomation({
      ...target,
      source: "agent",
      operation: "runQuickAction",
      input: { actionId: action.id, approvalId: firstApproval },
    });
    const [pausedTab] = await list(action);
    expect(pausedTab.pausedAt).toBe(1);
    const pauseId = pausedTab.pauseOwner?.pauseId;
    expect(pauseId).toEqual(expect.any(String));
    expect(pausedTab.pauseOwner).toEqual({ pauseId, taskId: "qa" });
    expect(paused).toMatchObject({
      status: "paused",
      completedSteps: 1,
      resumeRequest: {
        actionId: action.id,
        pause: { pauseId, tabId: session.sessionId, profileId: "default" },
      },
    });
    expect(paused).not.toHaveProperty("fileBaseline");
    const openPause = {
      ...target,
      source: "human",
      operation: "enterQuickActionPause",
      input: { actionId: action.id, pauseId },
    } as const;
    await expect(manager.runAutomation({ ...openPause, taskId: "other" })).rejects.toThrow("pause");
    const approvedPartition = session.partition;
    session.partition = "persist:tabs-browser:profile:personal";
    await expect(manager.runAutomation(openPause)).rejects.toThrow("pause has changed");
    session.partition = approvedPartition;
    await expect(manager.runAutomation(openPause)).resolves.toEqual({
      url: session.currentUrl,
    });
    await expect(
      manager.runAutomation({
        ...target,
        source: "human",
        taskId: "other",
        operation: "authorizeQuickAction",
        input: { action, token: pausedTab.token, resume: true },
      }),
    ).rejects.toThrow("available to this conversation");
    expect(evaluate).toHaveBeenCalledTimes(4);
    const repair = {
      ...target,
      source: "human",
      operation: "repairQuickAction",
      input: { action, token: pausedTab.token, pauseId },
    } as const;
    await expect(manager.runAutomation(repair)).rejects.toThrow("before this run");
    const [unchangedPause] = await list(action);
    expect(unchangedPause).toMatchObject({
      pausedAt: 1,
      pauseOwner: { pauseId, taskId: "qa" },
    });
    const repairResult = (await manager.runAutomation({
      ...repair,
      input: { ...repair.input, token: unchangedPause.token },
    })) as { action: unknown; pendingFileVerification: boolean };
    expect(repairResult).toMatchObject({
      action: {
        outcome: {
          selector: "#new-receipt",
          filenamePattern: "qa-{month}.csv",
        },
      },
      pendingFileVerification: false,
    });
    const repaired = repairResult.action;
    const [repairedTab] = await list(repaired);
    expect(await list(action)).toEqual([repairedTab]);
    const { id } = (await manager.runAutomation({
      ...target,
      source: "human",
      operation: "authorizeQuickAction",
      input: {
        action: repaired,
        token: repairedTab.token,
        resume: true,
        pauseId,
      },
    })) as { id: string };
    const verified = (await manager.runAutomation({
      ...target,
      source: "agent",
      operation: "runQuickAction",
      input: { actionId: action.id, approvalId: id },
    })) as { fileResult: { resultId: string }; fileReceipt: object };
    expect(verified).toMatchObject({
      status: "pass",
      completedSteps: 1,
      fileReceipt: {
        filename: "qa-December.csv",
        byteLength: 14,
        sha256: "a".repeat(64),
      },
      fileResult: {
        resultId: expect.any(String),
        tabId: session.sessionId,
        filename: "qa-December.csv",
      },
    });
    expect(evaluate).toHaveBeenCalledTimes(9);
    await expect(manager.runAutomation(openPause)).rejects.toThrow("pause has changed");
    expect(evaluate.mock.calls[8]?.[1][0].code).toContain(
      '"selector":"#new-receipt","expectedFilename":"qa-December.csv"',
    );
    expect(
      evaluate.mock.calls.filter(([, [script]]) => script.code.includes('"action":"fill"')),
    ).toHaveLength(1);
    const enter = {
      ...target,
      source: "human",
      operation: "enterQuickActionFileResult",
      input: { resultId: verified.fileResult.resultId },
    } as const;
    await expect(manager.runAutomation({ ...enter, taskId: "other" })).rejects.toThrow(
      "original thread",
    );
    await expect(manager.runAutomation({ ...enter, source: "agent" })).rejects.toThrow(
      "original thread",
    );
    const originalUrl = session.currentUrl;
    session.currentUrl = originalUrl + "/other";
    await expect(manager.runAutomation(enter)).rejects.toThrow("original browser page changed");
    session.currentUrl = originalUrl;
    const originalPartition = session.partition;
    session.partition = "persist:tabs-browser:profile:personal";
    await expect(manager.runAutomation(enter)).rejects.toThrow("original browser page changed");
    session.partition = originalPartition;
    expect(evaluate).toHaveBeenCalledTimes(9);
    evaluate.mockResolvedValueOnce({
      ...verified.fileReceipt,
      sha256: "f".repeat(64),
    });
    await expect(manager.runAutomation(enter)).rejects.toThrow("changed or is unavailable");
    expect(evaluate).toHaveBeenCalledTimes(10);
    evaluate.mockResolvedValueOnce(verified.fileReceipt).mockResolvedValueOnce("ok");
    await expect(manager.runAutomation(enter)).resolves.toEqual({
      url: originalUrl,
    });
    expect(evaluate.mock.calls[11]?.[1][0].code).toContain('"revealFileToken"');
  });

  it.each([
    ["https://docs.google.com/document/u/0/d/one", "https://docs.google.com/document/u/1/d/one"],
    [
      "https://docs.google.com/document/u/0/d/one",
      "https://docs.google.com/document/d/two?authuser=0",
    ],
    [
      "https://www.figma.com/design/One/QA?node-id=1-2",
      "https://www.figma.com/design/Two/QA?node-id=1-2",
    ],
    [
      "https://www.figma.com/design/One/QA?node-id=1-2",
      "https://www.figma.com/design/One/branch/Branch/QA?node-id=1-2",
    ],
  ])(
    "stops Quick Action replay from %s when the file or account changes to %s",
    async (url, destination) => {
      const manager = new BrowserHostManager(() => null);
      const origin = new URL(url).origin;
      const fixture = createMockSession({ currentUrl: url });
      const { session, webContents } = fixture;
      const { events } = mockNavigation(manager, fixture);
      const preventDefault = vi.fn();
      const evaluate = vi
        .fn()
        .mockResolvedValueOnce("missing")
        .mockImplementationOnce(async () => {
          events.emit("will-redirect", {
            isMainFrame: true,
            url: destination,
            preventDefault,
          });
          return "ok";
        })
        .mockResolvedValueOnce("missing")
        .mockImplementationOnce(async () => {
          session.currentUrl = destination;
          events.emit("did-navigate-in-page", {}, destination, true);
          session.currentUrl = url;
          events.emit("did-navigate-in-page", {}, url, true);
          return "ok";
        });
      Object.assign(webContents, {
        executeJavaScriptInIsolatedWorld: evaluate,
      });
      const target = {
        projectId: session.projectId,
        sessionId: session.sessionId,
        taskId: "qa",
      };
      const action = {
        id: crypto.randomUUID(),
        label: "Save report",
        origin,
        steps: [
          { action: "click", selector: "#save" },
          { action: "click", selector: "#confirm" },
        ],
        outcome: { selector: "#confirmation", description: "Report saved" },
      };
      const run = async () => {
        const [tab] = (await manager.runAutomation({
          ...target,
          source: "human",
          operation: "listQuickActionTargets",
          input: { action },
        })) as [{ token: string }];
        const { id } = (await manager.runAutomation({
          ...target,
          source: "human",
          operation: "authorizeQuickAction",
          input: { action, token: tab.token },
        })) as { id: string };
        return manager.runAutomation({
          ...target,
          source: "agent",
          operation: "runQuickAction",
          input: { actionId: action.id, approvalId: id },
        });
      };
      await expect(run()).rejects.toThrow("interrupted");
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(evaluate).toHaveBeenCalledTimes(2);
      await expect(run()).rejects.toThrow("interrupted");
      expect(evaluate).toHaveBeenCalledTimes(4);
      expect(evaluate.mock.calls[3]?.[1][0].code).toContain(`location.href === "${url}"`);
    },
  );

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

  describe("first-difference evidence approval", () => {
    it("rejects a reviewed draft after a reload or a same-document navigation away and back", async () => {
      const f = createEvidenceFixture();
      const { events } = mockNavigation(f.manager, f);
      await f.authorizePage();
      const url = f.session.currentUrl;
      const reviewed = f.state().pageApprovalToken;
      expect(reviewed).toBeTypeOf("string");
      events.emit("did-navigate", {}, url);
      expect(f.state().browserPageAuthorized).toBe(true);
      await expect(f.authorizeEvidence({ pageApprovalToken: reviewed })).rejects.toThrow(
        "page changed during review",
      );
      const afterReload = f.state().pageApprovalToken;
      expect(afterReload).not.toBe(reviewed);
      events.emit("did-navigate-in-page", {}, url + "#review", true);
      events.emit("did-navigate-in-page", {}, url, true);
      expect(f.state().browserPageAuthorized).toBe(true);
      f.attach.mockClear();
      await expect(f.authorizeEvidence({ pageApprovalToken: afterReload })).rejects.toThrow(
        "page changed during review",
      );
      expect(f.attach).not.toHaveBeenCalled();
      expect(f.state().deviceScreenshotAuthorized).toBe(false);
      f.attach.mockImplementationOnce(async () => {
        events.emit("did-navigate-in-page", {}, url + "#review", true);
        events.emit("did-navigate-in-page", {}, url, true);
        return "";
      });
      await expect(
        f.authorizeEvidence({ pageApprovalToken: f.state().pageApprovalToken }),
      ).rejects.toThrow("page changed during review");
      expect(f.state().deviceScreenshotAuthorized).toBe(false);
      await expect(
        f.authorizeEvidence({ pageApprovalToken: f.state().pageApprovalToken }),
      ).resolves.toMatchObject({
        grantIds: [expect.any(String), expect.any(String)],
      });
    });

    it("reserves both devices in one state update without editing page authority or navigating", async () => {
      const f = createEvidenceFixture();
      const { loadURL } = mockNavigation(f.manager, f);
      await f.authorizePage();
      const epoch = f.session.controlEpoch;
      const pageGrant = (f.session as { pageGrant?: object }).pageGrant;
      const emit = vi.spyOn(f.manager as any, "emitState");
      const {
        grantIds: [sourceId, targetId],
      } = await f.authorizeEvidence();
      expect(sourceId).not.toBe(targetId);
      expect(emit).toHaveBeenCalledOnce();
      expect(f.session.controlEpoch).toBe(epoch);
      expect((f.session as { pageGrant?: object }).pageGrant).toBe(pageGrant);
      expect(f.session.assignedTaskId).toBe(f.target.taskId);
      expect(f.session.controller).toBe("none");
      expect(loadURL).not.toHaveBeenCalled();
      expect(f.attach).toHaveBeenCalledExactlyOnceWith(999, [
        {
          code: expect.stringContaining('meta[name="tabs-screenshot-receipts"]'),
        },
      ]);
      f.attach.mockClear();
      await expect(f.transfer(sourceId, { phase: "inspect" })).resolves.toEqual({
        ...sourceDevice,
        firstDifference: { runId: evidenceRunId, side: "source" },
      });
      await expect(f.transfer(targetId, { phase: "inspect" })).resolves.toEqual({
        ...targetDevice,
        firstDifference: { runId: evidenceRunId, side: "target" },
      });
      expect(f.attach.mock.calls[0]?.[1][0].code).toContain(targetId);
      expect(f.attach.mock.calls[1]?.[1][0].code).toContain(sourceId);
      for (const frame of [
        undefined,
        { runId: evidenceRunId, side: "source" },
        { ...sourceFrame, step: 0 },
        { ...sourceFrame, step: "3" },
        { ...sourceFrame, runId: crypto.randomUUID() },
        targetFrame,
      ])
        await expect(f.transfer(sourceId, { frame })).rejects.toThrow("source");
      await expect(f.transfer(targetId, { frame: targetFrame })).rejects.toThrow("source");
      expect(f.attach).toHaveBeenCalledTimes(2);
      await expect(f.transfer(sourceId, { frame: sourceFrame })).resolves.toEqual({
        attached: true,
      });
      await expect(f.transfer(targetId, { ...targetDevice, frame: targetFrame })).resolves.toEqual({
        attached: true,
      });
      await expect(f.transfer(sourceId, { frame: sourceFrame })).rejects.toThrow("Approve");
      await expect(f.transfer(targetId, { ...targetDevice, frame: targetFrame })).rejects.toThrow(
        "Approve",
      );
    });

    it("requires the human owner and exact live tab, guest, profile, URL and page reference", async () => {
      const f = createEvidenceFixture();
      await expect(f.authorizeEvidence()).rejects.toThrow("exact destination tab");
      await f.authorizePage();
      await expect(f.authorizeEvidence({}, { source: "agent" })).rejects.toThrow("destination tab");
      await expect(f.authorizeEvidence({}, { taskId: "other" })).rejects.toThrow(
        "exact destination tab",
      );
      await expect(f.authorizeEvidence({}, { taskId: "" })).rejects.toThrow("destination tab");
      await expect(f.authorizeEvidence({}, { projectId: "other" })).rejects.toThrow("session");
      await expect(f.authorizeEvidence({}, { sessionId: "other" })).rejects.toThrow("session");
      for (const input of [
        { runId: "malformed" },
        { instanceId: "malformed" },
        { source: { ...sourceDevice, deviceId: "" } },
        { target: { ...targetDevice, hostId: " " } },
      ])
        await expect(f.authorizeEvidence(input)).rejects.toThrow("both comparison devices");
      for (const input of [
        { target: sourceDevice },
        { source: { ...sourceDevice, hostId: " build-mac" } },
      ])
        await expect(f.authorizeEvidence(input)).rejects.toThrow("distinct comparison devices");
      for (const input of [
        { instanceId: crypto.randomUUID() },
        { profileId: "personal" },
        { pageRef: "0".repeat(64) },
        { url: `${f.session.currentUrl}?draft=other` },
      ])
        await expect(f.authorizeEvidence(input)).rejects.toThrow("exact destination tab");
      Object.assign(f.webContents, { isLoadingMainFrame: () => true });
      await expect(f.authorizeEvidence()).rejects.toThrow("exact destination tab");
      Object.assign(f.webContents, { isLoadingMainFrame: () => false });
      f.manager.takeControl(f.target);
      await expect(f.authorizeEvidence()).rejects.toThrow("exact destination tab");
      expect(f.state().deviceScreenshotAuthorized).toBe(false);
      expect(f.attach).not.toHaveBeenCalled();
    });

    it("refuses evidence approval if the page revision changes while reading the receipt mode", async () => {
      const f = createEvidenceFixture();
      const { events } = mockNavigation(f.manager, f);
      await f.authorizePage();
      f.attach.mockImplementationOnce(async () => {
        events.emit("did-navigate", {}, f.session.currentUrl);
        return "same-origin-png";
      });
      await expect(f.authorizeEvidence()).rejects.toThrow("approved draft changed");
      expect(f.state().deviceScreenshotAuthorized).toBe(false);
    });

    it.each([
      "takeover",
      "revoke pair",
      "revoke page",
      "lost page grant",
      "navigation starts",
      "guest replacement",
      "live URL mismatch",
    ])("blocks both deferred transfers after %s", async (action) => {
      const f = createEvidenceFixture();
      const { events } = mockNavigation(f.manager, f);
      await f.authorizePage();
      const { grantIds } = await f.authorizeEvidence();
      await f.transfer(grantIds[0], { phase: "inspect" });
      await f.transfer(grantIds[1], { phase: "inspect" });
      f.attach.mockClear();
      if (action === "takeover") {
        f.manager.takeControl(f.target);
        await f.manager.resumeAgent(f.target);
      } else if (action === "revoke pair" || action === "revoke page") {
        await f.manager.runAutomation({
          ...f.target,
          source: "human",
          operation: action === "revoke pair" ? "revokeDeviceScreenshot" : "revokeBrowserPage",
          input: { grantIds },
        });
      } else if (action === "navigation starts") {
        events.emit("did-start-navigation", { isMainFrame: true }, f.session.currentUrl);
      } else if (action === "lost page grant") {
        Object.assign(f.session, { pageGrant: undefined });
      } else if (action === "guest replacement") {
        f.session.instanceId = crypto.randomUUID();
      } else {
        Object.assign(f.webContents, {
          getURL: () => `${f.session.currentUrl}?draft=other`,
        });
      }
      await expect(f.transfer(grantIds[0], { frame: sourceFrame })).rejects.toThrow("Approve");
      await expect(
        f.transfer(grantIds[1], { ...targetDevice, frame: targetFrame }),
      ).rejects.toThrow("Approve");
      expect(f.attach).not.toHaveBeenCalled();
    });

    it("keeps existing transfers when only one slot is free", async () => {
      const f = createEvidenceFixture();
      await f.authorizePage();
      const manualGrants = [];
      for (let i = 0; i < 7; i++) manualGrants.push((await f.authorize()).grantId);
      await expect(f.authorizeEvidence()).rejects.toThrow("pending screenshot transfer");
      await expect(f.authorize()).resolves.toEqual({
        grantId: expect.any(String),
      });
      for (const id of manualGrants)
        await expect(f.transfer(id, { phase: "inspect" })).resolves.toEqual(sourceDevice);
    });

    it("replaces unused grants from an earlier run while preserving manual transfers", async () => {
      const f = createEvidenceFixture();
      await f.authorizePage();
      const manualGrants = [];
      for (let i = 0; i < 6; i++) manualGrants.push((await f.authorize()).grantId);
      let { grantIds } = await f.authorizeEvidence();
      await expect(f.authorizeEvidence()).rejects.toThrow("pending screenshot transfer");
      await expect(f.transfer(grantIds[0], { phase: "inspect" })).resolves.toMatchObject({
        firstDifference: { runId: evidenceRunId, side: "source" },
      });

      for (let i = 0; i < 5; i++) {
        const previous = grantIds;
        const runId = crypto.randomUUID();
        await expect(f.authorizeEvidence({ runId, pageRef: "wrong-page" })).rejects.toThrow(
          "exact destination tab",
        );
        await expect(f.transfer(previous[0], { phase: "inspect" })).resolves.toMatchObject(
          sourceDevice,
        );
        ({ grantIds } = await f.authorizeEvidence({ runId }));
        for (const id of previous)
          await expect(f.transfer(id, { phase: "inspect" })).rejects.toThrow("Approve");
        await expect(f.transfer(grantIds[0], { phase: "inspect" })).resolves.toMatchObject({
          firstDifference: { runId, side: "source" },
        });
      }
      for (const id of manualGrants)
        await expect(f.transfer(id, { phase: "inspect" })).resolves.toEqual(sourceDevice);
    });
  });

  describe("device screenshot pair approval", () => {
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

    it("grants page control and both exact frames in one state update", async () => {
      const f = createUploadFixture();
      const emit = vi.spyOn(f.manager as any, "emitState");
      const { grantIds } = await f.authorizePair([source, target]);
      const [sourceId, targetId] = grantIds;
      expect(grantIds).toHaveLength(2);
      expect(sourceId).not.toBe(targetId);
      expect(emit).toHaveBeenCalledOnce();
      expect(f.session.assignedTaskId).toBe(f.target.taskId);
      expect(f.manager.getSessionState(f.target.projectId, f.target.sessionId)).toMatchObject({
        browserPageAuthorized: true,
        deviceScreenshotAuthorized: true,
      });
      await expect(f.transfer(sourceId, { phase: "inspect" })).resolves.toEqual(source);
      await expect(f.transfer(targetId, { phase: "inspect" })).resolves.toEqual(target);
      await expect(f.transfer(sourceId, target)).rejects.toThrow("source");
      await expect(f.transfer(targetId, source)).rejects.toThrow("source");
      await expect(f.transfer(sourceId, source)).resolves.toEqual({
        attached: true,
      });
      await expect(f.transfer(targetId, target)).resolves.toEqual({
        attached: true,
      });
    });

    it.skipIf(process.env.TABS_QA_BROWSER !== "1").each(["manual", "first-difference"])(
      "keeps %s screenshots in distinct file inputs after page code clears the first input",
      async (approval) => {
        const f = createEvidenceFixture();
        const deferred = approval === "first-difference";
        if (deferred) await f.authorizePage();
        const {
          grantIds: [sourceId, targetId],
        } = deferred ? await f.authorizeEvidence() : await f.authorizePair([source, target]);
        const sourceTransfer = deferred ? { ...sourceDevice, frame: sourceFrame } : source;
        const targetTransfer = deferred ? { ...targetDevice, frame: targetFrame } : target;
        const { chromium } = await import("playwright");
        const browser = await chromium.launch();
        onTestFinished(async () => browser.close());
        const page = await browser.newPage();
        await page.route("**/*", (route) =>
          route.fulfill({
            contentType: "text/html",
            body: '<input id="first" type="file"><input id="second" type="file">',
          }),
        );
        await page.goto(f.session.currentUrl);
        const cdp = await page.context().newCDPSession(page);
        const { frameTree } = await cdp.send("Page.getFrameTree");
        const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
          frameId: frameTree.frame.id,
          worldName: "paired-screenshots",
        });
        f.attach.mockImplementation(async (_world: number, [{ code }]: [{ code: string }]) => {
          const result = await cdp.send("Runtime.evaluate", {
            expression: code,
            contextId: executionContextId,
            returnByValue: true,
          });
          if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
          return result.result.value;
        });
        await expect(
          f.transfer(sourceId, { phase: "inspect", selector: "#first" }),
        ).resolves.toMatchObject(sourceDevice);
        await expect(
          f.transfer(targetId, { phase: "inspect", selector: "#first" }),
        ).rejects.toThrow("file input");
        await expect(
          f.transfer(sourceId, { ...sourceTransfer, selector: "#first" }),
        ).resolves.toEqual({ attached: true });
        await page.locator("#first").evaluate((input: HTMLInputElement) => {
          input.value = "";
        });
        await expect(
          f.transfer(targetId, { phase: "inspect", selector: "#first" }),
        ).rejects.toThrow("file input");
        await page.locator("#first").evaluate((input) => input.replaceWith(input.cloneNode()));
        await expect(
          f.transfer(targetId, { phase: "inspect", selector: "#first" }),
        ).rejects.toThrow("file input");
        await expect(
          f.transfer(targetId, { phase: "inspect", selector: "#second" }),
        ).resolves.toMatchObject(targetDevice);
        await expect(
          f.transfer(targetId, { ...targetTransfer, selector: "#second" }),
        ).resolves.toEqual({ attached: true });
      },
    );

    it.each([
      { name: "a single frame", frames: [source] },
      { name: "an extra frame", frames: [source, target, target] },
      { name: "a missing host", frames: [{ ...source, hostId: "" }, target] },
      {
        name: "a padded device ID",
        frames: [source, { ...target, deviceId: " same-id " }],
      },
      {
        name: "the same exact device",
        frames: [source, { ...target, hostId: source.hostId }],
      },
      { name: "reversed sides", frames: [target, source] },
      {
        name: "repeated sides",
        frames: [source, { ...target, frame: source.frame }],
      },
      {
        name: "different runs",
        frames: [
          source,
          {
            ...target,
            frame: {
              ...target.frame,
              runId: "92724452-d32a-42f1-9771-75656595c622",
            },
          },
        ],
      },
      {
        name: "different steps",
        frames: [source, { ...target, frame: { ...target.frame, step: 3 } }],
      },
    ])("rejects $name without granting access", async ({ frames }) => {
      const f = createUploadFixture();
      await expect(f.authorizePair(frames)).rejects.toThrow(/exact devices|distinct source/);
      expect(f.session.assignedTaskId).toBeNull();
      expect(f.manager.getSessionState(f.target.projectId, f.target.sessionId)).toMatchObject({
        browserPageAuthorized: false,
        deviceScreenshotAuthorized: false,
      });
    });

    it("requires the current guest, profile, page and human thread", async () => {
      const f = createUploadFixture({ assignedTaskId: "thread-1" });
      const pair = [source, target];
      await expect(f.authorizePair(pair, {}, { source: "agent" })).rejects.toThrow("approve");
      await expect(f.authorizePair(pair, {}, { taskId: "" })).rejects.toThrow("approve");
      await expect(f.authorizePair(pair, {}, { taskId: "other-thread" })).rejects.toThrow(
        "another thread",
      );
      for (const input of [
        { instanceId: "another-guest" },
        { instanceId: undefined },
        { profileId: "personal" },
        { url: `${f.session.currentUrl}?view=other` },
      ]) {
        await expect(f.authorizePair(pair, input)).rejects.toThrow("destination page");
      }
      Object.assign(f.webContents, { isLoadingMainFrame: () => true });
      await expect(f.authorizePair(pair)).rejects.toThrow("destination page");
      Object.assign(f.webContents, { isLoadingMainFrame: () => false });
      f.manager.takeControl(f.target);
      await expect(f.authorizePair(pair)).rejects.toThrow("Return control");
      await f.manager.resumeAgent(f.target);
      Object.assign(f.session, { instanceId: "replacement-guest" });
      await expect(f.authorizePair(pair)).rejects.toThrow("destination page");
      expect(f.session.assignedTaskId).toBe(f.target.taskId);
      expect(f.manager.getSessionState(f.target.projectId, f.target.sessionId)).toMatchObject({
        browserPageAuthorized: false,
        deviceScreenshotAuthorized: false,
      });
    });

    it("leaves existing individual grants usable when only one slot is free", async () => {
      const f = createUploadFixture();
      const existing = [];
      for (let i = 0; i < 7; i++) existing.push((await f.authorize()).grantId);
      const epoch = f.session.controlEpoch;

      await expect(f.authorizePair([source, target])).rejects.toThrow(
        "pending screenshot transfer",
      );
      expect(f.session.controlEpoch).toBe(epoch);
      expect(f.manager.getSessionState(f.target.projectId, f.target.sessionId)).toMatchObject({
        browserPageAuthorized: false,
        deviceScreenshotAuthorized: true,
      });
      await expect(f.authorize()).resolves.toEqual({
        grantId: expect.any(String),
      });
      await expect(f.authorize()).rejects.toThrow("pending screenshot transfer");
      for (const id of existing)
        await expect(f.transfer(id, { phase: "inspect" })).resolves.toMatchObject({
          hostId: source.hostId,
          deviceId: source.deviceId,
        });
    });

    it("revokes just the specified pair while keeping individual grants usable", async () => {
      const f = createUploadFixture();
      const { grantId } = await f.authorize();
      const { grantIds } = await f.authorizePair([source, target]);
      const revoke = (ids: unknown) =>
        f.manager.runAutomation({
          ...f.target,
          operation: "revokeDeviceScreenshot",
          source: "human",
          input: { grantIds: ids },
        });

      await expect(revoke([grantIds[0], null])).rejects.toThrow("exact screenshot grants");
      await expect(f.transfer(grantIds[0], { phase: "inspect" })).resolves.toEqual(source);
      await expect(revoke(grantIds)).resolves.toBeUndefined();
      for (const id of grantIds)
        await expect(f.transfer(id, { phase: "inspect" })).rejects.toThrow("Approve");
      await expect(f.transfer(grantId, { phase: "inspect" })).resolves.toEqual({
        hostId: source.hostId,
        deviceId: source.deviceId,
      });
      expect(f.manager.getSessionState(f.target.projectId, f.target.sessionId)).toMatchObject({
        browserPageAuthorized: true,
        deviceScreenshotAuthorized: true,
      });
    });
  });

  it("keeps separate source and destination frame approvals for the same draft", async () => {
    const f = createUploadFixture();
    const first = {
      runId: "92724452-d32a-42f1-9771-75656595c621",
      side: "source",
      step: 2,
    };
    const second = { ...first, side: "target" };
    const a = await f.authorize("human", {
      frame: first,
      allowPageControl: true,
    });
    const b = await f.authorize("human", {
      frame: second,
      allowPageControl: true,
    });
    await expect(f.transfer(a.grantId, { phase: "inspect" })).resolves.toMatchObject({
      frame: first,
    });
    await expect(f.transfer(b.grantId, { phase: "inspect" })).resolves.toMatchObject({
      frame: second,
    });
    await expect(f.transfer(a.grantId, { frame: second })).rejects.toThrow("source");
    await expect(f.transfer(a.grantId)).rejects.toThrow("source");
    await expect(f.transfer(a.grantId, { frame: first })).resolves.toEqual({
      attached: true,
    });
    await expect(f.transfer(b.grantId, { frame: second })).resolves.toEqual({
      attached: true,
    });
  });

  it("rejects a direct screenshot attach without a device authorization callback", async () => {
    const f = createUploadFixture();
    const { grantId } = await f.authorize();
    await expect(
      f.manager.runAutomation({
        ...f.target,
        operation: "deviceScreenshotUpload",
        source: "agent",
        input: {
          phase: "attach",
          grantId,
          hostId: "build-mac",
          deviceId: "same-id",
          selector: "#file",
          png: "AAAA",
        },
      }),
    ).rejects.toThrow("current device authorization");
    expect(f.attach).not.toHaveBeenCalled();
  });

  it.each(["queue", "surface preparation"])(
    "checks device authorization after %s and rejects a revoked transfer before the file input",
    async (delay) => {
      const f = createUploadFixture();
      const { grantId } = await f.authorize();
      const blocker = deferred<void>();
      const preparing = deferred<void>();
      const authorize = vi.fn(async () => false);
      if (delay === "queue") {
        f.session.automationTail = blocker.promise;
      } else {
        vi.spyOn(f.manager as any, "withAutomationSurface").mockImplementation(
          async (_session, run) => {
            preparing.resolve();
            await blocker.promise;
            return (run as () => Promise<unknown>)();
          },
        );
      }
      const rejected = expect(f.transfer(grantId, {}, authorize)).rejects.toThrow(
        "Device access changed",
      );
      if (delay === "surface preparation") await preparing.promise;
      expect(authorize).not.toHaveBeenCalled();
      blocker.resolve();
      await rejected;
      expect(authorize).toHaveBeenCalledOnce();
      expect(f.attach).not.toHaveBeenCalled();
      expect(f.manager.getSessionState(f.target.projectId, f.target.sessionId)).toMatchObject({
        deviceScreenshotAuthorized: true,
      });
      expect(f.session).not.toHaveProperty("screenshotAttempts");
    },
  );

  it.each(["page changes", "grant is revoked"])(
    "checks the browser grant again if the %s while device authorization is pending",
    async (change) => {
      const f = createUploadFixture();
      const { grantId } = await f.authorize();
      const checking = deferred<void>();
      const reply = deferred<boolean>();
      const rejected = expect(
        f.transfer(grantId, {}, () => {
          checking.resolve();
          return reply.promise;
        }),
      ).rejects.toThrow("Approve this screenshot transfer again");
      await checking.promise;
      if (change === "page changes") Object.assign(f.session, { pageRevision: 1 });
      else
        await f.manager.runAutomation({
          ...f.target,
          source: "human",
          operation: "revokeDeviceScreenshot",
          input: { grantId },
        });
      reply.resolve(true);
      await rejected;
      expect(f.attach).not.toHaveBeenCalled();
    },
  );

  it("checks consent, exact device and single-use receipt before giving a page bytes", async () => {
    const f = createUploadFixture();
    await expect(f.authorize("agent")).rejects.toThrow("approve");
    const { grantId } = await f.authorize();
    await expect(f.transfer(grantId, { phase: "inspect" })).resolves.toEqual({
      hostId: "build-mac",
      deviceId: "same-id",
    });
    await expect(f.transfer(grantId, { hostId: "local" })).rejects.toThrow("source");
    const outcomes = await Promise.allSettled([f.transfer(grantId), f.transfer(grantId)]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["fulfilled", "rejected"]);
    expect(f.attach).toHaveBeenCalledTimes(2);
  });

  it.each(["revocation", "takeover"])(
    "does not record a screenshot selection whose reply arrives after %s",
    async (interruption) => {
      const f = createUploadFixture();
      const { grantId } = await f.authorize();
      const dispatched = deferred<void>();
      const reply = deferred<boolean>();
      f.attach.mockImplementationOnce(() => {
        dispatched.resolve();
        return reply.promise;
      });
      const rejected = expect(f.transfer(grantId)).rejects.toThrow();
      await dispatched.promise;
      if (interruption === "takeover") f.manager.takeControl(f.target);
      else
        await f.manager.runAutomation({
          ...f.target,
          source: "human",
          operation: "revokeDeviceScreenshot",
          input: { grantId },
        });
      reply.resolve(true);
      await rejected;
      expect(f.session).not.toHaveProperty("screenshotDrafts");
      await expect(f.transfer(grantId, { phase: "inspect" })).rejects.toThrow();
      expect(f.attach).toHaveBeenCalledOnce();
    },
  );

  it.skipIf(process.env.TABS_QA_BROWSER !== "1")(
    "recovers a screenshot selection after a lost reply without re-dispatching input",
    async () => {
      const f = createUploadFixture();
      const { grantId } = await f.authorize();
      const { chromium } = await import("playwright");
      const browser = await chromium.launch();
      onTestFinished(async () => browser.close());
      const page = await browser.newPage();
      await page.route("**/*", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<input id="file" type="file"><output id="events">0</output>
            <script>document.querySelector("#file").addEventListener("change", () => {
              const output = document.querySelector("#events");
              output.textContent = String(Number(output.textContent) + 1);
            });</script>`,
        }),
      );
      await page.goto(f.session.currentUrl);
      const cdp = await page.context().newCDPSession(page);
      const { frameTree } = await cdp.send("Page.getFrameTree");
      const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
        frameId: frameTree.frame.id,
        worldName: "screenshot-retry",
      });
      const evaluate = async (_world: number, [{ code }]: [{ code: string }]) => {
        const result = await cdp.send("Runtime.evaluate", {
          expression: code,
          contextId: executionContextId,
          returnByValue: true,
        });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
        return result.result.value;
      };
      f.attach.mockImplementation(evaluate);
      const inspect = (selector = "#file") => f.transfer(grantId, { phase: "inspect", selector });
      await inspect();
      f.attach.mockImplementationOnce(async (...args: Parameters<typeof evaluate>) => {
        expect(await evaluate(...args)).toBe(true);
        throw new Error("reply lost after dispatch");
      });
      await expect(f.transfer(grantId)).rejects.toThrow("reply lost");
      await expect(f.transfer(grantId)).rejects.toThrow("Approve");
      await expect(inspect("input")).rejects.toThrow("selection changed");
      const receipt = {
        ...sourceDevice,
        selection: {
          sha256: createHash("sha256").update(Buffer.from("AAAA", "base64")).digest("hex"),
          sizeBytes: 3,
        },
      };
      await expect(inspect()).resolves.toEqual(receipt);
      await expect(inspect()).resolves.toEqual(receipt);
      expect(await page.locator("#events").innerText()).toBe("1");
      await page.locator("#file").evaluate((input: HTMLInputElement) => {
        const files = new DataTransfer();
        files.items.add(new File(["abc"], input.files![0]!.name, { type: "image/png" }));
        input.files = files.files;
      });
      await expect(inspect()).rejects.toThrow("selection changed");
      expect(await page.locator("#events").innerText()).toBe("1");
      await f.manager.runAutomation({
        ...f.target,
        source: "human",
        operation: "revokeDeviceScreenshot",
        input: { grantId },
      });
      await expect(inspect()).rejects.toThrow("Approve");
    },
  );

  it("reopens the original attachment in history only after the exact page loads", async () => {
    const fixture = createUploadFixture();
    const { manager, target, session } = fixture;
    const original = "https://docs.google.com/document/u/0/d/one?mode=edit";
    const other = "https://docs.google.com/document/u/1/d/two";
    session.currentUrl = original;
    const { events, goToIndex, loadURL } = mockNavigation(manager, fixture, [other, original]);
    const pageRef = manager.getSessionState(target.projectId, target.sessionId).pageRef!;
    session.currentUrl = other;
    const enter = (input: Record<string, unknown> = {}) =>
      manager.runAutomation({
        ...target,
        source: "human",
        operation: "enterAttachedPage",
        input: { pageRef, profileId: "work", ...input },
      });
    await expect(enter({ profileId: "personal" })).rejects.toThrow("approved browser profile");
    const guessedRef = createHash("sha256")
      .update(JSON.stringify([target.projectId, target.sessionId, session.partition, original]))
      .digest("hex");
    await expect(enter({ pageRef: guessedRef })).rejects.toThrow("history");
    expect(goToIndex).not.toHaveBeenCalled();
    const redirected = enter();
    const preventDefault = vi.fn();
    events.emit("will-redirect", {
      isMainFrame: true,
      url: other,
      preventDefault,
    });
    await expect(redirected).rejects.toThrow("exact attached page");
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(events.listenerCount("did-finish-load")).toBe(0);
    await manager.runAutomation({
      ...target,
      source: "human",
      operation: "authorizeBrowserPage",
      input: { url: other, profileId: "work" },
    });
    let finished = false;
    const result = enter().then((value) => {
      finished = true;
      return value;
    });
    expect(goToIndex.mock.calls).toEqual([[1], [1]]);
    session.currentUrl = original;
    events.emit("did-navigate", {}, original);
    await Promise.resolve();
    expect(finished).toBe(false);
    events.emit("did-finish-load");
    await expect(result).resolves.toEqual({ result: "attached_page" });
    expect(manager.getSessionState(target.projectId, target.sessionId).browserPageAuthorized).toBe(
      false,
    );
    expect(loadURL).not.toHaveBeenCalled();
    expect(events.listenerCount("did-finish-load")).toBe(0);
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

  describe("saved browser attachments", () => {
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

    it.skipIf(process.env.TABS_QA_BROWSER !== "1")(
      "reopens an exact website-backed Quick Action file after restart without running the action again",
      async () => {
        const f = await setup();
        const { chromium } = await import("playwright");
        const browser = await chromium.launch();
        onTestFinished(async () => browser.close());
        const work = await browser.newContext();
        let exports = 0;
        let reads = 0;
        let report = "name,result\ncheckout,pass\n";
        const link = '<a id="report" href="/files/42" download="report.csv">Download report</a>';
        await work.route("https://app.test/**", (route) => {
          const path = new URL(route.request().url()).pathname;
          if (path === "/export") {
            expect(route.request().method()).toBe("POST");
            exports++;
            return route.fulfill({ status: 204 });
          }
          if (path === "/files/42") {
            expect(route.request().method()).toBe("GET");
            reads++;
            return route.fulfill({
              contentType: "text/csv",
              headers: {
                "content-disposition": 'attachment; filename="report.csv"',
              },
              body: report,
            });
          }
          return route.fulfill({
            contentType: "text/html",
            body: `<button id="export">Export</button>
              <div id="result">${exports ? link : ""}</div>
              <script>
                document.querySelector("#export").onclick = async () => {
                  await fetch("/export", { method: "POST" });
                  document.querySelector("#result").innerHTML = ${JSON.stringify(link)};
                };
              </script>`,
          });
        });
        const original = await work.newPage();
        await original.goto(f.address);
        await connectChromiumPage(original, f);
        const action = {
          id: crypto.randomUUID(),
          label: "Export report",
          origin: new URL(f.address).origin,
          steps: [{ action: "click", selector: "#export" }],
          outcome: {
            selector: "#report",
            description: "Report ready",
            filenamePattern: "report.csv",
          },
        };
        const [target] = (await f.manager.runAutomation({
          ...f.request,
          operation: "listQuickActionTargets",
          input: { action },
        })) as [{ token: string }];
        const { id } = (await f.manager.runAutomation({
          ...f.request,
          operation: "authorizeQuickAction",
          input: { action, token: target.token },
        })) as { id: string };
        const result = (await f.manager.runAutomation({
          ...f.request,
          source: "agent",
          operation: "runQuickAction",
          input: { actionId: action.id, approvalId: id },
        })) as { fileResult: { resultId: string } };
        expect(result).toMatchObject({
          status: "pass",
          fileResult: {
            profileId: "work",
            filename: "report.csv",
            restorable: true,
          },
        });
        expect(result).not.toHaveProperty("websiteFile");
        await original.close();

        const restarted = new BrowserHostManager(() => null);
        const enter = {
          ...f.request,
          operation: "enterQuickActionFileResult",
          input: { resultId: result.fileResult.resultId },
        } as const;
        const otherProfile = f.tab(restarted, "about:blank", {
          profileId: "personal",
          partition: "persist:tabs-browser:profile:personal",
        });
        await expect(restarted.runAutomation(enter)).rejects.toThrow("original browser tab");
        expect(otherProfile.loadURL).not.toHaveBeenCalled();
        const restored = await work.newPage();
        const tab = f.tab(restarted, restored.url());
        await connectChromiumPage(restored, tab);
        tab.loadURL.mockImplementation(async (url) => {
          await restored.goto(url);
          tab.session.currentUrl = restored.url();
          tab.events.emit("did-navigate", {}, restored.url());
        });
        await expect(restarted.runAutomation({ ...enter, taskId: "other" })).rejects.toThrow(
          "original thread",
        );
        expect(tab.loadURL).not.toHaveBeenCalled();
        expect(reads).toBe(1);
        await expect(restarted.runAutomation(enter)).resolves.toEqual({
          url: f.address,
        });
        expect(tab.loadURL).toHaveBeenCalledExactlyOnceWith(f.address);
        expect(reads).toBe(2);
        report = "name,result\ncheckout,fail\n";
        await expect(restarted.runAutomation(enter)).rejects.toThrow("changed or is unavailable");
        expect(reads).toBe(3);
        expect(exports).toBe(1);
      },
    );

    describe("Figma canvas consent", () => {
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

      it("binds exact frame and connector identity to one explicit confirmation", async () => {
        const f = await setupFigma();
        await expect(f.inspect()).rejects.toThrow("Approve browser access");
        f.events.emit(
          "did-navigate-in-page",
          {},
          address.replace("35-12", "35%3A12") + "&view=edit",
          true,
        );
        const { approval, write } = await proposed(f);
        expect(write.target).toEqual({
          projectId: f.request.projectId,
          tabId: f.request.sessionId,
          profileId: f.input.profileId,
          hostKey: expect.any(String),
          attachmentId: f.attachmentId,
          mainFileKey: "mainKey",
          fileKey: "branchKey",
          nodeId: "35:12",
        });
        expect(approval).toEqual({ id: expect.any(String), ...write });
        expect(f.pending()).toEqual(approval);
        await expect(f.authorize(write)).resolves.toEqual({
          approval,
          status: "approval_required",
        });
        await expect(f.confirm(crypto.randomUUID())).rejects.toThrow("Review the current Figma");
        await expect(f.confirm(approval.id, { taskId: "other-thread" })).rejects.toThrow(
          "Review the current Figma",
        );
        await expect(
          f.manager.runAutomation({
            ...f.request,
            source: "agent",
            operation: "authorizeFigmaCanvas",
            input: { approvalId: approval.id },
          }),
        ).rejects.toThrow("Review the current Figma");
        await expect(f.confirm(approval.id)).resolves.toEqual({
          approved: true,
          approval,
        });
        expect(f.pending()).toBeUndefined();
        await expect(f.confirm(approval.id)).rejects.toThrow("Review the current Figma");

        for (const override of [
          { email: "other@example.com" },
          { operationId: "b".repeat(64) },
          { frame: { ...write.frame, text: "Changed text" } },
          { frame: { ...write.frame, width: 361 } },
        ])
          await expect(f.authorize({ ...write, ...override })).rejects.toThrow(
            "different frame request",
          );
        for (const override of [
          { nodeId: "35:13" },
          { fileKey: "differentBranch" },
          { mainFileKey: "differentFile" },
          { hostKey: "differentHost" },
          { attachmentId: crypto.randomUUID() },
        ])
          await expect(
            f.authorize({ ...write, target: { ...write.target, ...override } }),
          ).rejects.toThrow("Inspect the attached Figma node again");
        await expect(f.inspect()).resolves.toEqual(write.target);
        const results = await Promise.allSettled([f.authorize(write), f.authorize(write)]);
        expect(results.filter((result) => result.status === "fulfilled")).toEqual([
          { status: "fulfilled", value: { status: "approved", approval } },
        ]);
        await expect(f.dispatch({ ...approval, id: crypto.randomUUID() })).rejects.toThrow(
          "Review the current Figma",
        );
        await expect(f.dispatch(approval)).resolves.toBe(true);
        await expect(f.dispatch(approval)).rejects.toThrow("Review the current Figma");
        const next = await f.authorize(write);
        expect(next.status).toBe("approval_required");
        expect(next.approval.id).not.toBe(approval.id);
        expect(f.loadURL).not.toHaveBeenCalled();
        expect(f.executeJavaScript).not.toHaveBeenCalled();
        expect(f.sendInputEvent).not.toHaveBeenCalled();
      });

      it("requires the saved attachment and a fresh grant after restart", async () => {
        const f = await setupFigma();
        const other = await f.capture();
        await f.grant();
        const attachmentFile = join(f.userData, "browser-attachment-bookmarks", f.attachmentId);
        const attachment: BrowserAttachmentBookmark = JSON.parse(
          await readFile(attachmentFile, "utf8"),
        );
        await expect(
          f.authorize({
            target: {
              projectId: attachment.projectId,
              tabId: PreviewTabId.make(attachment.tabId),
              profileId: attachment.profileId,
              hostKey: attachment.hostKey,
              attachmentId: f.attachmentId,
              mainFileKey: "mainKey",
              fileKey: "branchKey",
              nodeId: "35:12",
            },
            operationId: "a".repeat(64),
            email: "design@example.com",
            frame: { name: "Frame", text: "Text", width: 360, height: 240 },
          }),
        ).rejects.toThrow("Review the current Figma");
        await expect(f.inspect(undefined, { taskId: "other-thread" })).rejects.toThrow(
          "original desktop",
        );
        await expect(
          f.inspect({ attachmentId: f.attachmentId, profileId: "personal" }),
        ).rejects.toThrow("original desktop");
        const restarted = new BrowserHostManager(() => null);
        f.tab(restarted, address);
        await expect(f.inspect(undefined, {}, restarted)).rejects.toThrow("Approve browser access");
        await f.grant(restarted, address);
        await expect(f.inspect(undefined, {}, restarted)).resolves.toMatchObject({
          attachmentId: f.attachmentId,
          fileKey: "branchKey",
          nodeId: "35:12",
        });
        const { approval, write } = await proposed(f);
        await expect(
          f.inspect({ attachmentId: other.attachmentId!, profileId: "work" }),
        ).rejects.toThrow("different attachment");
        await writeFile(
          attachmentFile,
          JSON.stringify({ ...attachment, url: address + "&view=another" }),
        );
        await expect(f.confirm(approval.id)).rejects.toThrow(
          "Inspect the attached Figma node again",
        );
        expect(f.pending()).toBeUndefined();
        await expect(f.authorize(write)).rejects.toThrow("Review the current Figma");
      });

      it("rechecks browser takeover at dispatch after connector setup", async () => {
        const f = await setupFigma();
        const { approval, write } = await proposed(f);
        await f.confirm(approval.id);
        await f.authorize(write);
        f.manager.takeControl(f.request);
        await f.manager.resumeAgent(f.request);
        await expect(f.dispatch(approval)).rejects.toThrow("Review the current Figma");
      });

      it("reopens a saved frame on its exact branch and rejects other targets", async () => {
        const f = await setupFigma();
        await f.grant();
        const target = await f.inspect();
        const restarted = new BrowserHostManager(() => null);
        const tab = f.tab(restarted, "about:blank");
        const receipt = {
          target,
          frameNodeId: "35:90",
          textNodeId: "35:91",
          verifiedAt: "2026-11-26T00:00:00Z",
        };
        const enter = (input: object) =>
          restarted.runAutomation({
            ...f.request,
            operation: "enterFigmaCanvasResult",
            input,
          });
        await expect(
          enter({ ...receipt, target: { ...target, fileKey: "otherBranch" } }),
        ).rejects.toThrow("original desktop");
        expect(tab.loadURL).not.toHaveBeenCalled();
        const opened = enter(receipt);
        const url = address.replace("35-12", "35-90");
        await vi.waitFor(() => expect(tab.loadURL).toHaveBeenCalledExactlyOnceWith(url));
        tab.events.emit("did-finish-load");
        await expect(opened).resolves.toEqual({ url });
        expect(
          restarted.getSessionState(f.request.projectId, f.request.sessionId).browserPageAuthorized,
        ).toBe(false);
      });

      it("reopens the same frame when Figma normalizes the Design URL", async () => {
        const original = address.replace("/design/", "/file/") + "&fuid=123&view=fit";
        const f = await setupFigma(original);
        await f.grant();
        const target = await f.inspect();
        const restarted = new BrowserHostManager(() => null);
        const tab = f.tab(restarted, "about:blank");
        const expected = original.replace("35-12", "35-90");
        const normalized =
          "https://www.figma.com/design/mainKey/branch/branchKey/New-title?view=fit&node-id=35%3A90&fuid=123";
        const request = {
          ...f.request,
          operation: "enterFigmaCanvasResult",
          input: {
            target,
            frameNodeId: "35:90",
            textNodeId: "35:91",
            verifiedAt: "2026-11-26T00:00:00Z",
          },
        };
        const preventDefault = vi.fn();
        const normalizedInPage = deferred<void>();
        const finishLoading = deferred<void>();
        tab.loadURL.mockImplementationOnce(async () => {
          tab.events.emit("will-redirect", {
            isMainFrame: true,
            url: normalized,
            preventDefault,
          });
          tab.session.currentUrl = normalized;
          tab.session.loading = true;
          tab.events.emit("did-navigate-in-page", {}, normalized, true);
          normalizedInPage.resolve();
          await finishLoading.promise;
          tab.session.loading = false;
          tab.events.emit("did-finish-load");
        });
        const opened = restarted.runAutomation(request);
        await normalizedInPage.promise;
        const pageCheck = `location.href === ${JSON.stringify(normalized)} && (${PAGE_READY_FOR_AGENT})`;
        const checksWhileLoading = tab.evaluate.mock.calls.filter(([, scripts]) =>
          scripts.some(({ code }) => code.startsWith(pageCheck)),
        );
        finishLoading.resolve();
        await expect(opened).resolves.toEqual({ url: normalized });
        expect(checksWhileLoading).toEqual([]);
        expect(preventDefault).not.toHaveBeenCalled();
        expect(tab.loadURL).toHaveBeenCalledExactlyOnceWith(expected);

        // Re-enter the current verified node without another navigation.
        await expect(restarted.runAutomation(request)).resolves.toEqual({
          url: normalized,
        });
        expect(tab.loadURL).toHaveBeenCalledOnce();
      });

      it("blocks a frame redirect with a different node, file, origin, or account URL", async () => {
        const original = address + "&fuid=123";
        const f = await setupFigma(original);
        await f.grant();
        const target = await f.inspect();
        const restarted = new BrowserHostManager(() => null);
        const tab = f.tab(restarted, "about:blank");
        const request = {
          ...f.request,
          operation: "enterFigmaCanvasResult",
          input: {
            target,
            frameNodeId: "35:90",
            textNodeId: "35:91",
            verifiedAt: "2026-11-26T00:00:00Z",
          },
        };
        const expected = original.replace("35-12", "35-90");
        for (const url of [
          expected.replace("35-90", "35-91"),
          expected.replace("branchKey", "otherBranch"),
          expected.replace("mainKey", "otherFile"),
          expected.replace("www.figma.com", "figma.com"),
          expected.replace("123", "456"),
          expected + "&node-id=35-90",
          expected + "&access_token=private",
          "https://www.figma.com/login",
        ]) {
          const preventDefault = vi.fn();
          tab.loadURL.mockImplementationOnce(async () => {
            tab.events.emit("will-redirect", {
              isMainFrame: true,
              url,
              preventDefault,
            });
          });
          await expect(restarted.runAutomation(request)).rejects.toThrow(
            "exact saved attachment URL",
          );
          expect(preventDefault).toHaveBeenCalledOnce();
          expect(tab.session.currentUrl).toBe("about:blank");
        }
      });

      it.skipIf(process.env.TABS_QA_BROWSER !== "1")(
        "verifies the normalized frame in the loaded Chromium document",
        async () => {
          const f = await setupFigma(address.replace("/design/", "/file/"));
          await f.grant();
          const target = await f.inspect();
          const restarted = new BrowserHostManager(() => null);
          const tab = f.tab(restarted, "about:blank");
          const { chromium } = await import("playwright");
          const browser = await chromium.launch();
          onTestFinished(async () => browser.close());
          const page = await browser.newPage();
          const normalized =
            "https://www.figma.com/design/mainKey/branch/branchKey/Renamed?node-id=35%3A90";
          await page.route("**/*", (route) => {
            if (route.request().url() !== f.address.replace("35-12", "35-90")) return route.abort();
            return route.fulfill({
              contentType: "text/html",
              body: `<canvas aria-label="Verified frame"></canvas>
                <script>history.replaceState(null, "", ${JSON.stringify(normalized)})</script>`,
            });
          });
          await connectChromiumPage(page, tab);
          tab.loadURL.mockImplementation(async (destination) => {
            await page.goto(destination);
            tab.events.emit("did-navigate", {}, page.url());
          });
          const request = {
            ...f.request,
            operation: "enterFigmaCanvasResult",
            input: {
              target,
              frameNodeId: "35:90",
              textNodeId: "35:91",
              verifiedAt: "2026-11-26T00:00:00Z",
            },
          };

          await expect(restarted.runAutomation(request)).resolves.toEqual({
            url: normalized,
          });
          expect(await page.getByLabel("Verified frame").count()).toBe(1);
          await page.evaluate(() => {
            const protectedInput = document.createElement("input");
            protectedInput.type = "password";
            document.body.append(protectedInput);
          });
          await expect(restarted.runAutomation(request)).rejects.toThrow("protected content");
          expect(tab.loadURL).toHaveBeenCalledOnce();
        },
      );

      it.each([
        address.replace("?node-id=35-12", ""),
        address + "&node-id=35-12",
        address.replace("/design/", "/proto/"),
        address.replace("https://", "http://"),
        address.replace("www.figma.com", "www.figma.com.example.com"),
      ])("requires an attached HTTPS Figma Design node in %s", async (url) => {
        const f = await setupFigma(url);
        await f.grant();
        await expect(f.inspect()).rejects.toThrow("same Figma Design file, branch and node");
      });

      it.each([
        address.replace("mainKey", "anotherMain"),
        address.replace("branchKey", "anotherBranch"),
        address.replace("35-12", "35-13"),
        address + "&node-id=35-12",
      ])(
        "rejects a current Figma selection that differs from the attachment in %s",
        async (url) => {
          const f = await setupFigma();
          f.events.emit("did-navigate-in-page", {}, url, true);
          await f.grant();
          await expect(f.inspect()).rejects.toThrow("same Figma Design file, branch and node");
        },
      );

      it.each(["navigation", "grant replacement", "takeover", "replacement guest"])(
        "retires confirmation and its inspection after %s",
        async (change) => {
          const f = await setupFigma();
          const { approval, write } = await proposed(f);
          await f.confirm(approval.id);
          if (change === "navigation") f.events.emit("did-navigate-in-page", {}, address, true);
          if (change === "grant replacement") await f.grant();
          if (change === "takeover") {
            f.manager.takeControl(f.request);
            await f.manager.resumeAgent(f.request);
          }
          if (change === "replacement guest") f.session.instanceId = crypto.randomUUID();
          await expect(f.authorize(write)).rejects.toThrow("Review the current Figma");
          expect(f.pending()).toBeUndefined();
        },
      );
    });

    it("keeps an opaque bookmark private and restores the exact URL after a same-origin change", async () => {
      const f = await setup();
      const captured = await f.capture();
      expect(captured).toEqual({
        attachmentId: expect.stringMatching(/^[a-f0-9-]{36}$/u),
      });
      expect((await f.capture()).attachmentId).not.toBe(captured.attachmentId);
      const directory = join(f.userData, "browser-attachment-bookmarks");
      const file = join(directory, captured.attachmentId!);
      expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
        url: f.address,
        projectId: f.request.projectId,
        tabId: f.request.sessionId,
        threadId: f.request.taskId,
        profileId: "work",
      });
      if (process.platform !== "win32") {
        expect((await stat(directory)).mode & 0o777).toBe(0o700);
        expect((await stat(file)).mode & 0o777).toBe(0o600);
      }
      f.events.emit("did-navigate", {}, "https://app.test/reports/43?view=review#overview");
      await expect(f.capture()).rejects.toThrow("changed");
      await expect(f.enter(f.manager, captured.attachmentId)).resolves.toEqual({
        url: f.address,
      });
      expect(f.loadURL).toHaveBeenCalledExactlyOnceWith(f.address);
      expect(f.session.controller).toBe("none");
      expect(f.session.assignedTaskId).toBeNull();
      expect(
        f.manager.getSessionState(f.request.projectId, f.request.sessionId).browserPageAuthorized,
      ).toBe(false);
    });

    it("rejects a different source, thread, tab, profile, project, or Chromium host", async () => {
      const f = await setup();
      await expect(f.capture({ source: "agent" })).rejects.toThrow("tab, profile and thread");
      await expect(f.capture({ input: { ...f.input, instanceId: "sibling" } })).rejects.toThrow(
        "changed",
      );
      Object.assign(f.session, { assignedTaskId: "other-thread" });
      await expect(f.capture()).rejects.toThrow("tab, profile and thread");
      Object.assign(f.session, { assignedTaskId: null });
      const { attachmentId } = await f.capture();
      await expect(f.enter(f.manager, attachmentId, { source: "agent" })).rejects.toThrow(
        "tab, profile and thread",
      );
      await expect(f.enter(f.manager, attachmentId, { taskId: "other-thread" })).rejects.toThrow(
        "original desktop",
      );
      const siblingId = "agents-surface-report-copy";
      const sibling = f.tab(f.manager, f.address, {
        sessionId: siblingId,
        key: `project-1::${siblingId}`,
        pageTitle: f.session.pageTitle,
      });
      await expect(f.enter(f.manager, attachmentId, { sessionId: siblingId })).rejects.toThrow(
        "original desktop",
      );
      expect(sibling.loadURL).not.toHaveBeenCalled();
      const otherProject = f.tab(f.manager, f.address, {
        projectId: "project-2",
        key: `project-2::${f.request.sessionId}`,
      });
      await expect(f.enter(f.manager, attachmentId, { projectId: "project-2" })).rejects.toThrow(
        "original desktop",
      );
      expect(otherProject.loadURL).not.toHaveBeenCalled();
      const restarted = new BrowserHostManager(() => null);
      const otherProfile = f.tab(restarted, f.address, {
        profileId: "personal",
        partition: "persist:tabs-browser:profile:personal",
      });
      await expect(
        f.enter(restarted, attachmentId, {
          input: { attachmentId, profileId: "personal" },
        }),
      ).rejects.toThrow("original desktop");
      const otherHost = f.tab(restarted, f.address);
      Object.assign(otherHost.webContents.session, {
        storagePath: join(f.userData, "other-host"),
      });
      await expect(f.enter(restarted, attachmentId)).rejects.toThrow("original desktop");
      expect(otherProfile.loadURL).not.toHaveBeenCalled();
      expect(otherHost.loadURL).not.toHaveBeenCalled();
    });

    it("restores after manager restart and rejects a replacement guest in the capturing manager", async () => {
      const f = await setup();
      const { attachmentId } = await f.capture();
      const replacement = f.tab(f.manager, "about:blank");
      await expect(f.enter(f.manager, attachmentId)).rejects.toThrow("original desktop");
      expect(replacement.loadURL).not.toHaveBeenCalled();
      const restarted = new BrowserHostManager(() => null);
      const originalTab = f.tab(restarted, "about:blank");
      await expect(f.enter(restarted, attachmentId)).resolves.toEqual({
        url: f.address,
      });
      expect(originalTab.loadURL).toHaveBeenCalledExactlyOnceWith(f.address);
    });

    it("rejects authentication redirects and HTTP login challenges during restore", async () => {
      const f = await setup();
      const { attachmentId } = await f.capture();
      const restarted = new BrowserHostManager(() => null);
      const tab = f.tab(restarted, "about:blank");
      const preventDefault = vi.fn();
      tab.loadURL.mockImplementationOnce(async () => {
        tab.events.emit("will-redirect", {
          isMainFrame: true,
          url: "https://app.test/login",
          preventDefault,
        });
      });
      await expect(f.enter(restarted, attachmentId)).rejects.toThrow("exact saved attachment URL");
      expect(tab.session.currentUrl).toBe("about:blank");
      expect(preventDefault).toHaveBeenCalledOnce();
      const cancelLogin = vi.fn();
      tab.loadURL.mockImplementationOnce(async () => {
        tab.events.emit("login", { preventDefault }, {}, {}, cancelLogin);
      });
      await expect(f.enter(restarted, attachmentId)).rejects.toThrow("exact saved attachment URL");
      expect(cancelLogin).toHaveBeenCalledExactlyOnceWith();
      expect(tab.stop).toHaveBeenCalledTimes(2);
      expect(tab.events.listenerCount("will-redirect")).toBe(1);
      expect(tab.events.listenerCount("login")).toBe(0);
    });

    it.each([
      "https://app.test/login",
      "https://app.test/%6cogin",
      "https://app.test/reports?__session=private",
      "https://app.test/reports?access%5Ftoken=private",
      "https://app.test/reports?X-Amz-Signature=private",
      "https://app.test/reports#/finish?client_secret=private",
      "https://app.test/reports#eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI",
    ])("declines to persist a protected or secret-bearing URL %s", async (url) => {
      const f = await setup(url);
      await expect(f.capture()).resolves.toEqual({ attachmentId: null });
      expect(f.evaluate).not.toHaveBeenCalled();
      await expect(readdir(f.userData)).resolves.toEqual([]);
    });

    it("declines a URL with credentials even when the caller has the matching live page reference", async () => {
      const f = await setup("https://user:private@app.test/reports");
      expect(f.input.pageRef).toBeUndefined();
      const pageRef = (f.manager as any).pageReference(f.session, f.address);
      await expect(f.capture({ input: { ...f.input, pageRef } })).resolves.toEqual({
        attachmentId: null,
      });
      expect(f.evaluate).not.toHaveBeenCalled();
      await expect(readdir(f.userData)).resolves.toEqual([]);
    });

    it("declines ephemeral sessions and protected fields and rejects changes during capture", async () => {
      const f = await setup();
      f.webContents.session.isPersistent.mockReturnValueOnce(false);
      await expect(f.capture()).resolves.toEqual({ attachmentId: null });
      f.fields.password = true;
      await expect(f.capture()).resolves.toEqual({ attachmentId: null });
      f.evaluate.mockImplementationOnce(async () => {
        f.events.emit("did-navigate", {}, "https://app.test/reports/43");
        return true;
      });
      await expect(f.capture()).rejects.toThrow("changed");
      await expect(readdir(f.userData)).resolves.toEqual([]);
    });

    it("only reports the exact restored URL when the destination has no protected fields", async () => {
      const f = await setup();
      const { attachmentId } = await f.capture();
      const restarted = new BrowserHostManager(() => null);
      const tab = f.tab(restarted, "about:blank");
      tab.fields.password = true;
      await expect(f.enter(restarted, attachmentId)).rejects.toThrow("protected content");
      expect(tab.loadURL).toHaveBeenCalledExactlyOnceWith(f.address);
      tab.fields.password = false;
      await expect(f.enter(restarted, attachmentId)).resolves.toEqual({
        url: f.address,
      });
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

  it.each(["takeover", "revoke", "navigate", "partition", "reassign"])(
    "keeps bytes out of the page after %s",
    async (change) => {
      const f = createUploadFixture();
      const { grantId } = await f.authorize();
      if (change === "takeover") {
        f.manager.takeControl(f.target);
        f.manager.resumeAgent(f.target);
      } else if (change === "revoke") {
        await f.manager.runAutomation({
          ...f.target,
          source: "human",
          operation: "revokeDeviceScreenshot",
        });
      } else if (change === "navigate") f.session.currentUrl += "/other-draft";
      else if (change === "partition")
        f.session.partition = "persist:tabs-browser:profile:personal";
      else f.manager.assignTabTask({ ...f.target, taskId: "other-thread" });
      await expect(f.transfer(grantId)).rejects.toThrow();
      expect(f.attach).not.toHaveBeenCalled();
    },
  );

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
