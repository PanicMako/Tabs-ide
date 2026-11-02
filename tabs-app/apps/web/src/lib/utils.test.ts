import { assert, describe, it, afterEach, vi } from "vitest";

import { getHashAwareSearchParams, isWindowsPlatform } from "./utils";

describe("isWindowsPlatform", () => {
  it("matches Windows platform identifiers", () => {
    assert.isTrue(isWindowsPlatform("Win32"));
    assert.isTrue(isWindowsPlatform("Windows"));
    assert.isTrue(isWindowsPlatform("windows_nt"));
  });

  it("does not match darwin", () => {
    assert.isFalse(isWindowsPlatform("darwin"));
  });
});

describe("hash-aware route parameters", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("uses the current desktop destination over stale outer search parameters", () => {
    vi.stubGlobal("window", {
      location: { search: "?section=maintenance", hash: "#/settings?section=usage" },
    });
    assert.equal(getHashAwareSearchParams().get("section"), "usage");
  });
  it("keeps browser-history destinations and outer window flags", () => {
    vi.stubGlobal("window", { location: { search: "?section=usage&popout=true", hash: "" } });
    assert.equal(getHashAwareSearchParams().get("section"), "usage");
    vi.stubGlobal("window", {
      location: { search: "?popout=true", hash: "#/settings?section=quick-actions" },
    });
    assert.equal(getHashAwareSearchParams().get("section"), "quick-actions");
    assert.equal(getHashAwareSearchParams().get("popout"), "true");
  });
});
