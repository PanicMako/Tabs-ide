import { describe, expect, it } from "vitest";

import {
  isNativeSurfaceBlockingOverlaySlot,
  shouldSuspendNativeSurfaceForOverlay,
} from "./nativeSurfaceOverlay";

describe("native surface overlay policy", () => {
  it("suspends native surfaces for blocking menus, dialogs, and resize overlays", () => {
    expect(isNativeSurfaceBlockingOverlaySlot("menu-positioner")).toBe(true);
    expect(isNativeSurfaceBlockingOverlaySlot("popover-positioner")).toBe(true);
    expect(isNativeSurfaceBlockingOverlaySlot("dialog-backdrop")).toBe(true);
    expect(isNativeSurfaceBlockingOverlaySlot("dialog-popup")).toBe(true);
    expect(isNativeSurfaceBlockingOverlaySlot("alert-dialog-backdrop")).toBe(true);
    expect(isNativeSurfaceBlockingOverlaySlot("alert-dialog-popup")).toBe(true);
    expect(isNativeSurfaceBlockingOverlaySlot("command-dialog-backdrop")).toBe(true);
    expect(isNativeSurfaceBlockingOverlaySlot("command-dialog-popup")).toBe(true);
    expect(isNativeSurfaceBlockingOverlaySlot("code-resize-overlay")).toBe(true);
  });

  it("does not suspend native surfaces for notifications (handled by dedicated overlay WebContentsView)", () => {
    expect(isNativeSurfaceBlockingOverlaySlot("toast-root", { interactive: true })).toBe(false);
    expect(isNativeSurfaceBlockingOverlaySlot("toast-popup", { interactive: true })).toBe(false);
    expect(isNativeSurfaceBlockingOverlaySlot("toast-action")).toBe(false);
    expect(isNativeSurfaceBlockingOverlaySlot("toast-root", { interactive: false })).toBe(false);
    expect(isNativeSurfaceBlockingOverlaySlot("toast-popup", { interactive: false })).toBe(false);
    expect(isNativeSurfaceBlockingOverlaySlot("toast-root")).toBe(false);
    expect(isNativeSurfaceBlockingOverlaySlot("toast-popup")).toBe(false);
  });

  it("does not abort a native surface that is still starting", () => {
    expect(shouldSuspendNativeSurfaceForOverlay(false, true)).toBe(false);
    expect(shouldSuspendNativeSurfaceForOverlay(true, true)).toBe(true);
    expect(shouldSuspendNativeSurfaceForOverlay(true, false)).toBe(false);
    expect(shouldSuspendNativeSurfaceForOverlay(false, false)).toBe(false);
  });
});
