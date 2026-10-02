import { expect, it } from "vitest";
import { listingMetadata, renderListingMetadata } from "./listingMetadata.ts";

it("uses validated bounded listing text and an exact configured origin", () => {
  const manifest = { displayName: "Project companion", description: "A workspace tool" };
  expect(
    listingMetadata(manifest, "https://exchange.example", "/extensions/acme/tool?version=1.0.0"),
  ).toEqual({
    title: "Project companion · Tabs Exchange",
    description: "A workspace tool",
    url: "https://exchange.example/extensions/acme/tool?version=1.0.0",
  });
  expect(
    listingMetadata(
      manifest,
      "https://exchange.example",
      "https://other.example/extensions/acme/tool",
    ),
  ).toBeUndefined();
  expect(
    listingMetadata(manifest, "https://user:secret@exchange.example", "/extensions/acme/tool"),
  ).toBeUndefined();
  expect(
    listingMetadata(
      { ...manifest, description: "x".repeat(501) },
      "https://exchange.example",
      "/extensions/acme/tool",
    ),
  ).toBeUndefined();
  expect(
    listingMetadata(null, "https://exchange.example", "/extensions/acme/tool"),
  ).toBeUndefined();
});

it("escapes HTML and replacement syntax in all title, description, and social fields", () => {
  const hostile = `</title><script>alert('x')</script>\" & $&`;
  const rendered = renderListingMetadata(
    '<head><title>Generic</title><meta name="description" content="Generic"></head>',
    {
      title: hostile,
      description: hostile,
      url: 'https://exchange.example/extensions/acme/tool?version=1.0.0&other="',
    },
  );
  expect(rendered).not.toContain("<script>");
  expect(rendered).toContain("&lt;/title&gt;");
  expect(rendered).toContain("&quot; &amp; $&");
  expect(rendered).toContain('property="og:title"');
  expect(rendered).toContain('name="twitter:description"');
  expect(rendered).toContain('rel="canonical"');
});

it("retains the instance brand in server-rendered listing and social titles", () => {
  const html =
    '<head><title>Generic</title><meta name="description" content="Generic"><meta name="exchange-site-name" content="Example &amp; Tools"></head>';
  const rendered = renderListingMetadata(html, {
    title: "Companion · Tabs Exchange",
    description: "Tool",
    url: "https://exchange.example/extensions/demo/tool",
  });
  expect(rendered).toContain("<title>Companion · Example &amp; Tools</title>");
  expect(rendered).toContain('property="og:title" content="Companion · Example &amp; Tools"');
});
