import { expect, it } from "vitest";
import { extensionDocs, extensionApiVersion } from "./extension-docs";
import { renderReleaseMarkdown } from "./release-markdown";
it("generates all documentation routes and references the actual SDK", () => {
  expect(extensionDocs).toHaveLength(10);
  expect(new Set(extensionDocs.map((doc) => doc.slug)).size).toBe(10);
  const reference = extensionDocs.find((doc) => doc.slug === "reference")!;
  expect(reference.body).toContain(`TABS_EXTENSION_API_VERSION: "${extensionApiVersion}"`);
  expect(reference.body).toContain("export const TabsExtensionManifest");
  expect(renderReleaseMarkdown(reference.body)).toContain("<pre><code");
  expect(extensionDocs[0]!.body).toContain("not published to npm");
});
