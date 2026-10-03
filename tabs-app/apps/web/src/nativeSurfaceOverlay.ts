import { useEffect, useRef } from "react";

const BLOCKING_NATIVE_SURFACE_OVERLAY_SELECTORS = [
  "[data-slot='menu-positioner']",
  "[data-slot='popover-positioner']",
  "[data-slot='dialog-backdrop']",
  "[data-slot='dialog-popup']",
  "[data-slot='alert-dialog-backdrop']",
  "[data-slot='alert-dialog-popup']",
  "[data-slot='command-dialog-backdrop']",
  "[data-slot='command-dialog-popup']",
  "[data-slot='code-resize-overlay']",
] as const;

/**
 * Native WebContentsViews sit above renderer CSS, so modal overlays that must
 * remain readable or interactive temporarily suspend the active native surface.
 * Notifications now render in a dedicated topmost WebContentsView and do not
 * suspend or detach native surfaces.
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
  onResume: () => void;
  debounceMs?: number;
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
}: NativeSurfaceOverlaySuspensionOptions): void {
  const onSuspendRef = useRef(onSuspend);
  onSuspendRef.current = onSuspend;
  const onResumeRef = useRef(onResume);
  onResumeRef.current = onResume;
  const surfaceReadyRef = useRef(surfaceReady);
  surfaceReadyRef.current = surfaceReady;

  useEffect(() => {
    if (!enabled) return;

    let suspended = false;
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
      if (shouldSuspend) {
        onSuspendRef.current();
      } else {
        onResumeRef.current();
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
      observer.disconnect();
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    };
  }, [enabled, debounceMs]);
}
