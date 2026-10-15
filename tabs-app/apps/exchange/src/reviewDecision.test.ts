import { describe, expect, it } from "vitest";
import {
  reviewArchivePath,
  reviewDecision,
  reviewRescan,
} from "../frontend/src/lib/reviewDecision.ts";

const identity = { namespace: "acme", name: "tool", version: "1.0.0", digest: "a".repeat(64) };
describe("review decision identity binding", () => {
  it("binds archive inspection and rescan requests to validated identity and digest", () => {
    expect(reviewArchivePath(identity)).toBe("/v1/review/acme/tool/1.0.0/download");
    expect(reviewRescan(identity, "  Advisory service recovered  ", identity.digest)).toEqual({
      path: "/v1/review/acme/tool/1.0.0/rescan",
      body: { digest: identity.digest, reason: "Advisory service recovered" },
    });
    expect(() => reviewArchivePath({ ...identity, name: "../tool" })).toThrow("identity");
    expect(() => reviewRescan(identity, "Retry", "b".repeat(64))).toThrow("exact");
    expect(() => reviewRescan(identity, " ", identity.digest)).toThrow("reason");
  });
  it("allows revocation only in the approved-release context", () => {
    expect(
      reviewDecision(identity, "revoke", "Security incident", identity.digest, "approved").body,
    ).toEqual({ action: "revoke", digest: identity.digest, reason: "Security incident" });
    for (const action of ["approve", "reject"])
      expect(() =>
        reviewDecision(identity, action, "Reviewed", identity.digest, "approved"),
      ).toThrow("revoke");
  });
  it("binds approval and rejection to the captured digest and trims the reason", () => {
    for (const action of ["approve", "reject"]) {
      expect(reviewDecision(identity, action, " Examined contents ", identity.digest)).toEqual({
        path: "/v1/review/acme/tool/1.0.0",
        body: { action, digest: identity.digest, reason: "Examined contents" },
      });
    }
  });
  it("rejects mismatched confirmation, blank or oversized reasons and unsupported actions", () => {
    expect(() => reviewDecision(identity, "approve", "Reviewed", "b".repeat(64))).toThrow("exact");
    for (const reason of [" ", "x".repeat(2001)])
      expect(() => reviewDecision(identity, "approve", reason, identity.digest)).toThrow("reason");
    expect(() => reviewDecision(identity, "revoke", "Reviewed", identity.digest)).toThrow("Choose");
  });
  it("rejects identities that could alter the intended API route", () => {
    for (const change of [
      { namespace: "../acme" },
      { name: "tool?x" },
      { version: "1/approve" },
      { digest: "bad" },
    ])
      expect(() =>
        reviewDecision({ ...identity, ...change }, "approve", "Reviewed", identity.digest),
      ).toThrow("identity");
  });
});
