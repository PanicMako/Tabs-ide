import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeGithubLogin } from "./auth.ts";
import type { ExchangeConfig } from "./config.ts";

const origin = "https://exchange.tabs.example";
const state = "s".repeat(43);
const callback = new URL(`${origin}/auth/github/callback?state=${state}&code=oauth-code`);
const config: ExchangeConfig = {
  origin,
  githubClientId: "client",
  githubClientSecret: "secret",
  adminGithubIds: new Set(),
  bucket: "quarantine",
  publishingEnabled: false,
};

function fixture() {
  const request = { headers: { cookie: `tabs_exchange_oauth=${state}` } } as IncomingMessage;
  const headers = new Map<string, unknown>();
  const response = {
    setHeader: vi.fn((name: string, value: unknown) => {
      headers.set(name, value);
    }),
    writeHead: vi.fn(() => response),
    end: vi.fn(),
  } as unknown as ServerResponse;
  const queries: string[] = [];
  const pool = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      return { rowCount: sql.startsWith("DELETE FROM exchange_oauth_states") ? 1 : 0, rows: [] };
    }),
  } as unknown as Pool;
  return { request, response, headers, queries, pool };
}

function githubResponse(value: unknown, url: string): Response {
  const response = Response.json(value);
  Object.defineProperty(response, "url", { value: url });
  return response;
}

afterEach(() => vi.unstubAllGlobals());

describe("Exchange GitHub OAuth transport", () => {
  it("uses bounded, non-redirecting JSON requests before creating a publisher session", async () => {
    const subject = fixture();
    const request = vi.fn(async (url: string, init: RequestInit) => {
      expect(init.redirect).toBe("error");
      expect(init.cache).toBe("no-store");
      expect(init.credentials).toBe("omit");
      return url === "https://github.com/login/oauth/access_token"
        ? githubResponse({ access_token: "gho_test" }, url)
        : githubResponse({ id: 42, login: "publisher" }, url);
    });
    vi.stubGlobal("fetch", request);
    await completeGithubLogin(subject.request, subject.response, callback, subject.pool, config);
    expect(request).toHaveBeenCalledTimes(2);
    expect(subject.queries.some((sql) => sql.startsWith("INSERT INTO exchange_sessions"))).toBe(
      true,
    );
    expect(subject.headers.get("Set-Cookie")).toEqual(
      expect.arrayContaining([expect.stringContaining("tabs_exchange_session=")]),
    );
  });

  it("rejects a changed destination or oversized token response before session creation", async () => {
    for (const response of [
      githubResponse({ access_token: "gho_test" }, "https://other.example/token"),
      githubResponse(
        { access_token: "x".repeat(130 * 1024) },
        "https://github.com/login/oauth/access_token",
      ),
    ]) {
      const subject = fixture();
      const request = vi.fn(async () => response);
      vi.stubGlobal("fetch", request);
      await expect(
        completeGithubLogin(subject.request, subject.response, callback, subject.pool, config),
      ).rejects.toThrow();
      expect(request).toHaveBeenCalledTimes(1);
      expect(subject.queries.some((sql) => sql.startsWith("INSERT INTO exchange_sessions"))).toBe(
        false,
      );
    }
  });

  it("rejects an oversized GitHub profile and malformed token before session creation", async () => {
    for (const token of ["gho_valid", "gho_bad\nheader"]) {
      const subject = fixture();
      const request = vi.fn(async (url: string) =>
        url === "https://github.com/login/oauth/access_token"
          ? githubResponse({ access_token: token }, url)
          : githubResponse({ id: 42, login: "x".repeat(130 * 1024) }, url),
      );
      vi.stubGlobal("fetch", request);
      await expect(
        completeGithubLogin(subject.request, subject.response, callback, subject.pool, config),
      ).rejects.toThrow();
      expect(request).toHaveBeenCalledTimes(token.includes("\n") ? 1 : 2);
      expect(subject.queries.some((sql) => sql.startsWith("INSERT INTO exchange_sessions"))).toBe(
        false,
      );
    }
  });

  it("rejects invalid OAuth callback state before making a network request", async () => {
    const subject = fixture();
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    await expect(
      completeGithubLogin(
        subject.request,
        subject.response,
        new URL(`${origin}/auth/github/callback?state=wrong&code=oauth-code`),
        subject.pool,
        config,
      ),
    ).rejects.toThrow(/state mismatch/);
    expect(request).not.toHaveBeenCalled();
    expect(subject.queries).toEqual([]);
  });
});
