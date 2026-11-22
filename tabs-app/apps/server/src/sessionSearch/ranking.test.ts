import { describe, expect, it } from "vitest";

import {
  buildMatchExpression,
  rankHits,
  recencyFactor,
  tokenizeQuery,
  type RawHitRow,
} from "./ranking.ts";

const NOW = Date.parse("2026-11-20T00:00:00Z");
const DAY = 86_400_000;

const row = (over: Partial<RawHitRow>): RawHitRow => ({
  skey: "claude:a",
  agent: "claude",
  sessionId: "a",
  cwd: "/w",
  title: "Some session",
  path: "/p",
  sessionUpdatedAt: NOW,
  role: "assistant",
  ts: NOW,
  bm25: -1,
  snippet: "",
  ...over,
});

describe("query building", () => {
  it("builds quoted prefix terms joined by AND", () => {
    expect(buildMatchExpression("Debounce sidebar-search")).toBe(
      '"debounce"* AND "sidebar"* AND "search"*',
    );
  });

  it("never lets user input inject FTS operators", () => {
    expect(buildMatchExpression('foo" OR NEAR(bar) *')).toBe(
      '"foo"* AND "or"* AND "near"* AND "bar"*',
    );
    expect(buildMatchExpression('"*-:^')).toBeNull();
  });

  it("dedupes and caps terms", () => {
    expect(tokenizeQuery("a a b")).toEqual(["a", "b"]);
    expect(tokenizeQuery("1 2 3 4 5 6 7 8 9 10")).toHaveLength(8);
  });
});

describe("rankHits", () => {
  it("collapses matches to one hit per session and counts them", () => {
    const ranked = rankHits(
      [row({ bm25: -2 }), row({ bm25: -5, snippet: "best" }), row({ skey: "claude:b", bm25: -1 })],
      "x",
      NOW,
      10,
    );
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.row.snippet).toBe("best");
    expect(ranked[0]!.matchCount).toBe(2);
  });

  it("prefers stronger relevance over mild recency", () => {
    const ranked = rankHits(
      [row({ skey: "old", bm25: -8, ts: NOW - 60 * DAY }), row({ skey: "new", bm25: -2, ts: NOW })],
      "x",
      NOW,
      10,
    );
    expect(ranked[0]!.row.skey).toBe("old");
  });

  it("breaks relevance ties by recency", () => {
    const ranked = rankHits(
      [row({ skey: "old", ts: NOW - 120 * DAY }), row({ skey: "new", ts: NOW - 1 * DAY })],
      "x",
      NOW,
      10,
    );
    expect(ranked.map((r) => r.row.skey)).toEqual(["new", "old"]);
  });

  it("boosts user-authored messages and title matches", () => {
    const user = rankHits(
      [row({ skey: "u", role: "user" }), row({ skey: "a", role: "assistant" })],
      "x",
      NOW,
      10,
    );
    expect(user[0]!.row.skey).toBe("u");
    const titled = rankHits(
      [row({ skey: "t", title: "Debounce search" }), row({ skey: "n", title: "Other" })],
      "debounce",
      NOW,
      10,
    );
    expect(titled[0]!.row.skey).toBe("t");
  });

  it("honors the limit", () => {
    const rows = Array.from({ length: 5 }, (_, i) => row({ skey: `s${i}` }));
    expect(rankHits(rows, "x", NOW, 3)).toHaveLength(3);
  });

  it("recency halves at the half-life", () => {
    expect(recencyFactor(NOW, NOW)).toBe(1);
    expect(recencyFactor(NOW - 45 * DAY, NOW)).toBeCloseTo(0.5, 5);
  });
});
