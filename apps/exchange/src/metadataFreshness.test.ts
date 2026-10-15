import { describe, expect, it } from "vitest";
import { metadataFreshness } from "./metadataFreshness.ts";

const now = Date.parse("2026-09-29T00:00:00Z");
function row(name: string, role: string, expires: string) {
  return { name, bytes: Buffer.from(JSON.stringify({ signed: { _type: role, expires } })) };
}

describe("stored TUF metadata expiry advisory", () => {
  it("distinguishes missing, expiring, expired, and valid roles", () => {
    expect(
      metadataFreshness(
        [
          row("root.json", "root", "2026-10-30T00:00:00Z"),
          row("timestamp.json", "timestamp", "2026-09-29T12:00:00Z"),
          row("snapshot.json", "snapshot", "2026-09-28T00:00:00Z"),
        ],
        now,
      ),
    ).toEqual([
      { role: "root", status: "valid", expiresAt: "2026-10-30T00:00:00.000Z" },
      { role: "timestamp", status: "expiring", expiresAt: "2026-09-29T12:00:00.000Z" },
      { role: "snapshot", status: "expired", expiresAt: "2026-09-28T00:00:00.000Z" },
      { role: "targets", status: "missing", expiresAt: null },
    ]);
  });

  it("labels malformed or wrong-role bytes invalid", () => {
    expect(
      metadataFreshness(
        [
          row("root.json", "targets", "2026-10-30T00:00:00Z"),
          { name: "timestamp.json", bytes: Buffer.from("not JSON") },
        ],
        now,
      ).slice(0, 2),
    ).toEqual([
      { role: "root", status: "invalid", expiresAt: null },
      { role: "timestamp", status: "invalid", expiresAt: null },
    ]);
  });
});
