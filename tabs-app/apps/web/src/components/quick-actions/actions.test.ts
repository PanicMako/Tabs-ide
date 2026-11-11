import { describe, expect, it } from "vitest";
import {
  LAUNCHER_DESIGNS,
  QUICK_ACTIONS,
  actionRunId,
  actionZones,
  clampLauncher,
  customActionDraft,
  customActionFromDraft,
  customActionProblem,
  newCustomActionDraft,
  normalizeLauncherDesign,
  orderedActions,
  placeAction,
  searchTarget,
} from "./actions";
describe("quick actions", () => {
  it("keeps customization reachable and ignores obsolete preferences", () => {
    const actions = orderedActions(["usage", "unknown", "usage"], ["new-tab", "customize"]);
    expect(actions[0]!.id).toBe("usage");
    expect(actions.some((a) => a.id === "new-tab")).toBe(false);
    expect(actions.some((a) => a.id === "customize")).toBe(true);
    expect(new Set(actions.map((a) => a.id)).size).toBe(actions.length);
    expect(LAUNCHER_DESIGNS.map((design) => design.id)).toEqual(["compass", "sectors"]);
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
  it("shows a saved Dial as Orbit", () => {
    expect(normalizeLauncherDesign("dial")).toBe("compass");
    expect(normalizeLauncherDesign("sectors")).toBe("sectors");
  });
  it("places actions across the ring, More and hidden", () => {
    const ring = () => actionZones(order, hidden).ring.map((action) => action.id);
    let order: readonly string[] = [],
      hidden: readonly string[] = [];
    const apply = (
      ...args: [Parameters<typeof placeAction>[2], "ring" | "more" | "hidden", number]
    ) => ({ actionOrder: order, hiddenActions: hidden } = placeAction(order, hidden, ...args));
    apply("usage", "ring", 0);
    expect(ring()[0]).toBe("usage");
    expect(ring()).toHaveLength(7);
    apply("usage", "more", 0);
    expect(ring()).not.toContain("usage");
    expect(ring()).toHaveLength(7);
    apply("new-tab", "hidden", 0);
    expect(hidden).toEqual(["new-tab"]);
    expect(ring()).not.toContain("new-tab");
    apply("new-tab", "ring", 2);
    expect(hidden).toEqual([]);
    expect(ring()[2]).toBe("new-tab");
    apply("customize", "hidden", 0);
    expect(hidden).toEqual([]);
  });
  it("turns custom action drafts into saved actions and back", () => {
    const draft = { ...newCustomActionDraft("custom:1"), label: " Tests " };
    expect(customActionProblem(draft)).toBe("Enter a web address.");
    const command = { ...draft, kind: "command" as const, value: "bun run test" };
    expect(customActionProblem(command)).toBeNull();
    const saved = customActionFromDraft(command);
    expect(saved).toMatchObject({
      label: "Tests",
      actionId: "scratch-terminal",
      query: "bun run test",
    });
    expect(customActionDraft(saved)).toMatchObject({ kind: "command", value: "bun run test" });
    expect(customActionProblem({ ...draft, kind: "search", value: "https://x.dev" })).toContain(
      "{query}",
    );
    const builtin = customActionFromDraft({ ...draft, kind: "builtin", builtin: "git" });
    expect(customActionDraft(builtin)).toMatchObject({ kind: "builtin", builtin: "git" });
  });
  it("orders custom actions with the built-ins and drops broken ones", () => {
    const custom = [
      { id: "custom:a", label: "Docs", icon: "nope", actionId: "scratch-browser", query: "x.dev" },
      { id: "custom:b", label: "Broken", icon: "star", actionId: "gone", query: "" },
    ];
    const actions = orderedActions(["custom:a"], [], custom);
    expect(actions[0]).toMatchObject({ id: "custom:a", icon: "star" });
    expect(actionRunId(actions[0]!)).toBe("scratch-browser");
    expect(actions.some((action) => action.id === "custom:b")).toBe(false);
    const placed = placeAction([], [], "custom:a", "ring", 6, custom);
    expect(actionZones(placed.actionOrder, placed.hiddenActions, custom).ring[6]!.id).toBe(
      "custom:a",
    );
  });
});
