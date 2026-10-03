import { contextBridge, ipcRenderer } from "electron";
import type {
  NotificationOverlayBounds,
  NotificationOverlayTheme,
  NotificationToastPayload,
} from "@tabs/contracts";

const NOTIFICATION_OVERLAY_SYNC_TOASTS_EVENT = "notification-overlay:sync-toasts";
const NOTIFICATION_OVERLAY_SYNC_THEME_EVENT = "notification-overlay:sync-theme";
const NOTIFICATION_OVERLAY_ACTION_CHANNEL = "desktop:notification-overlay:action";
const NOTIFICATION_OVERLAY_DISMISS_CHANNEL = "desktop:notification-overlay:dismiss";
const NOTIFICATION_OVERLAY_REPORT_BOUNDS_CHANNEL = "desktop:notification-overlay:report-bounds";
const NOTIFICATION_OVERLAY_RESTORE_FOCUS_CHANNEL = "desktop:notification-overlay:restore-focus";
const WRITE_CLIPBOARD_TEXT_CHANNEL = "desktop:clipboard:write-text";

export interface NotificationOverlayBridge {
  onSyncToasts: (listener: (toasts: NotificationToastPayload[]) => void) => () => void;
  onSyncTheme: (listener: (theme: NotificationOverlayTheme) => void) => () => void;
  reportBounds: (bounds: NotificationOverlayBounds) => void;
  triggerAction: (toastId: string, actionId: string) => void;
  dismissToast: (toastId: string) => void;
  copyText: (text: string) => void;
}

contextBridge.exposeInMainWorld("notificationOverlayBridge", {
  onSyncToasts: (listener: (toasts: NotificationToastPayload[]) => void) => {
    const handler = (_event: unknown, toasts: NotificationToastPayload[]) => {
      listener(Array.isArray(toasts) ? toasts : []);
    };
    ipcRenderer.on(NOTIFICATION_OVERLAY_SYNC_TOASTS_EVENT, handler);
    return () => {
      ipcRenderer.removeListener(NOTIFICATION_OVERLAY_SYNC_TOASTS_EVENT, handler);
    };
  },
  onSyncTheme: (listener: (theme: NotificationOverlayTheme) => void) => {
    const handler = (_event: unknown, theme: NotificationOverlayTheme) => {
      if (theme && typeof theme.themeId === "string") {
        listener(theme);
      }
    };
    ipcRenderer.on(NOTIFICATION_OVERLAY_SYNC_THEME_EVENT, handler);
    return () => {
      ipcRenderer.removeListener(NOTIFICATION_OVERLAY_SYNC_THEME_EVENT, handler);
    };
  },
  reportBounds: (bounds: NotificationOverlayBounds) => {
    if (
      bounds &&
      Number.isFinite(bounds.width) &&
      Number.isFinite(bounds.height) &&
      bounds.width >= 0 &&
      bounds.height >= 0
    ) {
      ipcRenderer.send(NOTIFICATION_OVERLAY_REPORT_BOUNDS_CHANNEL, bounds);
    }
  },
  triggerAction: (toastId: string, actionId: string) => {
    if (
      typeof toastId === "string" &&
      toastId.length <= 256 &&
      typeof actionId === "string" &&
      actionId.length <= 256
    ) {
      ipcRenderer.send(NOTIFICATION_OVERLAY_ACTION_CHANNEL, { toastId, actionId });
    }
  },
  dismissToast: (toastId: string) => {
    if (typeof toastId === "string" && toastId.length <= 256) {
      ipcRenderer.send(NOTIFICATION_OVERLAY_DISMISS_CHANNEL, { toastId });
    }
  },
  copyText: (text: string) => {
    if (typeof text === "string" && text.length <= 4_096) {
      void ipcRenderer
        .invoke(WRITE_CLIPBOARD_TEXT_CHANNEL, text)
        .catch(() => undefined)
        .finally(() => ipcRenderer.send(NOTIFICATION_OVERLAY_RESTORE_FOCUS_CHANNEL));
    }
  },
});
