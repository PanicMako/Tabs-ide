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

function nextFrames(count: number): Promise<void> {
  if (typeof requestAnimationFrame !== "function") return Promise.resolve();
  return new Promise((resolve) => {
    const step = (remaining: number) => {
      if (remaining <= 0) return resolve();
      requestAnimationFrame(() => step(remaining - 1));
    };
    step(count);
  });
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
  debounceMs = 16,
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
    let backdropSize: { width: number; height: number } | null = null;
    let sizeObserver: ResizeObserver | null = null;
    const clearBackdrop = () => {
      sizeObserver?.disconnect();
      sizeObserver = null;
      backdrop?.remove();
      backdrop = null;
      backdropSize = null;
    };
    // A snapshot only stands in for the page at the size it was taken. Once the
    // host is resized (device preset, rotation, window resize), drop it rather
    // than show pixels that no longer match the frame.
    const watchHostSize = (host: HTMLElement) => {
      sizeObserver?.disconnect();
      if (typeof ResizeObserver === "undefined") return;
      sizeObserver = new ResizeObserver(([entry]) => {
        if (!entry || !backdropSize || !backdrop) return;
        const { width, height } = entry.contentRect;
        if (
          Math.abs(width - backdropSize.width) > 1 ||
          Math.abs(height - backdropSize.height) > 1
        ) {
          backdrop.remove();
          backdrop = null;
          backdropSize = null;
        }
      });
      sizeObserver.observe(host);
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
          const host = hostRef.current?.current ?? null;
          // Pin the snapshot to the size it was captured at. A viewport change
          // while suspended resizes the host; stretching old pixels to the new
          // frame is what made the preview look distorted.
          const captured = host?.getBoundingClientRect();
          const source = await Promise.resolve()
            .then(() => captureRef.current?.())
            .catch(() => null);
          if (current !== generation) return;
          if (source && host) {
            const image = new Image();
            image.src = source;
            image.alt = "";
            image.setAttribute("aria-hidden", "true");
            image.draggable = false;
            image.className = "pointer-events-none absolute left-0 top-0 select-none";
            if (captured && captured.width > 0 && captured.height > 0) {
              image.style.width = `${captured.width}px`;
              image.style.height = `${captured.height}px`;
              backdropSize = { width: captured.width, height: captured.height };
            } else {
              image.classList.add("size-full");
              backdropSize = null;
            }
            image.dataset.slot = "native-surface-backdrop";
            await image.decode().catch(() => undefined);
            if (current !== generation) return;
            clearBackdrop();
            host.append(image);
            backdrop = image;
            watchHostSize(host);
          }
          onSuspendRef.current();
        })();
      } else {
        // Keep the captured pixels until the native view has reattached and
        // composited a frame, so closing a menu never flashes the empty host.
        void Promise.resolve(onResumeRef.current())
          .then(() => nextFrames(2))
          .finally(() => {
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
