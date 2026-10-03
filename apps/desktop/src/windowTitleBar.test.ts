import { describe, expect, it, vi } from "vitest";
import { resolveDesktopTitleBarOptions, updateWindowControlsOverlay } from "./windowTitleBar";

describe("Windows window controls", () => {
  it("uses contrasting symbols after switching from dark to light and back", () => {
    const window = {
      isDestroyed: () => false,
      setTitleBarOverlay: vi.fn<(options: Electron.TitleBarOverlayOptions) => void>(),
    };
    updateWindowControlsOverlay("win32", [window], true);
    updateWindowControlsOverlay("win32", [window], false);
    updateWindowControlsOverlay("win32", [window], true);
    expect(window.setTitleBarOverlay.mock.calls.map(([style]) => style.symbolColor)).toEqual([
      "#cfcfcf",
      "#202020",
      "#cfcfcf",
    ]);
    expect(
      window.setTitleBarOverlay.mock.calls.every(([style]) => style.color === "#00000000"),
    ).toBe(true);
  });
  it("does not update macOS or Linux controls or destroyed windows", () => {
    const window = { isDestroyed: () => false, setTitleBarOverlay: vi.fn() };
    for (const platform of ["darwin", "linux"] as const)
      updateWindowControlsOverlay(platform, [window], false);
    updateWindowControlsOverlay("win32", [null, { ...window, isDestroyed: () => true }], false);
    expect(window.setTitleBarOverlay).not.toHaveBeenCalled();
    expect(resolveDesktopTitleBarOptions("darwin", false)).toEqual({
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 18 },
      titleBarOverlay: true,
    });
  });
  it("keeps Linux decorations in the window manager instead of assuming a controls side", () => {
    expect(resolveDesktopTitleBarOptions("linux", false)).toEqual({ titleBarStyle: "default" });
  });
  it("starts Windows controls in the selected light theme", () => {
    expect(resolveDesktopTitleBarOptions("win32", false)).toMatchObject({
      titleBarStyle: "hidden",
      titleBarOverlay: { symbolColor: "#202020", height: 52 },
    });
  });
});
