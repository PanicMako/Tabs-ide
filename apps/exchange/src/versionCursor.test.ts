import { describe, expect, it } from "vitest";
import { decodeVersionCursor, encodeVersionCursor } from "./versionCursor.ts";

describe("Exchange version-list cursors", () => {
  it("round-trips an exact microsecond timestamp and semantic version", () => {
    const value = { submittedAt: "2026-09-28T10:11:12.123456Z", version: "1.2.3-beta.1" };
    expect(decodeVersionCursor(encodeVersionCursor(value))).toEqual(value);
  });

  it("rejects malformed and oversized cursors", () => {
    expect(decodeVersionCursor("a".repeat(513))).toBeNull();
    expect(decodeVersionCursor("%2F")).toBeNull();
    expect(
      decodeVersionCursor(
        Buffer.from(JSON.stringify(["not-a-date", "1.0.0"])).toString("base64url"),
      ),
    ).toBeNull();
    expect(
      decodeVersionCursor(
        Buffer.from(JSON.stringify(["2026-02-30T10:11:12.123456Z", "1.0.0"])).toString("base64url"),
      ),
    ).toBeNull();
    expect(
      decodeVersionCursor(
        Buffer.from(JSON.stringify(["2026-09-28T10:11:12.123456Z", "../admin"])).toString(
          "base64url",
        ),
      ),
    ).toBeNull();
  });
});
