// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../frontend/src/scripts/api", async (original) => ({
  ...(await original<typeof import("../frontend/src/scripts/api")>()),
  request: api.request,
}));
import { RegistryRequestError } from "../frontend/src/scripts/api";
let windowListeners: Array<[string, EventListenerOrEventListenerObject]> = [];
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
beforeEach(() => {
  windowListeners = [];
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation((type, callback, options) => {
    if (callback) windowListeners.push([type, callback as EventListenerOrEventListenerObject]);
    add(type, callback, options);
  });
  vi.resetModules();
  api.request.mockReset();
  document.body.innerHTML = `<p id="account-status"></p><section id="account-signin" hidden><a id="account-signin-link">Sign in</a></section><div id="account-content" hidden><ul id="account-namespaces"></ul><form id="create-namespace"><input id="new-namespace" required pattern="[a-z][a-z0-9-]{1,62}" disabled value="maker"><input id="accept-terms" type="checkbox" required disabled><button type="submit" disabled>Create</button></form></div>`;
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  for (const [type, callback] of windowListeners) window.removeEventListener(type, callback);
  vi.restoreAllMocks();
});
async function start(enabled = true) {
  api.request
    .mockResolvedValueOnce({ login: "maker", publishingEnabled: enabled, termsVersion: "test" })
    .mockResolvedValueOnce({ namespaces: [] });
  await import("../frontend/src/scripts/account-pages");
  await vi.waitFor(() => expect(byId("account-status").textContent).toBe("Account loaded."));
}
function submit() {
  byId("create-namespace").dispatchEvent(new Event("submit", { cancelable: true }));
}
it("never creates a namespace while publishing is disabled", async () => {
  await start(false);
  byId<HTMLInputElement>("accept-terms").checked = true;
  submit();
  expect(api.request).toHaveBeenCalledTimes(2);
  expect(byId<HTMLInputElement>("new-namespace").disabled).toBe(true);
});
it("requires explicit agreement and a valid namespace", async () => {
  await start();
  submit();
  byId<HTMLInputElement>("accept-terms").checked = true;
  byId<HTMLInputElement>("new-namespace").value = "../bad";
  submit();
  expect(api.request).toHaveBeenCalledTimes(2);
});
it("sends one immutable request and locks fields until refresh finishes", async () => {
  await start();
  let finish!: () => void;
  api.request
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ namespaces: [{ name: "maker", role: "owner", verified: false }] });
  byId<HTMLInputElement>("accept-terms").checked = true;
  submit();
  submit();
  expect(api.request).toHaveBeenCalledTimes(3);
  expect(api.request).toHaveBeenLastCalledWith(
    "/v1/namespaces",
    "POST",
    {
      name: "maker",
      acceptTermsVersion: "test",
    },
    expect.any(AbortSignal),
  );
  expect(byId<HTMLInputElement>("new-namespace").disabled).toBe(true);
  finish();
  await vi.waitFor(() => expect(byId("account-status").textContent).toContain("Namespace created"));
  expect(byId<HTMLInputElement>("new-namespace").disabled).toBe(false);
  expect(byId("account-namespaces").textContent).toContain("maker · owner");
});
it("conceals account controls and focuses reconnect after session expiry", async () => {
  await start();
  api.request.mockRejectedValueOnce(
    new RegistryRequestError(401, "AUTHENTICATION_REQUIRED", "Sign in again"),
  );
  byId<HTMLInputElement>("accept-terms").checked = true;
  submit();
  await vi.waitFor(() => expect(byId("account-content").hidden).toBe(true));
  expect(byId("account-signin").hidden).toBe(false);
  expect(document.activeElement?.id).toBe("account-signin-link");
  submit();
  expect(api.request).toHaveBeenCalledTimes(3);
});

