import { describe, expect, it } from "vitest";
import { STARTUP_ANIMATION_HOLD_MS, STARTUP_ANIMATION_EXIT_MS } from "../components/SplashScreen";

describe("Startup splash timing constraints", () => {
  it("keeps the loader visible long enough to resolve on a warm launch", () => {
    expect(STARTUP_ANIMATION_HOLD_MS).toBe(1_800);
    expect(STARTUP_ANIMATION_HOLD_MS).toBeLessThanOrEqual(2_000);
  });

  it("preserves the exact one-second bottom-to-top exit", () => {
    expect(STARTUP_ANIMATION_EXIT_MS).toBe(1_000);
  });
});
