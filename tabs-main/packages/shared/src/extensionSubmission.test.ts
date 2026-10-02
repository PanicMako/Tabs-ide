import { describe, expect, it } from "vitest";
import { submissionLifecycle } from "./extensionSubmission.ts";
describe("extension submission lifecycle", () => {
  it("does not confuse approval with signed publication", () => {
    expect(submissionLifecycle({ status: "approved", published: false })).toMatchObject({
      code: "approved",
      terminal: false,
    });
    expect(submissionLifecycle({ status: "approved", published: true })).toMatchObject({
      code: "published",
      terminal: true,
    });
    expect(submissionLifecycle({ status: "approved", published: "true" })).toMatchObject({
      code: "approved",
      terminal: false,
    });
  });
  it("revocation and rejection take precedence over stale published flags", () => {
    expect(submissionLifecycle({ status: "revoked", published: true }).code).toBe("revoked");
    expect(submissionLifecycle({ status: "rejected", published: true }).terminal).toBe(true);
  });
  it("keeps accepted/scanning/review stages active and rejects unknown state claims", () => {
    for (const status of ["queued", "scanning", "review"])
      expect(submissionLifecycle({ status }).terminal).toBe(false);
    expect(submissionLifecycle(null).code).toBe("unknown");
    expect(submissionLifecycle({ status: "published" }).code).toBe("unknown");
  });
});
