import { afterEach, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Pool } from "pg";
import type { S3Client } from "@aws-sdk/client-s3";
import type { ExchangeActor } from "./auth";
const auth = vi.hoisted(() => ({ actor: null as ExchangeActor | null }));
vi.mock("./auth.ts", async (original) => ({
  ...(await original<typeof import("./auth.ts")>()),
  actorFor: async () => auth.actor,
}));
import { createExchangeServer } from "./server";
const servers: ReturnType<typeof createExchangeServer>[] = [];
afterEach(async () => {
  auth.actor = null;
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
async function fixture() {
  const query = vi.fn(async () => ({ rows: [] }));
  const server = createExchangeServer({ query } as unknown as Pool, {} as S3Client, {
    origin: "http://localhost:8787",
    githubClientId: "id",
    githubClientSecret: "secret",
    bucket: "test",
    publishingEnabled: false,
    adminGithubIds: new Set(),
    operatorGithubIds: new Set(["1"]),
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, query };
}
const operator = { id: "1", login: "operator", admin: true, operator: true, csrf: "valid" };
it("requires an operator browser session for state, plans, trust registration and publication", async () => {
  const { origin, query } = await fixture();
  for (const actor of [
    null,
    { ...operator, operator: false },
    { ...operator, tokenScope: "publish" as const },
  ]) {
    auth.actor = actor;
    for (const path of ["", "/plan", "/setup", "/publish"]) {
      const response = await fetch(`${origin}/v1/operator/releases${path}`, {
        method: path === "/setup" || path === "/publish" ? "POST" : "GET",
        headers: { Origin: "http://localhost:8787", "Content-Type": "application/json" },
        ...(path === "/setup" || path === "/publish" ? { body: "{}" } : {}),
      });
      expect(response.ok).toBe(false);
    }
  }
  expect(query).not.toHaveBeenCalled();
});
it("returns private operator state and rejects cross-origin setup before touching storage", async () => {
  const { origin, query } = await fixture();
  auth.actor = operator;
  const response = await fetch(`${origin}/v1/operator/releases`);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({ pin: null, root: null });
  query.mockClear();
  const forbidden = await fetch(`${origin}/v1/operator/releases/setup`, {
    method: "POST",
    headers: { Origin: "https://other.example", "Content-Type": "application/json" },
    body: "{}",
  });
  expect(forbidden.ok).toBe(false);
  expect(query).not.toHaveBeenCalled();
});
