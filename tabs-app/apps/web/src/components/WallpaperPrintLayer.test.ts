import { describe, expect, it } from "vitest";
import { WAVE_AMPLITUDE, printWave } from "./onboarding/wallpaperPrint";

describe("printWave", () => {
  it("never pushes a cell beyond the wave amplitude", () => {
    for (let row = 0; row < 60; row++) {
      for (let col = 0; col < 60; col += 7) {
        const value = printWave(col, row, 3.7);
        expect(Math.abs(value)).toBeLessThanOrEqual(WAVE_AMPLITUDE + 1e-9);
      }
    }
  });

  it("changes over time, so the print visibly moves", () => {
    const now = printWave(20, 10, 0);
    const later = printWave(20, 10, 1.2);
    expect(Math.abs(now - later)).toBeGreaterThan(0.01);
  });

  it("flows downward: a crest moves to a larger row as time advances", () => {
    // The wave is sin(row * 0.32 - phase * 1.7 + bend); find the crest row in a column over time.
    const crest = (phase: number) => {
      let best = 0;
      let bestValue = -Infinity;
      for (let row = 0; row < 40; row++) {
        const value = printWave(0, row, phase);
        if (value > bestValue) {
          bestValue = value;
          best = row;
        }
      }
      return best;
    };
    expect(crest(2)).toBeGreaterThan(crest(0));
  });
});
