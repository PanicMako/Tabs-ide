import { describe, expect, it } from "vitest";
import { snapShotFeedbackPlan } from "./snapShotFeedback";

describe("snapShotFeedbackPlan", () => {
  it("flashes and plays the chosen sound only as asked", () => {
    expect(snapShotFeedbackPlan({ flash: true, sound: null, reducedMotion: false })).toEqual({
      flash: true,
      sound: null,
    });
    expect(
      snapShotFeedbackPlan({ flash: false, sound: "camera-shutter", reducedMotion: false }),
    ).toEqual({ flash: false, sound: "camera-shutter" });
  });

  it("skips the flash, but not the sound, when reduced motion is on", () => {
    expect(snapShotFeedbackPlan({ flash: true, sound: "soft-pop", reducedMotion: true })).toEqual({
      flash: false,
      sound: "soft-pop",
    });
  });
});
