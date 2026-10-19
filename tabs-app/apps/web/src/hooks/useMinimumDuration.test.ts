import { describe, expect, it } from "vitest";
import { STARTUP_ANIMATION_HOLD_MS, STARTUP_ANIMATION_EXIT_MS } from "../components/SplashScreen";

describe("Startup splash timing constraints", () => {
  it("does not hold an already-ready workspace behind a decorative splash", () => {
    expect(STARTUP_ANIMATION_HOLD_MS).toBe(0);
  });

  it("keeps the splash exit brief", () => {
    expect(STARTUP_ANIMATION_EXIT_MS).toBeLessThanOrEqual(200);
  });
});
