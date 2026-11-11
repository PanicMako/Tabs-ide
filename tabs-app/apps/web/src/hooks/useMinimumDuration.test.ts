import { describe, expect, it } from "vitest";
import {
  MASCOT_INTRO_HOLD_MS,
  STARTUP_ANIMATION_HOLD_MS,
  STARTUP_ANIMATION_EXIT_MS,
  startupAnimationHoldMs,
  startupExitBeatMs,
} from "../lib/startupAnimationTiming";

describe("Startup splash timing constraints", () => {
  it("allows the last airport tile and its highlight to finish", () => {
    expect(STARTUP_ANIMATION_HOLD_MS).toBe(1_750);
    expect(startupAnimationHoldMs("solari")).toBe(1_750);
  });

  it("lets the mascot land its intro, including for the retired glass setting", () => {
    expect(startupAnimationHoldMs("mascot")).toBe(MASCOT_INTRO_HOLD_MS);
    expect(startupAnimationHoldMs("glass")).toBe(MASCOT_INTRO_HOLD_MS);
  });

  it("lifts the splash straight up over a long, smooth exit", () => {
    expect(STARTUP_ANIMATION_EXIT_MS).toBe(760);
    // Only the mascot plays its own launch before the lift.
    expect(startupExitBeatMs("solari")).toBe(0);
    expect(startupExitBeatMs("mascot")).toBeGreaterThan(0);
  });
});
