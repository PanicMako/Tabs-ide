import { expect, it } from "vitest";
import { wordmarkSize } from "../frontend/src/lib/wordmarkSize";
it("fills the available width with two measured words and a scaled gap", () => {
  const size = wordmarkSize(1200, 680, 100);
  const used = size * (6.8 + 0.24);
  expect(used).toBeLessThanOrEqual(1199);
  expect(used).toBeGreaterThan(1198);
});
it("shrinks without wrapping on a narrow viewport", () => {
  expect(wordmarkSize(300, 680, 100)).toBeLessThan(44);
  expect(wordmarkSize(300, 680, 100)).toBeGreaterThan(42);
});
it("does not calculate a size from unavailable or invalid layout metrics", () => {
  for (const value of [0, -1, NaN, Infinity]) expect(wordmarkSize(value, 680, 100)).toBe(0);
});
