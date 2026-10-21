import { describe, expect, it } from "vitest";
import {
  STARTUP_ANIMATION_HOLD_MS,
  STARTUP_ANIMATION_EXIT_MS,
  startupAnimationHoldMs,
} from "../lib/startupAnimationTiming";

describe("Startup splash timing constraints", () => {
  it("allows the last airport tile and its highlight to finish", () => {
    expect(STARTUP_ANIMATION_HOLD_MS).toBe(1_750);
    expect(startupAnimationHoldMs("solari")).toBe(1_750);
  });

  it("allows one complete glass cycle when selected", () => {
    expect(startupAnimationHoldMs("glass")).toBe(6_750);
  });

  it("uses a half-second upward exit", () => {
    expect(STARTUP_ANIMATION_EXIT_MS).toBe(500);
  });
});
