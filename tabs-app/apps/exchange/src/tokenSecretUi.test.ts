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
