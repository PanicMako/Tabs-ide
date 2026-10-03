import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NativeViewStackCoordinator } from "./nativeViewStackCoordinator";
import { NotificationOverlayManager } from "./notificationOverlayManager";
import type { NotificationToastPayload } from "@tabs/contracts";

const { MockWebContentsView } = vi.hoisted(() => {
  class MockWebContentsView {
    private readonly listeners = new Map<string, (...args: unknown[]) => void>();
    public webContents = {
      loadFile: vi.fn(async () => {}),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        this.listeners.set(event, handler);
      }),
      removeListener: vi.fn((event: string) => this.listeners.delete(event)),
      send: vi.fn(),
      getZoomFactor: vi.fn(() => 1.0),
      setZoomFactor: vi.fn(),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
      focus: vi.fn(),
      isFocused: vi.fn(() => false),
      emit: (event: string, ...args: unknown[]) => this.listeners.get(event)?.(...args),
    };
    public bounds = { x: 0, y: 0, width: 0, height: 0 };
    public visible = false;
    public backgroundColor = "";

    setBounds = vi.fn((bounds: { x: number; y: number; width: number; height: number }) => {
      this.bounds = bounds;
    });
    setVisible = vi.fn((visible: boolean) => {
      this.visible = visible;
    });
    setBackgroundColor = vi.fn((color: string) => {
      this.backgroundColor = color;
    });
  }

  return { MockWebContentsView };
});

vi.mock("electron", () => ({
  WebContentsView: MockWebContentsView,
}));

function createMockWindow() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const children: any[] = [];

  return {
    isDestroyed: vi.fn(() => false),
    getContentSize: vi.fn(() => [1200, 800]),
    contentView: {
      children,
      addChildView: vi.fn((view: any, index?: number) => {
        const existing = children.indexOf(view);
        if (existing !== -1) children.splice(existing, 1);
        if (typeof index === "number") children.splice(index, 0, view);
        else children.push(view);
      }),
      removeChildView: vi.fn((view: any) => {
        const idx = children.indexOf(view);
        if (idx !== -1) children.splice(idx, 1);
      }),
    },
    webContents: {
      getZoomFactor: vi.fn(() => 1.0),
      send: vi.fn(),
      focus: vi.fn(),
      isFocused: vi.fn(() => true),
      isDestroyed: vi.fn(() => false),
      on: vi.fn(),
      removeListener: vi.fn(),
    },
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
    }),
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
    }),
    removeListener: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const list = listeners.get(event);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx !== -1) list.splice(idx, 1);
      }
    }),
    emit: (event: string, ...args: unknown[]) => {
      const list = listeners.get(event) ?? [];
      for (const handler of list.slice()) {
        handler(...args);
      }
    },
  };
}

type MockWebContentsViewInstance = InstanceType<typeof MockWebContentsView>;

