import { describe, expect, it } from "vitest";

import {
  buildPairingLinkUrl,
  describeAccessClient,
  formatCountdown,
  secondsUntil,
} from "./remoteAccess.logic";

describe("remote access helpers", () => {
  it("builds a pairing link on the /pair page with the token in the fragment", () => {
    const link = new URL(buildPairingLinkUrl("http://192.168.1.4:3773/?x=1", "abc123"));
    expect(link.origin).toBe("http://192.168.1.4:3773");
    expect(link.pathname).toBe("/pair");
    expect(link.search).toBe("");
    expect(link.hash).toContain("abc123");
  });

  it("names a device by its label, else browser and OS, else its kind", () => {
    expect(describeAccessClient({ label: "Pixel", browser: "Chrome", os: "Android" })).toEqual({
      name: "Pixel",
      detail: "Chrome on Android",
    });
    expect(describeAccessClient({ browser: "Safari", os: "iOS" })).toEqual({
      name: "Safari on iOS",
      detail: "",
    });
    expect(describeAccessClient({ deviceType: "mobile" }).name).toBe("Phone");
    expect(describeAccessClient({}).name).toBe("Unknown device");
  });

  it("counts down to expiry without going negative", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(secondsUntil("2026-01-01T00:10:00Z", now)).toBe(600);
    expect(secondsUntil("2025-12-31T23:59:00Z", now)).toBe(0);
    expect(secondsUntil("not a date", now)).toBe(0);
    expect(formatCountdown(605)).toBe("10:05");
  });
});
