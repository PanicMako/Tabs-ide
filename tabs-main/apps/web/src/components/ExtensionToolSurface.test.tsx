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
  it("keeps the package and registry identity in host-owned chrome outside extension content", () => {
    const html = renderToStaticMarkup(
      <ExtensionToolSurface
        input={input}
        label="Overview"
        source="exchange"
        registryOrigin="https://exchange.example"
      />,
    );
    expect(html).toContain('aria-label="Extension identity"');
    expect(html).toContain("acme.dashboard");
    expect(html).toContain("https://exchange.example");
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Overview extension content"');
    expect(html.indexOf("acme.dashboard")).toBeLessThan(html.indexOf('role="region"'));
    expect(html).not.toContain("Verified publisher");
  });

  it("distinguishes development packages and escapes publisher-controlled labels", () => {
    const html = renderToStaticMarkup(
      <ExtensionToolSurface input={input} label="<Tabs official>" source="development" />,
    );
    expect(html).toContain("Development package");
    expect(html).toContain("&lt;Tabs official&gt;");
    expect(html).not.toContain("<Tabs official>");
  });
});