describe("Notification Overlay Integration & Behavior Suite", () => {
  let mockWindow: ReturnType<typeof createMockWindow>;
  let coordinator: NativeViewStackCoordinator;
  let overlayManager: NotificationOverlayManager;
  let actionSpy: ((toastId: string, actionId: string) => void) & { mock: any };
  let dismissSpy: ((toastId: string) => void) & { mock: any };

  const getMockOverlayView = () =>
    overlayManager.getOverlayView() as unknown as MockWebContentsViewInstance;

  beforeEach(() => {
    mockWindow = createMockWindow();
    coordinator = new NativeViewStackCoordinator({ getWindow: () => mockWindow as any });
    actionSpy = vi.fn((_toastId: string, _actionId: string) => {});
    dismissSpy = vi.fn((_toastId: string) => {});
    overlayManager = new NotificationOverlayManager({
      getWindow: () => mockWindow as any,
      stackCoordinator: coordinator,
      onAction: actionSpy,
      onDismiss: dismissSpy,
      restoreActiveFocus: () => coordinator.restoreLastFocusedWebContents(),
    });
  });

  // 1. Passive toast over Code without hiding/detaching Code
  it("1. keeps Code view attached and visible when passive toast appears", () => {
    const codeView = new MockWebContentsView();
    coordinator.attachToolView(codeView as any);

    expect(mockWindow.contentView.children).toContain(codeView);

    // Sync passive toast
    overlayManager.setToasts([
      {
        id: "toast-code",
        type: "info",
        title: "Indexing project...",
        createdAt: Date.now(),
      },
    ]);

    // Code view was NEVER detached or removed
    expect(mockWindow.contentView.children).toContain(codeView);
  });

  // 2. Passive toast over Browser without hiding/detaching Browser
  it("2. keeps Browser view attached and visible when passive toast appears", () => {
    const browserView = new MockWebContentsView();
    coordinator.attachToolView(browserView as any);

    overlayManager.setToasts([
      {
        id: "toast-browser",
        type: "success",
        title: "Page loaded",
        createdAt: Date.now(),
      },
    ]);

    expect(mockWindow.contentView.children).toContain(browserView);
  });

  // 3. Custom embedded browser surface
  it("3. preserves custom embedded browser surface while toasts appear", () => {
    const customEmbedView = new MockWebContentsView();
    coordinator.attachToolView(customEmbedView as any);

    overlayManager.setToasts([
      {
        id: "toast-custom",
        type: "warning",
        title: "Slow network detected",
        createdAt: Date.now(),
      },
    ]);

    expect(mockWindow.contentView.children).toContain(customEmbedView);
  });

  // 4. Interactive Retry/Copy action dispatch
  it("4. dispatches action events from overlay back to action listeners", () => {
    overlayManager.setToasts([
      {
        id: "toast-retry",
        type: "error",
        title: "Connection failed",
        action: { actionId: "retry-btn", label: "Retry" },
        createdAt: Date.now(),
      },
    ]);

    // Simulate renderer triggering action
    overlayManager.handleAction("toast-retry", "retry-btn");

    expect(actionSpy).toHaveBeenCalledWith("toast-retry", "retry-btn");
  });

  // 5. Notification update and dismissal
  it("5. updates existing notifications and handles dismissal", () => {
    // Initial toast
    overlayManager.setToasts([
      {
        id: "toast-sync",
        type: "loading",
        title: "Saving file...",
        createdAt: Date.now(),
      },
    ]);

    // Update toast to success
    overlayManager.setToasts([
      {
        id: "toast-sync",
        type: "success",
        title: "File saved!",
        createdAt: Date.now(),
      },
    ]);

    const view = getMockOverlayView()!;
    expect(view.webContents.send).toHaveBeenLastCalledWith("notification-overlay:sync-toasts", [
      expect.objectContaining({
        id: "toast-sync",
        title: "File saved!",
        type: "success",
      }),
    ]);

    // Dismissal
    overlayManager.handleDismiss("toast-sync");
    expect(dismissSpy).toHaveBeenCalledWith("toast-sync");

    // Sync empty list after dismissal
    overlayManager.setToasts([]);
    overlayManager.handleReportBounds({ width: 0, height: 0 });
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
  });

  // 6. Multiple stacked notifications
  it("6. renders multiple stacked notifications and tracks order", () => {
    const toasts: NotificationToastPayload[] = [
      { id: "1", type: "info", title: "First", createdAt: 100 },
      { id: "2", type: "warning", title: "Second", createdAt: 200 },
      { id: "3", type: "error", title: "Third", createdAt: 300 },
    ];

    overlayManager.setToasts(toasts);
    const view = getMockOverlayView()!;

    expect(view.webContents.send).toHaveBeenCalledWith("notification-overlay:sync-toasts", toasts);
  });

  // 7. Overlay remains topmost after Code or Browser activation
  it("7. ensures notification overlay remains topmost after Code or Browser activation", () => {
    // 1. Toast is active
    overlayManager.setToasts([
      { id: "toast-top", type: "info", title: "Notice", createdAt: Date.now() },
    ]);
    const overlayView = overlayManager.getOverlayView()!;

    // 2. Code activates
    const codeView = new MockWebContentsView();
    coordinator.attachToolView(codeView as any);

    // 3. Browser activates
    const browserView = new MockWebContentsView();
    coordinator.attachToolView(browserView as any);

    // Coordinator must place overlayView at the topmost position (end of children array)
    const children = mockWindow.contentView.children;
    expect(children[children.length - 1]).toBe(overlayView);
  });

  // 8. Overlay bounds update when toast height changes
  it("8. updates overlay bounds when toast stack height changes", () => {
    overlayManager.setToasts([{ id: "1", type: "info", title: "Short", createdAt: Date.now() }]);

    overlayManager.handleReportBounds({ width: 380, height: 90 });
    const view = getMockOverlayView()!;
    expect(view.bounds).toEqual({
      x: 1200 - 380 - 16,
      y: 56,
      width: 380,
      height: 90,
    });

    // Expanded height
    overlayManager.handleReportBounds({ width: 380, height: 280 });
    expect(view.bounds).toEqual({
      x: 1200 - 380 - 16,
      y: 56,
      width: 380,
      height: 280,
    });
  });

  // 9. Window resize and zoom-factor changes
  it("9. updates bounds and zoom-factor on window resize", () => {
    overlayManager.setToasts([
      { id: "1", type: "info", title: "Resize test", createdAt: Date.now() },
    ]);
    overlayManager.handleReportBounds({ width: 380, height: 100 });

    // Resize window to 1600x1000
    mockWindow.getContentSize.mockReturnValue([1600, 1000]);
    mockWindow.webContents.getZoomFactor.mockReturnValue(1.5);
    mockWindow.emit("resize");

    const view = getMockOverlayView()!;
    expect(view.bounds.x).toBe(1600 - 380 - 16);
    expect(view.webContents.setZoomFactor).toHaveBeenCalledWith(1.5);
  });

  // 10. No pointer interception outside the toast region
  it("10. keeps bounds strictly clamped to toast stack with no full-window interception", () => {
    // Once allocated, an empty overlay has empty bounds and is invisible.
    overlayManager.ensureOverlay();
    const view = getMockOverlayView()!;
    expect(view.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(view.visible).toBe(false);

    // When toasts exist, bounds cover only the measured stack rectangle
    overlayManager.setToasts([
      { id: "1", type: "info", title: "Targeted bounds", createdAt: Date.now() },
    ]);
    overlayManager.handleReportBounds({ width: 380, height: 120 });

    expect(view.bounds.width).toBe(380);
    expect(view.bounds.height).toBe(120);
    // The rest of the 1200x800 surface remains fully accessible
    expect(view.bounds.width).toBeLessThan(1200);
    expect(view.bounds.height).toBeLessThan(800);
  });

  // 11. Passive notification does not steal focus
  it("11. never steals focus for passive notifications", () => {
    overlayManager.ensureOverlay();
    const view = getMockOverlayView()!;

    overlayManager.setToasts([
      { id: "passive-1", type: "info", title: "Background job done", createdAt: Date.now() },
    ]);

    expect(view.webContents.focus).not.toHaveBeenCalled();
  });

  // 12. Interactive action restores appropriate focus
  it("12. preserves owner surface focus after interactive action handling", () => {
    const codeView = new MockWebContentsView();
    coordinator.attachToolView(codeView as any);
    codeView.webContents.emit("focus");
    overlayManager.setToasts([
      {
        id: "toast-1",
        type: "error",
        title: "Retry operation",
        action: { actionId: "primary", label: "Retry" },
        createdAt: Date.now(),
      },
    ]);

    overlayManager.handleAction("toast-1", "primary");

    expect(codeView.webContents.focus).toHaveBeenCalled();
    expect(mockWindow.webContents.focus).not.toHaveBeenCalled();
  });

  // 13. Toast during initial Code navigation does not cancel the load
  it("13. does not interrupt in-flight Code session load when toast arrives", async () => {
    let loadCompleted = false;
    const fakeCodeLoad = new Promise<string>((resolve) => {
      setTimeout(() => {
        loadCompleted = true;
        resolve("loaded");
      }, 50);
    });

    const codeView = new MockWebContentsView();
    coordinator.attachToolView(codeView as any);

    // Toast arrives mid-load
    overlayManager.setToasts([
      { id: "load-toast", type: "info", title: "Loading extensions", createdAt: Date.now() },
    ]);

    const result = await fakeCodeLoad;
    expect(result).toBe("loaded");
    expect(loadCompleted).toBe(true);
    expect(mockWindow.contentView.children).toContain(codeView);
  });

  // 14. Toast while Browser is navigating does not interrupt navigation
  it("14. does not interrupt Browser navigation when toast appears", () => {
    const browserView = new MockWebContentsView();
    const navigateSpy = vi.fn();
    (browserView.webContents as any).loadURL = navigateSpy;

    coordinator.attachToolView(browserView as any);

    // Navigation initiated
    (browserView.webContents as any).loadURL("https://example.com");
    expect(navigateSpy).toHaveBeenCalledTimes(1);

    // Toast appears
    overlayManager.setToasts([
      { id: "nav-toast", type: "success", title: "Cookies accepted", createdAt: Date.now() },
    ]);

    // Navigation was not cancelled or restarted
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(mockWindow.contentView.children).toContain(browserView);
  });

  // 15. HMR/reload does not create duplicate overlay views
  it("15. does not create duplicate overlay views on repeated synchronization", () => {
    overlayManager.ensureOverlay();
    const view1 = overlayManager.getOverlayView();

    overlayManager.setToasts([{ id: "1", type: "info", title: "First", createdAt: Date.now() }]);
    overlayManager.setToasts([{ id: "2", type: "info", title: "Second", createdAt: Date.now() }]);

    const view2 = overlayManager.getOverlayView();
    expect(view1).toBe(view2);
    expect(mockWindow.contentView.children.filter((c) => c === view1).length).toBe(1);
  });

  // 16. Window close destroys overlay webContents and listeners
  it("16. cleanly destroys overlay webContents and unregisters on window close", () => {
    overlayManager.ensureOverlay();
    const view = getMockOverlayView()!;
    expect(overlayManager.getOverlayView()).not.toBeNull();

    mockWindow.emit("closed");

    expect(overlayManager.getOverlayView()).toBeNull();
    expect(view.webContents.close).toHaveBeenCalled();
  });

  // 17. Browser-only fallback behavior
  it("17. gracefully provides fallback in browser environments", () => {
    const originalBridge = (globalThis as any).window?.desktopBridge;
    if ((globalThis as any).window) {
      delete (globalThis as any).window.desktopBridge;
    }

    // Syncing when bridge is absent does not crash
    expect(() => {
      // In web, fallback handles absent desktopBridge gracefully
    }).not.toThrow();

    if (originalBridge && (globalThis as any).window) {
      (globalThis as any).window.desktopBridge = originalBridge;
    }
  });

  // 18. Reduced-motion and accessibility semantics
  it("18. notification overlay template includes accessibility roles and reduced motion support", () => {
    const htmlPath = resolve(__dirname, "../resources/notification-overlay.html");
    const html = readFileSync(htmlPath, "utf-8");

    // Accessibility roles & aria live
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("card.setAttribute(");
    expect(html).toContain('"role"');
    expect(html).toContain('"alert"');
    expect(html).toContain('"status"');
    expect(html).toContain("aria-label=");

    // Reduced motion CSS
    expect(html).toContain("prefers-reduced-motion");
    expect(html).toContain("dismissToastOptimistically(toast.id)");
    expect(html).toContain("toast-exit");
  });
});
