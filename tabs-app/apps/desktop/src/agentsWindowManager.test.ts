import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockBrowserWindows, MockBrowserWindow, mockWebContents } = vi.hoisted(() => {
  const mockBrowserWindows: any[] = [];
  const mockWebContents = {
    id: 42,
    isDestroyed: vi.fn(() => false),
    focus: vi.fn(),
    send: vi.fn(),
  };

  class MockBrowserWindow {
    readonly id: number;
    readonly webContents = mockWebContents;
    private listeners = new Map<string, Function[]>();
    private destroyed = false;
    private minimized = false;
    private shown = false;

    constructor(_opts: any) {
      this.id = mockBrowserWindows.length + 1;
      mockBrowserWindows.push(this);
    }

    on(event: string, handler: Function) {
      const list = this.listeners.get(event) ?? [];
      list.push(handler);
      this.listeners.set(event, list);
      return this;
    }

    once(event: string, handler: Function) {
      const wrapped = (...args: any[]) => {
        this.removeListener(event, wrapped);
        handler(...args);
      };
      return this.on(event, wrapped);
    }

    removeListener(event: string, handler: Function) {
      const list = this.listeners.get(event);
      if (list) {
        this.listeners.set(
          event,
          list.filter((h) => h !== handler),
        );
      }
      return this;
    }

    emit(event: string, ...args: any[]) {
      const list = [...(this.listeners.get(event) ?? [])];
      for (const h of list) h(...args);
    }

    isDestroyed() {
      return this.destroyed;
    }

    destroy() {
      this.destroyed = true;
      this.emit("closed");
    }

    isMinimized() {
      return this.minimized;
    }

    restore() {
      this.minimized = false;
    }

    show() {
      this.shown = true;
    }

    focus() {}

    getContentSize() {
      return [1200, 800];
    }
  }

  return { mockBrowserWindows, MockBrowserWindow, mockWebContents };
});

vi.mock("electron", () => ({
  BrowserWindow: MockBrowserWindow,
  webContents: {
    fromId: vi.fn(() => mockWebContents),
  },
}));

const mockHostInstances: any[] = [];
vi.mock("./codeHostManager", () => {
  class MockCodeHostManager {
    readonly ensureSession = vi.fn(async () => {});
    readonly activateSession = vi.fn(async () => {});
    readonly setBounds = vi.fn();
    readonly flushAndShutdownSessions = vi.fn(async () => {});
    private registrar: any = null;

    constructor() {
      mockHostInstances.push(this);
    }

    setNativeWebContentsRegistrar(reg: any) {
      this.registrar = reg;
      if (reg) {
        // Register mock webContents immediately
        reg(mockWebContents, { x: 0, y: 0, width: 1200, height: 800 }, "test-project");
      }
    }
  }

  return {
    CodeHostManager: MockCodeHostManager,
  };
});

vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { AgentsWindowManager } from "./agentsWindowManager";

describe("AgentsWindowManager", () => {
  beforeEach(() => {
    mockBrowserWindows.length = 0;
    mockHostInstances.length = 0;
    vi.clearAllMocks();
  });

  const baseConfig: any = {
    state: { available: true },
    runtime: {
      kind: "desktop-renderer",
      vscodeRoot: "/mock/vscode",
      stateDir: "/mock/state",
    },
  };

  const mockBackend: any = {
    registerWebContents: vi.fn(),
  };

  it("opens an agents window and forwards handoff arguments upon ready", async () => {
    const manager = new AgentsWindowManager(baseConfig, () => mockBackend);

    const openPromise = manager.open({
      source: "link",
      folderUriIsDefault: false,
      draft: { inputText: "Hello Agent", attachments: "[]" },
    });

    // Notify ready
    manager.notifyReady(mockWebContents as any);

    await openPromise;

    expect(mockBrowserWindows.length).toBe(1);
    expect(mockWebContents.send).toHaveBeenCalledWith(
      "vscode:selectAgentsFolder",
      undefined,
      undefined,
      "link",
      false,
      { inputText: "Hello Agent", attachments: "[]" },
      undefined,
    );
  });

  it("reuses the existing open window for subsequent handoffs", async () => {
    const manager = new AgentsWindowManager(baseConfig, () => mockBackend);

    // First open
    const firstPromise = manager.open({
      source: "link",
      folderUriIsDefault: false,
      draft: { inputText: "Draft 1", attachments: "[]" },
    });
    manager.notifyReady(mockWebContents as any);
    await firstPromise;

    expect(mockBrowserWindows.length).toBe(1);

    // Second open with sessionResource
    await manager.open({
      source: "parallelWorkEmptyChatHandoff",
      folderUriIsDefault: false,
      sessionResource: { scheme: "vscode-chat-session", path: "/session-42" },
      onboardingSessionResource: { scheme: "agent-host", path: "/onboard-1" },
    });

    // Should NOT create a second BrowserWindow
    expect(mockBrowserWindows.length).toBe(1);

    expect(mockWebContents.send).toHaveBeenLastCalledWith(
      "vscode:selectAgentsFolder",
      undefined,
      { scheme: "vscode-chat-session", path: "/session-42" },
      "parallelWorkEmptyChatHandoff",
      false,
      undefined,
      { scheme: "agent-host", path: "/onboard-1" },
    );
  });

  it("awaits session flush on window close before destroying", async () => {
    const manager = new AgentsWindowManager(baseConfig, () => mockBackend);

    const openPromise = manager.open({
      source: "link",
      folderUriIsDefault: false,
    });
    manager.notifyReady(mockWebContents as any);
    await openPromise;

    const win = mockBrowserWindows[0];
    const host = mockHostInstances[0];

    const closeEvent = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    win.emit("close", closeEvent);

    expect(closeEvent.defaultPrevented).toBe(true);

    // Wait for the async flush in close handler
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(host.flushAndShutdownSessions).toHaveBeenCalledTimes(1);
    expect(win.isDestroyed()).toBe(true);
  });

  it("gracefully shuts down all windows on manager.shutdown()", async () => {
    const manager = new AgentsWindowManager(baseConfig, () => mockBackend);

    const openPromise = manager.open({
      source: "link",
      folderUriIsDefault: false,
    });
    manager.notifyReady(mockWebContents as any);
    await openPromise;

    const win = mockBrowserWindows[0];
    const host = mockHostInstances[0];

    await manager.shutdown();

    expect(host.flushAndShutdownSessions).toHaveBeenCalledTimes(1);
    expect(win.isDestroyed()).toBe(true);
  });
});
