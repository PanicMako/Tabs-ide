import { describe, expect, it } from "vitest";
import { decodeSearchCursor, encodeSearchCursor } from "./searchCursor.ts";

describe("Exchange search cursor", () => {
  it("captures the display-name sort key, including a full-length Unicode name", () => {
    for (const sortName of ["alpha", "工具".repeat(250)]) {
      const value = { namespace: "acme", name: "tool", sortName };
      expect(decodeSearchCursor(encodeSearchCursor(value))).toEqual(value);
    }
    for (const sortName of ["", "x".repeat(1501)])
      expect(
        decodeSearchCursor(encodeSearchCursor({ namespace: "acme", name: "tool", sortName })),
      ).toBeNull();
  });
  it("roundtrips relevance ranks and rejects invalid ranks", () => {
    for (const relevance of [0, 1, 2, 3, 4]) {
      const value = { namespace: "acme", name: "tool", relevance };
      expect(decodeSearchCursor(encodeSearchCursor(value))).toEqual(value);
    }
    for (const relevance of [-1, 5, 1.5]) {
      expect(
        decodeSearchCursor(encodeSearchCursor({ namespace: "acme", name: "tool", relevance })),
      ).toBeNull();
    }
  });
  it("distinguishes publication cursors from legacy upload-date cursors and preserves unknown dates", () => {
    for (const publishedAt of [null, "2026-10-01T09:15:10.123456Z"]) {
      const cursor = { namespace: "acme", name: "tool", publishedAt };
      expect(decodeSearchCursor(encodeSearchCursor(cursor))).toEqual(cursor);
    }
    expect(
      decodeSearchCursor(
        encodeSearchCursor({ namespace: "acme", name: "tool", publishedAt: "bad" }),
      ),
    ).toBeNull();
  });
  it("preserves microseconds for stable newest pagination", () => {
    const identity = {
      namespace: "acme",
      name: "tool",
      submittedAt: "2026-09-30T09:15:10.123456Z",
    };
    expect(decodeSearchCursor(encodeSearchCursor(identity))).toEqual(identity);
    expect(
      decodeSearchCursor(encodeSearchCursor({ ...identity, submittedAt: "not-a-date" })),
    ).toBeNull();
    for (const submittedAt of ["2026-02-30T09:15:10.123456Z", "0000-01-01T09:15:10.123456Z"])
      expect(decodeSearchCursor(encodeSearchCursor({ ...identity, submittedAt }))).toBeNull();
  });
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
