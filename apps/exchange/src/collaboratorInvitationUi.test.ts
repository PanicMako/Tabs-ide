// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../frontend/src/scripts/api", async (original) => ({
  ...(await original<typeof import("../frontend/src/scripts/api")>()),
  request: api.request,
}));
import { RegistryRequestError } from "../frontend/src/scripts/api";
const actor = { login: "maker", publishingEnabled: true };
const namespaces = { namespaces: [{ name: "maker", role: "owner" }] };
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const send = () =>
  document.querySelector<HTMLButtonElement>('#namespace-collaborators button[type="submit"]')!;
const refresh = () =>
  document.querySelector<HTMLButtonElement>('#namespace-collaborators button[type="button"]')!;
const status = () =>
  document.querySelector<HTMLElement>('#namespace-collaborators [role="status"]')!;
function submit() {
  document
    .querySelector("#namespace-collaborators form")!
    .dispatchEvent(new Event("submit", { cancelable: true }));
}
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
    '<p id="account-status"></p><section id="account-signin" hidden><a id="account-signin-link">Reconnect</a></section><div id="account-content"><div id="namespace-collaborators"></div></div>';
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  detachListeners();
  vi.restoreAllMocks();
});
async function start(enabled = true) {
  api.request
    .mockResolvedValueOnce({ ...actor, publishingEnabled: enabled })
    .mockResolvedValueOnce(namespaces);
  await import("../frontend/src/scripts/collaborators");
  await vi.waitFor(() => expect(send()).not.toBeNull());
}
it("does not send when publishing is disabled or the GitHub username is invalid", async () => {
  await start(false);
  byId<HTMLInputElement>("invite-login").value = "friend";
  submit();
  expect(api.request).toHaveBeenCalledTimes(2);
  expect(byId<HTMLInputElement>("invite-login").disabled).toBe(true);
});
it("requires valid fields before sending", async () => {
  await start();
  byId<HTMLInputElement>("invite-login").value = "../friend";
  submit();
  expect(api.request).toHaveBeenCalledTimes(2);
  expect(status().textContent).toContain("Enter a valid GitHub username");
  expect(byId("invite-login").getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement?.id).toBe("invite-login");
});
it("locks every submitted value, serializes sends, and announces the captured recipient", async () => {
  await start();
  let finish!: () => void;
  api.request.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  byId<HTMLInputElement>("invite-login").value = "friend";
  send().focus();
  submit();
  submit();
  expect(api.request).toHaveBeenCalledTimes(3);
  expect(api.request).toHaveBeenLastCalledWith(
    "/v1/namespaces/maker/members",
    "POST",
    { githubLogin: "friend", role: "contributor" },
    expect.any(AbortSignal),
  );
  for (const control of document.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLButtonElement
  >("form input, form select, form button"))
    expect(control.disabled).toBe(true);
  byId<HTMLInputElement>("invite-login").value = "other";
  finish();
  await vi.waitFor(() =>
    expect(status().textContent).toContain("Invitation sent to friend as contributor in maker"),
  );
  expect(send().disabled).toBe(false);
  expect(document.activeElement?.id).toBe("invite-login");
});
it("requires fresh ownership and pending history after an uncertain send, without retrying the mutation", async () => {
  await start();
  api.request.mockRejectedValueOnce(new Error("connection lost"));
  byId<HTMLInputElement>("invite-login").value = "friend";
  submit();
  await vi.waitFor(() => expect(refresh().hidden).toBe(false));
  expect(send().disabled).toBe(true);
  submit();
  expect(api.request).toHaveBeenCalledTimes(3);
  api.request
    .mockResolvedValueOnce(actor)
    .mockResolvedValueOnce(namespaces)
    .mockResolvedValueOnce({ members: [], invitations: [{ login: "Friend" }] });
  refresh().focus();
  refresh().click();
  refresh().click();
  await vi.waitFor(() => expect(status().textContent).toContain("No second invitation was sent"));
  expect(api.request.mock.calls.filter((call) => call[1] === "POST")).toHaveLength(1);
  expect(byId<HTMLInputElement>("invite-login").value).toBe("");
  expect(send().disabled).toBe(false);
});
it("keeps fields locked if ownership is lost or history cannot be verified", async () => {
  await start();
  api.request.mockRejectedValueOnce(new Error("uncertain"));
  byId<HTMLInputElement>("invite-login").value = "friend";
  submit();
  await vi.waitFor(() => expect(refresh().hidden).toBe(false));
  api.request.mockResolvedValueOnce(actor).mockResolvedValueOnce({ namespaces: [] });
  refresh().click();
  await vi.waitFor(() => expect(status().textContent).toContain("must still own this namespace"));
  expect(send().disabled).toBe(true);
  api.request
    .mockResolvedValueOnce(actor)
    .mockResolvedValueOnce(namespaces)
    .mockResolvedValueOnce({ members: null, invitations: [] });
  refresh().click();
  await vi.waitFor(() => expect(status().textContent).toContain("could not be verified"));
  expect(send().disabled).toBe(true);
});
it("conceals protected controls and restores reconnect focus after expired access", async () => {
  await start();
  api.request.mockRejectedValueOnce(
    new RegistryRequestError(401, "AUTHENTICATION_REQUIRED", "Sign in"),
  );
  byId<HTMLInputElement>("invite-login").value = "friend";
  send().focus();
  submit();
  await vi.waitFor(() => expect(byId("account-content").hidden).toBe(true));
  expect(byId("account-signin").hidden).toBe(false);
  expect(document.activeElement?.id).toBe("account-signin-link");
});
it("discards late page-exit completions and remounts with fresh access after BFCache restoration", async () => {
  await start();
  let finish!: () => void;
  api.request.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  byId<HTMLInputElement>("invite-login").value = "friend";
  submit();
  window.dispatchEvent(new Event("pagehide"));
  finish();
  await Promise.resolve();
  expect(document.querySelector("#invite-login")).toBeNull();
  api.request.mockResolvedValueOnce(actor).mockResolvedValueOnce(namespaces);
  const show = new Event("pageshow");
  Object.defineProperty(show, "persisted", { value: true });
  window.dispatchEvent(show);
  await vi.waitFor(() => expect(byId("invite-login")).not.toBeNull());
  expect(status().textContent).not.toContain("Invitation sent");
});

