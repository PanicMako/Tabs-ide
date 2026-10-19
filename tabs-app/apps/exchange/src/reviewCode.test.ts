import { expect, it } from "vitest";
import { reviewCodeLines, reviewCodePreviews } from "../frontend/src/lib/reviewCode";
const digest = "a".repeat(64);
const scan = {
  digest,
  passed: true,
  issues: [],
  reviewDiff: { entries: [{ file: "index.js", change: "added", patch: "+source" }] },
};
it("only reads previews from complete digest-bound evidence, never from failed scans", () => {
  expect(reviewCodePreviews(scan, digest)[0]?.patch).toBe("+source");
  for (const value of [
    null,
    { ...scan, digest: "b".repeat(64) },
    { ...scan, issues: [{ code: "scan-failed" }] },
  ])
    expect(reviewCodePreviews(value, digest)).toEqual([]);
});
it("bounds source, deduplicates file paths and explains omitted content", () => {
  const previews = reviewCodePreviews(
    {
      ...scan,
      reviewDiff: {
        entries: [
          { file: "large.js", change: "added", patch: "x".repeat(17000), omitted: "output-limit" },
          { file: "image.png", change: "added", omitted: "binary-or-large" },
          { file: "image.png", patch: "duplicate" },
        ],
      },
    },
    digest,
  );
  expect(previews).toHaveLength(2);
  expect(previews[0]?.patch).toBeUndefined();
  expect(previews[0]?.explanation).toContain("output limit");
  expect(previews[1]?.explanation).toContain("binary");
});
it("tracks previous and submitted line numbers across hunks without treating headers as source", () => {
  const lines = reviewCodeLines(
    "--- previous/file\n+++ submitted/file\n@@ -3,2 +7,2 @@\n context\n-old\n+new\n@@ -10 +20 @@\n+next",
  );
  expect(lines[0]?.kind).toBe("meta");
  expect(lines[1]?.kind).toBe("meta");
  expect(lines[3]).toMatchObject({ before: 3, after: 7, kind: "context" });
  expect(lines[4]).toMatchObject({ before: 4, after: null, kind: "removed" });
  expect(lines[5]).toMatchObject({ before: null, after: 8, kind: "added" });
  expect(lines[7]).toMatchObject({ before: null, after: 20, kind: "added" });
});
