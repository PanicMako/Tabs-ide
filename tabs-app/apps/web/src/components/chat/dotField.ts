import { ring, type BannerFrame } from "./bannerCanvas";

/**
 * The pixel field a composer banner can be drawn with: a grid of small squares
 * whose brightness comes from a `Light`, plus the shared hover glow and click
 * ring. Callers choose how light moves and how a lit dot is coloured.
 */

export interface Cell {
  readonly x: number;
  readonly y: number;
  /** x across the strip, 0 to 1. */
  readonly u: number;
  readonly row: number;
  readonly col: number;
  readonly w: number;
  readonly h: number;
  readonly t: number;
}

/** How lit one dot is before hover and clicks. */
export type Light = (cell: Cell) => number;

/** The colour of a dot lit to `v` (0–1). */
export type Paint = (cell: Cell, v: number, dark: boolean) => string;

/** A soft tilted band centred on `centre`, travelling across the field. */
export function band(x: number, y: number, h: number, centre: number, tilt: number, width: number) {
  const along = x - centre + (y - h / 2) * tilt;
  return Math.exp(-(along * along) / (2 * width * width));
}

/** Where sweep `k` of `count` is now: evenly spaced, looping just past both ends. */
export function sweepAt(t: number, w: number, speed: number, k: number, count: number): number {
  return ((((t * speed + k / count) % 1) + 1) % 1) * (w + 240) - 120;
}

/** The resting shimmer a field sits on: never dark, gently rippling. */
export function restingField(c: Cell, level: number): number {
  return level + 0.08 * Math.sin(c.u * 22 + c.y * 0.35 - c.t * 2.2);
}

export function drawDotField(
  f: BannerFrame,
  light: Light,
  paint: Paint,
  options: { readonly clear?: boolean } = {},
) {
  const { ctx, width: w, height: h, time: t } = f;
  if (options.clear !== false) ctx.clearRect(0, 0, w, h);
  const gap = 5;
  let col = 0;
  for (let x = gap / 2; x < w; x += gap, col += 1) {
    const u = x / w;
    let row = 0;
    for (let y = gap / 2; y < h; y += gap, row += 1) {
      const cell = { x, y, u, row, col, w, h, t };
      let v = light(cell);
      if (f.pointer.active) {
        const d = Math.hypot(x - f.pointer.x, y - f.pointer.y);
        v += Math.exp(-(d * d) / (2 * 34 * 34)) * 0.9;
      }
      for (const pulse of f.pulses) {
        v += ring(Math.hypot(x - pulse.x, y - pulse.y), t - pulse.born, 240, 9, 1.6) * 1.2;
      }
      v = Math.min(1, v);
      if (v < 0.04) continue;
      const size = 1 + v * 1.8;
      ctx.fillStyle = paint(cell, v, f.dark);
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }
  }
}
