import { describe, expect, it } from "vitest";
import {
  MASCOT_INTRO_HOLD_MS,
  SOLARI_BOARD_SETTLED_MS,
  SOLARI_RISE_EXIT_MS,
  STARTUP_ANIMATION_EXIT_MS,
  startupAnimationHoldMs,
  startupExitBeatMs,
  startupExitMs,
  startupExitStyle,
  startupIntroIsSignalled,
} from "../lib/startupAnimationTiming";

describe("Startup splash timing constraints", () => {
  it("reveals the airport board when its last tile lands, not after a fixed hold", () => {
    expect(startupIntroIsSignalled("solari")).toBe(true);
    expect(startupAnimationHoldMs("solari")).toBe(0);
    // Eight tiles still flip in a readable cascade, well under a second and a half.
    expect(SOLARI_BOARD_SETTLED_MS).toBeLessThan(1_200);
  });

  it("lets the mascot land its intro, including for the retired glass setting", () => {
    expect(startupIntroIsSignalled("mascot")).toBe(false);
    expect(startupAnimationHoldMs("mascot")).toBe(MASCOT_INTRO_HOLD_MS);
    expect(startupAnimationHoldMs("glass")).toBe(MASCOT_INTRO_HOLD_MS);
  });

  it("hands off by raising the workspace from the bottom", () => {
    expect(startupExitStyle("solari")).toBe("rise");
    expect(startupExitStyle("mascot")).toBe("rise");
    expect(startupExitMs("solari")).toBe(SOLARI_RISE_EXIT_MS);
    expect(startupExitMs("mascot")).toBe(STARTUP_ANIMATION_EXIT_MS);
    // The board holds for a short beat once every card has landed, so nothing
    // rises mid-flip; the mascot holds a little longer to show the 100.
    expect(startupExitBeatMs("solari")).toBeGreaterThanOrEqual(200);
    expect(startupExitBeatMs("solari")).toBeLessThanOrEqual(300);
    expect(startupExitBeatMs("mascot")).toBeGreaterThan(startupExitBeatMs("solari"));
  });
});
