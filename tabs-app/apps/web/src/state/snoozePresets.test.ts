import { describe, expect, it } from "vitest";

import { resolveSnoozePresets } from "./snoozePresets";

describe("resolveSnoozePresets", () => {
  it("offers relative, tomorrow, and next-week wake times", () => {
    const now = new Date(2026, 8, 1, 10, 30, 0, 0);
    const presets = resolveSnoozePresets(now);
    expect(presets.map((preset) => preset.id)).toEqual([
      "hour",
      "three-hours",
      "evening",
      "tomorrow",
      "next-week",
    ]);
    expect(Date.parse(presets[0]!.snoozedUntil) - now.getTime()).toBe(60 * 60 * 1_000);
    expect(presets.every((preset) => Date.parse(preset.snoozedUntil) > now.getTime())).toBe(true);
  });

  it("omits this evening when it is too close or already past", () => {
    const presets = resolveSnoozePresets(new Date(2026, 8, 1, 17, 30, 0, 0));
    expect(presets.some((preset) => preset.id === "evening")).toBe(false);
  });
});
