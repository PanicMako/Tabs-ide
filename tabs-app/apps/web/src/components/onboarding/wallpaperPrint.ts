/**
 * Print styles for the agent wallpaper: the artwork is sampled into a coarse grid once and redrawn
 * as ASCII glyphs, a dither, braille, engraved lines, stipple, crosses or a mosaic. Everything here is pure so it stays testable;
 * the canvas component only supplies pixels and a 2D context.
 */

import { AGENT_WALLPAPER_CHANGE_EVENT } from "./wallpapers";

export type WallpaperPrintStyle =
  | "halftone"
  | "ascii"
  | "dither"
  | "braille"
  | "engrave"
  | "stipple"
  | "crosses"
  | "mosaic"
  | "none";

export type WallpaperPrintStrength = 1 | 2 | 3;

export interface WallpaperPrintStyleOption {
  readonly id: WallpaperPrintStyle;
  readonly label: string;
  readonly description: string;
}

export const WALLPAPER_PRINT_STYLES: readonly WallpaperPrintStyleOption[] = [
  { id: "halftone", label: "Halftone", description: "Soft printed dots and paper grain" },
  { id: "ascii", label: "ASCII", description: "The artwork drawn in text characters" },
  { id: "dither", label: "Dither", description: "Crisp retro pixels in a Bayer pattern" },
  { id: "braille", label: "Braille", description: "Fine terminal-style braille texture" },
  {
    id: "engrave",
    label: "Engraved",
    description: "Fine horizontal lines that swell with the light",
  },
  { id: "stipple", label: "Stipple", description: "Scattered ink dots, like a pen drawing" },
  {
    id: "crosses",
    label: "Crosses",
    description: "A grid of small plus marks sized by the artwork",
  },
  { id: "mosaic", label: "Mosaic", description: "Square pixels that grow in the brightest areas" },
  { id: "none", label: "Clean", description: "The wallpaper with no texture" },
];

const PRINT_STYLE_KEY = "tabs:agentWallpaperPrintStyle";
const PRINT_STRENGTH_KEY = "tabs:agentWallpaperPrintStrength";
const PRINT_ANIMATE_KEY = "tabs:agentWallpaperPrintAnimate";

const STYLE_IDS = new Set<string>(WALLPAPER_PRINT_STYLES.map((style) => style.id));

export function parseWallpaperPrintStyle(value: unknown): WallpaperPrintStyle {
  return typeof value === "string" && STYLE_IDS.has(value)
    ? (value as WallpaperPrintStyle)
    : "halftone";
}

export function parseWallpaperPrintStrength(value: unknown): WallpaperPrintStrength {
  const number = Number(value);
  return number === 1 || number === 3 ? number : 2;
}

export function getWallpaperPrintStyle(): WallpaperPrintStyle {
  try {
    return parseWallpaperPrintStyle(localStorage.getItem(PRINT_STYLE_KEY));
  } catch {
    return "halftone";
  }
}

export function getWallpaperPrintStrength(): WallpaperPrintStrength {
  try {
    return parseWallpaperPrintStrength(localStorage.getItem(PRINT_STRENGTH_KEY));
  } catch {
    return 2;
  }
}

/** Windows, Linux and few-core machines rasterize canvas on the CPU, so they start with it off. */
export function isModestDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Win|Linux/i.test(navigator.platform) || (navigator.hardwareConcurrency ?? 8) <= 4;
}

export function getWallpaperPrintAnimate(): boolean {
  try {
    const saved = localStorage.getItem(PRINT_ANIMATE_KEY);
    if (saved !== null) return saved === "true";
  } catch {}
  return !isModestDevice();
}

export function saveWallpaperPrintAnimate(animate: boolean): void {
  try {
    localStorage.setItem(PRINT_ANIMATE_KEY, String(animate));
  } catch {}
  notifyWallpaperChange();
}

function notifyWallpaperChange(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(AGENT_WALLPAPER_CHANGE_EVENT));
  }
}

export function saveWallpaperPrintStyle(style: WallpaperPrintStyle): void {
  try {
    localStorage.setItem(PRINT_STYLE_KEY, style);
  } catch {}
  notifyWallpaperChange();
}

export function saveWallpaperPrintStrength(strength: WallpaperPrintStrength): void {
  try {
    localStorage.setItem(PRINT_STRENGTH_KEY, String(strength));
  } catch {}
  notifyWallpaperChange();
}

// ── Grid sampling ──────────────────────────────────────────────────────────────────────────

