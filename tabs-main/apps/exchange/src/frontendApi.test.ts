import { afterEach, describe, expect, it, vi } from "vitest";
import { request, RegistryRequestError } from "../frontend/src/scripts/api.ts";

afterEach(() => vi.unstubAllGlobals());
describe("same-origin account API client", () => {
  it.each([
    [200, "INVALID_RESPONSE", "registry API"],
    [401, "AUTHENTICATION_REQUIRED", "Sign in again"],
    [403, "ACCESS_DENIED", "namespace membership"],
    [503, "SERVICE_UNAVAILABLE", "registry is unavailable"],
  ])("handles HTML responses with status %i safely", async (status, code, guidance) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<!doctype html><p>private-proxy-diagnostic</p>", { status })),
    );
    const error = await request("/v1/me").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(RegistryRequestError);
    expect(error).toMatchObject({ status, code });
    expect((error as Error).message).toContain(guidance);
    expect((error as Error).message).not.toMatch(/private-proxy|Unexpected token|doctype/);
  });
  it("handles invalid UTF-8 without exposing decoding diagnostics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([0xff]))),
    );
    await expect(request("/v1/me")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("preserves successful packaged text responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("# Extension guide")),
    );
    expect(await request("/v1/assets/readme", "GET", undefined, undefined, "text")).toBe(
      "# Extension guide",
    );
  });
  it("exposes a typed access failure without repeating server diagnostics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "tex-secret", recovery: "tex-secret" }, { status: 403 }),
      ),
    );
    const error = await request("/v1/me").catch((error: unknown) => error);
    expect(error).toBeInstanceOf(RegistryRequestError);
    expect(error).toMatchObject({ status: 403, code: "ACCESS_DENIED" });
    expect((error as Error).message).not.toContain("tex-secret");
  });
  it("distinguishes required terms acceptance from expired authentication", async () => {
    vi.stubGlobal("document", { cookie: "" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ code: "TERMS_ACCEPTANCE_REQUIRED" }, { status: 403 })),
    );
    await expect(request("/v1/publisher/agreement")).rejects.toThrow("Account page");
  });
  it("binds mutations to the session CSRF token and blocks redirect following", async () => {
    vi.stubGlobal("document", { cookie: "tabs_exchange_csrf=csrf-example" });
    const fetcher = vi.fn(async () => Response.json({ name: "my-publisher" }));
    vi.stubGlobal("fetch", fetcher);
    expect(await request("/v1/namespaces", "POST", { name: "my-publisher" })).toEqual({
      name: "my-publisher",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/v1/namespaces",
      expect.objectContaining({
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "csrf-example" },
      }),
    );
  });
  it("rejects external endpoints before reading credentials or fetching", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(request("https://evil.example/v1/namespaces")).rejects.toThrow(
      "Invalid API route",
    );
    await expect(request("//evil.example/v1/namespaces")).rejects.toThrow("Invalid API route");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("bounds responses and explains reconnect rather than revocation", async () => {
    vi.stubGlobal("document", { cookie: "" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "expired" }, { status: 401 })),
    );
    await expect(request("/v1/me")).rejects.toThrow("Sign in again");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x".repeat(1024 * 1024 + 1))),
    );
    await expect(request("/v1/me")).rejects.toThrow("exceeded its limit");
  });
});
