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
  const scope = byId<HTMLSelectElement>("review-scope");
  scope.value = "all";
  scope.dispatchEvent(new Event("change"));
  const choices = [...items.querySelectorAll<HTMLButtonElement>(".review-package-choice")];
  expect(choices).toHaveLength(2);
  expect(document.querySelectorAll(".review-package-detail")).toHaveLength(0);
  choices[0]!.click();
  const pending = document.querySelector<HTMLElement>(".review-package-detail")!;
  expect(pending.querySelector("h3")?.textContent).toBe("publisher.workspace-note@1.0.0");
  expect(document.activeElement).toBe(pending.querySelector("h3"));
  const reason = pending.querySelector<HTMLTextAreaElement>("textarea[id^=review-reason]")!;
  reason.value = "My unfinished decision notes";
  choices[1]!.click();
  expect(pending.hidden).toBe(true);
  expect(choices[0]!.getAttribute("aria-pressed")).toBe("false");
  expect(document.querySelectorAll(".review-package-detail:not([hidden])")).toHaveLength(1);
  expect(document.querySelector(".review-package-detail:not([hidden]) h3")?.textContent).toBe(
    "publisher.workspace-note@1.0.1",
  );
  choices[0]!.click();
  expect(reason.value).toBe("My unfinished decision notes");
  expect(transport.request.mock.calls.every(([, method]) => method !== "POST")).toBe(true);
});

it("opening a package shows decision guidance without sending a review action", async () => {
  const digest = "a".repeat(64);
  transport.request.mockImplementation(async (path: string) => {
    if (path === "/v1/me") return { login: "reviewer", admin: true };
    if (path.endsWith("/queue"))
      return {
        submissions: [
          {
            namespace: "publisher",
            name: "relay",
            version: "1.0.0",
            digest,
            status: "review",
            manifest: { displayName: "Relay" },
            scan_result: {
              passed: true,
              digest,
              issues: [],
              reviewDiff: {
                entries: Array.from({ length: 20 }, (_, index) => ({
                  file: `file-${index}.js`,
                  change: "added",
                  patch: "+new code",
                })),
              },
            },
          },
        ],
      };
    if (path.endsWith("/approved")) return { versions: [] };
    return {};
  });
  await ready();
  document.querySelector<HTMLButtonElement>(".review-package-choice")!.click();
  const inspection = document.querySelector<HTMLElement>(".package-inspection")!;
  expect(document.querySelector(".review-package-badge")?.textContent).toBe("Ready for review");
  expect(document.querySelector(".review-package-guidance")?.textContent).toContain(
    "Inspect the package",
  );
  expect(inspection.textContent).toContain("Approval moves this version to signing");
  expect(inspection.querySelectorAll(".review-fingerprint")).toHaveLength(2);
  expect(inspection.querySelector("form")?.noValidate).toBe(true);
  const previews = [...inspection.querySelectorAll("section")]
    .find((section) => section.querySelector("h4")?.textContent === "Text change previews")!
    .querySelector<HTMLDetailsElement>(":scope > details")!;
  expect(previews.open).toBe(false);
  expect(previews.querySelector("summary")?.textContent).toBe("Browse 20 file previews");
  expect(previews.querySelectorAll("details")).toHaveLength(20);
  expect(transport.request.mock.calls.every(([, method]) => method !== "POST")).toBe(true);
});

it("hides a selected package when it is filtered out and clears private details on refresh", async () => {
  const entry = {
    namespace: "publisher",
    name: "relay",
    version: "1.0.0",
    digest: "a".repeat(64),
    status: "review",
    manifest: null,
    scan_result: null,
  };
  transport.request.mockImplementation(async (path: string) => {
    if (path === "/v1/me") return { login: "reviewer", admin: true };
    if (path.endsWith("/queue")) return { submissions: [entry] };
    if (path.endsWith("/approved")) return { versions: [] };
    return {};
  });
  await ready();
  document.querySelector<HTMLButtonElement>(".review-package-choice")!.click();
  const detail = document.querySelector<HTMLElement>(".review-package-detail")!;
  const query = byId<HTMLInputElement>("review-query");
  query.value = "does-not-match";
  query.dispatchEvent(new Event("input"));
  expect(detail.hidden).toBe(true);
  expect(byId("review-selection-empty").hidden).toBe(false);
  refresh();
  await vi.waitFor(() => expect(byId("review-content").hidden).toBe(false));
  expect(detail.isConnected).toBe(false);
  expect(document.querySelectorAll(".review-package-detail")).toHaveLength(0);
});

it.each([true, false])(
  "shows the signing next step only after confirmed approval for an operator: %s",
  async (operator) => {
    const digest = "a".repeat(64);
    const entry = {
      namespace: "publisher",
      name: "relay",
      version: "1.0.0",
      digest,
      status: "review",
      manifest: null,
      scan_result: { passed: true, digest, issues: [] },
    };
    transport.request.mockImplementation(async (path: string) => {
      if (path === "/v1/me") return { login: "reviewer", admin: true, operator };
      if (path.endsWith("/queue")) return { submissions: [entry] };
      if (path.endsWith("/approved")) return { versions: [] };
      return {};
    });
    await ready();
    document.querySelector<HTMLButtonElement>(".review-package-choice")!.click();
    const form = document.querySelector<HTMLFormElement>(".review-package-detail form")!;
    const next = form.querySelector<HTMLElement>(".review-next-step")!;
    expect(next.hidden).toBe(true);
    byId<HTMLTextAreaElement>("review-reason-0").value =
      "Checked requested access and package source.";
    byId<HTMLInputElement>("review-confirm-0").value = digest;
    form.requestSubmit(form.querySelector<HTMLButtonElement>('button[value="approve"]')!);
    await vi.waitFor(() => expect(form.textContent).toContain("Approval recorded"));
    expect(next.hidden).toBe(!operator);
    expect(next.getAttribute("href")).toBe("/admin/releases");
    expect(document.activeElement).toBe(operator ? next : byId("review-refresh"));
    expect(
      document.querySelector(".review-package-detail > .review-package-badge")?.textContent,
    ).toBe("Approved");
    const writes = transport.request.mock.calls.filter(([, method]) => method === "POST");
    expect(writes).toHaveLength(1);
    expect(writes[0]![2]).toMatchObject({ action: "approve", digest });
  },
);
