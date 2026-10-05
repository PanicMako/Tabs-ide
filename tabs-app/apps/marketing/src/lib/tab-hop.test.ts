import { describe, expect, it } from "vitest";
import { overlaps, jumpHeight, runComplete } from "./tab-hop";
describe("Window Surfer collision", () => {
  it("keeps tools and obstacles isolated to their project lane", () => {
    expect(overlaps(100, 100, 0, 1)).toBe(false);
    expect(overlaps(100, 100, 1, 1)).toBe(true);
  });
  it("checks both directions and allows a clear gap", () => {
    expect(overlaps(130, 100, 2, 2)).toBe(true);
    expect(overlaps(70, 100, 2, 2)).toBe(true);
    expect(overlaps(135, 100, 2, 2)).toBe(false);
    expect(overlaps(20, 100, 2, 2)).toBe(false);
  });
});

describe("Surf challenge rules", () => {
  it("requires tools in all projects, not camping in one lane", () => {
    expect(runComplete(15, [15, 0, 0], 15, 3)).toBe(false);
    expect(runComplete(15, [5, 5, 5], 15, 3)).toBe(true);
    expect(runComplete(14, [5, 5, 4], 15, 3)).toBe(false);
  });
  it("only clears clutter around the apex, not throughout the jump", () => {
    expect(jumpHeight(0.65, 0.65)).toBeLessThan(32);
    expect(jumpHeight(0.325, 0.65)).toBeCloseTo(90);
    expect(jumpHeight(0.01, 0.65)).toBeLessThan(32);
    expect(jumpHeight(0, 0.65)).toBe(0);
  });
});
