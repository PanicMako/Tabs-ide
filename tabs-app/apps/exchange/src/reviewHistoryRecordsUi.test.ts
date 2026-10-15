// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../frontend/src/scripts/api", () => ({ request: api.request }));
let detach = () => {};
beforeEach(() => {
  vi.resetModules();
  api.request.mockReset();
  const events = vi.spyOn(window, "addEventListener");
  detach = () => {
    for (const [type, listener, options] of events.mock.calls)
      window.removeEventListener(type, listener, options);
  };
  document.body.innerHTML =
    '<form id="review-history-form"><input id="review-history-namespace"><input id="review-history-name"></form><p id="review-history-status"></p><ul id="review-history-versions"></ul><ul id="review-history-decisions"></ul>';
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  detach();
  vi.restoreAllMocks();
});
const row = {
  action: "approve",
  version: "1.0.0",
  digest: "a".repeat(64),
  reviewer_login: "reviewer",
  created_at: "2026-10-04T15:30:00+05:30",
  reason: "<img src=x onerror=alert(1)>",
};
it("preserves digest and exact time while separating readable decision evidence safely", async () => {
  api.request.mockResolvedValueOnce({ versions: [], decisions: [row] });
  const { showReviewHistory } = await import("../frontend/src/scripts/review-history");
  await showReviewHistory("maker", "tool");
  const record = document.querySelector("#review-history-decisions li")!;
  expect(record.querySelector("strong")!.textContent).toBe("approve · 1.0.0");
  expect(record.querySelector("time")!.dateTime).toBe(row.created_at);
  expect(record.querySelector("time")!.textContent).toContain("10:00");
  expect(record.textContent).toContain(row.digest);
  expect(record.textContent).toContain(row.reason);
  expect(record.querySelector("img")).toBeNull();
});
it("rejects an incomplete response before rendering any of its evidence", async () => {
  api.request.mockResolvedValueOnce({ versions: [], decisions: [row, { ...row, reason: null }] });
  const { showReviewHistory } = await import("../frontend/src/scripts/review-history");
  await showReviewHistory("maker", "tool");
  expect(document.querySelector("#review-history-decisions")!.textContent).toBe("");
  expect(document.querySelector("#review-history-status")!.textContent).toContain("Could not load");
});
it("discards superseded and departed-page history responses", async () => {
  let finish!: (value: unknown) => void;
  api.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { showReviewHistory } = await import("../frontend/src/scripts/review-history");
  const old = showReviewHistory("maker", "tool");
  api.request.mockResolvedValueOnce({ versions: [], decisions: [{ ...row, version: "2.0.0" }] });
  await showReviewHistory("maker", "next-tool");
  finish({ versions: [], decisions: [row] });
  await old;
  expect(document.querySelector("#review-history-decisions")!.textContent).toContain("2.0.0");
  expect(document.querySelector("#review-history-decisions")!.textContent).not.toContain("1.0.0");
  window.dispatchEvent(new Event("pagehide"));
  expect(document.querySelector("#review-history-decisions")!.textContent).toBe("");
});
