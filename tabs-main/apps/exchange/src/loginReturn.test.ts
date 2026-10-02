import { describe, expect, it } from "vitest";
import { loginReturnRoute } from "./loginReturn.ts";

describe("OAuth return route", () => {
  it.each([
    "/",
    "/extensions?q=git&sort=newest",
    "/extensions/acme/tool?version=1.0.0",
    "/publish",
    "/admin/reviewers",
    "/admin/security",
    "/account/tokens",
    "/account/submissions/123",
    "/docs/extensions/permissions#network",
  ])("preserves a local product task: %s", (route) => {
    expect(loginReturnRoute(route)).toBe(route);
  });
  it.each([
    "https://evil.example",
    "//evil.example/path",
    "/\\evil.example",
    "/%5cevil.example",
    "/%2f%2fevil.example",
    "/auth/github/start",
    "/v1/extensions",
    "/admin/reviewers/arbitrary",
    "/extensions\r\nLocation: evil",
    "/extensions?x=%0d%0aevil",
    "/extensions?x=%zz",
    "/" + "x".repeat(2048),
  ])("rejects redirects, endpoint loops, and malformed input: %s", (route) => {
    expect(loginReturnRoute(route)).toBe("/publisher");
  });
  it("defaults missing or non-string values", () => {
    expect(loginReturnRoute(null)).toBe("/publisher");
    expect(loginReturnRoute({})).toBe("/publisher");
  });
});
