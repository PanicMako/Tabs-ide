import { describe, expect, it } from "vitest";

import { patchLineNumbers, splitPatchByFile } from "./hostPatch";

const PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,3 @@",
  " keep",
  "-old",
  "+new",
  "+added",
  "diff --git a/gone.txt b/gone.txt",
  "--- a/gone.txt",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-bye",
].join("\n");

describe("splitPatchByFile", () => {
  it("splits a patch into files with their line counts", () => {
    const files = splitPatchByFile(PATCH);
    expect(files.map((file) => file.path)).toEqual(["src/a.ts", "gone.txt"]);
    expect(files[0]).toMatchObject({ additions: 2, deletions: 1 });
    expect(files[1]).toMatchObject({ additions: 0, deletions: 1 });
  });

  it("returns nothing for an empty patch", () => {
    expect(splitPatchByFile("")).toEqual([]);
  });
});

describe("patchLineNumbers", () => {
  it("lists the lines each side of a patch shows", () => {
    const [file] = splitPatchByFile(PATCH);
    const lines = patchLineNumbers(file!.text);
    expect([...lines.added]).toEqual([2, 3]);
    expect([...lines.removed]).toEqual([2]);
    expect([...lines.context]).toEqual([[1, 1]]);
  });
});
