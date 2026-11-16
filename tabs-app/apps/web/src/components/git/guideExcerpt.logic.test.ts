import { describe, expect, it } from "vitest";

import { excerptLines, isGuideStale } from "./guideExcerpt.logic";

const PATCH = ["@@ -1,3 +1,4 @@", " keep", "-removed", "+added one", "+added two", " tail"].join(
  "\n",
);

describe("excerptLines", () => {
  it("returns the new side's added and kept lines in range", () => {
    const lines = excerptLines(PATCH, { side: "new", start: 2, end: 3 });
    expect(lines.map((line) => line.text)).toEqual(["+added one", "+added two"]);
  });

  it("returns the old side's removed and kept lines in range", () => {
    const lines = excerptLines(PATCH, { side: "old", start: 1, end: 2 });
    expect(lines.map((line) => line.text)).toEqual([" keep", "-removed"]);
  });

  it("gives nothing for a missing patch or a range outside it", () => {
    expect(excerptLines(null, { side: "new", start: 1, end: 3 })).toEqual([]);
    expect(excerptLines(PATCH, { side: "new", start: 90, end: 99 })).toEqual([]);
  });

  it("reads a reversed range", () => {
    expect(excerptLines(PATCH, { side: "new", start: 3, end: 2 })).toHaveLength(2);
  });
});

describe("isGuideStale", () => {
  it("is stale only when both heads are known and differ", () => {
    expect(isGuideStale({ headSha: "a" }, "b")).toBe(true);
    expect(isGuideStale({ headSha: "a" }, "a")).toBe(false);
    expect(isGuideStale({ headSha: "a" }, null)).toBe(false);
    expect(isGuideStale(null, "b")).toBe(false);
  });
});
