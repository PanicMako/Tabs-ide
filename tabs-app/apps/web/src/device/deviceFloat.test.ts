import { describe, expect, it } from "vitest";
import { clampFloatPosition, defaultFloatPosition, floatSizeFor } from "./deviceFloat";

const viewport = { width: 1200, height: 800 };
const size = { width: 340, height: 600 };

describe("deviceFloat", () => {
  it("keeps a dragged window on screen", () => {
    expect(clampFloatPosition({ x: -50, y: -50 }, size, viewport)).toEqual({ x: 12, y: 12 });
    expect(clampFloatPosition({ x: 5000, y: 5000 }, size, viewport)).toEqual({
      x: 1200 - 340 - 12,
      y: 800 - 600 - 12,
    });
    expect(clampFloatPosition({ x: 300, y: 100 }, size, viewport)).toEqual({ x: 300, y: 100 });
  });

  it("starts in the lower right", () => {
    expect(defaultFloatPosition(size, viewport)).toEqual({ x: 836, y: 176 });
  });

  it("shrinks to fit a small window and never goes off the edge", () => {
    expect(floatSizeFor({ width: 300, height: 400 })).toEqual({ width: 276, height: 376 });
    expect(
      clampFloatPosition(
        { x: 100, y: 100 },
        { width: 276, height: 376 },
        { width: 300, height: 400 },
      ),
    ).toEqual({ x: 12, y: 12 });
  });
});
