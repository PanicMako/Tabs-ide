import { describe, expect, it } from "vitest";
import {
  LAUNCHER_DESIGNS,
  QUICK_ACTIONS,
  clampLauncher,
  orderedActions,
  searchTarget,
} from "./actions";
describe("quick actions", () => {
  it("keeps customization reachable and ignores obsolete preferences", () => {
    const actions = orderedActions(["usage", "unknown", "usage"], ["new-tab", "customize"]);
    expect(actions[0]!.id).toBe("usage");
    expect(actions.some((a) => a.id === "new-tab")).toBe(false);
    expect(actions.some((a) => a.id === "customize")).toBe(true);
    expect(new Set(actions.map((a) => a.id)).size).toBe(actions.length);
    expect(LAUNCHER_DESIGNS).toHaveLength(3);
    expect(orderedActions([], [])).toEqual(QUICK_ACTIONS);
  });
  it("creates supported web URLs and encodes queries without executing schemes", () => {
    expect(searchTarget("https://example.com/a?q=x")).toBe("https://example.com/a?q=x");
    expect(searchTarget("example.com/docs")).toBe("https://example.com/docs");
    expect(searchTarget("javascript:alert(1)")).toBe(
      "https://www.google.com/search?q=javascript%3Aalert(1)",
    );
  });
  it("clamps every corner and oversized launchers within the available viewport origin", () => {
    const size = { width: 420, height: 400 },
      viewport = { width: 800, height: 600 };
    expect(clampLauncher({ x: 400, y: 300 }, size, viewport)).toEqual({ x: 190, y: 100 });
    expect(clampLauncher({ x: 0, y: 0 }, size, viewport)).toEqual({ x: 8, y: 8 });
    expect(clampLauncher({ x: 799, y: 599 }, size, viewport)).toEqual({ x: 372, y: 192 });
    expect(clampLauncher({ x: 0, y: 0 }, size, { width: 200, height: 200 })).toEqual({
      x: 8,
      y: 8,
    });
  });
});
