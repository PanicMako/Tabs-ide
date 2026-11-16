import { describe, expect, it } from "vitest";

import {
  countViewed,
  isFileViewed,
  isStaleViewedState,
  toFileViewedStates,
  withFileViewed,
} from "./pullRequestFilesViewed.logic";

describe("files viewed logic", () => {
  const states = toFileViewedStates({
    files: [
      { path: "a.ts", state: "viewed" },
      { path: "b.ts", state: "dismissed" },
    ],
    truncated: false,
  });

  it("reads states, treating a missing file as unviewed and a dismissed one as stale", () => {
    expect(isFileViewed("a.ts", states)).toBe(true);
    expect(isFileViewed("b.ts", states)).toBe(false);
    expect(isFileViewed("c.ts", states)).toBe(false);
    expect(isStaleViewedState(states?.get("b.ts"))).toBe(true);
    expect(isFileViewed("a.ts", null)).toBe(false);
    expect(toFileViewedStates(undefined)).toBeNull();
  });

  it("applies one press on top of the held answer", () => {
    const next = withFileViewed(
      { files: [{ path: "a.ts", state: "viewed" }], truncated: true },
      "a.ts",
      false,
    );
    expect(next).toEqual({ files: [{ path: "a.ts", state: "unviewed" }], truncated: true });
    expect(withFileViewed(undefined, "z.ts", true).files).toEqual([
      { path: "z.ts", state: "viewed" },
    ]);
  });

  it("counts how many of the listed paths are viewed", () => {
    expect(countViewed(["a.ts", "b.ts", "c.ts"], states)).toBe(1);
  });
});
