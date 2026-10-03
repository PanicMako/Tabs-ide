import { getSharedHighlighter } from "@pierre/diffs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createIncrementalHighlightedDocument } from "../../lib/incrementalHighlighting";
import { HighlightedCodeLines, toHtml } from "./HighlightedCodeLines";

describe("highlighted code lines", () => {
  it("preserves Shiki HTML, including colors, escaping, whitespace, and blank lines", async () => {
    const highlighter = await getSharedHighlighter({
      langs: ["typescript"],
      themes: ["pierre-dark", "pierre-light"],
      preferredHighlighter: "shiki-wasm",
    });
    for (const theme of ["pierre-dark", "pierre-light"] as const) {
      const highlight = createIncrementalHighlightedDocument(highlighter, "typescript", theme);
      const code =
        'const html = "<img src=x onerror=alert(1)>";\n\n/* multi\nline */\n\tconst x = 1;\n';
      for (let end = 0; end <= code.length; end++) {
        const root = highlight(code.slice(0, end));
        expect(renderToStaticMarkup(<HighlightedCodeLines root={root} />)).toBe(toHtml(root));
      }
    }
  });
});
