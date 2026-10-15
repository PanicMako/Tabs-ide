import { expect, it } from "vitest";
import * as Duration from "effect/Duration";
import {
  resolveBackgroundActivitySettings,
  normalizeBackgroundActivitySettings,
} from "./backgroundActivitySettings.ts";
it("normalizes without changing resolved custom durations or false flags", () => {
  for (const baseProfile of ["balanced", "performance", "battery-saver"] as const) {
    const input = {
      schemaVersion: 1 as const,
      profile: "custom" as const,
      baseProfile,
      overrides: {
        automaticGitFetchInterval: Duration.seconds(0),
        pauseWhenHostLocked: false,
        idleClientTtl: Duration.seconds(99),
      },
    };
    const before = resolveBackgroundActivitySettings(input),
      normalized = normalizeBackgroundActivitySettings(input),
      after = resolveBackgroundActivitySettings(normalized);
    expect(after).toEqual(before);
    expect(after.pauseWhenHostLocked).toBe(false);
    expect(Duration.toMillis(after.automaticGitFetchInterval)).toBe(0);
    expect(normalizeBackgroundActivitySettings(normalized)).toEqual(normalized);
  }
});
it("collapses exact custom preset to its base profile", () => {
  expect(
    normalizeBackgroundActivitySettings({
      schemaVersion: 1,
      profile: "custom",
      baseProfile: "battery-saver",
      overrides: {},
    }),
  ).toEqual({ schemaVersion: 1, profile: "battery-saver", overrides: {} });
});
