import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildReviewDiff } from "./reviewDiff.ts";

const roots: string[] = [];

function fixture() {
  const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-review-diff-"));
  roots.push(root);
  const prior = Path.join(root, "prior");
  const current = Path.join(root, "current");
  FS.mkdirSync(prior);
  FS.mkdirSync(current);
  return { prior, current };
}

afterEach(() => {
  for (const root of roots.splice(0)) FS.rmSync(root, { recursive: true, force: true });
});

describe("Exchange reviewer diff", () => {
  it("shows bounded added, modified, and removed text without including unchanged files", async () => {
    const { prior, current } = fixture();
    FS.writeFileSync(Path.join(prior, "changed.js"), "const answer = 1;\n");
    FS.writeFileSync(Path.join(current, "changed.js"), "const answer = 2;\n");
    FS.writeFileSync(Path.join(prior, "removed.js"), "old();\n");
    FS.writeFileSync(Path.join(current, "added.js"), "newCode();\n");
    FS.writeFileSync(Path.join(prior, "same.js"), "same();\n");
    FS.writeFileSync(Path.join(current, "same.js"), "same();\n");
    const result = await buildReviewDiff({
      currentDirectory: current,
      currentFiles: ["added.js", "changed.js", "same.js"],
      priorDirectory: prior,
      priorFiles: ["changed.js", "removed.js", "same.js"],
      changedFiles: ["added.js", "changed.js", "removed.js"],
    });
    expect(result.entries.map((entry) => [entry.file, entry.change])).toEqual([
      ["added.js", "added"],
      ["changed.js", "modified"],
      ["removed.js", "removed"],
    ]);
    expect(result.entries[1]?.patch).toContain("-const answer = 1;");
    expect(result.entries[1]?.patch).toContain("+const answer = 2;");
    expect(result.truncated).toBe(false);
  });

  it("omits binary and large content and caps the number of previewed files", async () => {
    const { current } = fixture();
    FS.writeFileSync(Path.join(current, "0-binary"), Buffer.from([0, 1, 2]));
    FS.writeFileSync(Path.join(current, "1-large"), "x".repeat(33 * 1024));
    const additional = Array.from({ length: 50 }, (_, index) => `file-${index}`);
    for (const file of additional) FS.writeFileSync(Path.join(current, file), "small\n");
    const files = ["0-binary", "1-large", ...additional];
    const result = await buildReviewDiff({
      currentDirectory: current,
      currentFiles: files,
      changedFiles: files,
    });
    expect(result.entries).toHaveLength(40);
    expect(result.entries.find((entry) => entry.file === "0-binary")?.omitted).toBe(
      "binary-or-large",
    );
    expect(result.entries.find((entry) => entry.file === "1-large")?.omitted).toBe(
      "binary-or-large",
    );
    expect(result.truncated).toBe(true);
  });
});
