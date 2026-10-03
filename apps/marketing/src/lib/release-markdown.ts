import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";

/** GitHub release bodies are Markdown, not preformatted text. Raw HTML stays escaped. */
export function renderReleaseMarkdown(body: string | null): string {
  return micromark(body?.trim() || "No release notes were provided for this release.", {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
  });
}