/** Luminance (0–1) for each sample of the artwork, row-major. */
export interface LuminanceGrid {
  readonly width: number;
  readonly height: number;
  readonly values: Float32Array;
}

/** Rec. 709 luminance of RGBA pixels, ignoring alpha so transparent PNG edges read as black. */
export function luminanceFromRgba(data: Uint8ClampedArray, width: number, height: number) {
  const values = new Float32Array(width * height);
  for (let index = 0; index < values.length; index++) {
    const offset = index * 4;
    values[index] =
      (0.2126 * data[offset]! + 0.7152 * data[offset + 1]! + 0.0722 * data[offset + 2]!) / 255;
  }
  return { width, height, values } satisfies LuminanceGrid;
}

/** Stretches a grid to the full 0–1 range so flat or dark artwork still shows structure. */
export function normalizeLuminance(grid: LuminanceGrid): LuminanceGrid {
  let min = 1;
  let max = 0;
  for (const value of grid.values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const span = max - min;
  if (span < 0.04) return grid;
  const values = new Float32Array(grid.values.length);
  for (let index = 0; index < values.length; index++) {
    values[index] = (grid.values[index]! - min) / span;
  }
  return { width: grid.width, height: grid.height, values };
}

// ── Glyph and pattern math ─────────────────────────────────────────────────────────────────

/** Light to dense. The first entry is blank so empty sky stays empty. */
export const ASCII_RAMP = " .,:;-=+*#%@";

export function rampIndex(luminance: number, levels: number, gamma = 1): number {
  const clamped = Math.min(1, Math.max(0, luminance));
  return Math.min(levels - 1, Math.floor(Math.pow(clamped, gamma) * levels));
}

/** Braille dot bits in the order the Unicode block numbers them, as [dx, dy] of a 2×4 cell. */
const BRAILLE_BITS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0x01],
  [0, 1, 0x02],
  [0, 2, 0x04],
  [1, 0, 0x08],
  [1, 1, 0x10],
  [1, 2, 0x20],
  [0, 3, 0x40],
  [1, 3, 0x80],
];

export function brailleChar(
  sample: (dx: number, dy: number) => number,
  threshold: (dx: number, dy: number) => number,
): string {
  let bits = 0;
  for (const [dx, dy, bit] of BRAILLE_BITS) {
    if (sample(dx, dy) > threshold(dx, dy)) bits |= bit;
  }
  return String.fromCodePoint(0x2800 + bits);
}

const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

/** Ordered dither threshold for a pixel, in the open range (0, 1). */
export function bayerThreshold(x: number, y: number): number {
  return (BAYER_4[y & 3]![x & 3]! + 0.5) / 16;
}

// ── Rendering ──────────────────────────────────────────────────────────────────────────────

export interface PrintCanvas {
  readonly width: number;
  readonly height: number;
}

