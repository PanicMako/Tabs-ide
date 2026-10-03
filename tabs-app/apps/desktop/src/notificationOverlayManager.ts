import * as FS from "node:fs";
import * as Path from "node:path";
import { WebContentsView, type BrowserWindow, type Rectangle, type WebContents } from "electron";
import type {
  NotificationOverlayBounds,
  NotificationOverlayTheme,
  NotificationToastPayload,
} from "@tabs/contracts";
import type { NativeViewStackCoordinator } from "./nativeViewStackCoordinator";

export interface NotificationOverlayManagerOptions {
  getWindow: () => BrowserWindow | null;
  stackCoordinator: NativeViewStackCoordinator;
  onAction?: ((toastId: string, actionId: string) => void) | undefined;
  onDismiss?: ((toastId: string) => void) | undefined;
  restoreActiveFocus?: (() => void) | undefined;
}

const MAX_VISIBLE_TOASTS = 8;
const MAX_ID_LENGTH = 256;
const MAX_TITLE_LENGTH = 512;
const MAX_DESCRIPTION_LENGTH = 4_096;
const MAX_ACTION_LABEL_LENGTH = 128;

function isBoundedString(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxLength &&
    (allowEmpty || value.trim().length > 0)
  );
}

/** Validate and bound renderer-owned data before it reaches the privileged overlay process. */
export function normalizeNotificationToasts(input: unknown): NotificationToastPayload[] {
  if (!Array.isArray(input)) return [];

  const normalized: NotificationToastPayload[] = [];
  for (const value of input.slice(0, MAX_VISIBLE_TOASTS * 4)) {
    if (normalized.length >= MAX_VISIBLE_TOASTS) break;
    if (!value || typeof value !== "object") continue;
    const toast = value as Record<string, unknown>;
    if (
      !isBoundedString(toast.id, MAX_ID_LENGTH) ||
      !isBoundedString(toast.title, MAX_TITLE_LENGTH) ||
      !["loading", "success", "error", "warning", "info"].includes(String(toast.type)) ||
      !Number.isFinite(toast.createdAt)
    ) {
      continue;
    }
    if (
      toast.description !== undefined &&
      !isBoundedString(toast.description, MAX_DESCRIPTION_LENGTH, true)
    ) {
      continue;
    }
    if (
      toast.duration !== undefined &&
      (!Number.isFinite(toast.duration) || Number(toast.duration) < 0)
    ) {
      continue;
    }

    let action: NotificationToastPayload["action"];
    if (toast.action !== undefined) {
      if (!toast.action || typeof toast.action !== "object") continue;
      const rawAction = toast.action as Record<string, unknown>;
      if (
        !isBoundedString(rawAction.actionId, MAX_ID_LENGTH) ||
        !isBoundedString(rawAction.label, MAX_ACTION_LABEL_LENGTH)
      ) {
        continue;
      }
      action = { actionId: rawAction.actionId, label: rawAction.label };
    }

    normalized.push({
      id: toast.id,
      type: toast.type as NotificationToastPayload["type"],
      title: toast.title,
      createdAt: Number(toast.createdAt),
      ...(toast.description !== undefined ? { description: toast.description as string } : {}),
      ...(toast.duration !== undefined ? { duration: Number(toast.duration) } : {}),
      ...(action ? { action } : {}),
      ...(typeof toast.tooltipStyle === "boolean" ? { tooltipStyle: toast.tooltipStyle } : {}),
      ...(typeof toast.interactive === "boolean" ? { interactive: toast.interactive } : {}),
      ...(toast.threadId === null || typeof toast.threadId === "string"
        ? { threadId: toast.threadId }
        : {}),
    });
  }
  return normalized;
}

function resolveNotificationOverlayHtmlPath(): string {
  const candidates = [
    Path.join(__dirname, "notification-overlay.html"),
    Path.join(__dirname, "../resources/notification-overlay.html"),
    Path.join(__dirname, "../prod-resources/notification-overlay.html"),
    ...(process.resourcesPath
      ? [
          Path.join(process.resourcesPath, "resources/notification-overlay.html"),
          Path.join(process.resourcesPath, "notification-overlay.html"),
        ]
      : []),
  ];
  for (const candidate of candidates) {
    try {
      if (FS.existsSync(candidate)) return candidate;
    } catch {
      // Ignore filesystem access errors
    }
  }
  return candidates[0]!;
}