it("recovers interrupted creation through GETs without sending a second POST", async () => {
  await start();
  api.request.mockRejectedValueOnce(new Error("Network interrupted"));
  byId<HTMLInputElement>("accept-terms").checked = true;
  submit();
  await vi.waitFor(() =>
    expect(byId("account-status").textContent).toContain("Network interrupted"),
  );
  expect(byId<HTMLInputElement>("new-namespace").disabled).toBe(true);
  const recovery = byId("create-namespace").querySelector<HTMLButtonElement>("button.secondary")!;
  expect(recovery.hidden).toBe(false);
  expect(recovery.disabled).toBe(false);
  submit();
  expect(api.request).toHaveBeenCalledTimes(3);
  api.request
    .mockResolvedValueOnce({ login: "maker", publishingEnabled: true, termsVersion: "test" })
    .mockResolvedValueOnce({ namespaces: [{ name: "maker", role: "owner", verified: false }] });
  recovery.click();
  await vi.waitFor(() =>
    expect(byId("account-status").textContent).toContain("No second creation"),
  );
  expect(api.request.mock.calls.filter((call) => call[1] === "POST")).toHaveLength(1);
  expect(byId<HTMLInputElement>("new-namespace").disabled).toBe(false);
  expect(recovery.hidden).toBe(true);
});
it("keeps uncertain creation locked on malformed recovery evidence", async () => {
  await start();
  api.request.mockRejectedValueOnce(new Error("Interrupted"));
  byId<HTMLInputElement>("accept-terms").checked = true;
  submit();
  await vi.waitFor(() => expect(byId("account-status").textContent).toContain("Interrupted"));
  api.request
    .mockResolvedValueOnce({ login: "maker", publishingEnabled: true, termsVersion: "test" })
    .mockResolvedValueOnce({ namespaces: [{ name: "../bad", role: "owner", verified: false }] });
  byId("create-namespace").querySelector<HTMLButtonElement>("button.secondary")!.click();
  await vi.waitFor(() => expect(byId("account-status").textContent).toContain("invalid"));
  expect(byId<HTMLInputElement>("new-namespace").disabled).toBe(true);
});
it("discards late create completion after pagehide and rechecks on restored pages", async () => {
  await start();
  let resolve!: () => void;
  api.request.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  byId<HTMLInputElement>("accept-terms").checked = true;
  submit();
  const signal = api.request.mock.calls[2]![3] as AbortSignal;
  window.dispatchEvent(new Event("pagehide"));
  expect(signal.aborted).toBe(true);
  resolve();
  await Promise.resolve();
  expect(byId("account-content").hidden).toBe(true);
  expect(api.request).toHaveBeenCalledTimes(3);
  api.request
    .mockResolvedValueOnce({ login: "maker", publishingEnabled: true, termsVersion: "test" })
    .mockResolvedValueOnce({ namespaces: [] });
  const show = new Event("pageshow");
  Object.defineProperty(show, "persisted", { value: true });
  window.dispatchEvent(show);
  await vi.waitFor(() => expect(byId("account-status").textContent).toContain("previous creation"));
  expect(byId<HTMLInputElement>("new-namespace").disabled).toBe(true);
  expect(api.request).toHaveBeenCalledTimes(5);
});
it("conceals controls when namespace reads expire before initialization completes", async () => {
  api.request
    .mockResolvedValueOnce({ login: "maker", publishingEnabled: true, termsVersion: "test" })
    .mockRejectedValueOnce(new RegistryRequestError(403, "FORBIDDEN", "Access changed"));
  await import("../frontend/src/scripts/account-pages");
  await vi.waitFor(() => expect(byId("account-status").textContent).toBe("Access changed"));
  expect(byId("account-content").hidden).toBe(true);
  expect(byId<HTMLInputElement>("new-namespace").disabled).toBe(true);
  expect(byId("account-namespaces").textContent).toBe("");
});

it("does not reveal an account after its initial response arrives on a departed page", async () => {
  let resolve!: (value: unknown) => void;
  api.request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await import("../frontend/src/scripts/account-pages");
  const signal = api.request.mock.calls[0]![3] as AbortSignal;
  window.dispatchEvent(new Event("pagehide"));
  resolve({ login: "maker", publishingEnabled: true, termsVersion: "test" });
  await Promise.resolve();
  expect(signal.aborted).toBe(true);
  expect(byId("account-content").hidden).toBe(true);
  expect(api.request).toHaveBeenCalledTimes(1);
});
it("rejects malformed account capability data before exposing controls", async () => {
  api.request.mockResolvedValueOnce({
    login: "maker",
    publishingEnabled: "true",
    termsVersion: "test",
  });
  await import("../frontend/src/scripts/account-pages");
  await vi.waitFor(() =>
    expect(byId("account-status").textContent).toContain("Account information is invalid"),
  );
  expect(byId("account-content").hidden).toBe(true);
  expect(byId<HTMLInputElement>("new-namespace").disabled).toBe(true);
  expect(api.request).toHaveBeenCalledTimes(1);
});
