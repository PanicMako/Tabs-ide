import { describe, expect, it } from "vitest";
import { eyePose, gazeTarget, GAZE_X_PX, NEAR_PX } from "./eyeGaze";

describe("gazeTarget", () => {
  it("rests when the cursor is on the eyes", () => {
    expect(gazeTarget(0, 0)).toEqual({ x: 0, y: 0 });
  });
  it("aims at the cursor, fully once it is a little way off", () => {
    const far = gazeTarget(500, 0);
    expect(far.x).toBeCloseTo(1);
    expect(far.y).toBeCloseTo(0);
    const diagonal = gazeTarget(300, -300);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1);
    expect(diagonal.y).toBeLessThan(0);
  });
  it("looks only part of the way at a cursor just beside it", () => {
    expect(gazeTarget(NEAR_PX / 2, 0).x).toBeCloseTo(0.5);
  });
});

describe("eyePose", () => {
  it("is a neutral pair at rest", () => {
    const pose = eyePose(0, 0);
    expect(pose).toMatchObject({ tx: 0, ty: 0, rotate: 0 });
    expect(pose.left).toEqual({ sx: 1, sy: 1 });
    expect(pose.right).toEqual({ sx: 1, sy: 1 });
  });
  it("shifts the pair and narrows the farther eye when looking sideways", () => {
    const right = eyePose(1, 0);
    expect(right.tx).toBeCloseTo(GAZE_X_PX);
    expect(right.left.sx).toBeLessThan(1);
    expect(right.right.sx).toBe(1);
    const left = eyePose(-1, 0);
    expect(left.right.sx).toBeLessThan(1);
    expect(left.left.sx).toBe(1);
  });
  it("lowers the lids looking down and lifts them looking up", () => {
    expect(eyePose(0, 1).left.sy).toBeLessThan(1);
    expect(eyePose(0, -1).left.sy).toBeGreaterThan(1);
    expect(eyePose(0, 1).left.sy).toBeLessThan(eyePose(0, -1).left.sy);
  });
});
