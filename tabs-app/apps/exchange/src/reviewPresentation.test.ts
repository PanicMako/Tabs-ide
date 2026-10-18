import { expect, it } from "vitest";
import { reviewPresentation } from "../frontend/src/lib/reviewPresentation";
const digest = "a".repeat(64);
it("never labels missing, mismatched or blocking scan evidence ready for review", () => {
  for (const scan of [
    null,
    {},
    { passed: true, digest: "b".repeat(64), issues: [] },
    { passed: true, digest, issues: [{ severity: "blocking" }] },
    { passed: false, digest, issues: [] },
  ]) {
    expect(reviewPresentation({ status: "review", digest, scan_result: scan }).tone).not.toBe(
      "ready",
    );
  }
  expect(
    reviewPresentation({
      status: "review",
      digest,
      scan_result: { passed: true, digest, issues: [] },
    }).label,
  ).toBe("Ready for review");
});
it("keeps scan progress and approval distinct from publication", () => {
  expect(reviewPresentation({ status: "scanning", digest, scan_result: null }).label).toBe(
    "Scanning",
  );
  expect(reviewPresentation({ status: "queued", digest, scan_result: null }).label).toBe(
    "Waiting for scan",
  );
  expect(reviewPresentation({ status: "approved", digest, scan_result: null }).guidance).toContain(
    "separate step",
  );
});
