import { describe, expect, it } from "vitest";
import {
  STASH_SHRINK_STEPS,
  scaleToMaxSide,
  shrinkToBudget,
  stashImageBudgetChars,
} from "./stashImageShrink";

describe("stash image shrinking", () => {
  it("scales the longest side down and never enlarges", () => {
    expect(scaleToMaxSide(3024, 1964, 1512)).toEqual({ width: 1512, height: 982 });
    expect(scaleToMaxSide(800, 600, 1800)).toEqual({ width: 800, height: 600 });
  });

  it("splits the storage budget between images", () => {
    expect(stashImageBudgetChars(2_700_000, 3)).toBe(900_000);
    expect(stashImageBudgetChars(2_700_000, 0)).toBe(2_700_000);
  });

  it("stops at the first step that fits", async () => {
    const tried: number[] = [];
    const result = await shrinkToBudget(1000, async (step) => {
      tried.push(step.maxSide);
      return { dataUrl: "x".repeat(step.maxSide) };
    });
    // 2400, 1800 and 1400 are over 1000 characters; 1000 fits exactly.
    expect(tried).toEqual([2400, 1800, 1400, 1000]);
    expect(result?.dataUrl.length).toBe(1000);
  });

  it("gives up when nothing fits or encoding fails", async () => {
    expect(await shrinkToBudget(10, async () => ({ dataUrl: "x".repeat(50) }))).toBeNull();
    expect(await shrinkToBudget(10, async () => null)).toBeNull();
    expect(STASH_SHRINK_STEPS.length).toBeGreaterThan(1);
  });
});
