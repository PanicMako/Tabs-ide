export interface ReviewCodePreview {
  file: string;
  change: string;
  patch?: string;
  explanation: string;
}
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Only display bounded previews from a scan bound to this exact archive. */
export function reviewCodePreviews(scanValue: unknown, digest: string): ReviewCodePreview[] {
  const scan = record(scanValue);
  if (scan.digest !== digest || typeof scan.passed !== "boolean" || !Array.isArray(scan.issues))
    return [];
  if (scan.issues.some((item) => record(item).code === "scan-failed")) return [];
  const diff = record(scan.reviewDiff);
  if (!Array.isArray(diff.entries)) return [];
  let remaining = 128 * 1024;
  const seen = new Set<string>();
  return diff.entries.slice(0, 40).flatMap((value) => {
    const row = record(value);
    if (typeof row.file !== "string" || row.file.length > 512 || seen.has(row.file)) return [];
    seen.add(row.file);
    const patch =
      typeof row.patch === "string" && row.patch.length <= Math.min(remaining, 16 * 1024)
        ? row.patch
        : undefined;
    if (patch !== undefined) remaining -= patch.length;
    const omission =
      row.omitted === "binary-or-large"
        ? "This file is binary, non-text, or larger than the text preview limit."
        : row.omitted === "diff-too-complex"
          ? "This change exceeded the comparison complexity limit."
          : row.omitted === "output-limit"
            ? "This change exceeded the preview output limit."
            : "No valid text preview was recorded for this file.";
    return [
      {
        file: row.file,
        change: ["added", "modified", "removed"].includes(String(row.change))
          ? String(row.change)
          : "recorded",
        ...(patch !== undefined ? { patch } : {}),
        explanation:
          patch !== undefined
            ? "Recorded change preview. Only changed lines and nearby context are included; this is not the complete source file."
            : omission +
              " Download the exact archive for independent inspection; this file has not been cleared by this preview.",
      },
    ];
  });
}

export interface ReviewCodeLine {
  before: number | null;
  after: number | null;
  kind: "added" | "removed" | "context" | "meta";
  text: string;
}
/** Parse unified-diff coordinates without interpreting any source as HTML or code. */
export function reviewCodeLines(patch: string): ReviewCodeLine[] {
  let before: number | null = null;
  let after: number | null = null;
  return patch.split("\n").map((text) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      before = Number(hunk[1]);
      after = Number(hunk[2]);
      return { before: null, after: null, kind: "meta", text };
    }
    if (before === null || after === null || !/^[ +-]/.test(text))
      return { before: null, after: null, kind: "meta", text };
    if (text.startsWith("+")) return { before: null, after: after++, kind: "added", text };
    if (text.startsWith("-")) return { before: before++, after: null, kind: "removed", text };
    return { before: before++, after: after++, kind: "context", text };
  });
}
