export type MarkdownFormat = "bold" | "italic" | "code";

const MARKERS: Record<MarkdownFormat, string> = { bold: "**", italic: "*", code: "`" };

export interface MarkdownEdit {
  /** The text that replaces the selection. */
  readonly text: string;
  /** For an empty selection: how many characters the caret should move back, to sit between the markers. */
  readonly caretBack: number;
}

/**
 * Wraps the selected text in Markdown markers, or takes them off when the
 * selection is already wrapped in them. With nothing selected it inserts an
 * empty pair and asks for the caret to go between them.
 */
export function formatSelection(selected: string, format: MarkdownFormat): MarkdownEdit {
  const marker = MARKERS[format];
  if (selected.length === 0) return { text: marker + marker, caretBack: marker.length };
  const wrapped =
    selected.length >= marker.length * 2 + 1 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker) &&
    // `*` must not read the pair inside `**bold**` as italic.
    !(format === "italic" && selected.startsWith("**") && selected.endsWith("**"));
  if (wrapped) return { text: selected.slice(marker.length, -marker.length), caretBack: 0 };
  return { text: marker + selected + marker, caretBack: 0 };
}

/** Which format a key press asks for, or null. `mod` is Cmd on macOS and Ctrl elsewhere. */
export function markdownFormatForKey(input: {
  readonly key: string;
  readonly mod: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}): MarkdownFormat | null {
  if (!input.mod || input.shift || input.alt) return null;
  switch (input.key.toLowerCase()) {
    case "b":
      return "bold";
    case "i":
      return "italic";
    case "e":
      return "code";
    default:
      return null;
  }
}
