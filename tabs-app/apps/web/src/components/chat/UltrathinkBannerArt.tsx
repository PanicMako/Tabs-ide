import { BannerCanvas, type BannerArt } from "./bannerCanvas";
import { drawDotField, type Cell } from "./dotField";
import { RIPPLE_SHADES, createRippleWash, rippleSource, rippleValue } from "./rippleWash";

/**
 * The ultrathink banner's background: a soft wash of violet ripples under a
 * field of tiny dots that light up as each crest passes. The cursor becomes a
 * second source; a click throws a bright ring.
 */

/** Brightest dots run from violet up toward white. */
function dotColor(v: number, dark: boolean): string {
  const scaled = Math.max(0, Math.min(0.9999, v)) * (RIPPLE_SHADES.length - 1);
  const index = Math.floor(scaled);
  const f = scaled - index;
  const a = RIPPLE_SHADES[index]!;
  const b = RIPPLE_SHADES[index + 1]!;
  const lift = Math.max(0, (v - 0.7) / 0.3) * 0.6;
  const channel = (i: 0 | 1 | 2) => {
    const base = a[i] + (b[i] - a[i]) * f;
    return dark ? base + (255 - base) * lift : base * (1 - lift * 0.4);
  };
  return `rgba(${channel(0) | 0},${channel(1) | 0},${channel(2) | 0},${dark ? v : v * 0.9})`;
}

/** How strongly the dots follow the rings: quiet troughs, lit crests. */
function dotLight(c: Cell): number {
  const source = rippleSource(c.w, c.h, c.t);
  const v = rippleValue(c.x, c.y, c.t, source.x, source.y);
  return Math.max(0, (v - 0.32) * 1.5);
}

function rippleArt(): BannerArt {
  const wash = createRippleWash();
  return (f) => {
    // The smooth wash sits underneath, dimmed so the dots carry the light.
    wash(f, f.dark ? 0.5 : 0.35);
    drawDotField(f, dotLight, (_cell, v, dark) => dotColor(v, dark), { clear: false });
  };
}

export function UltrathinkBannerArt() {
  return <BannerCanvas artKey="ultrathink" className="" makeArt={rippleArt} />;
}
