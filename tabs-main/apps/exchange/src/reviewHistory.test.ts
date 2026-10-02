import { describe, expect, it } from "vitest";
import { reviewHistoryLines, reviewHistoryPath } from "../frontend/src/lib/reviewHistory.ts";
describe("review history presentation contract", () => {
  it("restricts lookup to an exact namespace/name route", () => {
    expect(reviewHistoryPath("acme", "tool")).toBe("/v1/review/acme/tool/history");
    for (const value of ["../acme", "acme?x", "Acme", "a"])
      expect(() => reviewHistoryPath(value, "tool")).toThrow();
  });
  it("preserves reviewer, exact digest, timestamp and reason as plain strings", () => {
    const row = {
      action: "approve",
      version: "1.0.0",
      digest: "a".repeat(64),
      reviewer_login: "reviewer",
      created_at: "2026-10-01T00:00:00Z",
      reason: "<script>untrusted</script>",
    };
    const result = reviewHistoryLines({ versions: [], decisions: [row] });
    expect(result.decisions[0]).toContain(row.digest);
    expect(result.decisions[0]).toContain(row.reason);
    expect(result.decisions[0]).toContain("Reviewer reviewer at 2026-10-01");
  });
  it("rejects oversized lists and malformed rows rather than presenting partial evidence", () => {
    for (const data of [
      null,
      {},
      { versions: [], decisions: [null] },
      { versions: Array.from({ length: 101 }, () => ({})), decisions: [] },
    ])
      expect(() => reviewHistoryLines(data)).toThrow();
  });
});
