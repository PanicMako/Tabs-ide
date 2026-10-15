// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../frontend/src/scripts/api", () => ({
  request: transport.request,
  RegistryRequestError: class extends Error {
    constructor(readonly status: number) {
      super("Access expired");
    }
  },
}));
beforeEach(() => {
  vi.resetModules();
  transport.request.mockReset();
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../frontend/src/pages/admin/security.astro"),
    "utf8",
  );
  document.body.innerHTML = /<Operations[^>]*>([\s\S]*?)<\/Operations>/.exec(source)![1]!;
  transport.request.mockImplementation(async (path: string) =>
    path === "/v1/me" ? { admin: true, login: "reviewer" } : { blockedDigests: [] },
  );
});
afterEach(() => window.dispatchEvent(new Event("pagehide")));
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
async function ready() {
  await import("../frontend/src/scripts/review-security");
  await vi.waitFor(() => expect(byId("security-content").hidden).toBe(false));
}
function refresh() {
  const button = byId<HTMLButtonElement>("security-refresh");
  button.focus();
  button.click();
  button.blur();
}
function prepareBlock() {
  byId<HTMLInputElement>("security-digest").value = "a".repeat(64);
  byId<HTMLTextAreaElement>("security-block-reason").value = "Controlled test only";
  byId("security-block").dispatchEvent(new Event("submit", { cancelable: true }));
}
it("restores focus after refreshing security evidence without making a change", async () => {
  await ready();
  refresh();
  await vi.waitFor(() => expect(document.activeElement).toBe(byId("security-refresh")));
  expect(transport.request.mock.calls.every(([, method]) => method !== "POST")).toBe(true);
});
it("focuses reconnect when refresh discovers expired access", async () => {
  await ready();
  const { RegistryRequestError } = await import("../frontend/src/scripts/api");
  transport.request.mockRejectedValueOnce(
    new RegistryRequestError(401, "UNAUTHORIZED", "Sign in again"),
  );
  refresh();
  await vi.waitFor(() => expect(document.activeElement).toBe(byId("security-signin")));
});
it("focuses the explanation when the account has no reviewer privileges", async () => {
  await ready();
  transport.request.mockResolvedValueOnce({ login: "publisher", admin: false });
  refresh();
  await vi.waitFor(() => expect(document.activeElement).toBe(byId("security-status")));
  expect(byId("security-content").hidden).toBe(true);
});
it("aborts a pending action on navigation, reloads restored evidence, and ignores its late completion", async () => {
  await ready();
  let complete!: (value: unknown) => void;
  transport.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  prepareBlock();
  const write = transport.request.mock.calls.find(([, method]) => method === "POST")!;
  const signal = write[3] as AbortSignal;
  expect(signal.aborted).toBe(false);
  window.dispatchEvent(new Event("pagehide"));
  expect(signal.aborted).toBe(true);
  const restored = new Event("pageshow");
  Object.defineProperty(restored, "persisted", { value: true });
  window.dispatchEvent(restored);
  await vi.waitFor(() => expect(byId("security-content").hidden).toBe(false));
  expect(byId("security-status").textContent).toContain("may have been accepted");
  const other = document.createElement("button");
  document.body.append(other);
  other.focus();
  complete({});
  await Promise.resolve();
  await Promise.resolve();
  expect(document.activeElement).toBe(other);
  expect(byId<HTMLFieldSetElement>("security-block").querySelector("fieldset")!.disabled).toBe(
    false,
  );
  expect(byId("security-block").querySelector("[data-result]")!.textContent).toBe("");
  expect(transport.request.mock.calls.filter(([, method]) => method === "POST")).toHaveLength(1);
});
it("does not steal a deliberate focus move after an action finishes", async () => {
  await ready();
  let complete!: (value: unknown) => void;
  transport.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  prepareBlock();
  const other = document.createElement("button");
  document.body.append(other);
  other.focus();
  complete({});
  await vi.waitFor(() => expect(byId("security-block").textContent).toContain("Digest blocked"));
  expect(document.activeElement).toBe(other);
});
