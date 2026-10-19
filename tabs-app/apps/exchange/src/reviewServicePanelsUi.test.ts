// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
it("shows attention, metadata and UTC activity separately, then clears stale health evidence", async () => {
  vi.resetModules();
  document.body.innerHTML =
    '<p id="review-health-indicator"></p><div id="review-health-metrics"></div><p id="review-health-pipeline"></p><div id="review-operations-details"><p id="review-operations-advisory"></p><ul id="review-operations-activity"></ul><ul id="review-operations-metadata"></ul><ul id="review-operations-alerts"></ul><ul id="review-operations-revocations"></ul><p id="review-operations-remaining"></p></div><details id="review-revocations-fold"></details>';
  const { showOperationsDetail, clearOperationsDetail } =
    await import("../frontend/src/scripts/review-operations");
  const message = "<img src=x onerror=alert(1)> Signing needs setup.";
  showOperationsDetail({
    queue: {
      worker_recently_seen: true,
      queued: 0,
      scanning: 0,
      stale_scans: 0,
      awaiting_review: 1,
      awaiting_signed_publication: 0,
      pending_signed_revocations: 1,
      last_worker_heartbeat_at: "2026-10-18T11:47:42Z",
      last_scan_at: null,
      oldest_queued_at: null,
      last_reviewed_at: null,
      last_signed_publication_at: null,
    },
    metadataFreshness: ["root", "timestamp", "snapshot", "targets"].map((role) => ({
      role,
      status: "missing",
      expiresAt: null,
    })),
    readiness: {
      ready: false,
      healthzOk: true,
      alerts: [{ level: "warning", subsystem: "tuf", message }],
    },
    pendingRevocations: [],
  });
  expect(document.querySelectorAll(".health-metric")).toHaveLength(4);
  expect(document.querySelectorAll(".health-role")).toHaveLength(4);
  expect(document.querySelector("time")!.dateTime).toBe("2026-10-18T11:47:42.000Z");
  expect(document.querySelector("#review-operations-alerts")!.textContent).toContain(message);
  expect(document.querySelector("img")).toBeNull();
  expect((document.querySelector("#review-revocations-fold") as HTMLDetailsElement).open).toBe(
    true,
  );
  clearOperationsDetail();
  expect((document.getElementById("review-operations-details") as HTMLElement).hidden).toBe(true);
  expect(document.querySelectorAll(".health-metric")).toHaveLength(0);
  expect(document.getElementById("review-health-indicator")!.dataset.health).toBe("unknown");
});
