import { describe, expect, it } from "vitest";
import { resizeBrowserViewport } from "./BrowserViewportResizeFrame";

describe("resizeBrowserViewport", () => {
  it("resizes centered side rails by twice the pointer distance", () => {
    expect(resizeBrowserViewport({ width: 800, height: 600 }, "east", 25, 0)).toEqual({
      width: 850,
      height: 600,
    });
    expect(resizeBrowserViewport({ width: 800, height: 600 }, "west", 25, 0)).toEqual({
      width: 750,
      height: 600,
    });
  });
  it("resizes both axes from a corner", () => {
    expect(resizeBrowserViewport({ width: 800, height: 600 }, "southeast", 20, 15)).toEqual({
      width: 840,
      height: 630,
    });
  });
  it("keeps the viewport within usable limits", () => {
    expect(resizeBrowserViewport({ width: 300, height: 200 }, "southwest", 100, -100)).toEqual({
      width: 240,
      height: 180,
    });
  });
});
