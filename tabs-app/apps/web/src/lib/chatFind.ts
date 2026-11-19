const MATCH_HIGHLIGHT = "chat-find";
const CURRENT_HIGHLIGHT = "chat-find-current";
export const CHAT_FIND_LIMIT = 500;

/** Every case-insensitive occurrence of the query in the text under `root`, in reading order. */
export function findTextRanges(
  root: Node,
  query: string,
  limit: number = CHAT_FIND_LIMIT,
): Range[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    // Text inside scripts and styles is never on screen.
    acceptNode: (node) =>
      node.parentElement?.closest("script, style, [aria-hidden='true']")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node && ranges.length < limit; node = walker.nextNode()) {
    const text = (node.textContent ?? "").toLowerCase();
    for (
      let from = text.indexOf(needle);
      from !== -1;
      from = text.indexOf(needle, from + needle.length)
    ) {
      const range = document.createRange();
      range.setStart(node, from);
      range.setEnd(node, from + needle.length);
      ranges.push(range);
      if (ranges.length >= limit) break;
    }
  }
  return ranges;
}

/** The match after (or before) the current one, wrapping around; -1 when there are none. */
export function nextMatchIndex(count: number, current: number, direction: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0) return direction === 1 ? 0 : count - 1;
  return (current + direction + count) % count;
}

type HighlightRegistry = Map<string, unknown> & { set: (name: string, value: unknown) => unknown };
const highlightCtor = (): (new (...ranges: Range[]) => unknown) | null =>
  (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight ?? null;
const registry = (): HighlightRegistry | null =>
  (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights ?? null;

/** Paints every match softly and the current one more strongly, and scrolls to the current one. */
export function paintFindHighlights(ranges: ReadonlyArray<Range>, currentIndex: number): void {
  const Highlight = highlightCtor();
  const highlights = registry();
  if (!Highlight || !highlights) return;
  highlights.set(MATCH_HIGHLIGHT, new Highlight(...ranges));
  const current = ranges[currentIndex];
  highlights.set(CURRENT_HIGHLIGHT, current ? new Highlight(current) : new Highlight());
  current?.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "auto" });
}

export function clearFindHighlights(): void {
  const highlights = registry();
  highlights?.delete(MATCH_HIGHLIGHT);
  highlights?.delete(CURRENT_HIGHLIGHT);
}
