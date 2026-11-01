import { describe, expect, it, vi } from "vitest";
import { desktopZoomFactor, desktopZoomMenu } from "./desktopZoom";

describe("platform-relative desktop zoom", () => {
  it("makes Windows 100% use an 85% physical scale while retaining relative zoom", () => {
    expect(desktopZoomFactor("win32")).toBe(0.85);
    expect(desktopZoomFactor("win32", 0.75)).toBeCloseTo(0.6375);
    expect(desktopZoomFactor("win32", 1.5)).toBeCloseTo(1.275);
    expect(desktopZoomFactor("win32", Infinity)).toBe(0.85);
    expect(desktopZoomFactor("darwin")).toBe(1);
    expect(desktopZoomFactor("linux", 1.25)).toBe(1.25);
  });

  it("routes Windows menu accelerators through relative zoom and keeps other platform roles", () => {
    const dispatch = vi.fn();
    const menu = desktopZoomMenu("win32", dispatch);
    for (const item of menu) item.click?.(undefined as never, undefined as never, {} as never);
    expect(dispatch.mock.calls).toEqual([["zoom-reset"], ["zoom-in"], ["zoom-in"], ["zoom-out"]]);
    expect(menu.map((item) => item.accelerator)).toEqual([
      "Ctrl+0",
      "Ctrl+=",
      "Ctrl+Plus",
      "Ctrl+-",
    ]);
    expect(desktopZoomMenu("darwin", dispatch).map((item) => item.role)).toEqual([
      "resetZoom",
      "zoomIn",
      "zoomIn",
      "zoomOut",
    ]);
  });
});
