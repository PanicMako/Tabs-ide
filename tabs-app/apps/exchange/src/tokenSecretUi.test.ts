// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../frontend/src/scripts/api", () => ({ request: api.request }));
let resolveCreation: (result: unknown) => void;
beforeEach(() => {
  vi.resetModules();
  api.request.mockReset();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  document.body.innerHTML = `<p id="token-status"></p><ul id="token-list"></ul><form id="token-create"><input id="token-label" value="Test"><select id="token-scope"><option value="read">Read</option></select><select id="token-namespace"></select><button id="token-create-button" disabled>Create</button></form><section id="token-secret-section" hidden><h2 id="token-secret-title" tabindex="-1">Secret</h2><input id="token-secret"><p id="token-expiry"></p><button id="token-hide">Hide</button><button id="token-copy">Copy</button></section><button id="token-refresh">Refresh</button><pre id="token-instructions"></pre>`;
  api.request.mockImplementation(async (path: string, method = "GET") => {
    if (path === "/v1/me") return { login: "publisher" };
    if (path === "/v1/publisher/namespaces") return { namespaces: [] };
    if (path === "/v1/tokens" && method === "POST")
      return new Promise((resolve) => {
        resolveCreation = resolve;
      });
    return { tokens: [] };
  });
});
afterEach(() => vi.restoreAllMocks());
const secret = () => document.querySelector<HTMLInputElement>("#token-secret")!;
const section = () => document.querySelector<HTMLElement>("#token-secret-section")!;
async function startCreation() {
  await import("../frontend/src/scripts/tokens");
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLButtonElement>("#token-create-button")!.disabled).toBe(false),
  );
  document.querySelector("#token-create")!.dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() =>
    expect(api.request).toHaveBeenCalledWith("/v1/tokens", "POST", {
      label: "Test",
      scope: "read",
    }),
  );
}
it.each(["pagehide", "visibilitychange"])(
  "keeps a late token response concealed after %s",
  async (eventName) => {
    await startCreation();
    if (eventName === "pagehide") window.dispatchEvent(new Event("pagehide"));
    else {
      vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      document.dispatchEvent(new Event("visibilitychange"));
      // Even returning before the response must not undo the concealment.
      vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    }
    resolveCreation({ token: `tex_${"a".repeat(43)}`, expiresAt: "2030-01-01T00:00:00Z" });
    await vi.waitFor(() =>
      expect(document.querySelector("#token-status")!.textContent).toContain(
        "Its secret was not displayed",
      ),
    );
    expect(secret().value).toBe("");
    expect(section().hidden).toBe(true);
  },
);
it("shows a completed token only on an uninterrupted visible page and conceals it on navigation", async () => {
  await startCreation();
  resolveCreation({ token: `tex_${"a".repeat(43)}`, expiresAt: "2030-01-01T00:00:00Z" });
  await vi.waitFor(() => expect(section().hidden).toBe(false));
  expect(secret().value).toBe(`tex_${"a".repeat(43)}`);
  expect(document.activeElement).toBe(document.querySelector("#token-secret-title"));
  window.dispatchEvent(new Event("pagehide"));
  expect(secret().value).toBe("");
  expect(section().hidden).toBe(true);
});

it("explains a missing namespace and hides that field for read-only access", async () => {
  document.querySelector("#token-scope")!.innerHTML =
    '<option value="publish">Submit</option><option value="read">Read</option>';
  document.body.insertAdjacentHTML(
    "beforeend",
    '<div id="token-namespace-field"></div><p id="token-namespace-empty" hidden></p><p id="token-scope-help"></p>',
  );
  await import("../frontend/src/scripts/tokens");
  await vi.waitFor(() =>
    expect(document.getElementById("token-namespace-empty")!.hidden).toBe(false),
  );
  expect(document.querySelector<HTMLButtonElement>("#token-create-button")!.disabled).toBe(true);
  const access = document.querySelector<HTMLSelectElement>("#token-scope")!;
  access.value = "read";
  access.dispatchEvent(new Event("change"));
  expect(document.getElementById("token-namespace-field")!.hidden).toBe(true);
  expect(document.querySelector<HTMLSelectElement>("#token-namespace")!.required).toBe(false);
  expect(document.querySelector<HTMLButtonElement>("#token-create-button")!.disabled).toBe(false);
  expect(document.getElementById("token-scope-help")!.textContent).toContain("cannot submit");
});

it("validates a blank name in the page before sending a request", async () => {
  document.querySelector<HTMLInputElement>("#token-label")!.value = "   ";
  await import("../frontend/src/scripts/tokens");
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLButtonElement>("#token-create-button")!.disabled).toBe(false),
  );
  document.querySelector("#token-create")!.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(api.request.mock.calls.some(([, method]) => method === "POST")).toBe(false);
  expect(document.activeElement?.id).toBe("token-label");
  expect(document.getElementById("token-status")!.textContent).toContain("Give this token a name");
});

it("requires a second action to revoke and safely renders token labels", async () => {
  const token = {
    id: "11111111-1111-4111-8111-111111111111",
    label: "<img src=x onerror=alert(1)>",
    scope: "publish",
    namespace: "studio",
    expires_at: "2035-01-01T00:00:00Z",
    revoked_at: null as string | null,
  };
  api.request.mockImplementation(async (path: string, method = "GET") => {
    if (path === "/v1/me") return { login: "publisher" };
    if (path === "/v1/publisher/namespaces") return { namespaces: [] };
    if (method === "DELETE") {
      token.revoked_at = "2026-10-19";
      return {};
    }
    return { tokens: [token] };
  });
  await import("../frontend/src/scripts/tokens");
  await vi.waitFor(() =>
    expect(document.querySelector("#token-list strong")?.textContent).toBe(token.label),
  );
  expect(document.querySelector("#token-list img")).toBe(null);
  expect(document.querySelector(".cli-token-state")!.textContent).toBe("Active");
  const revoke = document.querySelector<HTMLButtonElement>("#token-list button[aria-label]")!;
  revoke.click();
  expect(document.querySelector<HTMLElement>(".cli-revoke-confirmation")!.hidden).toBe(false);
  expect(api.request.mock.calls.some(([, method]) => method === "DELETE")).toBe(false);
  document.querySelector<HTMLButtonElement>(".cli-revoke-confirmation button")!.click();
  expect(document.activeElement).toBe(revoke);
  expect(document.querySelector<HTMLElement>(".cli-revoke-confirmation")!.hidden).toBe(true);
  revoke.click();
  document.querySelector<HTMLButtonElement>(".cli-revoke-action")!.click();
  await vi.waitFor(() =>
    expect(document.querySelector(".cli-token-state")!.textContent).toBe("Revoked"),
  );
  expect(api.request).toHaveBeenCalledWith(`/v1/tokens/${token.id}`, "DELETE");
  expect(document.querySelector("#token-list button[aria-label]")).toBe(null);
});

it("copies terminal placeholders without putting the generated secret in commands", async () => {
  document.body.insertAdjacentHTML(
    "beforeend",
    '<button id="token-setup-copy">Copy setup</button><p id="token-setup-feedback"></p>',
  );
  const writeText = vi.fn(async (_value: string) => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await startCreation();
  const token = `tex_${"a".repeat(43)}`;
  resolveCreation({ token, expiresAt: "2030-01-01T00:00:00Z" });
  await vi.waitFor(() => expect(section().hidden).toBe(false));
  document.getElementById("token-setup-copy")!.click();
  await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
  expect(writeText.mock.calls[0]![0]).toContain("<your-token>");
  expect(writeText.mock.calls[0]![0]).not.toContain(token);
});
