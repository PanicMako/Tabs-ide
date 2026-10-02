import { describe, expect, it } from "vitest";
import {
  reviewOperationsDetail,
  reviewOperationsSummary,
} from "../frontend/src/lib/reviewOperations.ts";
import { metadataFreshness } from "./metadataFreshness.ts";
import { evaluateOperationalReadiness } from "./operationalAlerts.ts";
const queue = {
  worker_recently_seen: true,
  queued: 1,
  scanning: 2,
  stale_scans: 0,
  awaiting_review: 3,
  awaiting_signed_publication: 4,
  pending_signed_revocations: 1,
};
describe("reviewer operational status", () => {
  const now = Date.parse("2026-10-01T00:00:00Z");
  const detailedQueue = {
    ...queue,
    last_worker_heartbeat_at: "2026-10-01T00:00:00Z",
    last_scan_at: null,
    oldest_queued_at: null,
    last_reviewed_at: null,
    last_signed_publication_at: null,
  };
  const metadata = metadataFreshness(
    [
      {
        name: "root.json",
        bytes: Buffer.from(
          JSON.stringify({ signed: { _type: "root", expires: "2027-01-01T00:00:00Z" } }),
        ),
      },
      {
        name: "timestamp.json",
        bytes: Buffer.from(
          JSON.stringify({ signed: { _type: "timestamp", expires: "2026-09-30T00:00:00Z" } }),
        ),
      },
    ],
    now,
  );
  const detail = {
    queue: detailedQueue,
    metadataFreshness: metadata,
    readiness: evaluateOperationalReadiness(
      true,
      { ...detailedQueue, metadataFreshness: metadata },
      now,
    ),
    pendingRevocations: [
      {
        namespace: "acme",
        name: "tool",
        version: "1.0.0",
        digest: "a".repeat(64),
        reviewed_at: "2026-10-01T00:00:00Z",
      },
    ],
  };
  it("presents real server freshness and alert contracts without treating expiry as signature proof", () => {
    const result = reviewOperationsDetail(detail);
    expect(result.metadata).toEqual([
      "root: valid; expires 2027-01-01T00:00:00.000Z.",
      "timestamp: expired; expires 2026-09-30T00:00:00.000Z.",
      "snapshot: missing.",
      "targets: missing.",
    ]);
    expect(result.alerts).toHaveLength(3);
    expect(result.advisory).toContain("attention required");
    expect(result.activity[0]).toContain("2026-10-01T00:00:00.000Z");
    expect(result.activity[1]).toContain("none recorded");
    expect(result.revocations[0]).toContain("acme.tool@1.0.0: SHA-256");
    expect(result.remaining).toBe(0);
  });
  it("explains bounded or missing revocation identities without claiming an empty backlog", () => {
    const result = reviewOperationsDetail({
      ...detail,
      queue: { ...detailedQueue, pending_signed_revocations: 101 },
    });
    expect(result.remaining).toBe(100);
    expect(reviewOperationsDetail({ ...detail, pendingRevocations: [] }).revocations[0]).toContain(
      "Do not assume",
    );
    expect(
      reviewOperationsDetail({
        ...detail,
        queue: { ...detailedQueue, pending_signed_revocations: 0 },
        pendingRevocations: [],
      }).revocations[0],
    ).toContain("No signed revocations are pending");
  });
  it("fails closed on missing, duplicate, malformed or inconsistent operational evidence", () => {
    for (const change of [
      { metadataFreshness: [] },
      { metadataFreshness: [metadata[0], metadata[0], metadata[2], metadata[3]] },
      { metadataFreshness: [{ ...metadata[0], expiresAt: null }, ...metadata.slice(1)] },
      { readiness: { ...detail.readiness, ready: true } },
      { queue: { ...detailedQueue, last_scan_at: "unknown" } },
      { queue: { ...detailedQueue, pending_signed_revocations: 0 } },
      { pendingRevocations: Array(101).fill(detail.pendingRevocations[0]) },
      { pendingRevocations: [{ ...detail.pendingRevocations[0], namespace: "../acme" }] },
      { pendingRevocations: [{ ...detail.pendingRevocations[0], digest: "invalid" }] },
    ])
      expect(() => reviewOperationsDetail({ ...detail, ...change })).toThrow();
    expect(() =>
      reviewOperationsDetail({
        ...detail,
        queue: { ...detailedQueue, pending_signed_revocations: 2 },
        pendingRevocations: [detail.pendingRevocations[0], detail.pendingRevocations[0]],
      }),
    ).toThrow("Duplicate");
  });
  it("distinguishes approval and revocation from signed publication", () => {
    const summary = reviewOperationsSummary({ queue });
    expect(summary).toContain("4 approved release(s) await signed publication");
    expect(summary).toContain("1 revoked release(s) remain in published signed targets");
    expect(summary).toContain("Publish updated signed metadata promptly");
  });
  it("does not invent a healthy status from absent or malformed data", () => {
    for (const value of [
      null,
      {},
      { queue: { ...queue, queued: -1 } },
      { queue: { ...queue, scanning: "2" } },
      { queue: { ...queue, worker_recently_seen: null } },
    ])
      expect(() => reviewOperationsSummary(value)).toThrow();
    expect(reviewOperationsSummary({ queue: { ...queue, worker_recently_seen: false } })).toContain(
      "missing or stale",
    );
  });
});
