import { describe, expect, it } from "vitest";
import {
  ASCII_RAMP,
  bayerThreshold,
  cellHash,
  brailleChar,
  luminanceFromRgba,
  normalizeLuminance,
  parseWallpaperPrintStrength,
  parseWallpaperPrintStyle,
  rampIndex,
} from "./wallpaperPrint";

describe("wallpaper print", () => {
  it("drops retired styles back to halftone", () => {
    expect(parseWallpaperPrintStyle("dots")).toBe("halftone");
    expect(parseWallpaperPrintStyle("binary")).toBe("halftone");
    expect(parseWallpaperPrintStyle("engrave")).toBe("engrave");
  });

  it("scatters the cell hash evenly inside [0, 1)", () => {
    let sum = 0;
    for (let index = 0; index < 2000; index++) {
      const value = cellHash(index % 50, Math.floor(index / 50));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      sum += value;
    }
    expect(sum / 2000).toBeGreaterThan(0.45);
    expect(sum / 2000).toBeLessThan(0.55);
  });

  it("falls back to halftone and balanced for unknown stored values", () => {
    expect(parseWallpaperPrintStyle("matrix")).toBe("halftone");
    expect(parseWallpaperPrintStyle("ascii")).toBe("ascii");
    expect(parseWallpaperPrintStrength("9")).toBe(2);
    expect(parseWallpaperPrintStrength("3")).toBe(3);
  });

  it("maps luminance onto the ramp without leaving its bounds", () => {
    expect(rampIndex(-1, ASCII_RAMP.length)).toBe(0);
    expect(rampIndex(0, ASCII_RAMP.length)).toBe(0);
    expect(rampIndex(2, ASCII_RAMP.length)).toBe(ASCII_RAMP.length - 1);
  });

  it("builds braille from all eight dots and leaves blanks empty", () => {
    expect(
      brailleChar(
        () => 1,
        () => 0.5,
      ),
    ).toBe("⣿");
    expect(
      brailleChar(
        () => 0,
        () => 0.5,
      ),
    ).toBe("⠀");
    expect(
      brailleChar(
        (dx, dy) => (dx === 0 && dy === 0 ? 1 : 0),
        () => 0.5,
      ),
    ).toBe("⠁");
  });

  it("keeps Bayer thresholds inside (0, 1) and distinct across a tile", () => {
    const values = new Set<number>();
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const value = bayerThreshold(x, y);
        expect(value).toBeGreaterThan(0);
        expect(value).toBeLessThan(1);
        values.add(value);
      }
    }
    expect(values.size).toBe(16);
  });

  it("stretches narrow luminance and leaves flat artwork alone", () => {
    const rgba = new Uint8ClampedArray([100, 100, 100, 255, 140, 140, 140, 255]);
    const stretched = normalizeLuminance(luminanceFromRgba(rgba, 2, 1));
    expect(stretched.values[0]).toBeCloseTo(0);
    expect(stretched.values[1]).toBeCloseTo(1);
    const flat = luminanceFromRgba(new Uint8ClampedArray([90, 90, 90, 255, 90, 90, 90, 255]), 2, 1);
    expect(normalizeLuminance(flat)).toBe(flat);
  });
});
