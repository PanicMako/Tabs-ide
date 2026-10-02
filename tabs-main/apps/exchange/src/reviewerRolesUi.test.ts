import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../frontend/src/scripts/api", () => ({
  request: transport.request,
  RegistryRequestError: class extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
let dom: Window;
beforeEach(() => {
  vi.resetModules();
  transport.request.mockReset();
  dom = new Window();
  for (const name of ["document", "window", "AbortController", "Event", "KeyboardEvent"] as const)
    vi.stubGlobal(name, name === "window" ? dom : dom[name]);
  const page = readFileSync(
    new URL("../frontend/src/pages/admin/reviewers.astro", import.meta.url),
    "utf8",
  );
  document.body.innerHTML = /<Exchange[^>]*>([\s\S]*?)<\/Exchange>/.exec(page)![1]!;
});
afterEach(async () => {
  window.dispatchEvent(new Event("pagehide"));
  await dom.happyDOM.close();
  vi.unstubAllGlobals();
});
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
async function operator() {
  transport.request.mockImplementation(async (path: string) =>
    path === "/v1/me"
      ? { login: "operator", operator: true, admin: true }
      : { reviewers: [], events: [] },
  );
  await import("../frontend/src/scripts/reviewer-roles");
  await vi.waitFor(() => expect(byId("roles-content").hidden).toBe(false));
}
function prepare() {
  byId<HTMLInputElement>("roles-login").value = "reviewer";
  byId<HTMLTextAreaElement>("roles-reason").value = "Trusted reviewer";
  byId("roles-form").dispatchEvent(new Event("submit", { cancelable: true }));
}
it("does not load assignments for a reviewer without operator access", async () => {
  transport.request.mockResolvedValue({ login: "reviewer", admin: true, operator: false });
  await import("../frontend/src/scripts/reviewer-roles");
  await vi.waitFor(() => expect(byId("roles-status").textContent).toContain("operator account"));
  expect(byId("roles-content").hidden).toBe(true);
  expect(transport.request).toHaveBeenCalledTimes(1);
});
it("requires confirmation and restores focus when Escape cancels", async () => {
  await operator();
  prepare();
  expect(byId("roles-confirmation").hidden).toBe(false);
  expect(document.activeElement).toBe(byId("roles-confirmation"));
  byId("roles-confirmation").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(byId("roles-confirmation").hidden).toBe(true);
  expect(document.activeElement).toBe(byId("roles-prepare"));
  expect(transport.request.mock.calls.every(([, method]) => method !== "POST")).toBe(true);
});
it("offers reconnect when access expires during initial loading", async () => {
  const { RegistryRequestError } = await import("../frontend/src/scripts/api");
  transport.request.mockRejectedValue(
    new RegistryRequestError(401, "UNAUTHORIZED", "Sign in again"),
  );
  await import("../frontend/src/scripts/reviewer-roles");
  await vi.waitFor(() => expect(byId("roles-signin").hidden).toBe(false));
  expect(byId("roles-content").hidden).toBe(true);
});
it("submits the confirmed change once and renders audit text without HTML execution", async () => {
  await operator();
  prepare();
  transport.request.mockResolvedValueOnce({ changed: true }).mockResolvedValueOnce({
    reviewers: [
      {
        login: "reviewer",
        active: true,
        reason: "<script>unsafe</script>",
        changed_by: "operator",
        changed_at: "2026-10-03",
      },
    ],
    events: [],
  });
  byId<HTMLButtonElement>("roles-confirm").click();
  await vi.waitFor(() =>
    expect(byId("roles-status").textContent).toContain("Access change recorded"),
  );
  const writes = transport.request.mock.calls.filter(([, method]) => method === "POST");
  expect(writes).toHaveLength(1);
  expect(writes[0]![2]).toEqual({ login: "reviewer", action: "grant", reason: "Trusted reviewer" });
  expect(byId("roles-assignments").textContent).toContain("<script>unsafe</script>");
  expect(document.querySelector("script")).toBeNull();
  expect(document.activeElement).toBe(byId("roles-prepare"));
});
it("removes the privileged view and focuses reconnect after access is revoked", async () => {
  await operator();
  prepare();
  const { RegistryRequestError } = await import("../frontend/src/scripts/api");
  transport.request.mockRejectedValueOnce(
    new RegistryRequestError(403, "FORBIDDEN", "Access removed"),
  );
  byId<HTMLButtonElement>("roles-confirm").click();
  await vi.waitFor(() => expect(byId("roles-content").hidden).toBe(true));
  expect(byId("roles-signin").hidden).toBe(false);
  expect(document.activeElement).toBe(byId("roles-signin"));
  expect(byId("roles-status").textContent).toContain("removed");
});