/**
 * Manages the dedicated topmost notification overlay WebContentsView.
 *
 * It ensures:
 * 1. Only ONE overlay WebContentsView exists per window (reused across reloads/HMR).
 * 2. It has a transparent background (`#00000000`).
 * 3. It starts hidden with `{ x: 0, y: 0, width: 0, height: 0 }` bounds.
 * 4. It occupies ONLY the measured rectangular region of the active notification stack.
 * 5. It never steals focus for passive notifications.
 * 6. It restores focus after interactive toast actions/dismissal.
 * 7. It is destroyed cleanly when the window is closed.
 */
export class NotificationOverlayManager {
  private readonly getWindow: () => BrowserWindow | null;
  private readonly stackCoordinator: NativeViewStackCoordinator;
  private readonly onAction?: ((toastId: string, actionId: string) => void) | undefined;
  private readonly onDismiss?: ((toastId: string) => void) | undefined;
  private readonly restoreActiveFocus?: (() => void) | undefined;

  private overlayView: WebContentsView | null = null;
  private toasts: readonly NotificationToastPayload[] = [];
  private theme: NotificationOverlayTheme = { themeId: "tabs-dark", isDark: true };
  private lastReportedSize: NotificationOverlayBounds = { width: 0, height: 0 };
  private boundWindow: BrowserWindow | null = null;
  private windowResizeHandler: (() => void) | null = null;
  private windowCloseHandler: (() => void) | null = null;
  private emptyHideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: NotificationOverlayManagerOptions) {
    this.getWindow = options.getWindow;
    this.stackCoordinator = options.stackCoordinator;
    this.onAction = options.onAction;
    this.onDismiss = options.onDismiss;
    this.restoreActiveFocus = options.restoreActiveFocus;
  }

  /**
   * Get or lazily create the dedicated overlay WebContentsView for the window.
   */
  public ensureOverlay(): WebContentsView | null {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) return null;

    if (this.overlayView && this.boundWindow === window) {
      this.stackCoordinator.ensureTopmost();
      return this.overlayView;
    }

    // Clean up any stale view from a previous window
    if (this.overlayView) {
      this.destroy();
    }

    this.boundWindow = window;

    const preloadPath = Path.join(__dirname, "notificationPreload.js");
    const view = new WebContentsView({
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    // Pure transparent background so the overlay does not paint over underlying content
    try {
      view.setBackgroundColor("#00000000");
    } catch {
      // Best-effort
    }

    // Start completely hidden and empty
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    try {
      view.setVisible(false);
    } catch {
      // Best-effort
    }

    const htmlPath = resolveNotificationOverlayHtmlPath();
    void view.webContents.loadFile(htmlPath).catch(() => {
      // Best-effort load
    });

    view.webContents.on("did-finish-load", () => {
      this.syncThemeToOverlay();
      this.syncToastsToOverlay();
      this.syncZoomFactor();
    });

    // Attach to coordinator as topmost layer
    this.overlayView = view;
    this.stackCoordinator.setNotificationOverlayView(view);

    // Track window resize to recalculate bounds
    this.windowResizeHandler = () => {
      this.syncZoomFactor();
      this.updateBounds();
    };
    window.on("resize", this.windowResizeHandler);

    // Clean destruction on window close
    this.windowCloseHandler = () => {
      this.destroy();
    };
    window.once("closed", this.windowCloseHandler);

    return view;
  }

  /**
   * Update the active toasts from the renderer.
   */
  public setToasts(toasts: readonly NotificationToastPayload[]): void {
    this.toasts = toasts;
    if (toasts.length === 0 && !this.overlayView) {
      return;
    }
    this.ensureOverlay();
    this.clearEmptyHideTimer();

    if (toasts.length === 0) {
      this.syncToastsToOverlay();
      // Let the overlay renderer play its exit transition. The bounds report
      // normally collapses the view first; this timer is a fail-safe if the
      // renderer is unavailable or throttled.
      this.emptyHideTimer = setTimeout(() => {
        this.emptyHideTimer = null;
        this.lastReportedSize = { width: 0, height: 0 };
        this.updateBounds();
      }, 450);
      return;
    } else if (this.lastReportedSize.width <= 0 || this.lastReportedSize.height <= 0) {
      // A zero-sized hidden WebContentsView is not guaranteed to receive an animation
      // frame promptly. Show a tight provisional region so its ResizeObserver can
      // report the final wrapped height without a hidden-view/rAF deadlock.
      this.lastReportedSize = { width: 380, height: 60 };
      this.updateBounds();
    }
    this.syncToastsToOverlay();
  }

  /**
   * Update theme from main process / settings.
   */
  public setTheme(theme: NotificationOverlayTheme): void {
    this.theme = theme;
    this.syncThemeToOverlay();
  }

  /**
   * Called by IPC when the overlay DOM measures its content size.
   */
  public handleReportBounds(bounds: NotificationOverlayBounds): void {
    if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return;
    if (bounds.width <= 0 || bounds.height <= 0) {
      this.clearEmptyHideTimer();
    }
    this.lastReportedSize = bounds;
    this.updateBounds();
  }

  /**
   * Called by IPC when user clicks an action inside the overlay.
   */
  public handleAction(toastId: string, actionId: string): void {
    const toast = this.toasts.find((candidate) => candidate.id === toastId);
    if (!toast?.action || toast.action.actionId !== actionId) return;
    this.onAction?.(toastId, actionId);
    this.restoreActiveFocus?.();
  }

  /**
   * Called by IPC when user dismisses a toast from the overlay.
   */
  public handleDismiss(toastId: string): void {
    if (!this.toasts.some((toast) => toast.id === toastId)) return;
    this.onDismiss?.(toastId);
    this.restoreActiveFocus?.();
  }

  public restoreFocus(): void {
    this.restoreActiveFocus?.();
  }

  /**
   * Calculate and apply the tight rectangular bounds for the notification stack.
   */
  public updateBounds(): void {
    const window = this.getWindow();
    if (!window || window.isDestroyed() || !this.overlayView) return;

    if (
      this.toasts.length === 0 ||
      this.lastReportedSize.width <= 0 ||
      this.lastReportedSize.height <= 0
    ) {
      this.overlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      try {
        this.overlayView.setVisible(false);
      } catch {}
      return;
    }

    const [windowWidth = 0, windowHeight = 0] = window.getContentSize();
    const HEADER_OFFSET = 56;
    const MARGIN_RIGHT = 16;
    const MARGIN_BOTTOM = 16;

    const maxWidth = Math.min(420, Math.max(100, windowWidth - MARGIN_RIGHT * 2));
    const width = Math.max(0, Math.min(maxWidth, Math.round(this.lastReportedSize.width)));
    const maxHeight = Math.max(0, windowHeight - HEADER_OFFSET - MARGIN_BOTTOM);
    const height = Math.max(0, Math.min(maxHeight, Math.round(this.lastReportedSize.height)));

    const x = Math.max(0, windowWidth - width - MARGIN_RIGHT);
    const y = HEADER_OFFSET;

    const bounds: Rectangle = { x, y, width, height };
    this.overlayView.setBounds(bounds);
    try {
      this.overlayView.setVisible(true);
    } catch {}

    this.stackCoordinator.ensureTopmost();
  }

  /**
   * Synchronize zoom factor from parent window webContents to overlay webContents.
   */
  public syncZoomFactor(): void {
    const window = this.getWindow();
    if (!window || window.isDestroyed() || !this.overlayView) return;

    try {
      const zoom = window.webContents.getZoomFactor();
      this.overlayView.webContents.setZoomFactor(zoom);
    } catch {}
  }

  private syncToastsToOverlay(): void {
    if (!this.overlayView || this.overlayView.webContents.isDestroyed()) return;
    try {
      this.overlayView.webContents.send("notification-overlay:sync-toasts", this.toasts);
    } catch {}
  }

  private syncThemeToOverlay(): void {
    if (!this.overlayView || this.overlayView.webContents.isDestroyed()) return;
    try {
      this.overlayView.webContents.send("notification-overlay:sync-theme", this.theme);
    } catch {}
  }

  /**
   * Get the current overlay WebContentsView (if created).
   */
  public getOverlayView(): WebContentsView | null {
    return this.overlayView;
  }

  /**
   * Get current toasts.
   */
  public getToasts(): readonly NotificationToastPayload[] {
    return this.toasts;
  }

  public ownsWebContents(contents: WebContents): boolean {
    return this.overlayView?.webContents === contents;
  }

  /**
   * Clean destruction of the overlay view and listeners.
   */
  public destroy(): void {
    this.clearEmptyHideTimer();
    if (this.boundWindow && !this.boundWindow.isDestroyed()) {
      if (this.windowResizeHandler) {
        this.boundWindow.removeListener("resize", this.windowResizeHandler);
      }
      if (this.windowCloseHandler) {
        this.boundWindow.removeListener("closed", this.windowCloseHandler);
      }
    }

    this.windowResizeHandler = null;
    this.windowCloseHandler = null;
    this.boundWindow = null;

    this.stackCoordinator.removeNotificationOverlayView();

    if (this.overlayView) {
      try {
        if (!this.overlayView.webContents.isDestroyed()) {
          this.overlayView.webContents.close();
        }
      } catch {}
      this.overlayView = null;
    }
  }

  private clearEmptyHideTimer(): void {
    if (this.emptyHideTimer === null) return;
    clearTimeout(this.emptyHideTimer);
    this.emptyHideTimer = null;
  }
}
