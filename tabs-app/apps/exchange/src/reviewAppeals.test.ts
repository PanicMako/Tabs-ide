import { describe, expect, it } from "vitest";
import { appealResponse, reviewAppeals } from "../frontend/src/lib/reviewAppeals";
describe("reviewer appeal evidence and responses", () => {
  const entry = {
    id: "12",
    namespace: "demo",
    name: "tool",
    version: "1.0.0",
    digest: "a".repeat(64),
    message: "Reconsider this",
    status: "rejected",
    review_reason: null,
  };
  it("validates bounded package evidence and preserves text literally", () => {
    expect(
      reviewAppeals({ appeals: [{ ...entry, message: "<script>text</script>" }] })[0]?.message,
    ).toBe("<script>text</script>");
    expect(() => reviewAppeals({ appeals: [entry, entry] })).toThrow("identity");
    expect(() =>
      reviewAppeals({ appeals: [{ ...entry, id: Number.MAX_SAFE_INTEGER + 1 }] }),
    ).toThrow("identity");
    expect(() => reviewAppeals({ appeals: [{ ...entry, digest: "wrong" }] })).toThrow();
    expect(() => reviewAppeals({ appeals: Array(101).fill(entry) })).toThrow();
  });
  it("addresses only a validated appeal id and refuses empty or oversized responses", () => {
    expect(appealResponse("12", "  Explanation  ")).toEqual({
      path: "/v1/review/appeals/12/response",
      body: { response: "Explanation" },
    });
    for (const [id, message] of [
      ["../12", "text"],
      ["12", " "],
      ["12", "x".repeat(4001)],
    ])
      expect(() => appealResponse(id!, message!)).toThrow();
  });
});
