import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExtensionToolSurface } from "./ExtensionToolSurface";

const input = {
  projectId: "project-a",
  extensionId: "acme.dashboard",
  toolId: "overview",
  profileId: "work",
};

describe("ExtensionToolSurface", () => {
  it("gives the extension the full content region without an identity strip", () => {
    const html = renderToStaticMarkup(
      <ExtensionToolSurface input={input} label="Overview" source="exchange" />,
    );
    expect(html).not.toContain("<header");
    expect(html).toContain('aria-label="Overview extension content"');
  });

  it("escapes publisher-controlled labels", () => {
    const html = renderToStaticMarkup(
      <ExtensionToolSurface input={input} label="<Tabs official>" source="development" />,
    );
    expect(html).toContain("&lt;Tabs official&gt;");
    expect(html).not.toContain("<Tabs official>");
  });
});
