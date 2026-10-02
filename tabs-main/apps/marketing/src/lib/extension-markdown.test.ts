import { describe, expect, it } from "vitest";
import { isPackagedExtensionImage, isSafeExtensionLink } from "./extension-markdown";
import { renderReleaseMarkdown } from "./release-markdown";

describe("extension listing Markdown boundaries", () => {
  it("escapes HTML and excludes executable link schemes", () => {
    const html = renderReleaseMarkdown(
      '<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">',
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img ");
    for (const href of [
      "javascript:alert(1)",
      "data:text/html,evil",
      "file:///etc/passwd",
      "//evil.example",
      "../publisher",
      " javaScript:alert(1)",
    ])
      expect(isSafeExtensionLink(href)).toBe(false);
    for (const href of [
      "https://example.com",
      "http://example.com",
      "mailto:author@example.com",
      "#section",
    ])
      expect(isSafeExtensionLink(href)).toBe(true);
  });
  it("allows only the exact reviewed packaged image path", () => {
    expect(isPackagedExtensionImage("icon.png", "icon.png")).toBe(true);
    expect(isPackagedExtensionImage("./icon.png", "icon.png")).toBe(true);
    for (const source of [
      null,
      "https://evil.example/icon.png",
      "data:image/png;base64,abcd",
      "../icon.png",
      "screenshot.png",
      "icon.png?token=secret",
    ])
      expect(isPackagedExtensionImage(source, "icon.png")).toBe(false);
    expect(isPackagedExtensionImage("icon.png")).toBe(false);
  });
});
