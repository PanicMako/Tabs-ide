import type { BannerFrame, Rgb } from "./bannerCanvas";

/**
 * The ultrathink ripples: violet rings spreading from a point three quarters
 * of the way across, over a slow drifting tide. Shared by the ultrathink banner
 * and by the Overmind banner when the lead runs at ultrathink.
 */

/** Deep indigo up to bright violet; values blend smoothly between them. */
export const RIPPLE_SHADES: ReadonlyArray<Rgb> = [
  [24, 12, 58],
  [40, 19, 96],
  [58, 28, 140],
  [80, 40, 184],
  [104, 58, 222],
  [128, 88, 242],
  [160, 128, 252],
];

function shadeInto(data: Uint8ClampedArray, offset: number, v: number) {
  const scaled = Math.max(0, Math.min(0.9999, v)) * (RIPPLE_SHADES.length - 1);
  const index = Math.floor(scaled);
  const f = scaled - index;
  const a = RIPPLE_SHADES[index]!;
  const b = RIPPLE_SHADES[index + 1]!;
  data[offset] = a[0] + (b[0] - a[0]) * f;
  data[offset + 1] = a[1] + (b[1] - a[1]) * f;
  data[offset + 2] = a[2] + (b[2] - a[2]) * f;
  data[offset + 3] = 255;
}

/** Banner pixels per buffer pixel; smoothing on the way up hides the grid. */
const SCALE = 4;

/** Where the rings come from right now: three quarters across, swaying gently. */
export function rippleSource(w: number, h: number, t: number) {
  return { x: w * (0.75 + 0.03 * Math.sin(t * 0.3)), y: h * (0.5 + 0.12 * Math.sin(t * 0.45)) };
}

/** How lit the ripple field is at a point, 0–1 before clamping; shared by the wash and the dots. */
export function rippleValue(x: number, y: number, t: number, sx: number, sy: number): number {
  const d = Math.hypot(x - sx, y - sy);
  // Rings travel outward and soften with distance.
  let v = 0.44 + (0.3 * Math.sin(d * 0.055 - t * 2.1)) / (1 + d / 260);
  // A second, finer set of rings riding on the first.
  v += (0.08 * Math.sin(d * 0.13 - t * 3.4)) / (1 + d / 90);
  // A slow tide across the whole bar, so the far side never sits still.
  v += 0.1 * Math.sin(x * 0.006 - t * 0.35) + 0.05 * Math.sin(y * 0.08 + x * 0.01 + t * 0.6);
  return v;
}

/**
 * Paints the smooth ripple wash over the whole canvas, clearing it first:
 * drawn small and scaled up with smoothing, at `alpha` so whatever is drawn on
 * top carries the light. The cursor adds rings of its own; clicks throw one.
 */
export function createRippleWash(): (f: BannerFrame, alpha: number) => void {
  const buffer = document.createElement("canvas");
  const bufferCtx = buffer.getContext("2d");
  let image: ImageData | null = null;

  return (f, alpha) => {
    const { ctx, width: w, height: h, time: t } = f;
    ctx.clearRect(0, 0, w, h);
    if (!bufferCtx || w <= 0 || h <= 0) return;
    const bw = Math.max(1, Math.ceil(w / SCALE));
    const bh = Math.max(1, Math.ceil(h / SCALE));
    if (!image || image.width !== bw || image.height !== bh) {
      buffer.width = bw;
      buffer.height = bh;
      image = bufferCtx.createImageData(bw, bh);
    }
    const data = image.data;
    const source = rippleSource(w, h, t);

    for (let by = 0; by < bh; by += 1) {
      const y = (by + 0.5) * SCALE;
      for (let bx = 0; bx < bw; bx += 1) {
        const x = (bx + 0.5) * SCALE;
        let v = rippleValue(x, y, t, source.x, source.y);
        if (f.pointer.active) {
          const pd = Math.hypot(x - f.pointer.x, y - f.pointer.y);
          v += (0.22 * Math.sin(pd * 0.09 - t * 4)) / (1 + pd / 40) + 0.12 * Math.exp(-pd / 50);
        }
        for (const pulse of f.pulses) {
          const age = t - pulse.born;
          const pd = Math.hypot(x - pulse.x, y - pulse.y) - age * 230;
          v += Math.exp(-(pd * pd) / (2 * 14 * 14)) * Math.exp(-age * 1.3) * 0.5;
        }
        shadeInto(data, (by * bw + bx) * 4, v);
      }
    }

    bufferCtx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.globalAlpha = alpha;
    ctx.drawImage(buffer, 0, 0, w, h);
    ctx.globalAlpha = 1;
  };
}
