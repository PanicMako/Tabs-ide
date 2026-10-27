import { expect, it } from "vitest";
import { CommitDraftContext } from "./CommitDraftContext";

it("includes later components even when the first file is very large", () => {
  const context = new CommitDraftContext();
  const data =
    "diff --git a/apps/web/src/styles.css b/apps/web/src/styles.css\n" +
    "+ enormous stylesheet\n".repeat(80_000) +
    "diff --git a/apps/server/src/commit.ts b/apps/server/src/commit.ts\n@@ generate draft @@\n+return generateLocalCommitMessage(diff);\n";
  for (let offset = 0; offset < data.length; offset += 1024)
    context.push(new TextEncoder().encode(data.slice(offset, offset + 1024)));
  const result = context.render();
  expect(result).toContain("styles.css");
  expect(result).toContain("generateLocalCommitMessage");
  expect(result).toContain("[truncated]");
  expect(result.length).toBeLessThan(36_001);
});
it("ignores binary/generated assets and preserves empty diffs", () => {
  const context = new CommitDraftContext();
  context.push(new TextEncoder().encode("diff --git a/icon.png b/icon.png\nBinary files differ\n"));
  expect(context.render()).toBe("");
  expect(new CommitDraftContext().render()).toBe("");
});
