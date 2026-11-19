import { describe, expect, it } from "vitest";
import { quitKeyOverlayView } from "./quitKeyOverlay.logic";

describe("quitKeyOverlayView", () => {
  it("shows nothing when idle", () => {
    expect(quitKeyOverlayView({ progress: null, armed: false }, true)).toEqual({ visible: false });
  });
  it("shows the fill while holding, clamped, with the platform's chord", () => {
    expect(quitKeyOverlayView({ progress: 0.4, armed: false }, true)).toEqual({
      visible: true,
      label: "Keep holding ⌘Q to quit",
      fill: 0.4,
    });
    expect(quitKeyOverlayView({ progress: 3, armed: false }, false)).toMatchObject({
      label: "Keep holding Ctrl+Q to quit",
      fill: 1,
    });
  });
  it("asks for a second press once armed", () => {
    expect(quitKeyOverlayView({ progress: null, armed: true }, true)).toEqual({
      visible: true,
      label: "Press ⌘Q again to quit",
      fill: null,
    });
  });
});
