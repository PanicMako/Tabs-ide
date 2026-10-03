import { describe, expect, it, vi } from "vitest";
import {
  readWindowControlsRightInset,
  readWindowControlsInsets,
  subscribeWindowControlsGeometry,
  type WindowControlsOverlay,
} from "./windowControlsOverlay";

describe("Windows caption control geometry", () => {
  function makeOverlay(visible: boolean, x: number, width: number): WindowControlsOverlay {
    return Object.assign(new EventTarget(), { visible, getTitlebarAreaRect: () => ({ x, width }) });
  }
  it("reserves the reported controls instead of assuming a fixed width", () => {
    expect(readWindowControlsRightInset(1440, makeOverlay(true, 0, 1302))).toBe(138);
    expect(readWindowControlsRightInset(1920, makeOverlay(true, 0, 1747.5))).toBe(172.5);
    expect(readWindowControlsRightInset(1440, makeOverlay(true, 8, 1294))).toBe(138);
  });
  it("releases the header in fullscreen when the overlay is hidden and its rect is empty", () => {
    expect(readWindowControlsRightInset(1440, makeOverlay(false, 0, 0))).toBe(0);
  });
  it("uses a bounded startup fallback instead of the whole window for unavailable geometry", () => {
    expect(readWindowControlsRightInset(1440, undefined)).toBe(140);
    expect(readWindowControlsRightInset(1440, makeOverlay(true, 0, 0))).toBe(140);
    expect(readWindowControlsRightInset(1440, makeOverlay(true, 0, NaN))).toBe(140);
    expect(readWindowControlsRightInset(1440, makeOverlay(true, 0, 1600))).toBe(0);
  });
  it("respects controls on the left, right, or both sides", () => {
    const fallback = { left: 92, right: 0 };
    expect(readWindowControlsInsets(1440, makeOverlay(true, 84, 1356), fallback)).toEqual({
      left: 84,
      right: 0,
    });
    expect(readWindowControlsInsets(1440, makeOverlay(true, 0, 1302), fallback)).toEqual({
      left: 0,
      right: 138,
    });
    expect(readWindowControlsInsets(1440, makeOverlay(true, 84, 1218), fallback)).toEqual({
      left: 84,
      right: 138,
    });
    expect(readWindowControlsInsets(1440, makeOverlay(false, 0, 0), fallback)).toEqual({
      left: 0,
      right: 0,
    });
    expect(readWindowControlsInsets(1440, undefined, fallback)).toEqual(fallback);
    expect(readWindowControlsInsets(1440, makeOverlay(true, NaN, 0), fallback)).toEqual(fallback);
  });
  it("reacts to native geometry and viewport changes, then removes both listeners", () => {
    const overlay = makeOverlay(true, 0, 1302);
    const viewport = new EventTarget();
    const changed = vi.fn();
    const dispose = subscribeWindowControlsGeometry(overlay, viewport, changed);
    overlay.dispatchEvent(new Event("geometrychange"));
    viewport.dispatchEvent(new Event("resize"));
    expect(changed).toHaveBeenCalledTimes(2);
    dispose();
    overlay.dispatchEvent(new Event("geometrychange"));
    viewport.dispatchEvent(new Event("resize"));
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
