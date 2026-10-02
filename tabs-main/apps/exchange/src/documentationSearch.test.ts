import { describe, expect, it } from "vitest";
import {
  documentationSections,
  searchDocumentation,
  registryApiSections,
  isDocumentationHref,
  parseDocumentationIndex,
} from "../frontend/src/scripts/documentationSearch.ts";
describe("section documentation search", () => {
  it("validates loaded indexes and keeps malformed-response diagnostics private", () => {
    const valid = [{ title: "Guide", page: "Start", href: "/docs/extensions", text: "Build" }];
    expect(parseDocumentationIndex(JSON.stringify(valid))).toEqual(valid);
    for (const input of [
      "<!doctype html>secret-proxy-diagnostic",
      "null",
      "{}",
      '[{"title":12}]',
      JSON.stringify([{ ...valid[0], href: "https://evil.example/" }]),
      JSON.stringify(Array.from({ length: 10_001 }, () => valid[0])),
    ]) {
      expect(() => parseDocumentationIndex(input)).toThrow("use the guide navigation");
      try {
        parseDocumentationIndex(input);
      } catch (error) {
        expect((error as Error).message).not.toMatch(/secret-proxy|Unexpected token|doctype/);
      }
    }
  });
  it("allows only local guide anchors and registry operation anchors", () => {
    expect(isDocumentationHref("/docs/extensions/registry-api#catalogSearch")).toBe(true);
    expect(isDocumentationHref("/docs/extensions/reference#docs-section-1")).toBe(true);
    for (const href of [
      "https://evil.example/docs/extensions",
      "//evil.example",
      "/docs/extensions/registry-api#../bad",
      "/docs/extensions/reference#catalogSearch",
      "/docs/extensions/../account",
    ])
      expect(isDocumentationHref(href)).toBe(false);
  });
  it("indexes real registry operations using the reference page's operation anchors", () => {
    const sections = registryApiSections({
      paths: {
        "/v1/catalog": {
          get: {
            operationId: "catalogSearch",
            summary: "Search catalog",
            description: "Search by keywords",
            parameters: [{ name: "cursor", in: "query", description: "Pagination cursor" }],
            responses: { "401": { description: "Authentication required for private registries" } },
          },
          parameters: [],
        },
      },
    });
    expect(sections).toHaveLength(1);
    expect(searchDocumentation(sections, "private authentication")[0]?.href).toBe(
      "/docs/extensions/registry-api#catalogSearch",
    );
    expect(searchDocumentation(sections, "pagination cursor")[0]?.title).toContain(
      "GET /v1/catalog",
    );
    expect(
      registryApiSections({ paths: { "/v1/bad": { get: { operationId: "../invalid" } } } }),
    ).toEqual([]);
  });
  it("uses rendered headings rather than headings inside code examples", () => {
    const sections = documentationSections(
      "Guide",
      "/docs/extensions",
      "<h1>Start</h1><pre># example</pre><h2>Accounts</h2><p>Shared profiles</p>",
    );
    expect(sections).toHaveLength(2);
    expect(sections[1]?.href).toBe("/docs/extensions#docs-section-1");
    expect(searchDocumentation(sections, "shared profiles")[0]?.title).toBe("Accounts");
  });
  it("ranks title matches ahead of body matches and bounds results", () => {
    const sections = [
      { title: "Storage", page: "API", href: "/docs/extensions", text: "data" },
      { title: "Other", page: "API", href: "/docs/extensions", text: "storage" },
    ];
    expect(searchDocumentation(sections, "storage")[0]?.title).toBe("Storage");
    expect(searchDocumentation(sections, "")).toEqual([]);
    expect(
      searchDocumentation(
        Array.from({ length: 30 }, () => sections[0]!),
        "storage",
      ),
    ).toHaveLength(20);
  });
});
