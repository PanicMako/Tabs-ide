import { describe, expect, it } from "vitest";

import {
  pinOrderKeyBetween,
  planPinnedMove,
  planPinnedReorder,
  sortPinnedThreads,
} from "./pinnedThreadOrder";

describe("pinned thread ordering", () => {
  it("creates keys before, between, and after existing keys", () => {
    const middle = pinOrderKeyBetween(null, null)!;
    expect(pinOrderKeyBetween(null, middle)! < middle).toBe(true);
    expect(pinOrderKeyBetween(middle, null)! > middle).toBe(true);
    const close = pinOrderKeyBetween("g", "h")!;
    expect(close > "g" && close < "h").toBe(true);
  });

  it("sorts keyed threads before legacy keyless pins", () => {
    const sorted = sortPinnedThreads([
      { id: "legacy", createdAt: "2026-01-03T00:00:00.000Z", pinOrderKey: null },
      { id: "second", createdAt: "2026-01-01T00:00:00.000Z", pinOrderKey: "t" },
      { id: "first", createdAt: "2026-01-02T00:00:00.000Z", pinOrderKey: "g" },
    ]);
    expect(sorted.map((thread) => thread.id)).toEqual(["first", "second", "legacy"]);
  });

  it("plans one-key neighbor moves and rejects moves past an edge", () => {
    const ids = ["first", "second", "third"];
    const keys = new Map<string, string | null>([
      ["first", "g"],
      ["second", "m"],
      ["third", "t"],
    ]);
    const move = planPinnedMove({
      orderedIds: ids,
      keysById: keys,
      movedId: "second",
      direction: "up",
    });
    expect(move).toHaveLength(1);
    expect(move![0]!.orderKey < "g").toBe(true);
    expect(
      planPinnedMove({ orderedIds: ids, keysById: keys, movedId: "first", direction: "up" }),
    ).toBeNull();
  });

  it("plans a dragged thread between its displayed neighbors", () => {
    const move = planPinnedReorder({
      orderedIds: ["third", "first", "second"],
      keysById: new Map([
        ["first", "g"],
        ["second", "m"],
        ["third", "t"],
      ]),
      movedId: "third",
    });
    expect(move).toHaveLength(1);
    expect(move[0]!.orderKey < "g").toBe(true);
  });
});
