import * as Crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Pool } from "pg";
import type { S3Client } from "@aws-sdk/client-s3";
import { afterEach, expect, it, vi } from "vitest";
import { createExchangeServer } from "./server.ts";

const servers: ReturnType<typeof createExchangeServer>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
async function fixture(renew: () => Promise<void>, visibility: "public" | "private" = "public") {
  const bytes = Buffer.from('{"signed":{"version":2}}');
  const query = vi.fn(async () => ({
    rows: [{ bytes, sha256: Crypto.createHash("sha256").update(bytes).digest("hex") }],
  }));
  const server = createExchangeServer(
    { query } as unknown as Pool,
    {} as S3Client,
    {
      origin: "http://localhost:8787",
      githubClientId: "id",
      githubClientSecret: "secret",
      bucket: "test",
      publishingEnabled: false,
      adminGithubIds: new Set(),
      visibility,
      allowedGithubIds: new Set(["42"]),
    },
    undefined,
    renew,
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { query, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

it("renews before serving a timestamp to an anonymous installer", async () => {
  let finish!: () => void;
  const renew = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const subject = await fixture(renew);
  const response = fetch(`${subject.origin}/v1/tuf/metadata/timestamp.json`);
  await vi.waitFor(() => expect(renew).toHaveBeenCalledOnce());
  expect(subject.query).not.toHaveBeenCalled();
  finish();
  const result = await response;
  expect(result.status).toBe(200);
  expect((await result.json()).signed.version).toBe(2);
  expect(result.headers.get("Cache-Control")).toBe("no-store");
});

it("does not serve stale timestamp bytes when renewal fails", async () => {
  const subject = await fixture(async () => {
    throw new Error("Renewal storage unavailable");
  });
  const result = await fetch(`${subject.origin}/v1/tuf/metadata/timestamp.json`);
  expect(result.status).toBe(500);
  expect(subject.query).not.toHaveBeenCalled();
  expect((await result.json()).error).toBe("Internal Exchange error.");
});

it("keeps private-registry authentication ahead of automatic renewal", async () => {
  const renew = vi.fn(async () => {});
  const subject = await fixture(renew, "private");
  expect((await fetch(`${subject.origin}/v1/tuf/metadata/timestamp.json`)).status).toBe(401);
  expect(renew).not.toHaveBeenCalled();
  expect(subject.query).not.toHaveBeenCalled();
});
