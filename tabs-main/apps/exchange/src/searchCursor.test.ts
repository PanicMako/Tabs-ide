import { describe, expect, it } from "vitest";
import { decodeSearchCursor, encodeSearchCursor } from "./searchCursor.ts";

describe("Exchange search cursor", () => {
  it("roundtrips an exact extension identity", () => {
    const identity = { namespace: "acme-tools", name: "dashboard" };
    expect(decodeSearchCursor(encodeSearchCursor(identity))).toEqual(identity);
  });

  it("rejects malformed, oversized, and noncanonical cursors", () => {
    expect(decodeSearchCursor("bad/cursor")).toBeNull();
    expect(decodeSearchCursor("x".repeat(257))).toBeNull();
    expect(
      decodeSearchCursor(Buffer.from(JSON.stringify(["Acme", "dashboard"])).toString("base64url")),
    ).toBeNull();
    expect(
      decodeSearchCursor(`${encodeSearchCursor({ namespace: "acme", name: "dashboard" })}=`),
    ).toBeNull();
  });
});
