import { describe, expect, it } from "vitest";
import { submissionAppeals } from "../frontend/src/lib/submissionAppeals";

describe("submission appeal evidence", () => {
  const identity = { namespace: "demo", name: "tool", version: "1.0.0", digest: "a".repeat(64) };
  const entry = {
    ...identity,
    message: "Please reconsider",
    created_at: "2026-10-01",
    response: null,
    responded_at: null,
  };
  it("retains pending and responded appeals without interpreting messages as markup", () => {
    expect(submissionAppeals({ appeals: [entry] }, identity)[0]?.response).toBeNull();
    expect(
      submissionAppeals(
        { appeals: [{ ...entry, response: "<script>not HTML</script>" }] },
        identity,
      )[0]?.response,
    ).toBe("<script>not HTML</script>");
  });
  it("rejects another release's evidence and malformed or oversized records", () => {
    expect(() =>
      submissionAppeals({ appeals: [{ ...entry, digest: "b".repeat(64) }] }, identity),
    ).toThrow("identity");
    expect(() =>
      submissionAppeals({ appeals: [{ ...entry, message: "x".repeat(4001) }] }, identity),
    ).toThrow();
    expect(() => submissionAppeals({ appeals: Array(101).fill(entry) }, identity)).toThrow();
    expect(() => submissionAppeals(null, identity)).toThrow();
  });
});
