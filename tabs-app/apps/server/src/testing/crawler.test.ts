import { describe, expect, it } from "vitest";

import {
  isTabsStartupSnapshot,
  isUrlWithinTestingScope,
  parseActionableElements,
  validateTestingCdpEndpoint,
} from "./crawler";

describe("Testing crawler URL scope", () => {
  const target = new URL("https://example.test/settings/profile?mode=edit");

  it("keeps exact-page runs on the complete supplied URL", () => {
    expect(isUrlWithinTestingScope(target, new URL(target.href), "page")).toBe(true);
    expect(
      isUrlWithinTestingScope(target, new URL("https://example.test/settings/profile"), "page"),
    ).toBe(false);
    expect(
      isUrlWithinTestingScope(
        target,
        new URL("https://example.test/settings/profile?mode=edit#details"),
        "page",
      ),
    ).toBe(false);
  });

  it("includes child routes but not sibling prefixes in path runs", () => {
    expect(
      isUrlWithinTestingScope(
        target,
        new URL("https://example.test/settings/profile/security"),
        "path",
      ),
    ).toBe(true);
    expect(
      isUrlWithinTestingScope(target, new URL("https://example.test/settings/profiles"), "path"),
    ).toBe(false);
  });

  it("supports hash-router path scopes", () => {
    const hashTarget = new URL("https://example.test/#/settings");
    expect(
      isUrlWithinTestingScope(
        hashTarget,
        new URL("https://example.test/#/settings/themes"),
        "path",
      ),
    ).toBe(true);
    expect(
      isUrlWithinTestingScope(hashTarget, new URL("https://example.test/#/agents"), "path"),
    ).toBe(false);
  });

  it("allows any same-origin URL only in origin runs", () => {
    expect(isUrlWithinTestingScope(target, new URL("https://example.test/admin"), "origin")).toBe(
      true,
    );
    expect(
      isUrlWithinTestingScope(target, new URL("https://other.test/settings/profile"), "origin"),
    ).toBe(false);
  });
});

describe("Testing crawler desktop stabilization", () => {
  it.each(["- generic: TABS", "- generic [ref=e7]: TABS"])(
    "recognizes startup marker %s",
    (snapshot) => {
      expect(isTabsStartupSnapshot(snapshot)).toBe(true);
    },
  );

  it("does not mistake normal workspace content for startup", () => {
    expect(isTabsStartupSnapshot('- tab "Testing" [selected]')).toBe(false);
  });
});

describe("Testing crawler action safety", () => {
  it("does not expose filesystem and project launchers to autonomous exploration", () => {
    const snapshot = [
      '- button "Add Project..." [ref=e1]',
      '- button "Open File..." [ref=e2]',
      '- button "Clone from Git..." [ref=e3]',
      '- button "Capture Login Session" [ref=e4]',
      '- button "Run Task" [ref=e5]',
      '- button "Start Exploration" [ref=e6]',
      '- button "Restore defaults" [ref=e7]',
      '- button "New Terminal" [ref=e8]',
      '- tab "Testing" [ref=e9]',
    ].join("\n");

    expect(parseActionableElements(snapshot)).toEqual([
      { role: "tab", name: "Testing", ref: "e9" },
    ]);
  });
});

describe("Testing crawler CDP endpoint", () => {
  it.each(["http://127.0.0.1:9224", "http://localhost:9224", "https://[::1]:9224"])(
    "accepts loopback endpoint %s",
    (endpoint) => {
      expect(validateTestingCdpEndpoint(endpoint)).toBe(new URL(endpoint).href);
    },
  );

  it.each(["https://example.test:9224", "ws://127.0.0.1:9224"])(
    "rejects unsafe endpoint %s",
    (endpoint) => {
      expect(() => validateTestingCdpEndpoint(endpoint)).toThrow(
        "Electron CDP endpoint must be an http(s) loopback URL",
      );
    },
  );
});
