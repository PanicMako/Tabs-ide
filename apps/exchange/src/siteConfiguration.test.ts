import { describe, expect, it } from "vitest";
import { exchangeSiteConfiguration } from "../frontend/src/lib/siteConfiguration";
describe("self-hosted Exchange presentation configuration", () => {
  it("defaults to local documentation and permits configured public instance links", () => {
    expect(exchangeSiteConfiguration({})).toEqual({
      name: "Tabs Exchange",
      docs: "/docs/extensions",
      support: undefined,
    });
    expect(
      exchangeSiteConfiguration({
        EXCHANGE_WEB_SITE_NAME: " Example Exchange ",
        EXCHANGE_WEB_DOCS_URL: "https://docs.example/extensions",
        EXCHANGE_WEB_SUPPORT_URL: "/support",
      }),
    ).toEqual({
      name: "Example Exchange",
      docs: "https://docs.example/extensions",
      support: "/support",
    });
  });
  it("rejects unsafe schemes, protocol-relative links, credentials and control characters", () => {
    for (const value of [
      "javascript:alert(1)",
      "//evil.example",
      "https://user:secret@example.com",
      "http://example.com",
      "/../admin",
    ])
      expect(() => exchangeSiteConfiguration({ EXCHANGE_WEB_DOCS_URL: value })).toThrow();
    expect(() => exchangeSiteConfiguration({ EXCHANGE_WEB_SITE_NAME: "bad\nname" })).toThrow();
    expect(() => exchangeSiteConfiguration({ EXCHANGE_WEB_SITE_NAME: "x".repeat(81) })).toThrow();
  });
});
