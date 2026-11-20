import { describe, expect, it } from "vitest";
import { applyProviderOrder, isCustomProviderOrder, moveProvider } from "./providerOrder";

const entries = ["codex", "claudeAgent", "cursor", "copilot", "grok"].map((id) => ({ id }));
const ids = (list: readonly { id: string }[]) => list.map(({ id }) => id);

describe("applyProviderOrder", () => {
  it("keeps the built-in order when nothing was arranged", () => {
    expect(ids(applyProviderOrder(entries, []))).toEqual(ids(entries));
    expect(ids(applyProviderOrder(entries, undefined))).toEqual(ids(entries));
  });

  it("puts arranged providers first and keeps the rest in built-in order", () => {
    expect(ids(applyProviderOrder(entries, ["grok", "codex"]))).toEqual([
      "grok",
      "codex",
      "claudeAgent",
      "cursor",
      "copilot",
    ]);
  });

  it("ignores unknown and duplicate ids in a saved order", () => {
    expect(ids(applyProviderOrder(entries, ["removed", "cursor", "cursor", "codex"]))).toEqual([
      "cursor",
      "codex",
      "claudeAgent",
      "copilot",
      "grok",
    ]);
  });
});

describe("moveProvider", () => {
  const order = ids(entries);

  it("moves a provider down to the target's place", () => {
    expect(moveProvider(order, "codex", "cursor")).toEqual([
      "claudeAgent",
      "cursor",
      "codex",
      "copilot",
      "grok",
    ]);
  });

  it("moves a provider up to the target's place", () => {
    expect(moveProvider(order, "grok", "claudeAgent")).toEqual([
      "codex",
      "grok",
      "claudeAgent",
      "cursor",
      "copilot",
    ]);
  });

  it("keeps hidden providers in place when dragging within a filtered list", () => {
    // Only codex, cursor and grok are visible (e.g. the Enabled filter).
    expect(moveProvider(order, "grok", "codex")).toEqual([
      "grok",
      "codex",
      "claudeAgent",
      "cursor",
      "copilot",
    ]);
  });

  it("returns the same order for a no-op or unknown move", () => {
    expect(moveProvider(order, "codex", "codex")).toEqual(order);
    expect(moveProvider(order, "missing", "codex")).toEqual(order);
  });
});

describe("isCustomProviderOrder", () => {
  it("tells an arranged list from the built-in one", () => {
    const order = ids(entries);
    expect(isCustomProviderOrder(order, [])).toBe(false);
    expect(isCustomProviderOrder(order, order)).toBe(false);
    expect(isCustomProviderOrder(order, ["codex"])).toBe(false);
    expect(isCustomProviderOrder(order, ["cursor"])).toBe(true);
  });
});
