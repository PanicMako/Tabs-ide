// @effect-diagnostics nodeBuiltinImport:off -- prompt assembly is synchronous, and this is one stat per document.
import * as NodeFS from "node:fs";

/** Document types whose text is extracted to a `<file>.txt` sidecar for the agent to read. */
export const EXTRACTED_TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  "docx",
  "xlsx",
  "pptx",
  "odt",
  "ods",
  "odp",
  "rtf",
  "epub",
  "ipynb",
]);

export function hasExtractableDocumentExtension(path: string): boolean {
  const extension = path.split(".").at(-1)?.toLowerCase();
  return extension !== undefined && EXTRACTED_TEXT_EXTENSIONS.has(extension);
}

/** The sidecar the attachment claim extracted, when this is a document type and it exists. */
export function extractedTextSidecarSync(path: string): string | undefined {
  if (!hasExtractableDocumentExtension(path)) return undefined;
  const sidecar = `${path}.txt`;
  try {
    return NodeFS.existsSync(sidecar) ? sidecar : undefined;
  } catch {
    return undefined;
  }
}
