import { describe, expect, it } from "vitest";
import { isTrustedIpcFrame, isTrustedTabsUrl } from "./ipcSecurity";

describe("Tabs desktop trust boundary", () => {
  it.each([
    "https://evil.test/?popout=true",
    "https://evil.test/?section=diagnostics",
    "tabs://app.evil.test/",
    "//evil.test/",
    "/\\evil.test/",
    "javascript:alert(1)",
    "tabs://user@app/index.html",
  ])("rejects remote/spoofed internal URL %s", (url) => {
    expect(isTrustedTabsUrl(url, "tabs")).toBe(false);
  });
  it("accepts application routes and the exact development origin", () => {
    expect(isTrustedTabsUrl("/settings?popout=true", "tabs")).toBe(true);
    expect(isTrustedTabsUrl("tabs://app/index.html#/settings", "tabs")).toBe(true);
    expect(
      isTrustedTabsUrl("http://localhost:5173/settings", "tabs", "http://localhost:5173"),
    ).toBe(true);
    expect(isTrustedTabsUrl("http://localhost:5174/", "tabs", "http://localhost:5173")).toBe(false);
  });
  it("requires an owned window, main frame, and trusted origin together", () => {
    const input = {
      senderId: 1,
      trustedIds: [1],
      isMainFrame: true,
      frameUrl: "tabs://app/index.html",
      scheme: "tabs",
    };
    expect(isTrustedIpcFrame(input)).toBe(true);
    expect(isTrustedIpcFrame({ ...input, senderId: 2 })).toBe(false);
    expect(isTrustedIpcFrame({ ...input, isMainFrame: false })).toBe(false);
    expect(isTrustedIpcFrame({ ...input, frameUrl: "https://evil.test/" })).toBe(false);
  });
});
