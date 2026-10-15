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
vi.mock("../frontend/src/scripts/review-history", () => ({
  clearReviewHistory: vi.fn(),
  showReviewHistory: vi.fn(),
}));
vi.mock("../frontend/src/scripts/review-operations", () => ({
  clearOperationsDetail: vi.fn(),
  showOperationsDetail: () => "Healthy",
}));
vi.mock("../frontend/src/scripts/review-appeals", () => ({
  clearReviewAppeals: vi.fn(),
  showReviewAppeals: vi.fn(),
}));
beforeEach(() => {
  vi.resetModules();
  transport.request.mockReset();
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../frontend/src/pages/admin/index.astro"),
    "utf8",
  );
  document.body.innerHTML = /<Operations[^>]*>([\s\S]*?)<\/Operations>/.exec(source)![1]!;
  transport.request.mockImplementation(async (path: string) => {
    if (path === "/v1/me") return { login: "reviewer", admin: true };
    if (path.endsWith("/queue")) return { submissions: [] };
    if (path.endsWith("/approved")) return { versions: [] };
    return {};
  });
});
afterEach(() => window.dispatchEvent(new Event("pagehide")));
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
async function ready() {
  await import("../frontend/src/scripts/review");
  await vi.waitFor(() => expect(byId("review-content").hidden).toBe(false));
}
function refresh() {
  const button = byId<HTMLButtonElement>("review-refresh");
  button.focus();
  button.click();
  button.blur();
}
it("returns focus to queue refresh after loading without making a decision", async () => {
  await ready();
  refresh();
  await vi.waitFor(() => expect(document.activeElement).toBe(byId("review-refresh")));
  expect(transport.request.mock.calls.every(([, method]) => method !== "POST")).toBe(true);
});
it("focuses reconnect when refreshing receives an unauthorized response", async () => {
  await ready();
  const { RegistryRequestError } = await import("../frontend/src/scripts/api");
  transport.request.mockRejectedValueOnce(
    new RegistryRequestError(401, "UNAUTHORIZED", "Sign in again"),
  );
  refresh();
  await vi.waitFor(() => expect(document.activeElement).toBe(byId("review-signin")));
  expect(byId("review-content").hidden).toBe(true);
});
it("focuses the explanation when the account has lost reviewer access", async () => {
  await ready();
  transport.request.mockResolvedValueOnce({ login: "publisher", admin: false });
  refresh();
  await vi.waitFor(() => expect(document.activeElement).toBe(byId("review-status")));
  expect(byId("review-content").hidden).toBe(true);
  expect(byId("review-signin").hidden).toBe(true);
});
it("respects a deliberate focus move while the queue reloads", async () => {
  await ready();
  let complete!: (value: unknown) => void;
  transport.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  refresh();
  const other = document.createElement("button");
  document.body.append(other);
  other.focus();
  complete({ login: "reviewer", admin: true });
  await vi.waitFor(() => expect(byId("review-content").hidden).toBe(false));
  expect(document.activeElement).toBe(other);
});

it("nests pending and approved release headings under the package desk, with deeper evidence headings", async () => {
  const entry = {
    namespace: "publisher",
    name: "workspace-note",
    version: "1.0.0",
    digest: "a".repeat(64),
    status: "review",
    manifest: null,
    scan_result: null,
  };
  transport.request.mockImplementation(async (path: string) => {
    if (path === "/v1/me") return { login: "reviewer", admin: true };
    if (path.endsWith("/queue")) return { submissions: [entry] };
    if (path.endsWith("/approved")) return { versions: [{ ...entry, version: "1.0.1" }] };
    return {};
  });
  await ready();
  expect(byId("review-inbox-title").tagName).toBe("H2");
  const items = byId("review-items");
  expect([...items.querySelectorAll(":scope > li > h3")].map((node) => node.textContent)).toEqual([
    "publisher.workspace-note@1.0.0",
    "publisher.workspace-note@1.0.1",
  ]);
  expect(items.querySelector("h1, h2")).toBeNull();
  expect(items.querySelectorAll(":scope > li > .package-inspection > section > h4")).toHaveLength(
    2,
  );
  expect(items.querySelector("section h3")).toBeNull();
  expect(items.querySelectorAll("form")).toHaveLength(2);
  const inspections = [...items.querySelectorAll<HTMLDetailsElement>(".package-inspection")];
  expect(inspections.map((section) => section.open)).toEqual([false, false]);
  expect(inspections.map((section) => section.querySelector("summary")?.textContent)).toEqual([
    "Inspect evidence & decide",
    "Release controls",
  ]);
});
