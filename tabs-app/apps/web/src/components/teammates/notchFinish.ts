import type { TeammateCustomFinish, TeammateFinish } from "@tabs/contracts";
import type { CSSProperties } from "react";

/**
 * How a finish is painted. A finish without a material is a flat colour driven by CSS
 * (see notch-avatar.css); one with a material is a lit surface: a gradient body, a thin rim of
 * light along its edge and a soft diagonal sheen. Only Afterglow also glows, as the logo does.
 */
export interface NotchMaterial {
  /** Gradient stops from the top left of the mark to its bottom right. */
  readonly stops: ReadonlyArray<readonly [offset: number, color: string]>;
  /** The light that runs along the mark's edge. */
  readonly rim: string;
  /** Opacity of the diagonal sheen across the upper body. */
  readonly sheen: number;
  /** A soft halo behind the mark. */
  readonly glow?: string;
}

const PRESET_MATERIALS: Partial<Record<string, NotchMaterial>> = {
  // The logo's own treatment: electric blue, a bright rim and a halo on near-black.
  "blue-ink": {
    stops: [
      [0, "#3a78ff"],
      [0.5, "#1636f5"],
      [1, "#0a1fd9"],
    ],
    rim: "#d6e4ff",
    sheen: 0.16,
    glow: "#2a52ff",
  },
  ember: {
    stops: [
      [0, "#ffc46b"],
      [0.45, "#ff6a3d"],
      [1, "#b3200c"],
    ],
    rim: "#ffe2b8",
    sheen: 0.32,
  },
  brass: {
    stops: [
      [0, "#fff3bd"],
      [0.3, "#ecbb45"],
      [0.62, "#c58a1b"],
      [1, "#7a4c0d"],
    ],
    rim: "#fff6cf",
    sheen: 0.38,
  },
  moss: {
    stops: [
      [0, "#c4ffbe"],
      [0.45, "#38cc6c"],
      [1, "#0b6537"],
    ],
    rim: "#dcffd6",
    sheen: 0.3,
  },
  tide: {
    stops: [
      [0, "#b4fff0"],
      [0.45, "#1fc6c4"],
      [1, "#0a5688"],
    ],
    rim: "#d5fff8",
    sheen: 0.3,
  },
  orchid: {
    stops: [
      [0, "#eddcff"],
      [0.45, "#a47cf0"],
      [1, "#552db3"],
    ],
    rim: "#f3e8ff",
    sheen: 0.32,
  },
  rose: {
    stops: [
      [0, "#ffd6dd"],
      [0.45, "#f4577a"],
      [1, "#9e1040"],
    ],
    rim: "#ffe4ea",
    sheen: 0.3,
  },
  graphite: {
    stops: [
      [0, "#f8fafc"],
      [0.35, "#aab6c6"],
      [0.7, "#5b6a80"],
      [1, "#273244"],
    ],
    rim: "#ffffff",
    sheen: 0.42,
  },
  sand: {
    stops: [
      [0, "#fff3d4"],
      [0.45, "#e6c081"],
      [1, "#9c6428"],
    ],
    rim: "#fff8e6",
    sheen: 0.3,
  },
};

const FLAT_BODY: Partial<Record<string, string>> = {
  signature: "#0e2af3",
  "blue-white": "#0e2af3",
  mono: "#000000",
  "ivory-ink": "#111318",
};

const CUSTOM_PATTERN = /^hue-(-?\d+(?:\.\d+)?)$/;

/** The hue (0 to 359) of a finish picked on the colour dial, or null for a preset finish. */
export function customFinishHue(finish: string): number | null {
  const match = CUSTOM_PATTERN.exec(finish);
  if (!match) return null;
  return ((Math.round(Number(match[1])) % 360) + 360) % 360;
}

/** The finish for a hue picked on the dial. */
export function customFinishId(hue: number): TeammateCustomFinish {
  return `hue-${((Math.round(hue) % 360) + 360) % 360}`;
}

/** Everything a custom hue paints: a lit gradient, its edge light, eyes and plate. */
function customPalette(hue: number) {
  const material: NotchMaterial = {
    stops: [
      [0, `hsl(${hue} 92% 84%)`],
      [0.45, `hsl(${hue} 78% 58%)`],
      [1, `hsl(${hue} 72% 30%)`],
    ],
    rim: `hsl(${hue} 100% 92%)`,
    sheen: 0.3,
  };
  return { material, eye: `hsl(${hue} 60% 9%)`, plate: `hsl(${hue} 45% 8%)` };
}

/** How a finish is painted, or undefined for a flat one. */
export function materialFor(finish: TeammateFinish): NotchMaterial | undefined {
  const hue = customFinishHue(finish);
  return hue === null ? PRESET_MATERIALS[finish] : customPalette(hue).material;
}

/** Inline colours for a custom finish (its eyes and plate); presets get theirs from CSS. */
export function finishStyle(finish: TeammateFinish): CSSProperties | undefined {
  const hue = customFinishHue(finish);
  if (hue === null) return undefined;
  const { eye, plate } = customPalette(hue);
  return { "--notch-eye": eye, "--notch-plate": plate } as CSSProperties;
}

/** The colour of a finish as a CSS background, for a swatch: its gradient, or its flat colour. */
export function finishSwatch(finish: TeammateFinish): string {
  const material = materialFor(finish);
  if (!material) return FLAT_BODY[finish] ?? "#0e2af3";
  const stops = material.stops.map(([offset, color]) => `${color} ${offset * 100}%`).join(", ");
  return `linear-gradient(145deg, ${stops})`;
}
