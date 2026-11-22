import type { DesktopBrowserContextMenuPayload } from "@tabs/contracts";
import { useEffect, useState } from "react";

import { showContextMenuFallback } from "~/contextMenuFallback";

/**
 * Embedded browser panes are native views that paint above the DOM. On right-click the desktop
 * sends a snapshot of the page and the menu items: this layer paints the snapshot exactly where
 * the page was, tells the desktop it may hide the live view, and draws the themed menu on top.
 */
export function BrowserContextMenuLayer() {
  const [shot, setShot] = useState<DesktopBrowserContextMenuPayload | null>(null);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.onBrowserContextMenu) return;
    return bridge.onBrowserContextMenu((payload) => setShot(payload));
  }, []);

  useEffect(() => {
    if (!shot) return;
    const bridge = window.desktopBridge;
    let cancelled = false;
    const image = new Image();
    image.src = shot.snapshot;
    void (async () => {
      let id: string | null = null;
      try {
        await image.decode();
        // Two frames: the snapshot must be on screen before the live view disappears.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        if (cancelled) return;
        await bridge?.browserContextMenuReady?.(shot.token);
        id = await showContextMenuFallback(shot.items, shot.point);
      } catch {
        id = null;
      }
      await bridge?.resolveBrowserContextMenu?.(shot.token, id);
      // Let the restored view paint before the snapshot goes away.
      setTimeout(() => !cancelled && setShot(null), 90);
    })();
    return () => {
      cancelled = true;
    };
  }, [shot]);

  if (!shot) return null;
  return (
    <img
      alt=""
      aria-hidden="true"
      data-slot="browser-context-menu-snapshot"
      src={shot.snapshot}
      draggable={false}
      className="pointer-events-none fixed z-[45] select-none"
      style={{
        left: shot.bounds.x,
        top: shot.bounds.y,
        width: shot.bounds.width,
        height: shot.bounds.height,
      }}
    />
  );
}
