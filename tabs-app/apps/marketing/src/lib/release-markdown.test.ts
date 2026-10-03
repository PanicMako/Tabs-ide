import { describe, expect, it } from "vitest";
import { renderReleaseMarkdown } from "./release-markdown";

describe("release note Markdown", () => {
  it("formats headings, bold list items, and links from GitHub release bodies", () => {
    const html = renderReleaseMarkdown(
      "## What changed\n\n- **Smoothed startup animation**: Improved timing.\n- [Details](https://github.com/PanicMako/Tabs-ide)",
    );
    expect(html).toContain("<h2>What changed</h2>");
    expect(html).toContain("<strong>Smoothed startup animation</strong>");
    expect(html).toContain('<a href="https://github.com/PanicMako/Tabs-ide">Details</a>');
    expect(html).not.toContain("**Smoothed");
  });

  it("escapes HTML supplied in release notes", () => {
    const html = renderReleaseMarkdown('<script>alert("x")</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps a readable fallback when no notes exist", () => {
    expect(renderReleaseMarkdown(null)).toContain("No release notes were provided");
  });
});