export interface PrintContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  fill(): void;
  rect(x: number, y: number, w: number, h: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  moveTo(x: number, y: number): void;
  fillText(text: string, x: number, y: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
}

export interface PrintLayout {
  /** Grid cell size in CSS pixels, plus how many artwork samples feed one cell. */
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly samplesX: number;
  readonly samplesY: number;
}

export function printLayout(style: WallpaperPrintStyle): PrintLayout {
  switch (style) {
    case "ascii":
      return { cellWidth: 7, cellHeight: 12, samplesX: 1, samplesY: 1 };
    case "engrave":
      return { cellWidth: 5, cellHeight: 6, samplesX: 1, samplesY: 1 };
    case "stipple":
      return { cellWidth: 5, cellHeight: 5, samplesX: 1, samplesY: 1 };
    case "crosses":
      return { cellWidth: 11, cellHeight: 11, samplesX: 1, samplesY: 1 };
    case "mosaic":
      return { cellWidth: 9, cellHeight: 9, samplesX: 1, samplesY: 1 };
    case "braille":
      return { cellWidth: 7, cellHeight: 14, samplesX: 2, samplesY: 4 };
    case "dither":
      return { cellWidth: 3, cellHeight: 3, samplesX: 1, samplesY: 1 };
    default:
      return { cellWidth: 8, cellHeight: 8, samplesX: 1, samplesY: 1 };
  }
}

export interface DrawPrintOptions {
  readonly style: WallpaperPrintStyle;
  readonly strength: WallpaperPrintStrength;
  /** Light ink for dark workspaces, dark ink for light ones. */
  readonly ink: "light" | "dark";
  /** Artwork samples at `cols * samplesX` by `rows * samplesY`. */
  readonly grid: LuminanceGrid;
  readonly cols: number;
  readonly rows: number;
  /** Draw only columns [colFrom, colTo); used to repaint a moving band of an animated print. */
  readonly colFrom?: number;
  readonly colTo?: number;
  /** Draw only rows [rowFrom, rowTo); used to repaint a moving band of an animated print. */
  readonly rowFrom?: number;
  readonly rowTo?: number;
  /** Multiplies the print's opacity, so a band can glow brighter than the still print. */
  readonly alphaScale?: number;
  /** Seconds of animation time. When set, a wave of density flows down through the print. */
  readonly phase?: number;
}

/** How far the wave pushes a cell's density up or down. */
export const WAVE_AMPLITUDE = 0.2;

/**
 * A slow wave of density that flows from the top of the print to the bottom, bent sideways by a
 * second, slower wave so the motion reads as liquid rather than as scrolling bars.
 */
export function printWave(col: number, row: number, phase: number): number {
  return (
    WAVE_AMPLITUDE * Math.sin(row * 0.32 - phase * 1.7 + Math.sin(col * 0.09 + phase * 0.45) * 1.4)
  );
}

const STRENGTH_ALPHA: Record<WallpaperPrintStrength, number> = { 1: 0.34, 2: 0.52, 3: 0.74 };
const MONO_FONT =
  'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

function inkRgb(ink: "light" | "dark"): string {
  return ink === "light" ? "255,255,255" : "10,14,24";
}

/** Light ink marks bright artwork; dark ink marks the shadows so it reads on a pale scrim. */
function inkWeight(luminance: number, ink: "light" | "dark"): number {
  return ink === "light" ? luminance : 1 - luminance;
}

export function drawWallpaperPrint(ctx: PrintContext, options: DrawPrintOptions): void {
  const { style, strength, ink, grid, cols, rows } = options;
  const colFrom = Math.max(0, options.colFrom ?? 0);
  const colTo = Math.min(cols, options.colTo ?? cols);
  const rowFrom = Math.max(0, options.rowFrom ?? 0);
  const rowTo = Math.min(rows, options.rowTo ?? rows);
  const layout = printLayout(style);
  // Dark ink is far more visible on a pale scrim than light ink is on a dark one, so it is
  // lighter; light ink (dark workspaces) is unchanged.
  const alpha = Math.min(
    1,
    STRENGTH_ALPHA[strength] * (ink === "dark" ? 0.6 : 1) * (options.alphaScale ?? 1),
  );
  const rgb = inkRgb(ink);
  const at = (col: number, row: number, dx = 0, dy = 0) => {
    const x = Math.min(grid.width - 1, col * layout.samplesX + dx);
    const y = Math.min(grid.height - 1, row * layout.samplesY + dy);
    const base = inkWeight(grid.values[y * grid.width + x]!, ink);
    if (options.phase === undefined) return base;
    // Midtones move the most; pure shadows and highlights hold still so the picture stays legible.
    const sway = 0.35 + 0.65 * 4 * base * (1 - base);
    return Math.min(1, Math.max(0, base + printWave(col, row, options.phase) * sway));
  };

  const cellX = (col: number) => col * layout.cellWidth;
  const cellY = (row: number) => row * layout.cellHeight;

  if (style === "engrave") {
    // Line thickness carries the tone, like an engraved or scanned print.
    ctx.fillStyle = `rgba(${rgb},${alpha})`;
    ctx.beginPath();
    for (let row = rowFrom; row < rowTo; row++) {
      for (let col = colFrom; col < colTo; col++) {
        const weight = at(col, row);
        if (weight < 0.08) continue;
        const thickness = Math.max(0.6, (layout.cellHeight - 1) * weight);
        ctx.rect(
          cellX(col),
          cellY(row) + (layout.cellHeight - thickness) / 2,
          layout.cellWidth + 0.5,
          thickness,
        );
      }
    }
    ctx.fill();
    return;
  }

  if (style === "stipple") {
    // A dot appears with the probability of the tone, jittered inside its cell.
    ctx.fillStyle = `rgba(${rgb},${Math.min(1, alpha * 1.25).toFixed(3)})`;
    ctx.beginPath();
    for (let row = rowFrom; row < rowTo; row++) {
      for (let col = colFrom; col < colTo; col++) {
        const weight = at(col, row);
        if (cellHash(col, row) >= weight * 0.95) continue;
        const x = cellX(col) + cellHash(row + 7, col + 13) * layout.cellWidth;
        const y = cellY(row) + cellHash(col + 29, row + 3) * layout.cellHeight;
        const radius = 0.55 + weight * 0.7;
        ctx.moveTo(x + radius, y);
        ctx.arc(x, y, radius, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    return;
  }

  if (style === "crosses") {
    ctx.fillStyle = `rgba(${rgb},${alpha})`;
    ctx.beginPath();
    for (let row = rowFrom; row < rowTo; row++) {
      for (let col = colFrom; col < colTo; col++) {
        const weight = at(col, row);
        if (weight < 0.1) continue;
        const arm = 1 + weight * (layout.cellWidth * 0.42);
        const cx = cellX(col) + layout.cellWidth / 2;
        const cy = cellY(row) + layout.cellHeight / 2;
        ctx.rect(cx - arm, cy - 0.5, arm * 2, 1);
        ctx.rect(cx - 0.5, cy - arm, 1, arm * 2);
      }
    }
    ctx.fill();
    return;
  }

  if (style === "mosaic") {
    ctx.fillStyle = `rgba(${rgb},${alpha})`;
    ctx.beginPath();
    for (let row = rowFrom; row < rowTo; row++) {
      for (let col = colFrom; col < colTo; col++) {
        const weight = at(col, row);
        if (weight < 0.08) continue;
        const side = (layout.cellWidth - 1) * Math.sqrt(weight);
        ctx.rect(
          cellX(col) + (layout.cellWidth - side) / 2,
          cellY(row) + (layout.cellHeight - side) / 2,
          side,
          side,
        );
      }
    }
    ctx.fill();
    return;
  }

  if (style === "dither") {
    ctx.fillStyle = `rgba(${rgb},${alpha})`;
    ctx.beginPath();
    for (let row = rowFrom; row < rowTo; row++) {
      for (let col = colFrom; col < colTo; col++) {
        if (at(col, row) > bayerThreshold(col, row)) {
          ctx.rect(
            col * layout.cellWidth,
            row * layout.cellHeight,
            layout.cellWidth - 0.5,
            layout.cellHeight - 0.5,
          );
        }
      }
    }
    ctx.fill();
    return;
  }

  ctx.font = `${Math.round(layout.cellHeight * (style === "braille" ? 1 : 0.92))}px ${MONO_FONT}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  if (style === "braille") {
    ctx.fillStyle = `rgba(${rgb},${alpha})`;
    for (let row = rowFrom; row < rowTo; row++) {
      for (let col = colFrom; col < colTo; col++) {
        const char = brailleChar(
          (dx, dy) => at(col, row, dx, dy),
          (dx, dy) => bayerThreshold(col * 2 + dx, row * 4 + dy),
        );
        if (char === "⠀") continue;
        ctx.fillText(
          char,
          col * layout.cellWidth + layout.cellWidth / 2,
          row * layout.cellHeight + layout.cellHeight / 2,
        );
      }
    }
    return;
  }

  // ASCII buckets cells by density so the fill colour changes once per level.
  const levels = ASCII_RAMP.length;
  const buckets: Array<Array<number>> = Array.from({ length: levels }, () => []);
  for (let row = rowFrom; row < rowTo; row++) {
    for (let col = colFrom; col < colTo; col++) {
      const level = rampIndex(at(col, row), levels, 1.35);
      if (level > 0) buckets[level]!.push(col, row);
    }
  }
  buckets.forEach((cells, level) => {
    if (cells.length === 0) return;
    const levelAlpha = alpha * (0.4 + 0.6 * (level / (levels - 1)));
    ctx.fillStyle = `rgba(${rgb},${levelAlpha.toFixed(3)})`;
    const glyph = ASCII_RAMP[level]!;
    for (let index = 0; index < cells.length; index += 2) {
      ctx.fillText(
        glyph,
        cells[index]! * layout.cellWidth + layout.cellWidth / 2,
        cells[index + 1]! * layout.cellHeight + layout.cellHeight / 2,
      );
    }
  });
}

/** Stable pseudo-random value in [0, 1) for a grid cell. */
export function cellHash(col: number, row: number): number {
  let hash = Math.imul(col + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(row + 0x7f4a7c15, 0xc2b2ae35);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0x27d4eb2f);
  hash ^= hash >>> 15;
  return (hash >>> 0) / 4294967296;
}
