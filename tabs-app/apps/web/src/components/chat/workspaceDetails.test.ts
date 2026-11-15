import { describe, expect, it } from "vitest";

import { isDetailShown, toggleDetail } from "./workspaceDetails";

describe("workspace details", () => {
  it("shows everything until something is hidden", () => {
    expect(isDetailShown([], "usage")).toBe(true);
    expect(isDetailShown(["usage"], "usage")).toBe(false);
  });

  it("toggles a detail off and on", () => {
    const off = toggleDetail([], "context");
    expect(off).toEqual(["context"]);
    expect(toggleDetail(off, "context")).toEqual([]);
  });

  it("drops ids that no longer exist", () => {
    expect(toggleDetail(["gone"], "usage")).toEqual(["usage"]);
  });
});