it("allows team setup when namespace management is enabled but uploads are closed", async () => {
  api.request
    .mockResolvedValueOnce({ ...actor, publishingEnabled: false, namespaceManagementEnabled: true })
    .mockResolvedValueOnce(namespaces);
  await import("../frontend/src/scripts/collaborators");
  await vi.waitFor(() => expect(send()).not.toBeNull());
  expect(byId<HTMLInputElement>("invite-login").disabled).toBe(false);
  expect(document.querySelector<HTMLFormElement>("#namespace-collaborators form")!.hidden).toBe(
    false,
  );
});

it("unlocks invitations immediately after the first namespace is created", async () => {
  api.request
    .mockResolvedValueOnce({ ...actor, publishingEnabled: false, namespaceManagementEnabled: true })
    .mockResolvedValueOnce({ namespaces: [] });
  await import("../frontend/src/scripts/collaborators");
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLFormElement>("#namespace-collaborators form")?.hidden).toBe(
      true,
    ),
  );
  api.request
    .mockResolvedValueOnce({ ...actor, publishingEnabled: false, namespaceManagementEnabled: true })
    .mockResolvedValueOnce(namespaces);
  window.dispatchEvent(new Event("exchange:namespaces-changed"));
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLFormElement>("#namespace-collaborators form")?.hidden).toBe(
      false,
    ),
  );
  expect(byId<HTMLSelectElement>("invite-namespace").value).toBe("maker");
});
