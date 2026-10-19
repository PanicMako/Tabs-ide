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
  document.body.innerHTML = '<p id="review-appeals-status"></p><ul id="review-appeals"></ul>';
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  detach();
  vi.restoreAllMocks();
});
const entry = {
  id: "1",
  namespace: "maker",
  name: "tool",
  version: "1.0.0",
  digest: "a".repeat(64),
  status: "open",
  message: "<img src=x onerror=alert(1)>",
  review_reason: "Please explain network access.",
};
it("separates untrusted messages from decisions and only posts after an explicit response submission", async () => {
  api.request.mockResolvedValueOnce({ appeals: [entry] });
  const { showReviewAppeals } = await import("../frontend/src/scripts/review-appeals");
  await showReviewAppeals(new AbortController().signal);
  expect(document.querySelector("img")).toBeNull();
  expect(document.querySelector(".appeal-conversation")!.textContent).toContain(entry.message);
  const form = document.querySelector("form")!;
  expect(form.hidden).toBe(true);
  (document.querySelector("button") as HTMLButtonElement).click();
  expect(form.hidden).toBe(false);
  expect(api.request).toHaveBeenCalledTimes(1);
  const response = document.querySelector("textarea")!;
  response.value = "  Thanks for clarifying.  ";
  let finish!: () => void;
  api.request.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(api.request).toHaveBeenCalledTimes(2);
  expect(api.request.mock.calls[1]).toEqual([
    "/v1/review/appeals/1/response",
    "POST",
    { response: "Thanks for clarifying." },
  ]);
  finish();
  await vi.waitFor(() => expect(form.textContent).toContain("Response recorded"));
});
it("distinguishes an empty queue from a failed load", async () => {
  api.request.mockResolvedValueOnce({ appeals: [] });
  const { showReviewAppeals } = await import("../frontend/src/scripts/review-appeals");
  await showReviewAppeals(new AbortController().signal);
  expect(document.querySelector(".service-welcome")!.textContent).toContain("caught up");
  api.request.mockRejectedValueOnce(new Error("offline"));
  await showReviewAppeals(new AbortController().signal);
  expect(document.querySelector(".service-welcome")).toBeNull();
  expect(document.getElementById("review-appeals-status")!.textContent).toContain(
    "could not be loaded",
  );
});
