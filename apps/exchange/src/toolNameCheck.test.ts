import type { AddressInfo } from "node:net";
import type { Pool } from "pg";
import type { S3Client } from "@aws-sdk/client-s3";
import { afterEach, expect, it, vi } from "vitest";
import { createExchangeServer } from "./server";
const auth = vi.hoisted(() => ({ actorFor: vi.fn() }));
vi.mock("./auth.ts", async (original) => ({
  ...(await original<object>()),
  actorFor: auth.actorFor,
}));
const servers: ReturnType<typeof createExchangeServer>[] = [];
afterEach(async () => {
  auth.actorFor.mockReset();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
async function fixture(rows: Array<{ used: boolean }>) {
  auth.actorFor.mockResolvedValue({ id: "42", login: "publisher" });
  const query = vi.fn().mockResolvedValue({ rows });
  const server = createExchangeServer({ query } as unknown as Pool, {} as S3Client, {
    origin: "http://localhost:8787",
    githubClientId: "id",
    githubClientSecret: "secret",
    bucket: "test",
    publishingEnabled: true,
    adminGithubIds: new Set(),
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, query };
}
it.each([true, false])(
  "checks existing names across all version states (used=%s)",
  async (used) => {
    const { origin, query } = await fixture([{ used }]);
    const response = await fetch(
      `${origin}/v1/publisher/name-check?namespace=studio&name=simulators`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      namespace: "studio",
      name: "simulators",
      available: !used,
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const [sql, parameters] = query.mock.calls[0]!;
    expect(sql).toContain("FROM exchange_versions");
    expect(sql).not.toContain("status =");
    expect(parameters).toEqual(["studio", "simulators", "42"]);
  },
);
it("does not expose name usage to a nonmember", async () => {
  const { origin } = await fixture([]);
  const response = await fetch(
    `${origin}/v1/publisher/name-check?namespace=studio&name=simulators`,
  );
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain('"available"');
});
it("rejects unauthenticated and malformed checks before querying names", async () => {
  const { origin, query } = await fixture([]);
  auth.actorFor.mockResolvedValueOnce(null);
  expect(
    (await fetch(`${origin}/v1/publisher/name-check?namespace=studio&name=simulators`)).status,
  ).toBe(403);
  expect(
    (await fetch(`${origin}/v1/publisher/name-check?namespace=studio&name=Bad.Name`)).status,
  ).toBe(400);
  expect(query).not.toHaveBeenCalled();
});
