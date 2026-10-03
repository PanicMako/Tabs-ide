import { describe, expect, it, beforeEach } from "vitest";
import { applyZoomFactor, getZoomFactor, resetZoom, zoomIn, zoomOut } from "./zoom";

describe("zoom state module", () => {
  beforeEach(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
    resetZoom();
  });

  it("defaults to 1.0 zoom factor", () => {
    expect(getZoomFactor()).toBe(1.0);
  });

  it("applies zoom factor within bounds (0.75 to 1.5) and snaps", () => {
    expect(applyZoomFactor(1.25)).toBe(1.25);
    expect(getZoomFactor()).toBe(1.25);

    // Test upper clamp
    expect(applyZoomFactor(3.0)).toBe(1.5);
    expect(getZoomFactor()).toBe(1.5);

    // Test lower clamp
    expect(applyZoomFactor(0.2)).toBe(0.75);
    expect(getZoomFactor()).toBe(0.75);
  });

  it("increments zoom to next snap point with zoomIn()", () => {
    applyZoomFactor(1.0);
    expect(zoomIn()).toBe(1.1);
  });

  it("decrements zoom to previous snap point with zoomOut()", () => {
    applyZoomFactor(1.0);
    expect(zoomOut()).toBe(0.9);
  });

  it("resets zoom to 1.0 with resetZoom()", () => {
    applyZoomFactor(1.5);
    expect(resetZoom()).toBe(1.0);
    expect(getZoomFactor()).toBe(1.0);
  });
});
