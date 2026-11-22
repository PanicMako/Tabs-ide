import { describe, expect, it } from "vitest";
import {
  isCornerPosition,
  isDragGesture,
  nearestCorner,
  nudgePosition,
  placeInWindow,
  positionFromOffset,
} from "./cornerPosition";

const viewport = { width: 1000, height: 800 };
const insets = { left: 16, right: 16, top: 52, bottom: 16 };

describe("cornerPosition", () => {
  it("validates stored positions", () => {
    expect(isCornerPosition({ x: 0, y: 1 })).toBe(true);
    expect(isCornerPosition({ x: 2, y: 0 })).toBe(false);
    expect(isCornerPosition(null)).toBe(false);
  });
  it("snaps to the nearest corner", () => {
    expect(nearestCorner({ x: 10, y: 10 }, 1000, 800)).toEqual({ x: 0, y: 0 });
    expect(nearestCorner({ x: 900, y: 700 }, 1000, 800)).toEqual({ x: 1, y: 1 });
    expect(nearestCorner({ x: 900, y: 10 }, 1000, 800)).toEqual({ x: 1, y: 0 });
  });
  it("tells a drag from a click", () => {
    expect(isDragGesture(2, 2)).toBe(false);
    expect(isDragGesture(10, 0)).toBe(true);
  });
  it("places a free position inside the window and round-trips a drop point", () => {
    expect(placeInWindow({ x: 0, y: 0 }, viewport, 56, insets)).toEqual({ x: 16, y: 52 });
    expect(placeInWindow({ x: 1, y: 1 }, viewport, 56, insets)).toEqual({ x: 928, y: 728 });
    const position = positionFromOffset({ x: 400, y: 300 }, viewport, 56, insets);
    const back = placeInWindow(position, viewport, 56, insets);
    expect(back.x).toBeCloseTo(400);
    expect(back.y).toBeCloseTo(300);
  });
  it("clamps drops and nudges that leave the window", () => {
    expect(positionFromOffset({ x: -50, y: 5000 }, viewport, 56, insets)).toEqual({ x: 0, y: 1 });
    const edge = nudgePosition({ x: 1, y: 1 }, { dx: 64, dy: 64 }, viewport, 56, insets);
    expect(edge).toEqual({ x: 1, y: 1 });
    const moved = nudgePosition({ x: 0, y: 0 }, { dx: 16, dy: 0 }, viewport, 56, insets);
    expect(placeInWindow(moved, viewport, 56, insets).x).toBeCloseTo(32);
  });
  it("copes with a window smaller than the box", () => {
    expect(positionFromOffset({ x: 10, y: 10 }, { width: 40, height: 40 }, 56, insets)).toEqual({
      x: 0,
      y: 0,
    });
    expect(placeInWindow({ x: 1, y: 1 }, { width: 40, height: 40 }, 56, insets)).toEqual({
      x: 16,
      y: 52,
    });
  });
});
