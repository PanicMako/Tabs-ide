import { useEffect, useRef } from "react";

const BLOCKING_NATIVE_SURFACE_OVERLAY_SELECTORS = [
  "[data-slot='menu-positioner']",
  "[data-slot='study-project-deck']",
  "[data-slot='notification-history-panel']",
  "[data-slot='popover-positioner']",
  "[data-slot='dialog-backdrop']",
  "[data-slot='dialog-popup']",
  "[data-slot='alert-dialog-backdrop']",
  "[data-slot='alert-dialog-popup']",
  "[data-slot='command-dialog-backdrop']",
  "[data-slot='command-dialog-popup']",
  "[data-slot='code-resize-overlay']",
  "[data-slot='quick-actions-overlay']",
  "[data-slot='workspace-tour-overlay']",
] as const;

/**
 * Native WebContentsViews sit above renderer CSS, so modal overlays that must
 * remain readable or interactive temporarily suspend the active native surface.
 * Toast notifications render in a dedicated topmost WebContentsView and do not
 * suspend native surfaces. The interactive renderer-owned history panel does.
 */
export const NATIVE_SURFACE_BLOCKING_OVERLAY_SELECTOR =
  BLOCKING_NATIVE_SURFACE_OVERLAY_SELECTORS.join(", ");

export function isNativeSurfaceBlockingOverlaySlot(
  slot: string,
  _options?: { interactive?: boolean },
): boolean {
  return BLOCKING_NATIVE_SURFACE_OVERLAY_SELECTORS.some(
    (selector) => selector === `[data-slot='${slot}']`,
  );
}

export function shouldSuspendNativeSurfaceForOverlay(
  surfaceReady: boolean,
  overlayOpen: boolean,
): boolean {
  return surfaceReady && overlayOpen;
}

export interface NativeSurfaceOverlaySuspensionOptions {
  enabled: boolean;
  surfaceReady: boolean;
  onSuspend: () => void;
  onResume: () => void | Promise<void>;
  debounceMs?: number;
  captureBackdrop?: () => Promise<string | null>;
  backdropHost?: { current: HTMLElement | null };
}

/**
 * Shared hook to consolidate debounced MutationObserver checks for genuine
 * blocking overlays (menus, dialogs, command palette).
 */
export function useNativeSurfaceOverlaySuspension({
  enabled,
  surfaceReady,
  onSuspend,
  onResume,
  debounceMs = 50,
  captureBackdrop,
  backdropHost,
}: NativeSurfaceOverlaySuspensionOptions): void {
  const captureRef = useRef(captureBackdrop);
  captureRef.current = captureBackdrop;
  const hostRef = useRef(backdropHost);
  hostRef.current = backdropHost;
  const onSuspendRef = useRef(onSuspend);
  onSuspendRef.current = onSuspend;
  const onResumeRef = useRef(onResume);
  onResumeRef.current = onResume;
  const surfaceReadyRef = useRef(surfaceReady);
  surfaceReadyRef.current = surfaceReady;

  useEffect(() => {
    if (!enabled) return;

    let suspended = false;
    let generation = 0;
    let backdrop: HTMLImageElement | null = null;
    const clearBackdrop = () => {
      backdrop?.remove();
      backdrop = null;
    };
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const syncOverlayVisibility = () => {
      debounceTimer = null;
      const overlayElement =
        typeof document !== "undefined"
          ? document.querySelector(NATIVE_SURFACE_BLOCKING_OVERLAY_SELECTOR)
          : null;
      const shouldSuspend = shouldSuspendNativeSurfaceForOverlay(
        surfaceReadyRef.current,
        overlayElement !== null,
      );

      if (shouldSuspend === suspended) {
        return;
      }

      suspended = shouldSuspend;
      const current = ++generation;
      if (shouldSuspend) {
        // Capture and decode while the native surface is still visible. CSS
        // cannot blur a sibling WebContentsView, so keep its pixels in the DOM.
        void (async () => {
          const source = await Promise.resolve()
            .then(() => captureRef.current?.())
            .catch(() => null);
          if (current !== generation) return;
          const host = hostRef.current?.current;
          if (source && host) {
            const image = new Image();
            image.src = source;
            image.alt = "";
            image.setAttribute("aria-hidden", "true");
            image.className = "pointer-events-none absolute inset-0 size-full select-none";
            image.dataset.slot = "native-surface-backdrop";
            await image.decode().catch(() => undefined);
            if (current !== generation) return;
            clearBackdrop();
            host.append(image);
            backdrop = image;
          }
          onSuspendRef.current();
        })();
      } else {
        // Keep the captured pixels until the native view has reattached.
        void Promise.resolve(onResumeRef.current()).finally(() => {
          if (current === generation) clearBackdrop();
        });
      }
    };

    const scheduleSync = () => {
      if (debounceTimer !== null) return;
      debounceTimer = setTimeout(syncOverlayVisibility, debounceMs);
    };

    // Initial check
    scheduleSync();

    if (typeof document === "undefined" || !document.body) {
      return;
    }

    const observer = new MutationObserver(() => {
      scheduleSync();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-open", "data-closed", "hidden", "style", "class"],
    });

    return () => {
      ++generation;
      clearBackdrop();
      observer.disconnect();
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    };
  }, [enabled, debounceMs]);
}
