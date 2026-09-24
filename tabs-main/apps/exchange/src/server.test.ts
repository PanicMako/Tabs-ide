import * as Crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Pool } from "pg";
import type { S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it } from "vitest";
import { createExchangeServer } from "./server.ts";
import type { ExchangeConfig } from "./config.ts";

const servers: Array<ReturnType<typeof createExchangeServer>> = [];
const digest = "a".repeat(64);
const csrf = "test-csrf-token";
const config: ExchangeConfig = {
  origin: "http://localhost:8787",
  githubClientId: "test",
  githubClientSecret: "test",
  adminGithubIds: new Set(["42"]),
  bucket: "test",
  tabsVersion: "1.3.17",
  publishingEnabled: false,
};

async function fixture(scanPassed = true, storedDigest = digest, submissionStatus = "review") {
  const actions: string[] = [];
  const client = {
    async query(sql: string) {
      actions.push(sql);
      if (sql.includes("SELECT status, digest, scan_result")) {
        return {
          rows: [
            { status: submissionStatus, digest: storedDigest, scan_result: { passed: scanPassed } },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const pool = {
    async query(sql: string) {
      if (sql.includes("FROM exchange_sessions")) {
        return {
          rows: [
            {
              id: "42",
              login: "reviewer",
              csrf_hash: Crypto.createHash("sha256").update(csrf).digest("hex"),
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
    async connect() {
      return client;
    },
  } as unknown as Pool;
  const server = createExchangeServer(pool, {} as S3Client, config);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${address.port}`, actions };
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe("Exchange HTTP boundaries", () => {
  it("serves the accessible publisher shell but keeps publishing disabled", async () => {
    const { base } = await fixture();
    const page = await fetch(`${base}/publisher`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('aria-live="polite"');
    const create = await fetch(`${base}/v1/namespaces`, { method: "POST" });
    expect(create.status).toBe(503);
  });

  it("requires reviewer authentication and exact digest", async () => {
    const { base, actions } = await fixture();
    const denied = await fetch(`${base}/v1/review/queue`);
    expect(denied.status).toBe(403);
    const result = await fetch(`${base}/v1/review/example/dashboard/1.0.0`, {
      method: "POST",
      headers: {
        Origin: config.origin,
        Cookie: "tabs_exchange_session=opaque",
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "approve", digest: "b".repeat(64), reason: "Reviewed" }),
    });
    expect(result.status).toBe(409);
    expect(actions.some((sql) => sql.includes("INSERT INTO exchange_review_events"))).toBe(false);
  });

  it("blocks scan failures and audits approved decisions", async () => {
    const blocked = await fixture(false);
    const headers = {
      Origin: config.origin,
      Cookie: "tabs_exchange_session=opaque",
      "X-CSRF-Token": csrf,
      "Content-Type": "application/json",
    };
    const body = JSON.stringify({ action: "approve", digest, reason: "Reviewed package" });
    const rejected = await fetch(`${blocked.base}/v1/review/example/dashboard/1.0.0`, {
      method: "POST",
      headers,
      body,
    });
    expect(rejected.status).toBe(409);
    const ready = await fixture(true);
    const approved = await fetch(`${ready.base}/v1/review/example/dashboard/1.0.0`, {
      method: "POST",
      headers,
      body,
    });
    expect(approved.status).toBe(200);
    expect(ready.actions.some((sql) => sql.includes("INSERT INTO exchange_review_events"))).toBe(
      true,
    );
  });

  it("audits revocation only for an approved version", async () => {
    const ready = await fixture(true, digest, "approved");
    const result = await fetch(`${ready.base}/v1/review/example/dashboard/1.0.0`, {
      method: "POST",
      headers: {
        Origin: config.origin,
        Cookie: "tabs_exchange_session=opaque",
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "revoke", digest, reason: "Confirmed malicious behavior" }),
    });
    expect(result.status).toBe(200);
    expect(ready.actions.some((sql) => sql.includes("INSERT INTO exchange_review_events"))).toBe(
      true,
    );
  });

  it("does not verify a publisher without an HTTPS ownership proof", async () => {
    const ready = await fixture();
    const result = await fetch(`${ready.base}/v1/review/namespaces/example/verification`, {
      method: "POST",
      headers: {
        Origin: config.origin,
        Cookie: "tabs_exchange_session=opaque",
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        verified: true,
        proofUrl: "http://example.com/proof",
        reason: "Claimed ownership",
      }),
    });
    expect(result.status).toBe(400);
    expect(ready.actions).toEqual([]);
  });
});
