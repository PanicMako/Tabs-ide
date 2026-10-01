export interface WindowControlsOverlay extends EventTarget {
  readonly visible: boolean;
  getTitlebarAreaRect(): { x: number; width: number };
}

export interface WindowControlsInsets {
  readonly left: number;
  readonly right: number;
}

export function readWindowControlsInsets(
  viewportWidth: number,
  overlay: WindowControlsOverlay | undefined,
  fallback: WindowControlsInsets,
): WindowControlsInsets {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return { left: 0, right: 0 };
  if (!overlay) return fallback;
  if (!overlay.visible) return { left: 0, right: 0 };
  const rect = overlay.getTitlebarAreaRect();
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.width) ||
    rect.x < 0 ||
    rect.x >= viewportWidth ||
    rect.width <= 0
  )
    return fallback;
  return { left: rect.x, right: Math.max(0, viewportWidth - rect.x - rect.width) };
}

export function readWindowControlsRightInset(
  viewportWidth: number,
  overlay: WindowControlsOverlay | undefined,
): number {
  return readWindowControlsInsets(viewportWidth, overlay, { left: 0, right: 140 }).right;
}

export function subscribeWindowControlsGeometry(
  overlay: WindowControlsOverlay | undefined,
  viewport: EventTarget,
  onChange: () => void,
): () => void {
  overlay?.addEventListener("geometrychange", onChange);
  viewport.addEventListener("resize", onChange);
  return () => {
    overlay?.removeEventListener("geometrychange", onChange);
    viewport.removeEventListener("resize", onChange);
  };
}
