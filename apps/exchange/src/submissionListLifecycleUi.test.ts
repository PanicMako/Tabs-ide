// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../frontend/src/scripts/api", async (original) => ({
  ...(await original<typeof import("../frontend/src/scripts/api")>()),
  request: api.request,
}));
import { RegistryRequestError } from "../frontend/src/scripts/api";
const entry = {
  namespace: "maker",
  name: "tool",
  version: "1.0.0",
  digest: "a".repeat(64),
  status: "review",
  published: false,
};
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let detachListeners = () => {};
beforeEach(() => {
  vi.resetModules();
  api.request.mockReset();
  const listeners = vi.spyOn(window, "addEventListener");
  detachListeners = () => {
    for (const [type, listener, options] of listeners.mock.calls)
      window.removeEventListener(type, listener, options);
  };
  document.body.innerHTML =
    '<p id="account-status"></p><section id="account-signin" hidden><a href="/auth/github/start" id="account-signin-link">Sign in</a></section><div id="account-content"><ul id="account-submissions"></ul><p id="submissions-count"></p><button id="submissions-refresh">Refresh</button></div><a href="#other" id="other">Other</a>';
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  detachListeners();
  vi.restoreAllMocks();
});
async function start() {
  api.request.mockResolvedValueOnce({ submissions: [entry] });
  await import("../frontend/src/scripts/submissions");
  await vi.waitFor(() =>
    expect(byId("account-submissions").textContent).toContain("maker.tool@1.0.0"),
  );
}
it("clears stale data and restores focus after failed refresh", async () => {
  await start();
  api.request.mockRejectedValueOnce(new Error("Unavailable"));
  byId("submissions-refresh").focus();
  byId("submissions-refresh").click();
  await vi.waitFor(() => expect(byId("submissions-count").textContent).toBe("Unavailable"));
  expect(byId("account-submissions").textContent).toBe("");
  expect(document.activeElement?.id).toBe("submissions-refresh");
});
it("rejects malformed lists without rendering partial results", async () => {
  await start();
  api.request.mockResolvedValueOnce({ submissions: [entry, { ...entry, digest: "bad" }] });
  byId("submissions-refresh").click();
  await vi.waitFor(() =>
    expect(byId("submissions-count").textContent).toContain("invalid submission list"),
  );
  expect(byId("account-submissions").textContent).toBe("");
});
it("clears protected content and focuses reconnect after expiry", async () => {
  await start();
  api.request.mockRejectedValueOnce(
    new RegistryRequestError(401, "AUTHENTICATION_REQUIRED", "Sign in again"),
  );
  byId("submissions-refresh").focus();
  byId("submissions-refresh").click();
  await vi.waitFor(() => expect(byId("account-content").hidden).toBe(true));
  expect(byId("account-signin").hidden).toBe(false);
  expect(document.activeElement?.id).toBe("account-signin-link");
});
it("aborts page exit and ignores its late response after cache restoration", async () => {
  await start();
  let finish!: (value: unknown) => void;
  api.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  byId("submissions-refresh").click();
  const signal = api.request.mock.calls.at(-1)![3] as AbortSignal;
  window.dispatchEvent(new Event("pagehide"));
  expect(signal.aborted).toBe(true);
  expect(byId("account-submissions").textContent).toBe("");
  api.request.mockResolvedValueOnce({ submissions: [{ ...entry, version: "2.0.0" }] });
  const show = new Event("pageshow");
  Object.defineProperty(show, "persisted", { value: true });
  window.dispatchEvent(show);
  await vi.waitFor(() => expect(byId("account-submissions").textContent).toContain("2.0.0"));
  finish({ submissions: [entry] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(byId("account-submissions").textContent).not.toContain("1.0.0");
});
it("serializes refresh and preserves deliberate navigation focus", async () => {
  await start();
  let finish!: (value: unknown) => void;
  api.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  byId("submissions-refresh").focus();
  byId("submissions-refresh").click();
  byId("submissions-refresh").dispatchEvent(new Event("click"));
  expect(api.request).toHaveBeenCalledTimes(2);
  byId("other").focus();
  finish({ submissions: [] });
  await vi.waitFor(() =>
    expect(byId("submissions-count").textContent).toContain("No submissions yet"),
  );
  expect(document.activeElement?.id).toBe("other");
});
