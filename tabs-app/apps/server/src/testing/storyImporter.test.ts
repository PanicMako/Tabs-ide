import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseUserStory } from "./storyImporter";

describe("user story import", () => {
  it("accepts pasted text and preserves a local provenance label", async () => {
    const result = await parseUserStory({
      sourceKind: "text",
      content: "As an owner, I can update workspace settings.",
    });

    expect(result).toMatchObject({ sourceName: "Pasted story.txt", sourceKind: "text" });
    expect(result.content).toContain("workspace settings");
  });

  it("accepts Markdown files and rejects unsupported extensions", async () => {
    const root = await mkdtemp(join(tmpdir(), "tabs-story-import-"));
    const markdownPath = join(root, "story.md");
    const csvPath = join(root, "story.csv");
    await writeFile(markdownPath, "# Story\n\nThe user can save settings.");
    await writeFile(csvPath, "not,a,story");
    try {
      await expect(
        parseUserStory({ sourceKind: "file", filePath: markdownPath }),
      ).resolves.toMatchObject({
        sourceName: "story.md",
        sourceKind: "md",
      });
      await expect(parseUserStory({ sourceKind: "file", filePath: csvPath })).rejects.toThrow(
        /Markdown, \.txt, \.md, \.docx, and text-based \.pdf/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
