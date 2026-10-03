import { beforeEach, describe, expect, it } from "vitest";

import {
  buildVersionMismatchDismissalKey,
  dismissVersionMismatch,
  isVersionMismatchDismissed,
  resetVersionMismatchDismissals,
  resolveVersionMismatch,
} from "./versionSkew.ts";

describe("versionSkew", () => {
  beforeEach(() => {
    resetVersionMismatchDismissals();
  });

  it("returns null when server and client versions match", () => {
    expect(resolveVersionMismatch("1.2.3", "1.2.3")).toBeNull();
  });

  it("returns null when server is ahead of client", () => {
    expect(resolveVersionMismatch("1.3.0", "1.2.0")).toBeNull();
  });

  it("returns a VersionMismatch when server is behind client", () => {
    const mismatch = resolveVersionMismatch("1.0.0", "1.1.0");
    expect(mismatch).not.toBeNull();
    expect(mismatch?.clientVersion).toBe("1.1.0");
    expect(mismatch?.serverVersion).toBe("1.0.0");
    expect(mismatch?.hint).toContain("Version mismatch");
  });

  it("handles nightly versions appropriately", () => {
    const mismatch = resolveVersionMismatch("1.0.0-nightly.20260101", "1.0.0-nightly.20260102");
    expect(mismatch).not.toBeNull();
  });

  it("persists dismissals keyed by environment and version pair", () => {
    const key = buildVersionMismatchDismissalKey("local-env", {
      clientVersion: "1.5.0",
      serverVersion: "1.4.0",
    });
    expect(isVersionMismatchDismissed(key)).toBe(false);

    dismissVersionMismatch(key);
    expect(isVersionMismatchDismissed(key)).toBe(true);

    // Another version pair is NOT dismissed (version-keyed persistence)
    const otherKey = buildVersionMismatchDismissalKey("local-env", {
      clientVersion: "1.6.0",
      serverVersion: "1.4.0",
    });
    expect(isVersionMismatchDismissed(otherKey)).toBe(false);
  });
});
