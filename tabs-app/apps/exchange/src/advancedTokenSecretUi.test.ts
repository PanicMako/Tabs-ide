// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
let complete!: (value: Response) => void;
let requests: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "./publisher.html"),
    "utf8",
  );
  document.body.innerHTML = /<body[^>]*>([\s\S]*?)<\/body>/.exec(source)![1]!;
  requests = vi.fn(async (path: string, options: RequestInit = {}) => {
    if (path === "/v1/me")
      return Response.json({
        login: "publisher",
        publishingEnabled: true,
        termsVersion: "test",
        admin: false,
      });
    if (path === "/v1/tokens" && options.method === "POST")
      return new Promise<Response>((resolve) => {
        complete = resolve;
      });
    return Response.json({
      tokens: [],
      namespaces: [],
      invitations: [],
      submissions: [],
      appeals: [],
    });
  });
  vi.stubGlobal("fetch", requests);
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const token = `tex_${"a".repeat(43)}`;
async function start() {
  await import("./publisher.js");
  byId<HTMLInputElement>("token-label").value = "Controlled test";
  byId("token-form").dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() =>
    expect(
      requests.mock.calls.some(
        ([path, options]) => path === "/v1/tokens" && options.method === "POST",
      ),
    ).toBe(true),
  );
}
it.each(["pagehide", "visibilitychange"])(
  "never reveals a late credential after %s, even after returning",
  async (eventName) => {
    await start();
    if (eventName === "pagehide") window.dispatchEvent(new Event("pagehide"));
    else {
      vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      document.dispatchEvent(new Event("visibilitychange"));
      vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    }
    complete(Response.json({ token }));
    await vi.waitFor(() =>
      expect(byId("status").textContent).toContain("Its secret was not displayed"),
    );
    expect(byId<HTMLInputElement>("token-value").value).toBe("");
    expect(byId("token-result").hidden).toBe(true);
  },
);
it("shows only an uninterrupted credential, then clears it when the page is hidden", async () => {
  await start();
  complete(Response.json({ token }));
  await vi.waitFor(() => expect(byId("token-result").hidden).toBe(false));
  expect(byId<HTMLInputElement>("token-value").value).toBe(token);
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(byId<HTMLInputElement>("token-value").value).toBe("");
  expect(byId("token-result").hidden).toBe(true);
});
it("manual dismissal invalidates a pending reveal and prevents duplicate creation", async () => {
  await start();
  byId("token-form").dispatchEvent(new Event("submit", { cancelable: true }));
  byId<HTMLButtonElement>("token-dismiss").click();
  complete(Response.json({ token }));
  await vi.waitFor(() =>
    expect(byId("status").textContent).toContain("Its secret was not displayed"),
  );
  expect(
    requests.mock.calls.filter(
      ([path, options]) => path === "/v1/tokens" && options.method === "POST",
    ),
  ).toHaveLength(1);
  expect(byId<HTMLInputElement>("token-value").value).toBe("");
});
it("does not expose a malformed credential response", async () => {
  await start();
  complete(Response.json({ token: "unexpected response" }));
  await vi.waitFor(() => expect(byId("status").textContent).toContain("Unexpected token response"));
  expect(byId<HTMLInputElement>("token-value").value).toBe("");
  expect(byId("token-result").hidden).toBe(true);
});

it("routes advanced requests through bounded, nonredirecting, same-origin transport with CSRF", async () => {
  document.cookie = "tabs_exchange_csrf=controlled-csrf; Path=/";
  await start();
  for (const [, options] of requests.mock.calls) {
    expect(options).toMatchObject({
      redirect: "error",
      credentials: "same-origin",
      cache: "no-store",
    });
    expect(options.signal).toBeDefined();
  }
  const creation = requests.mock.calls.find(([, options]) => options.method === "POST")!;
  expect(creation[1].headers).toMatchObject({
    "X-CSRF-Token": "controlled-csrf",
    "Content-Type": "application/json",
  });
  complete(Response.json({ token }));
  await vi.waitFor(() => expect(byId("token-result").hidden).toBe(false));
});
it("uses safe access guidance without exposing an upstream error body", async () => {
  await start();
  complete(
    Response.json(
      { error: "private-upstream-diagnostics", recovery: "private-upstream-diagnostics" },
      { status: 403 },
    ),
  );
  await vi.waitFor(() => expect(byId("status").textContent).toContain("namespace membership"));
  expect(document.body.textContent).not.toContain("private-upstream-diagnostics");
  expect(byId<HTMLInputElement>("token-value").value).toBe("");
  expect(byId("token-result").hidden).toBe(true);
});
it("rejects oversized advanced responses before exposing a credential", async () => {
  await start();
  complete(Response.json({ token: "x".repeat(1024 * 1024 + 1) }));
  await vi.waitFor(() => expect(byId("status").textContent).toContain("exceeded its limit"));
  expect(byId<HTMLInputElement>("token-value").value).toBe("");
  expect(byId("token-result").hidden).toBe(true);
});
