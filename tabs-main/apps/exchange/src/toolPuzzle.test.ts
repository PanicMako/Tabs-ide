import { describe, expect, it } from "vitest";
import {
  connectedToolPuzzle,
  initialToolPuzzle,
  swapToolPuzzle,
  toolPuzzleNeighbor,
  validToolPuzzle,
} from "../frontend/src/lib/toolPuzzle";

describe("optional tool puzzle", () => {
  it("starts unsolved and can be solved without moving input/output", () => {
    expect(connectedToolPuzzle(initialToolPuzzle)).toBe(false);
    let tiles = swapToolPuzzle(initialToolPuzzle, 1, 2);
    tiles = swapToolPuzzle(tiles, 3, 4);
    tiles = swapToolPuzzle(tiles, 4, 5);
    expect(tiles).toEqual([1, 2, 3, 6, 5, 4, 7, 8, 9]);
    expect(connectedToolPuzzle(tiles)).toBe(true);
    expect(initialToolPuzzle).toEqual([1, 3, 2, 4, 6, 5, 7, 8, 9]);
  });
  it("rejects duplicate, missing, noninteger and out-of-range tiles", () => {
    for (const tiles of [
      [1, 2],
      [1, 2, 3, 4, 5, 6, 7, 8, 8],
      [0, 2, 3, 4, 5, 6, 7, 8, 9],
      [1.5, 2, 3, 4, 5, 6, 7, 8, 9],
    ]) {
      expect(validToolPuzzle(tiles)).toBe(false);
      expect(connectedToolPuzzle(tiles)).toBe(false);
    }
    expect(connectedToolPuzzle([1, 2, 3, 4, 5, 6, 7, 8, 9])).toBe(false);
  });
  it("protects endpoints and rejects invalid swap indices", () => {
    for (const index of [-1, 0, 8, 9, 1.5, NaN]) {
      expect(() => swapToolPuzzle(initialToolPuzzle, index, 1)).toThrow();
      expect(() => swapToolPuzzle(initialToolPuzzle, 1, index)).toThrow();
    }
  });
  it("keeps arrow navigation inside the board without wrapping rows", () => {
    expect(toolPuzzleNeighbor(2, "ArrowRight")).toBe(2);
    expect(toolPuzzleNeighbor(3, "ArrowLeft")).toBe(3);
    expect(toolPuzzleNeighbor(1, "ArrowDown")).toBe(4);
    expect(toolPuzzleNeighbor(7, "ArrowUp")).toBe(4);
    expect(toolPuzzleNeighbor(8, "ArrowDown")).toBe(8);
  });
});
