import { parseUnifiedDiff, type UnifiedDiffLine } from "./unifiedDiff";

/**
 * The lines of a file's patch that a guide excerpt points at: the added or kept lines for the
 * `new` side, the removed or kept lines for the `old` side, within the excerpt's range. A range
 * that falls outside what the patch shows gives nothing, which the page draws as no code rather
 * than as the wrong code.
 */
export function excerptLines(
  patch: string | null | undefined,
  excerpt: { readonly side: "new" | "old"; readonly start: number; readonly end: number },
): ReadonlyArray<UnifiedDiffLine> {
  if (!patch) return [];
  const low = Math.min(excerpt.start, excerpt.end);
  const high = Math.max(excerpt.start, excerpt.end);
  return parseUnifiedDiff(patch).filter((line) => {
    if (line.kind === "header" || line.kind === "metadata") return false;
    const number = excerpt.side === "new" ? line.newLine : line.oldLine;
    if (number === null || number < low || number > high) return false;
    // Each side shows its own lines: the other side's changed lines are not part of its range.
    return excerpt.side === "new" ? line.kind !== "deletion" : line.kind !== "addition";
  });
}

/** Whether a guide was written for an older head than the pull request has now. */
export function isGuideStale(
  guide: { readonly headSha: string } | null,
  currentHeadSha: string | null,
): boolean {
  return guide !== null && currentHeadSha !== null && guide.headSha !== currentHeadSha;
}
