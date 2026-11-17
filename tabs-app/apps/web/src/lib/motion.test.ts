import { describe, expect, it } from "vitest";
import { getSurfacePreset, sideOffsetVars, surfaceEnterFrom } from "./motion";
import {
  MOTION_DURATIONS,
  MOTION_PROFILE,
  clipAtRest,
  restFor,
  type MotionKind,
} from "./motionProfiles";
import { surfaceMotionPace } from "../panelAnimations";

const ALL_KINDS = Object.keys(MOTION_DURATIONS) as MotionKind[];

describe("motion presets", () => {
  it("starts popups slightly toward their trigger", () => {
    expect(sideOffsetVars("top", 6)).toEqual({ y: 6 });
    expect(sideOffsetVars("bottom", 6)).toEqual({ y: -6 });
    expect(sideOffsetVars("left", 6)).toEqual({ x: 6 });
    expect(sideOffsetVars("right", 6)).toEqual({ x: -6 });
  });

  it("uses clean fades with a small scale on popups", () => {
    const node = { getAttribute: () => "bottom" } as unknown as HTMLElement;
    const motion = { seconds: (v: number) => v, profile: MOTION_PROFILE };
    expect(surfaceEnterFrom(getSurfacePreset("popover"), node, motion)).toEqual({
      opacity: 0,
      scale: 0.98,
    });
    expect(surfaceEnterFrom(getSurfacePreset("panel"), node, motion)).toEqual({ opacity: 0 });
  });

  it("keeps exits shorter than entrances so dismissals never drag", () => {
    for (const preset of ["popover", "tooltip", "dialog", "backdrop", "sheet-right"] as const) {
      const spec = getSurfacePreset(preset);
      expect(spec.exitDuration).toBeGreaterThan(0);
      expect(spec.exitDuration).toBeLessThan(spec.enterDuration);
    }
    expect(getSurfacePreset("panel").exitDuration).toBe(0);
  });

  it("keeps every interaction inside the quick range", () => {
    for (const kind of ALL_KINDS) {
      const [enter, exit] = MOTION_DURATIONS[kind];
      expect(enter * MOTION_PROFILE.pace).toBeLessThanOrEqual(0.2);
      expect(exit * MOTION_PROFILE.pace).toBeLessThanOrEqual(0.12);
    }
  });

  it("gives every kind a look, and a rest for exactly what it moves", () => {
    for (const kind of ALL_KINDS) {
      const look = MOTION_PROFILE.look(kind, { side: "bottom", radius: 8, amount: 1 });
      expect(look).toHaveProperty("opacity");
      expect(Object.keys(restFor(look, 8)).sort()).toEqual(Object.keys(look).sort());
    }
  });

  it("rests clipped looks on the element's own corner radius", () => {
    expect(clipAtRest(8)).toBe("inset(0% 0% 0% 0% round 8px)");
    expect(restFor({ clipPath: "inset(0% 0% 100% 0% round 8px)", opacity: 0 }, 8)).toEqual({
      clipPath: "inset(0% 0% 0% 0% round 8px)",
      opacity: 1,
    });
  });

  it("is on at the reference pace by default and scales with the duration setting", () => {
    expect(surfaceMotionPace(undefined)).toBe(1);
    expect(surfaceMotionPace(0)).toBe(1);
    expect(surfaceMotionPace(300)).toBe(2);
    expect(surfaceMotionPace(30)).toBe(0.6);
  });
});
