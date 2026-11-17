import { parsePatchFiles } from "@pierre/diffs";
import { describe, expect, it } from "vitest";
import { diffFileStats } from "./CompanionDiffLayouts";

const PATCH = `diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,2 +1,3 @@
 keep
-old
+new
+more
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-a
+b
`;

describe("diffFileStats", () => {
  it("sorts files by path and counts their changed lines", () => {
    const files = parsePatchFiles(PATCH).flatMap((entry) => entry.files);
    const stats = diffFileStats(files).map(({ path, dir, name, additions, deletions }) => ({
      path,
      dir,
      name,
      additions,
      deletions,
    }));
    expect(stats).toEqual([
      { path: "README.md", dir: "", name: "README.md", additions: 1, deletions: 1 },
      { path: "src/b.ts", dir: "src/", name: "b.ts", additions: 2, deletions: 1 },
    ]);
  });
});
