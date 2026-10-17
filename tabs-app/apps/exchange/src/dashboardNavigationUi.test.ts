import { Window } from "happy-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../frontend/src/scripts/api", () => ({ request: transport.request }));
let dom: Window;
beforeEach(() => {
  vi.resetModules();
  transport.request.mockReset();
  dom = new Window({ url: "http://localhost:8787/account" });
  for (const key of [
    "window",
    "document",
    "location",
    "Node",
    "Element",
    "Event",
    "KeyboardEvent",
    "AbortController",
  ] as const)
    vi.stubGlobal(key, key === "window" ? dom : dom[key]);
  document.body.innerHTML = `<a id="account-link"></a><a id="reviewer-link" hidden></a><a id="operator-link" hidden></a><button id="dashboard-signout" hidden>Sign out</button><p id="dashboard-session-status"></p><div id="account-content"></div><details data-header-workspace><summary>Your workspace</summary><a href="/account">Account</a></details><button id="outside">Outside</button>`;
});
afterEach(async () => {
  window.dispatchEvent(new Event("pagehide"));
  await dom.happyDOM.close();
  vi.unstubAllGlobals();
});
const element = (id: string) => document.getElementById(id)!;

it("keeps privileged navigation hidden until identity is valid and clears cached permissions on pagehide", async () => {
  transport.request.mockResolvedValue({ login: "owner", admin: true, operator: true });
  await import("../frontend/src/scripts/account");
  await vi.waitFor(() => expect(element("operator-link").hidden).toBe(false));
  expect(element("dashboard-signout").hidden).toBe(false);
  window.dispatchEvent(new Event("pagehide"));
  expect(element("operator-link").hidden).toBe(true);
  expect(element("reviewer-link").hidden).toBe(true);
  expect(element("dashboard-signout").hidden).toBe(true);
  transport.request.mockResolvedValue(null);
  const restored = new Event("pageshow");
  Object.defineProperty(restored, "persisted", { value: true });
  window.dispatchEvent(restored);
  await vi.waitFor(() => expect(element("account-link").textContent).toBe("Sign in with GitHub"));
  expect(element("operator-link").hidden).toBe(true);
});

it("keeps content available and offers retry when sign-out fails", async () => {
  transport.request.mockImplementation(async (path: string) => {
    if (path === "/v1/me") return { login: "publisher" };
    throw new Error("Connection unavailable. Try again.");
  });
  await import("../frontend/src/scripts/account");
  await vi.waitFor(() => expect(element("dashboard-signout").hidden).toBe(false));
  element("dashboard-signout").click();
  await vi.waitFor(() =>
    expect(element("dashboard-session-status").textContent).toContain("Try again"),
  );
  expect((element("dashboard-signout") as HTMLButtonElement).disabled).toBe(false);
  expect(element("account-content").hidden).toBe(false);
  expect(transport.request).toHaveBeenCalledWith("/v1/logout", "POST", {});
});

it("closes the workspace disclosure with Escape and restores keyboard focus, including after cached navigation", async () => {
  await import("../frontend/src/scripts/header-workspace");
  const menu = document.querySelector("details")!;
  menu.open = true;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  expect(menu.open).toBe(false);
  expect(document.activeElement).toBe(menu.querySelector("summary"));
  menu.open = true;
  window.dispatchEvent(new Event("pagehide"));
  expect(menu.open).toBe(false);
  menu.open = true;
  element("outside").click();
  expect(menu.open).toBe(false);
});

it("opens a mobile navigation dialog, restores focus on Escape, and restores the sidebar on wider screens", async () => {
  document.body.innerHTML = `<header><button id="dashboard-menu-toggle">Open workspace navigation</button></header><aside id="dashboard-sidebar"><button id="dashboard-menu-close">Close</button><nav><a href="/publish">Publish</a></nav></aside><div class="dashboard-content"></div>`;
  document.body.dataset.dashboard = "true";
  const media = new dom.EventTarget();
  Object.assign(media, { matches: true });
  vi.spyOn(window, "matchMedia").mockReturnValue(media as unknown as MediaQueryList);
  await import("../frontend/src/scripts/dashboard-navigation");
  const menu = element("dashboard-sidebar");
  expect(menu.hidden).toBe(true);
  expect(menu.querySelector("a")?.getAttribute("href")).toBe("/publish");
  element("dashboard-menu-toggle").click();
  expect(menu.hidden).toBe(false);
  expect(menu.getAttribute("aria-modal")).toBe("true");
  expect(document.querySelector<HTMLElement>(".dashboard-content")!.inert).toBe(true);
  expect(document.activeElement).toBe(element("dashboard-menu-close"));
  for (const control of menu.querySelectorAll<HTMLElement>("a,button"))
    control.getClientRects = () => [{ width: 44, height: 44 }] as unknown as DOMRectList;
  const link = menu.querySelector<HTMLElement>("a")!;
  link.focus();
  link.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(element("dashboard-menu-close"));
  element("dashboard-menu-close").dispatchEvent(
    new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }),
  );
  expect(document.activeElement).toBe(link);
  menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  expect(menu.hidden).toBe(true);
  expect(document.activeElement).toBe(element("dashboard-menu-toggle"));
  expect(document.querySelector<HTMLElement>(".dashboard-content")!.inert).toBe(false);
  Object.assign(media, { matches: false });
  media.dispatchEvent(new dom.Event("change"));
  expect(menu.hidden).toBe(false);
  expect(menu.hasAttribute("aria-modal")).toBe(false);
});

it("clears account UI after successful sign-out", async () => {
  const navigate = vi.spyOn(location, "assign").mockImplementation(() => {});
  transport.request.mockImplementation(async (path: string) =>
    path === "/v1/me" ? { login: "owner", admin: true, operator: true } : undefined,
  );
  await import("../frontend/src/scripts/account");
  await vi.waitFor(() => expect(element("operator-link").hidden).toBe(false));
  element("dashboard-signout").click();
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
  expect(element("account-content").hidden).toBe(true);
  expect(element("dashboard-signout").hidden).toBe(true);
  expect(element("operator-link").hidden).toBe(true);
  expect(element("reviewer-link").hidden).toBe(true);
  expect(element("account-link").textContent).toBe("Sign in with GitHub");
});

it("treats an expired session as signed out", async () => {
  const navigate = vi.spyOn(location, "assign").mockImplementation(() => {});
  transport.request.mockImplementation(async (path: string) => {
    if (path === "/v1/me") return { login: "publisher" };
    throw Object.assign(new Error("Session expired"), { status: 401 });
  });
  await import("../frontend/src/scripts/account");
  await vi.waitFor(() => expect(element("dashboard-signout").hidden).toBe(false));
  element("dashboard-signout").click();
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
  expect(element("account-content").hidden).toBe(true);
});

it("keeps verification failures visible and never claims sign-out succeeded", async () => {
  const navigate = vi.spyOn(location, "assign").mockImplementation(() => {});
  transport.request.mockImplementation(async (path: string) => {
    if (path === "/v1/me") return { login: "publisher" };
    throw Object.assign(new Error("CSRF verification failed"), { status: 403 });
  });
  await import("../frontend/src/scripts/account");
  await vi.waitFor(() => expect(element("dashboard-signout").hidden).toBe(false));
  element("dashboard-signout").click();
  await vi.waitFor(() =>
    expect(element("dashboard-session-status").textContent).toContain("Reload this page"),
  );
  expect(navigate).not.toHaveBeenCalled();
  expect(element("account-content").hidden).toBe(false);
  expect((element("dashboard-signout") as HTMLButtonElement).disabled).toBe(false);
});
