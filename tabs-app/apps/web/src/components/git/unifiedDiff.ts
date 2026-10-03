export interface UnifiedDiffLine {
  readonly key: string;
  readonly text: string;
  readonly kind: "header" | "context" | "addition" | "deletion" | "metadata";
  readonly oldLine: number | null;
  readonly newLine: number | null;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedDiff(patch: string): ReadonlyArray<UnifiedDiffLine> {
  let oldLine = 0;
  let newLine = 0;
  return patch.split("\n").map((text, index) => {
    const hunk = HUNK_HEADER.exec(text);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return { key: `hunk-${index}`, text, kind: "header", oldLine: null, newLine: null };
    }
    if (text.startsWith("+") && !text.startsWith("+++")) {
      const line = newLine++;
      return { key: `new-${line}-${index}`, text, kind: "addition", oldLine: null, newLine: line };
    }
    if (text.startsWith("-") && !text.startsWith("---")) {
      const line = oldLine++;
      return { key: `old-${line}-${index}`, text, kind: "deletion", oldLine: line, newLine: null };
    }
    if (text.startsWith(" ")) {
      const old = oldLine++;
      const next = newLine++;
      return {
        key: `context-${old}-${next}-${index}`,
        text,
        kind: "context",
        oldLine: old,
        newLine: next,
      };
    }
    return { key: `metadata-${index}`, text, kind: "metadata", oldLine: null, newLine: null };
  });
}
