import { describe, expect, it } from "vitest";
import { auditReviewPlan } from "./AuditReviewPlan.ts";

describe("audit execution plan", () => {
  it("changes executed passes and context budgets with mode and depth", () => {
    const quick = auditReviewPlan({ mode: "security", depth: "quick" });
    const deep = auditReviewPlan({ mode: "architecture", depth: "deep" });
    expect(quick.passes).toEqual(["security"]);
    expect(deep.passes).toContain("architecture");
    expect(deep.passes).toContain("test_gap");
    expect(deep.maxPatchChars).toBeGreaterThan(quick.maxPatchChars);
    expect(deep.maxFileLines).toBeGreaterThan(quick.maxFileLines);
  });
  it.each(["../outside", "/tmp/outside", "C:\\outside", "src/../../outside", "src//other"])(
    "rejects out-of-root or ambiguous target %s",
    (path) => {
      expect(() =>
        auditReviewPlan({ mode: "full_audit", depth: "standard", targetPaths: [path] }),
      ).toThrow("inside the repository");
    },
  );
  it("preserves explicit repository-relative folder targets", () => {
    expect(
      auditReviewPlan({ mode: "full_audit", depth: "standard", targetPaths: ["apps/web"] })
        .targetPaths,
    ).toEqual(["apps/web"]);
  });
});
