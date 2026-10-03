import { extname, basename } from "node:path";
import { readFile } from "node:fs/promises";

import mammoth from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface ParsedUserStory {
  readonly sourceName: string;
  readonly sourceKind: "text" | "markdown" | "txt" | "md" | "docx" | "pdf";
  readonly content: string;
}

async function pdfText(filePath: string): Promise<string> {
  const bytes = new Uint8Array(await readFile(filePath));
  const document = await getDocument({ data: bytes, useWorkerFetch: false }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .filter(Boolean)
        .join(" "),
    );
  }
  const text = pages.join("\n\n").trim();
  if (text.length < 20) {
    throw new Error(
      "The PDF does not contain enough selectable text. Scanned-PDF OCR is not supported.",
    );
  }
  return text;
}

export async function parseUserStory(input: {
  readonly sourceKind: "text" | "markdown" | "file";
  readonly content?: string;
  readonly filePath?: string;
}): Promise<ParsedUserStory> {
  if (input.sourceKind === "text" || input.sourceKind === "markdown") {
    const content = input.content?.trim();
    if (!content) throw new Error("Paste a user story before generating cases");
    return {
      sourceName: input.sourceKind === "markdown" ? "Pasted story.md" : "Pasted story.txt",
      sourceKind: input.sourceKind,
      content,
    };
  }
  if (!input.filePath) throw new Error("Choose a user-story file");
  const extension = extname(input.filePath).toLowerCase();
  if (extension === ".txt" || extension === ".md") {
    const content = (await readFile(input.filePath, "utf8")).trim();
    if (!content) throw new Error("The user-story file is empty");
    return {
      sourceName: basename(input.filePath),
      sourceKind: extension === ".md" ? "md" : "txt",
      content,
    };
  }
  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ path: input.filePath });
    const content = result.value.trim();
    if (!content) throw new Error("The Word document does not contain readable story text");
    return { sourceName: basename(input.filePath), sourceKind: "docx", content };
  }
  if (extension === ".pdf") {
    return {
      sourceName: basename(input.filePath),
      sourceKind: "pdf",
      content: await pdfText(input.filePath),
    };
  }
  throw new Error(
    "User stories support pasted text, Markdown, .txt, .md, .docx, and text-based .pdf files",
  );
}
