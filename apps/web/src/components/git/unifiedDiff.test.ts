import { describe, expect, it } from "vitest";

import { parseUnifiedDiff } from "./unifiedDiff";

describe("parseUnifiedDiff", () => {
  it("tracks old and new positions across multiple hunks", () => {
    const lines = parseUnifiedDiff(
      "@@ -2,3 +4,4 @@\n same\n-old\n+new\n+more\n@@ -20 +30 @@\n-tail\n+done",
    );

    expect(lines.map(({ kind, oldLine, newLine }) => ({ kind, oldLine, newLine }))).toEqual([
      { kind: "header", oldLine: null, newLine: null },
      { kind: "context", oldLine: 2, newLine: 4 },
      { kind: "deletion", oldLine: 3, newLine: null },
      { kind: "addition", oldLine: null, newLine: 5 },
      { kind: "addition", oldLine: null, newLine: 6 },
      { kind: "header", oldLine: null, newLine: null },
      { kind: "deletion", oldLine: 20, newLine: null },
      { kind: "addition", oldLine: null, newLine: 30 },
    ]);
  });

  it("does not assign positions to file headers and metadata", () => {
    expect(
      parseUnifiedDiff("--- a/file.ts\n+++ b/file.ts\n\\ No newline at end of file"),
    ).toMatchObject([
      { kind: "metadata", oldLine: null, newLine: null },
      { kind: "metadata", oldLine: null, newLine: null },
      { kind: "metadata", oldLine: null, newLine: null },
    ]);
  });
});
