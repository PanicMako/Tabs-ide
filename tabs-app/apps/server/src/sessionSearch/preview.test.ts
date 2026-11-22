import { describe, expect, it } from "vitest";

import { buildPreview } from "./preview.ts";

const make = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    text: index === 10 ? "please fix the debounce bug" : `message ${index}`,
    ts: index,
  }));

describe("buildPreview", () => {
  it("centres the window on the first match", () => {
    const result = buildPreview(make(30), "debounce");
    expect(result.messages.some((message) => message.matched)).toBe(true);
    expect(result.hiddenBefore).toBe(7);
    expect(result.hiddenAfter).toBe(30 - 16);
    expect(result.terms).toEqual(["debounce"]);
  });

  it("starts at the top when nothing matches", () => {
    const result = buildPreview(make(30), "zzz");
    expect(result.hiddenBefore).toBe(0);
    expect(result.messages).toHaveLength(6);
  });

  it("handles an empty transcript", () => {
    expect(buildPreview([], "x").messages).toEqual([]);
  });
});
