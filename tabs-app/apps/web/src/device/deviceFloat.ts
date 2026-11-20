export interface FloatPosition {
  readonly x: number;
  readonly y: number;
}
export interface FloatSize {
  readonly width: number;
  readonly height: number;
}

export const DEVICE_FLOAT_SIZE: FloatSize = { width: 340, height: 600 };
const EDGE = 12;

/** Keeps the floating device fully on screen, whatever the window did since it was placed. */
export function clampFloatPosition(
  position: FloatPosition,
  size: FloatSize,
  viewport: FloatSize,
): FloatPosition {
  const maxX = Math.max(EDGE, viewport.width - size.width - EDGE);
  const maxY = Math.max(EDGE, viewport.height - size.height - EDGE);
  return {
    x: Math.min(Math.max(EDGE, position.x), maxX),
    y: Math.min(Math.max(EDGE, position.y), maxY),
  };
}

/** Where a device lands the first time it floats: the lower right, clear of the composer's edge. */
export function defaultFloatPosition(size: FloatSize, viewport: FloatSize): FloatPosition {
  return clampFloatPosition(
    { x: viewport.width - size.width - 24, y: viewport.height - size.height - 24 },
    size,
    viewport,
  );
}

/** The size the floating window takes: the default, shrunk to fit a small window. */
export function floatSizeFor(viewport: FloatSize): FloatSize {
  return {
    width: Math.min(DEVICE_FLOAT_SIZE.width, Math.max(240, viewport.width - EDGE * 2)),
    height: Math.min(DEVICE_FLOAT_SIZE.height, Math.max(320, viewport.height - EDGE * 2)),
  };
}
