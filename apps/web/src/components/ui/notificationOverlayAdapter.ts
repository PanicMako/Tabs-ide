import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type {
  NotificationToastAction,
  NotificationToastPayload,
  NotificationToastType,
} from "@tabs/contracts";
import { markNotificationRead } from "~/stores/notificationStore";

/**
 * Extracts plain text safely from React nodes, strings, numbers, or arrays.
 * Never preserves raw HTML or executable elements.
 */
export function extractTextContent(node: ReactNode | unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) {
    return node.map(extractTextContent).join("");
  }
  if (typeof node === "object" && node !== null && "props" in node) {
    const props = (node as { props?: { children?: unknown } }).props;
    if (props && "children" in props) {
      return extractTextContent(props.children);
    }
  }
  return "";
}

export function isDesktopNotificationOverlayAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    window.desktopBridge?.isPopout !== true &&
    typeof window.desktopBridge?.syncNotificationOverlay === "function"
  );
}

export interface MinimalToastItem {
  id: string | number;
  type?: string | undefined;
  title?: ReactNode;
  description?: ReactNode;
  actionProps?:
    | {
        children?: ReactNode;
        onClick?: ((...args: any[]) => void) | undefined;
        [key: string]: unknown;
      }
    | undefined;
  data?:
    | {
        dismissAfterVisibleMs?: number | undefined;
        onClose?: (() => void) | undefined;
        tooltipStyle?: boolean | undefined;
        interactive?: boolean | undefined;
        threadId?: string | null | undefined;
        [key: string]: unknown;
      }
    | undefined;
  timeout?: number | undefined;
}

export interface ToastManagerLike {
  close: (id?: string) => void;
}

const VALID_TOAST_TYPES = new Set<NotificationToastType>([
  "loading",
  "error",
  "info",
  "success",
  "warning",
]);
const toastCreatedAtById = new Map<string, number>();

export function serializeToastToPayload(toast: MinimalToastItem): NotificationToastPayload {
  const toastId = String(toast.id);
  const createdAt = toastCreatedAtById.get(toastId) ?? Date.now();
  toastCreatedAtById.set(toastId, createdAt);
  const type: NotificationToastType = VALID_TOAST_TYPES.has(toast.type as NotificationToastType)
    ? (toast.type as NotificationToastType)
    : "info";

  const title = extractTextContent(toast.title);
  const description = toast.description ? extractTextContent(toast.description) : undefined;

  let action: NotificationToastAction | undefined = undefined;
  if (toast.actionProps) {
    const actionLabel = extractTextContent(toast.actionProps.children) || "Action";
    action = {
      actionId: "primary",
      label: actionLabel,
    };
  }

  const duration =
    toast.data?.dismissAfterVisibleMs ??
    (typeof toast.timeout === "number" && toast.timeout > 0 ? toast.timeout : 5000);

  const payload: NotificationToastPayload = {
    id: toastId,
    type,
    title,
    createdAt,
    duration,
    ...(description ? { description } : {}),
    ...(action ? { action } : {}),
    ...(typeof toast.data?.tooltipStyle === "boolean"
      ? { tooltipStyle: toast.data.tooltipStyle }
      : {}),
    ...(typeof toast.data?.interactive === "boolean"
      ? { interactive: toast.data.interactive }
      : {}),
    ...(toast.data?.threadId !== undefined ? { threadId: toast.data.threadId } : {}),
  };

  return payload;
}

export function syncNotificationOverlayToBridge(
  bridge:
    | { syncNotificationOverlay?: (toasts: readonly NotificationToastPayload[]) => Promise<void> }
    | undefined,
  toasts: readonly MinimalToastItem[],
): Promise<void> {
  if (!bridge?.syncNotificationOverlay) {
    return Promise.resolve();
  }
  const payloads = toasts.map(serializeToastToPayload);
  return bridge.syncNotificationOverlay(payloads);
}

export function handleNotificationOverlayAction(
  toasts: readonly MinimalToastItem[],
  action: { toastId: string; actionId: string },
): boolean {
  const matchingToast = toasts.find((t) => String(t.id) === action.toastId);
  if (matchingToast && action.actionId === "primary" && matchingToast.actionProps?.onClick) {
    matchingToast.actionProps.onClick();
    return true;
  }
  return false;
}

export function handleNotificationOverlayDismiss(
  toasts: readonly MinimalToastItem[],
  dismiss: { toastId: string },
  manager: ToastManagerLike,
): boolean {
  const matchingToast = toasts.find((t) => String(t.id) === dismiss.toastId);
  if (matchingToast) {
    matchingToast.data?.onClose?.();
    manager.close(String(matchingToast.id));
    markNotificationRead(String(matchingToast.id));
    return true;
  }
  return false;
}

/**
 * Hook to synchronize active toasts with the desktop notification overlay WebContentsView.
 * Returns true if the desktop notification overlay is active (in which case in-DOM
 * toasts should not be rendered).
 */
export function useNotificationOverlayAdapter(
  toasts: readonly MinimalToastItem[],
  manager: ToastManagerLike,
): boolean {
  const isAvailable = isDesktopNotificationOverlayAvailable();

  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;

  const managerRef = useRef(manager);
  managerRef.current = manager;

  // Listen for actions and dismissals from the overlay
  useEffect(() => {
    if (!isAvailable) return;

    const bridge = window.desktopBridge;
    if (!bridge?.onNotificationOverlayAction || !bridge?.onNotificationOverlayDismiss) {
      return;
    }

    const unsubAction = bridge.onNotificationOverlayAction(({ toastId, actionId }) => {
      handleNotificationOverlayAction(toastsRef.current, { toastId, actionId });
    });

    const unsubDismiss = bridge.onNotificationOverlayDismiss(({ toastId }) => {
      handleNotificationOverlayDismiss(toastsRef.current, { toastId }, managerRef.current);
    });

    return () => {
      unsubAction();
      unsubDismiss();
    };
  }, [isAvailable]);

  // Sync toasts to the overlay whenever the toast list changes
  const serializedToasts = toasts.map(serializeToastToPayload);
  const serializedSignature = JSON.stringify(serializedToasts);

  useEffect(() => {
    if (!isAvailable) return;

    const bridge = window.desktopBridge;
    void bridge?.syncNotificationOverlay?.(serializedToasts).catch(() => undefined);
  }, [serializedSignature, isAvailable]);

  // Clear the native overlay only when the adapter itself is removed. Keeping
  // this separate from the update effect avoids an empty sync (and visible
  // collapse/flicker) before every ordinary toast-list update.
  useEffect(() => {
    if (!isAvailable) return;
    const bridge = window.desktopBridge;
    return () => {
      void bridge?.syncNotificationOverlay?.([]).catch(() => undefined);
    };
  }, [isAvailable]);

  return isAvailable;
}
