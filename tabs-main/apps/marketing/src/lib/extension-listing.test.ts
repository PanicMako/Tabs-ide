import { describe, expect, it } from "vitest";
import { extensionDetailHref, isExchangeIdentifier, safePublisherUrl } from "./extension-listing";

describe("Exchange marketing listing links", () => {
  it("builds local detail links only for valid package identities", () => {
    expect(extensionDetailHref("tabs-example", "project-companion")).toBe(
      "/extension?namespace=tabs-example&name=project-companion",
    );
    expect(extensionDetailHref("../admin", "tool")).toBeNull();
    expect(extensionDetailHref("example", "a/b")).toBeNull();
    expect(isExchangeIdentifier("tabs-example")).toBe(true);
    expect(isExchangeIdentifier("A")).toBe(false);
  });

  it("accepts only credential-free HTTPS publisher links", () => {
    expect(safePublisherUrl("https://example.com/privacy")).toBe("https://example.com/privacy");
    expect(safePublisherUrl("http://example.com/privacy")).toBeNull();
    expect(safePublisherUrl("https://user:secret@example.com/")).toBeNull();
    expect(safePublisherUrl("javascript:alert(1)")).toBeNull();
  });
});
