import { expect, it } from "vitest";
import { sourceTokens } from "../frontend/src/lib/reviewSyntax";
import { formatCodeReviewNotes } from "../frontend/src/lib/reviewNotes";
it("colors code while preserving every source character, including hostile markup", () => {
  for (const source of [
    '{"name": "Relay", "version": 1}',
    'const target = "<script>alert(1)</script>"; // data',
    '<img src="x" onerror="alert(1)">',
    "x".repeat(9000),
  ]) {
    const tokens = sourceTokens(source, "data.json");
    expect(tokens.map((value) => value.text).join("")).toBe(source);
    expect(tokens.every((value) => /^[a-z]+$/.test(value.kind))).toBe(true);
  }
  expect(
    sourceTokens('"name": "Relay"', "data.json").some((value) => value.kind === "property"),
  ).toBe(true);
});
it("formats line-bound feedback as a draft and refuses silent truncation", () => {
  expect(
    formatCodeReviewNotes(
      [
        {
          file: "index.js",
          line: 3,
          endLine: 5,
          comment: "Check this",
          replacement: "safe suggestion",
        },
      ],
      "studio.relay@1.0.0",
    ),
  ).toContain("index.js:3–5");
  expect(() => formatCodeReviewNotes([], "studio.relay")).toThrow("first");
  expect(() =>
    formatCodeReviewNotes(
      [{ file: "x", line: 1, endLine: 1, comment: "x".repeat(2100) }],
      "studio.relay",
    ),
  ).toThrow("2,000");
});
