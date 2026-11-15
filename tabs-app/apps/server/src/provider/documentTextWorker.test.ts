// @effect-diagnostics nodeBuiltinImport:off -- the worker reads real files.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { extractedTextSidecarSync, hasExtractableDocumentExtension } from "./documentTextPaths.ts";
import { extractDocumentText } from "./documentTextWorker.ts";

let directory: string;
beforeEach(async () => {
  directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "tabs-doc-text-"));
});
afterEach(async () => {
  await NodeFSP.rm(directory, { recursive: true, force: true });
});

const write = async (name: string, content: string) => {
  const path = NodePath.join(directory, name);
  await NodeFSP.writeFile(path, content);
  return path;
};

describe("extractDocumentText", () => {
  it("reads notebook markdown and code cells", async () => {
    const path = await write(
      "nb.ipynb",
      JSON.stringify({
        cells: [
          { cell_type: "markdown", source: ["# Title\n", "intro"] },
          { cell_type: "code", source: "print('hi')" },
        ],
      }),
    );
    const text = await extractDocumentText(path, ".ipynb");
    expect(text).toContain("Title");
    expect(text).toContain("intro");
    expect(text).toContain("print('hi')");
  });

  it("reads RTF text and ignores control words", async () => {
    const path = await write(
      "note.rtf",
      "{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0 Hello \\b world\\b0 !}",
    );
    const text = await extractDocumentText(path, ".rtf");
    expect(text).toContain("Hello");
    expect(text).toContain("world");
    expect(text).not.toContain("fonttbl");
  });

  it("rejects a file with nothing to extract", async () => {
    const path = await write("empty.ipynb", JSON.stringify({ cells: [] }));
    await expect(extractDocumentText(path, ".ipynb")).rejects.toThrow();
  });
});

describe("extracted text sidecars", () => {
  it("only knows document types", () => {
    expect(hasExtractableDocumentExtension("/a/b.DOCX")).toBe(true);
    expect(hasExtractableDocumentExtension("/a/b.png")).toBe(false);
  });

  it("finds a sidecar only when it exists", async () => {
    const path = await write("report.docx", "x");
    expect(extractedTextSidecarSync(path)).toBeUndefined();
    await write("report.docx.txt", "text");
    expect(extractedTextSidecarSync(path)).toBe(`${path}.txt`);
    expect(extractedTextSidecarSync(NodePath.join(directory, "a.png"))).toBeUndefined();
  });
});
