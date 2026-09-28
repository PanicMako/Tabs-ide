import { describe, expect, it } from "vitest";
import { parseBlockedDigestBatch } from "./publisherBatch.js";

describe("reviewer hash-list input", () => {
  it("keeps exact lowercase digests and reasons", () => {
    expect(
      JSON.parse(
        parseBlockedDigestBatch(
          `${"a".repeat(64)} First reason\r\n${"b".repeat(64)}\tSecond reason`,
        ),
      ),
    ).toEqual({
      entries: [
        { digest: "a".repeat(64), reason: "First reason" },
        { digest: "b".repeat(64), reason: "Second reason" },
      ],
    });
  });

  it("rejects duplicates, malformed hashes, and excess entries", () => {
    expect(() => parseBlockedDigestBatch(" ")).toThrow(/between 1 and 100/);
    expect(() => parseBlockedDigestBatch(`${"A".repeat(64)} Reason`)).toThrow(/Line 1/);
    expect(() =>
      parseBlockedDigestBatch(`${"a".repeat(64)} First\n${"a".repeat(64)} Second`),
    ).toThrow(/Line 2/);
    expect(() =>
      parseBlockedDigestBatch(
        Array.from(
          { length: 101 },
          (_, index) => `${index.toString(16).padStart(64, "0")} Reason`,
        ).join("\n"),
      ),
    ).toThrow(/between 1 and 100/);
    expect(() => parseBlockedDigestBatch(`${"a".repeat(64)} ${"x".repeat(2001)}`)).toThrow(
      /Line 1/,
    );
  });

  it("enforces the API body-size limit before submission", () => {
    const raw = Array.from(
      { length: 100 },
      (_, index) => `${index.toString(16).padStart(64, "0")} ${"x".repeat(700)}`,
    ).join("\n");
    expect(() => parseBlockedDigestBatch(raw)).toThrow(/too large/);
  });
});
