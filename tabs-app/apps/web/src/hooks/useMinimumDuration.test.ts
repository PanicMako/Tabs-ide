import { describe, expect, it } from "vitest";
import {
  SOLARI_BOARD_SETTLED_MS,
  SOLARI_INTRO_FALLBACK_MS,
  STARTUP_RISE_EXIT_MS,
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

  it("reveals the mascot the moment it lands, including for the retired glass setting", () => {
    for (const loader of ["mascot", "glass"]) {
      expect(startupIntroIsSignalled(loader)).toBe(true);
      expect(startupAnimationHoldMs(loader)).toBe(0);
    }
  });

  it("never cuts an intro off: the safety net sits well past the longest intro", () => {
    expect(SOLARI_INTRO_FALLBACK_MS).toBeGreaterThanOrEqual(3_500);
  });

  it("hands off by raising the workspace from the bottom", () => {
    expect(startupExitStyle("solari")).toBe("rise");
    expect(startupExitStyle("mascot")).toBe("rise");
    // One full, visible sweep from the bottom edge to the top for every loader.
    expect(startupExitMs("solari")).toBe(STARTUP_RISE_EXIT_MS);
    expect(startupExitMs("mascot")).toBe(STARTUP_RISE_EXIT_MS);
    expect(STARTUP_RISE_EXIT_MS).toBeGreaterThanOrEqual(700);
    expect(STARTUP_RISE_EXIT_MS).toBeLessThanOrEqual(1_000);
    // The board holds for a short beat once every card has landed, so nothing
    // rises mid-flip; the mascot holds a little longer to show the 100.
    expect(startupExitBeatMs("solari")).toBeGreaterThanOrEqual(80);
    expect(startupExitBeatMs("solari")).toBeLessThanOrEqual(160);
    expect(startupExitBeatMs("mascot")).toBeGreaterThan(startupExitBeatMs("solari"));
  });
});
