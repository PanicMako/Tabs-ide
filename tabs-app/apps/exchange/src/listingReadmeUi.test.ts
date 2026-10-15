// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { extensionMarkdown } from "../../marketing/src/lib/extension-markdown";

it("nests publisher README headings beneath Overview while preserving inline content", () => {
  const rendered = extensionMarkdown(
    "# Tool **name**\n\n## Setup\n\n### Usage\n\n###### Details",
    undefined,
    undefined,
    3,
  );
  expect(
    [...rendered.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((heading) => heading.tagName),
  ).toEqual(["H3", "H4", "H5", "H6"]);
  expect(rendered.querySelector("h3 strong")?.textContent).toBe("name");
  expect(rendered.textContent).toContain("Details");
  const withoutTitle = extensionMarkdown("## Setup\n\n### Usage", undefined, undefined, 3);
  expect([...withoutTitle.querySelectorAll("h3,h4")].map((heading) => heading.tagName)).toEqual([
    "H3",
    "H4",
  ]);
});

it("keeps README HTML inert and image/link restrictions after heading adaptation", () => {
  const rendered = extensionMarkdown(
    "# Tool\n\n<script>bad()</script>\n\n![remote](https://example.invalid/tracking.png)\n\n![local](icon.png)\n\n[unsafe](javascript:bad)\n\n[support](https://example.com)",
    "icon.png",
    "/reviewed/icon",
    3,
  );
  expect(rendered.querySelector("script")).toBeNull();
  expect(rendered.querySelectorAll("img")).toHaveLength(1);
  expect(rendered.querySelector("img")?.getAttribute("src")).toBe("/reviewed/icon");
  expect(rendered.querySelectorAll('a[href^="javascript:"]')).toHaveLength(0);
  expect(rendered.querySelector('a[href="https://example.com"]')?.getAttribute("rel")).toBe(
    "noopener noreferrer",
  );
  expect(rendered.querySelectorAll("h1,h2")).toHaveLength(0);
});

it("preserves default heading levels for other callers and refuses an invalid context", () => {
  expect(extensionMarkdown("# Title").querySelector("h1")?.textContent).toBe("Title");
  for (const level of [0, 7, 1.5])
    expect(() => extensionMarkdown("# Title", undefined, undefined, level)).toThrow(
      "heading level",
    );
});
