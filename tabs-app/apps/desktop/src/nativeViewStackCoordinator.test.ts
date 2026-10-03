import { describe, expect, it, vi } from "vitest";
import { NativeViewStackCoordinator } from "./nativeViewStackCoordinator";

function createMockView(id: string) {
  const listeners = new Map<string, () => void>();
  return {
    id,
    setBounds: vi.fn(),
    setVisible: vi.fn(),
    webContents: {
      focus: vi.fn(),
      isFocused: vi.fn(() => false),
      isDestroyed: vi.fn(() => false),
      on: vi.fn((event: string, handler: () => void) => listeners.set(event, handler)),
      removeListener: vi.fn((event: string) => listeners.delete(event)),
      emit: (event: string) => listeners.get(event)?.(),
    },
  } as unknown as Electron.WebContentsView;
}

function createMockWindow() {
  const children: unknown[] = [];
  const contentView = {
    children,
    addChildView: vi.fn((view: unknown, index?: number) => {
      const existingIdx = children.indexOf(view);
      if (existingIdx !== -1) {
        children.splice(existingIdx, 1);
      }
      if (typeof index === "number") {
        children.splice(index, 0, view);
      } else {
        children.push(view);
      }
    }),
    removeChildView: vi.fn((view: unknown) => {
      const idx = children.indexOf(view);
      if (idx !== -1) {
        children.splice(idx, 1);
      }
    }),
  };

  return {
    isDestroyed: vi.fn(() => false),
    contentView,
    webContents: createMockView("main").webContents,
  } as unknown as Electron.BrowserWindow;
}

describe("NativeViewStackCoordinator", () => {
  it("attaches tool views when no overlay is present", () => {
    const mockWindow = createMockWindow();
    const coordinator = new NativeViewStackCoordinator({ getWindow: () => mockWindow });

    const codeView = createMockView("code");
    coordinator.attachToolView(codeView);

    expect(mockWindow.contentView.children).toEqual([codeView]);
  });

  it("sets notification overlay view and ensures it is topmost", () => {
    const mockWindow = createMockWindow();
    const coordinator = new NativeViewStackCoordinator({ getWindow: () => mockWindow });

    const codeView = createMockView("code");
    coordinator.attachToolView(codeView);

    const overlayView = createMockView("overlay");
    coordinator.setNotificationOverlayView(overlayView);

    expect(mockWindow.contentView.children).toEqual([codeView, overlayView]);
    expect(coordinator.isTopmost(overlayView)).toBe(true);
  });

  it("keeps notification overlay topmost when a new tool view is attached", () => {
    const mockWindow = createMockWindow();
    const coordinator = new NativeViewStackCoordinator({ getWindow: () => mockWindow });

    const codeView = createMockView("code");
    coordinator.attachToolView(codeView);

    const overlayView = createMockView("overlay");
    coordinator.setNotificationOverlayView(overlayView);

    // Now user switches to browser or opens a new session
    const browserView = createMockView("browser");
    coordinator.attachToolView(browserView);

    expect(mockWindow.contentView.children).toEqual([codeView, browserView, overlayView]);
    expect(coordinator.isTopmost(overlayView)).toBe(true);
    expect(coordinator.isTopmost(browserView)).toBe(false);
  });

  it("keeps notification overlay topmost when switching tool views (detach Code, attach Browser)", () => {
    const mockWindow = createMockWindow();
    const coordinator = new NativeViewStackCoordinator({ getWindow: () => mockWindow });

    const codeView = createMockView("code");
    const overlayView = createMockView("overlay");
    coordinator.attachToolView(codeView);
    coordinator.setNotificationOverlayView(overlayView);

    // Detach Code
    coordinator.detachToolView(codeView);
    expect(mockWindow.contentView.children).toEqual([overlayView]);

    // Attach Browser
    const browserView = createMockView("browser");
    coordinator.attachToolView(browserView);

    expect(mockWindow.contentView.children).toEqual([browserView, overlayView]);
    expect(coordinator.isTopmost(overlayView)).toBe(true);
  });

  it("inserts automation views below notification overlay", () => {
    const mockWindow = createMockWindow();
    const coordinator = new NativeViewStackCoordinator({ getWindow: () => mockWindow });

    const browserView = createMockView("browser");
    const overlayView = createMockView("overlay");
    coordinator.attachToolView(browserView);
    coordinator.setNotificationOverlayView(overlayView);

    const automationView = createMockView("automation");
    coordinator.attachAutomationView(automationView, 0);

    expect(mockWindow.contentView.children).toEqual([automationView, browserView, overlayView]);
    expect(coordinator.isTopmost(overlayView)).toBe(true);

    coordinator.detachAutomationView(automationView);
    expect(mockWindow.contentView.children).toEqual([browserView, overlayView]);
  });

  it("handles null or destroyed window safely", () => {
    const destroyedWindow = {
      isDestroyed: vi.fn(() => true),
      contentView: { children: [], addChildView: vi.fn(), removeChildView: vi.fn() },
    } as unknown as Electron.BrowserWindow;

    const coordinator = new NativeViewStackCoordinator({ getWindow: () => destroyedWindow });
    const view = createMockView("v");

    expect(() => coordinator.attachToolView(view)).not.toThrow();
    expect(() => coordinator.detachToolView(view)).not.toThrow();
    expect(() => coordinator.setNotificationOverlayView(view)).not.toThrow();
    expect(() => coordinator.ensureTopmost()).not.toThrow();
    expect(coordinator.isTopmost(view)).toBe(false);
  });

  it("cleans up overlay when destroyed", () => {
    const mockWindow = createMockWindow();
    const coordinator = new NativeViewStackCoordinator({ getWindow: () => mockWindow });

    const overlayView = createMockView("overlay");
    coordinator.setNotificationOverlayView(overlayView);
    expect(mockWindow.contentView.children).toContain(overlayView);

    coordinator.destroy();
    expect(mockWindow.contentView.children).not.toContain(overlayView);
    expect(coordinator.getNotificationOverlayView()).toBeNull();
  });

  it("restores focus to the native surface that most recently owned it", () => {
    const mockWindow = createMockWindow();
    const coordinator = new NativeViewStackCoordinator({ getWindow: () => mockWindow });
    const codeView = createMockView("code");
    coordinator.attachToolView(codeView);

    (codeView.webContents as unknown as { emit: (event: string) => void }).emit("focus");
    expect(coordinator.restoreLastFocusedWebContents()).toBe(true);
    expect(codeView.webContents.focus).toHaveBeenCalledOnce();
    expect(mockWindow.webContents.focus).not.toHaveBeenCalled();
  });
});
