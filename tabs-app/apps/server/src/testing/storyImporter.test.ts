import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { Document, Packer, Paragraph } from "docx";

import { parseUserStory } from "./storyImporter.ts";

describe("user story import", () => {
  it("loads the Word reader on demand and extracts document text", async () => {
    const root = await mkdtemp(join(tmpdir(), "tabs-story-word-"));
    const filePath = join(root, "story.docx");
    const content = "As a user, I can import a Word document after startup.";
    try {
      await writeFile(
        filePath,
        await Packer.toBuffer(
          new Document({
            sections: [{ children: [new Paragraph(content)] }],
          }),
        ),
      );
      await expect(parseUserStory({ sourceKind: "file", filePath })).resolves.toMatchObject({
        sourceKind: "docx",
        content,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads the PDF reader on demand and extracts selectable text", async () => {
    const root = await mkdtemp(join(tmpdir(), "tabs-story-pdf-"));
    const filePath = join(root, "story.pdf");
    const content = "The user can import a PDF document after startup.";
    const stream = `BT /F1 12 Tf 20 100 Td (${content}) Tj ET`;
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = objects.map((object, index) => {
      const offset = pdf.length;
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
      return offset;
    });
    const xref = pdf.length;
    pdf += `xref\n0 6\n0000000000 65535 f \n`;
    pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
    pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    try {
      await writeFile(filePath, pdf);
      await expect(parseUserStory({ sourceKind: "file", filePath })).resolves.toMatchObject({
        sourceKind: "pdf",
        content,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

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
