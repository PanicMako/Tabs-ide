import { joinComputerTreeText, parseComputerTreeText } from "./treeText.ts";

export interface WaitCondition {
  /** An element line contains this text (case-insensitive). */
  readonly text?: string | undefined;
  /** An element contains this text and is not disabled. */
  readonly enabled?: string | undefined;
  /** The window title contains this text. */
  readonly windowTitle?: string | undefined;
}

export const DEFAULT_QUERY_MAX_ELEMENTS = 60;

/**
 * Keeps only element lines containing `query` (case-insensitive) and their ancestors, so a large
 * window can be searched without reading the whole tree. Indexes are unchanged. Returns null when
 * nothing matches.
 */
export function filterTreeByQuery(
  treeText: string,
  query: string,
  maxElements = DEFAULT_QUERY_MAX_ELEMENTS,
): { readonly text: string; readonly matches: number } | null {
  const needle = query.trim().toLowerCase();
  if (needle === "") return null;
  const parsed = parseComputerTreeText(treeText);
  const { elements } = parsed;
  const keep = new Set<number>();
  const matchedPositions: number[] = [];
  elements.forEach((element, position) => {
    if (element.lines.join("\n").toLowerCase().includes(needle)) matchedPositions.push(position);
  });
  if (matchedPositions.length === 0) return null;
  const shown = matchedPositions.slice(0, Math.max(1, maxElements));
  for (const position of shown) {
    keep.add(position);
    let depth = elements[position]?.depth ?? 0;
    for (let up = position - 1; up >= 0 && depth > 0; up -= 1) {
      const candidate = elements[up];
      if (candidate && candidate.depth < depth) {
        keep.add(up);
        depth = candidate.depth;
      }
    }
  }
  const body = elements.flatMap((element, position) => (keep.has(position) ? element.lines : []));
  const omitted = matchedPositions.length - shown.length;
  const footer = [
    "",
    `${matchedPositions.length} matching element(s) for "${query.trim()}" with their ancestors${omitted > 0 ? `; ${omitted} more not shown` : ""}. Indexes match the full tree.`,
  ];
  return {
    text: joinComputerTreeText(parsed.header, body, footer),
    matches: matchedPositions.length,
  };
}

/** Which element lines satisfy `condition`, or null when it does not hold yet. */
export function evaluateWaitCondition(
  treeText: string,
  condition: WaitCondition,
): { readonly matches: ReadonlyArray<string> } | null {
  const parsed = parseComputerTreeText(treeText);
  const lines = parsed.elements.map((element) => element.lines.join("\n"));
  if (condition.windowTitle !== undefined) {
    const title = parsed.header.find((line) => line.startsWith("Window: "));
    if (!title?.toLowerCase().includes(condition.windowTitle.toLowerCase())) return null;
  }
  const matches: string[] = [];
  if (condition.text !== undefined) {
    const needle = condition.text.toLowerCase();
    const found = lines.filter((line) => line.toLowerCase().includes(needle));
    if (found.length === 0) return null;
    matches.push(...found);
  }
  if (condition.enabled !== undefined) {
    const needle = condition.enabled.toLowerCase();
    const found = lines.filter((line) => line.toLowerCase().includes(needle));
    // A label that repeats the button text must be enabled too.
    if (found.length === 0 || found.some((line) => line.includes("(disabled)"))) return null;
    matches.push(...found);
  }
  return { matches };
}

export function hasWaitCondition(condition: WaitCondition): boolean {
  return [condition.text, condition.enabled, condition.windowTitle].some(
    (value) => value !== undefined && value.trim() !== "",
  );
}

/** True when a diff reports nothing changed after an action. */
export function treeUnchanged(treeText: string): boolean {
  return treeText.includes("No change in the accessibility tree");
}
