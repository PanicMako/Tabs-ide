import { describe, expect, it } from "vitest";
import { nextFocusArea } from "./workspaceFocus";

describe("nextFocusArea", () => {
  const all = ["sidebar", "conversation", "composer", "panel"] as const;

  it("moves forward and wraps around", () => {
    expect(nextFocusArea(all, "sidebar", 1)).toBe("conversation");
    expect(nextFocusArea(all, "panel", 1)).toBe("sidebar");
  });

  it("moves backward and wraps around", () => {
    expect(nextFocusArea(all, "conversation", -1)).toBe("sidebar");
    expect(nextFocusArea(all, "sidebar", -1)).toBe("panel");
  });

  it("starts at an end when nothing is focused", () => {
    expect(nextFocusArea(all, null, 1)).toBe("sidebar");
    expect(nextFocusArea(all, null, -1)).toBe("panel");
  });

  it("skips hidden areas and handles having none", () => {
    expect(nextFocusArea(["sidebar", "composer"], "sidebar", 1)).toBe("composer");
    expect(nextFocusArea(["composer"], "composer", 1)).toBe("composer");
    expect(nextFocusArea([], null, 1)).toBeNull();
  });
});
