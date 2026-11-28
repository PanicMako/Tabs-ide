import { describe, expect, it } from "vitest";

import {
  accountMarkerChanged,
  isSessionLikeCookieName,
  parseAccountMarker,
} from "./browserAccountMarker";

const a = "a".repeat(64);
const b = "b".repeat(64);
const c = "c".repeat(64);

describe("account marker", () => {
  it("accepts one or more digests and rejects anything else", () => {
    expect(parseAccountMarker(a)).toBe(a);
    expect(parseAccountMarker(`${a},${b}`)).toBe(`${a},${b}`);
    expect(parseAccountMarker("alice@example.com")).toBeNull();
    expect(parseAccountMarker(`${a},`)).toBeNull();
    expect(parseAccountMarker(undefined)).toBeNull();
  });

  it("treats a missing marker on either side as no change", () => {
    expect(accountMarkerChanged(null, a)).toBe(false);
    expect(accountMarkerChanged(a, null)).toBe(false);
  });

  it("keeps the grant while any approved identity hint is still visible", () => {
    expect(accountMarkerChanged(a, a)).toBe(false);
    // Navigation shows another person's address next to the signed-in one.
    expect(accountMarkerChanged(a, `${a},${c}`)).toBe(false);
    expect(accountMarkerChanged(`${a},${b}`, b)).toBe(false);
  });

  it("revokes when every approved identity hint was replaced", () => {
    expect(accountMarkerChanged(a, b)).toBe(true);
    expect(accountMarkerChanged(`${a},${b}`, c)).toBe(true);
  });

  it("recognises session-like cookie names but ignores rotating tokens", () => {
    expect(isSessionLikeCookieName("session_id")).toBe(true);
    expect(isSessionLikeCookieName("auth_token")).toBe(true);
    expect(isSessionLikeCookieName("csrftoken")).toBe(false);
    expect(isSessionLikeCookieName("_ga")).toBe(false);
  });
});
