import { expect, it } from "vitest";
import { submissionPresentation } from "../frontend/src/lib/submissionPresentation";

it("only presents an approved version with signed-publication evidence as published", () => {
  expect(submissionPresentation({ status: "approved", published: true }).group).toBe("published");
  for (const status of ["queued", "scanning", "review", "approved", "rejected", "revoked"]) {
    expect(submissionPresentation({ status, published: false }).group).not.toBe("published");
  }
  for (const status of ["review", "rejected", "revoked"]) {
    expect(submissionPresentation({ status, published: true }).group).not.toBe("published");
  }
  expect(submissionPresentation({ status: "approved", published: false }).next).toContain(
    "Approval alone",
  );
});

it("distinguishes a decision needing attention from ordinary waiting and unknown data", () => {
  expect(submissionPresentation({ status: "rejected" }).group).toBe("attention");
  expect(submissionPresentation({ status: "revoked" }).group).toBe("attention");
  expect(submissionPresentation({ status: "review" }).group).toBe("progress");
  for (const value of [null, {}, { status: "new-server-state", published: true }]) {
    expect(submissionPresentation(value).group).toBe("unknown");
    expect(submissionPresentation(value).stage).toBe(-1);
  }
});
