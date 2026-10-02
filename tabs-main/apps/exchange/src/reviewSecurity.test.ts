import { describe, expect, it } from "vitest";
import {
  blockedDigestEvidence,
  digestBlock,
  digestBlockBatch,
  digestUnblock,
  namespaceVerification,
} from "../frontend/src/lib/reviewSecurity";

const digest = "a".repeat(64);
describe("reviewer security controls", () => {
  it("binds verification to the named namespace and requires safe ownership proof", () => {
    expect(
      namespaceVerification("acme", true, "https://acme.example/proof", "  Ownership checked  "),
    ).toEqual({
      path: "/v1/review/namespaces/acme/verification",
      body: { verified: true, proofUrl: "https://acme.example/proof", reason: "Ownership checked" },
    });
    expect(namespaceVerification("acme", false, "", "Ownership removed").body).not.toHaveProperty(
      "proofUrl",
    );
    for (const proof of [
      "",
      "http://acme.example",
      "javascript:alert(1)",
      "https://name:secret@acme.example",
      "https://acme.example/#fragment",
    ])
      expect(() => namespaceVerification("acme", true, proof, "Reviewed")).toThrow();
    expect(() => namespaceVerification("../acme", false, "", "Reviewed")).toThrow("namespace");
    expect(() => namespaceVerification("acme", false, "", " ")).toThrow("reason");
  });
  it("binds blocks and removals to exact digest and bounded reason", () => {
    expect(digestBlock(digest, "  Known malicious file  ").body).toEqual({
      digest,
      reason: "Known malicious file",
    });
    expect(digestUnblock(digest, "False positive").path).toBe(
      `/v1/review/blocked-digests/${digest}/remove`,
    );
    for (const value of ["../digest", "A".repeat(64), "a".repeat(63)])
      expect(() => digestUnblock(value, "Reviewed")).toThrow("SHA-256");
    expect(() => digestBlock(digest, "x".repeat(2001))).toThrow("reason");
  });
  it("reuses the bounded atomic batch parser rather than accepting arbitrary JSON", () => {
    expect(digestBlockBatch(`${digest} First\n${"b".repeat(64)} Second`).body.entries).toHaveLength(
      2,
    );
    expect(() => digestBlockBatch(`${digest} One\n${digest} Two`)).toThrow("unique");
    expect(() =>
      digestBlockBatch(
        Array.from(
          { length: 101 },
          (_, index) => `${index.toString(16).padStart(64, "0")} Reason`,
        ).join("\n"),
      ),
    ).toThrow("100");
  });
  it("validates bounded blocklist evidence and retains reason text literally", () => {
    const entry = {
      digest,
      reason: "<script>review text</script>",
      created_at: "2026-10-01T00:00:00Z",
    };
    expect(blockedDigestEvidence({ blockedDigests: [entry] })[0]).toEqual({
      digest,
      reason: entry.reason,
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    for (const entries of [
      [entry, entry],
      [{ ...entry, digest: "bad" }],
      [{ ...entry, reason: " " }],
      [{ ...entry, created_at: "unknown" }],
      Array(501).fill(entry),
    ])
      expect(() => blockedDigestEvidence({ blockedDigests: entries })).toThrow();
    expect(() => blockedDigestEvidence({})).toThrow();
  });
});
