import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  completeGithubLogin,
  startGithubLogin,
  GithubLoginFailure,
  recoverGithubLogin,
} from "./auth.ts";
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

function fixture(returnRoute = "/publisher") {
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
      return {
        rowCount: sql.startsWith("DELETE FROM exchange_oauth_states") ? 1 : 0,
        rows: sql.startsWith("DELETE FROM exchange_oauth_states")
          ? [{ return_route: returnRoute }]
          : [],
      };
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
  it("stores the return route with the expiring state, not in an editable callback parameter", async () => {
    const subject = fixture();
    await startGithubLogin(subject.response, subject.pool, config, "/extensions?q=git");
    expect(subject.pool.query).toHaveBeenCalledWith(expect.stringContaining("return_route"), [
      expect.any(String),
      "/extensions?q=git",
    ]);
    const redirect = vi.mocked(subject.response.writeHead).mock.calls[0]![1] as {
      Location: string;
    };
    expect(new URL(redirect.Location).origin).toBe("https://github.com");
    expect(redirect.Location).not.toContain("returnTo");
  });
  it("returns to the saved task and ignores callback redirect tampering", async () => {
    const subject = fixture("/extensions?q=git&sort=newest");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "https://github.com/login/oauth/access_token"
          ? githubResponse({ access_token: "gho_test" }, url)
          : githubResponse({ id: 42, login: "publisher" }, url),
      ),
    );
    const tampered = new URL(callback);
    tampered.searchParams.set("returnTo", "https://evil.example");
    await completeGithubLogin(subject.request, subject.response, tampered, subject.pool, config);
    expect(subject.response.writeHead).toHaveBeenCalledWith(302, {
      Location: `${origin}/extensions?q=git&sort=newest`,
    });
  });
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

describe("GitHub sign-in recovery", () => {
  it("consumes a cancelled attempt and uses only the saved destination without contacting GitHub", async () => {
    const subject = fixture("/account/namespaces");
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const cancelled = new URL(
      `${origin}/auth/github/callback?state=${state}&error=access_denied&returnTo=https://evil.example&error_description=secret`,
    );
    let failure: unknown;
    try {
      await completeGithubLogin(subject.request, subject.response, cancelled, subject.pool, config);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ reason: "cancelled", returnTo: "/account/namespaces" });
    expect(request).not.toHaveBeenCalled();
    expect(subject.queries).toHaveLength(1);
    recoverGithubLogin(subject.response, config, failure);
    expect(subject.response.writeHead).toHaveBeenCalledWith(303, {
      Location: `${origin}/sign-in?reason=cancelled&returnTo=%2Faccount%2Fnamespaces`,
    });
    expect(subject.headers.get("Set-Cookie")).toBe(
      "tabs_exchange_oauth=; Path=/; SameSite=Lax; Max-Age=0; Secure; HttpOnly",
    );
    expect(subject.headers.get("Cache-Control")).toBe("no-store");
  });
  it("rejects an expired state without exchanging its code", async () => {
    const subject = fixture();
    vi.mocked(subject.pool.query).mockResolvedValue({ rowCount: 0, rows: [] } as never);
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    await expect(
      completeGithubLogin(subject.request, subject.response, callback, subject.pool, config),
    ).rejects.toMatchObject({ reason: "expired" });
    expect(request).not.toHaveBeenCalled();
  });
  it("preserves the saved task on transport failure without exposing provider details", async () => {
    const subject = fixture("/publish");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private provider details")));
    await expect(
      completeGithubLogin(subject.request, subject.response, callback, subject.pool, config),
    ).rejects.toMatchObject({
      reason: "unavailable",
      returnTo: "/publish",
      message: "GitHub sign-in could not finish.",
    });
    expect(subject.queries).toHaveLength(1);
    recoverGithubLogin(subject.response, config, new Error("private provider details"));
    expect(subject.response.writeHead).toHaveBeenCalledWith(303, {
      Location: `${origin}/sign-in?reason=unavailable&returnTo=%2Fpublisher`,
    });
  });
  it("explains private account denial without creating a user or session", async () => {
    const subject = fixture("/account");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("access_token")
          ? githubResponse({ access_token: "gho_test" }, url)
          : githubResponse({ id: 42, login: "publisher" }, url),
      ),
    );
    await expect(
      completeGithubLogin(subject.request, subject.response, callback, subject.pool, {
        ...config,
        visibility: "private",
        allowedGithubIds: new Set(["99"]),
      }),
    ).rejects.toMatchObject({ reason: "denied", returnTo: "/account" });
    expect(subject.queries).toHaveLength(1);
  });
  it("bounds recovery destinations even if an error has an unsafe return route", () => {
    const subject = fixture();
    recoverGithubLogin(
      subject.response,
      config,
      new GithubLoginFailure("failure", "expired", "//evil.example"),
    );
    expect(subject.response.writeHead).toHaveBeenCalledWith(303, {
      Location: `${origin}/sign-in?reason=expired&returnTo=%2Fpublisher`,
    });
  });
});
