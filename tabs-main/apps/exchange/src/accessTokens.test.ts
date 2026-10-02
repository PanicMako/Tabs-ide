import * as Crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Pool } from "pg";
import { expect, it, vi } from "vitest";
import { issueAccessToken } from "./accessTokens.ts";
import { actorFor } from "./auth.ts";
import type { ExchangeConfig } from "./config.ts";
const actor = { id: "42", login: "author", admin: true, csrf: "csrf" };
const config: ExchangeConfig = {
  origin: "https://exchange.example",
  githubClientId: "id",
  githubClientSecret: "secret",
  bucket: "test",
  publishingEnabled: false,
  adminGithubIds: new Set(["42"]),
};

it("shows an expiring namespace token once and persists only its digest", async () => {
  const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rowCount: 1, rows: [] }));
  const issued = await issueAccessToken({ query } as unknown as Pool, actor, {
    label: "CLI",
    scope: "publish",
    namespace: "publisher",
  });
  expect(issued.token).toMatch(/^tex_[A-Za-z0-9_-]{43}$/);
  expect(Date.parse(issued.expiresAt) - Date.now()).toBeGreaterThan(29 * 86400000);
  const params = query.mock.calls[1]?.[1];
  expect(JSON.stringify(params)).not.toContain(issued.token);
  expect(params).toContain(Crypto.createHash("sha256").update(issued.token).digest("hex"));
});

it("does not issue tokens to other tokens or nonmembers", async () => {
  const query = vi.fn(async () => ({ rowCount: 0, rows: [] }));
  const pool = { query } as unknown as Pool;
  await expect(
    issueAccessToken(pool, { ...actor, tokenScope: "read" }, { label: "nested", scope: "read" }),
  ).rejects.toThrow();
  expect(query).not.toHaveBeenCalled();
  await expect(
    issueAccessToken(pool, actor, { label: "CLI", scope: "publish", namespace: "publisher" }),
  ).rejects.toThrow(/membership/);
  expect(query).toHaveBeenCalledTimes(1);
});

it("requires current expiry, revocation and membership checks, never grants admin", async () => {
  const token = `tex_${"a".repeat(43)}`;
  const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({
    rows: [{ id: "42", login: "author", scope: "publish", namespace: "publisher" }],
  }));
  const request = { headers: { authorization: `Bearer ${token}` } } as IncomingMessage;
  const authenticated = await actorFor(request, { query } as unknown as Pool, config);
  expect(authenticated?.admin).toBe(false);
  expect(query.mock.calls[0]?.[0]).toMatch(/expires_at > now\(\)/);
  expect(query.mock.calls[0]?.[0]).toContain("revoked_at IS NULL");
  expect(query.mock.calls[0]?.[0]).toContain("exchange_namespace_members");
  expect(query.mock.calls[0]?.[1]).not.toContain(token);
  expect(
    await actorFor(request, { query } as unknown as Pool, {
      ...config,
      visibility: "private",
      allowedGithubIds: new Set(["99"]),
    }),
  ).toBeNull();
});
