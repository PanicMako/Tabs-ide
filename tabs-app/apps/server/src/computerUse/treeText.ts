// Adapted from Orca (MIT, (c) 2026 Lovecast Inc.) — src/shared/computer/computer-use-tree-text.ts

/**
 * Every snapshot renders `<tabs><index> <role> ...` element lines between a header and a footer.
 * Depth is the number of leading tabs; the diff below relies on this shape.
 */
export interface ComputerTreeElement {
  readonly index: number;
  readonly depth: number;
  /** The element line plus any unindexed lines that follow it, such as omitted-child notes. */
  readonly lines: string[];
}

export interface ComputerTreeText {
  readonly header: string[];
  readonly elements: ComputerTreeElement[];
  readonly footer: string[];
}

const ELEMENT_LINE = /^(\t*)(\d+)(?= |$)/u;

export function parseComputerTreeText(treeText: string): ComputerTreeText {
  const lines = treeText.split("\n");
  const first = lines.findIndex((line) => ELEMENT_LINE.test(line));
  if (first === -1) {
    return { header: lines, elements: [], footer: [] };
  }
  const lastElement = lines.findLastIndex((line) => ELEMENT_LINE.test(line));
  // The footer starts at the first blank line after the last element; anything else between
  // elements belongs to the element above, including names that carried raw newlines.
  const blank = lines.indexOf("", lastElement);
  const footerStart = blank === -1 ? lines.length : blank;
  const elements: ComputerTreeElement[] = [];
  for (const line of lines.slice(first, footerStart)) {
    const match = ELEMENT_LINE.exec(line);
    if (match) {
      elements.push({ index: Number(match[2]), depth: (match[1] ?? "").length, lines: [line] });
    } else {
      elements.at(-1)?.lines.push(line);
    }
  }
  return { header: lines.slice(0, first), elements, footer: lines.slice(footerStart) };
}

export function joinComputerTreeText(header: string[], body: string[], footer: string[]): string {
  let end = header.length;
  while (end > 0 && header[end - 1] === "") {
    end -= 1;
  }
  return [...header.slice(0, end), "", ...body, ...footer].join("\n");
}
