/**
 * Position persistence and corner snapping shared by the floating mascots (workspace tour,
 * Notch). A position is {x, y} in 0..1 across the free area of the window.
 */
export interface CornerPosition {
  readonly x: number;
  readonly y: number;
}

export function isCornerPosition(value: unknown): value is CornerPosition {
  const saved = value as Partial<CornerPosition> | null;
  return (
    typeof saved?.x === "number" &&
    typeof saved?.y === "number" &&
    saved.x >= 0 &&
    saved.x <= 1 &&
    saved.y >= 0 &&
    saved.y <= 1
  );
}

export function readStoredPosition(key: string, fallback: CornerPosition): CornerPosition {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (isCornerPosition(saved)) return saved;
  } catch {}
  return fallback;
}

export function saveStoredPosition(key: string, position: CornerPosition) {
  try {
    localStorage.setItem(key, JSON.stringify(position));
  } catch {}
}

/** The window corner nearest to a point (0/1 on each axis). */
export function nearestCorner(
  point: { readonly x: number; readonly y: number },
  width: number,
  height: number,
): CornerPosition {
  return {
    x: point.x >= Math.max(1, width) / 2 ? 1 : 0,
    y: point.y >= Math.max(1, height) / 2 ? 1 : 0,
  };
}

/** Whether a pointer gesture moved far enough to count as a drag instead of a click. */
export function isDragGesture(dx: number, dy: number, threshold = 5): boolean {
  return Math.hypot(dx, dy) > threshold;
}

// ---------------------------------------------------------------- free placement

export interface WindowInsets {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** The pixel offset (top-left) of a floating box for a normalized position. Stays inside the window. */
export function placeInWindow(
  position: CornerPosition,
  viewport: Viewport,
  size: number,
  insets: WindowInsets,
): { x: number; y: number } {
  const freeWidth = Math.max(0, viewport.width - size - insets.left - insets.right);
  const freeHeight = Math.max(0, viewport.height - size - insets.top - insets.bottom);
  return {
    x: insets.left + clampUnit(position.x) * freeWidth,
    y: insets.top + clampUnit(position.y) * freeHeight,
  };
}

/** The normalized position for a pixel offset (top-left) of a floating box, clamped to the window. */
export function positionFromOffset(
  offset: { readonly x: number; readonly y: number },
  viewport: Viewport,
  size: number,
  insets: WindowInsets,
): CornerPosition {
  const freeWidth = Math.max(0, viewport.width - size - insets.left - insets.right);
  const freeHeight = Math.max(0, viewport.height - size - insets.top - insets.bottom);
  return {
    x: freeWidth === 0 ? 0 : clampUnit((offset.x - insets.left) / freeWidth),
    y: freeHeight === 0 ? 0 : clampUnit((offset.y - insets.top) / freeHeight),
  };
}

/** Moves a position by a pixel delta (keyboard nudge), clamped to the window. */
export function nudgePosition(
  position: CornerPosition,
  delta: { readonly dx: number; readonly dy: number },
  viewport: Viewport,
  size: number,
  insets: WindowInsets,
): CornerPosition {
  const at = placeInWindow(position, viewport, size, insets);
  return positionFromOffset({ x: at.x + delta.dx, y: at.y + delta.dy }, viewport, size, insets);
}
