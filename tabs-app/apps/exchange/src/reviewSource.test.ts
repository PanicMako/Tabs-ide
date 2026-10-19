import * as Crypto from "node:crypto";
import * as FS from "node:fs/promises";
import * as OS from "node:os";
import * as Path from "node:path";
import { Readable } from "node:stream";
import type { AddressInfo } from "node:net";
import type { Pool } from "pg";
import type { S3Client } from "@aws-sdk/client-s3";
import { packTabsext } from "@tabs/extension-package";
import { beforeAll, afterAll, expect, it } from "vitest";
import { readReviewSource, validateReviewSourceRequest } from "./reviewSource";
import { createExchangeServer } from "./server";
let directory: string;
let bytes: Buffer;
let digest: string;
const identity = { namespace: "tabs-example", name: "hello", version: "0.1.0" };
const text = '<script>throw new Error("never execute")</script>\nconst note = "untrusted source";';
beforeAll(async () => {
  directory = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-review-source-test-"));
  const source = Path.join(directory, "source");
  await FS.cp(Path.resolve(import.meta.dirname, "../../../examples/hello-extension"), source, {
    recursive: true,
  });
  await FS.writeFile(Path.join(source, "dist/index.html"), text);
  await FS.writeFile(Path.join(source, "binary.dat"), Buffer.from([0, 1, 2, 3]));
  await FS.writeFile(Path.join(source, "large.txt"), "x".repeat(384 * 1024 + 1));
  const archive = Path.join(directory, "package.tabsext");
  await packTabsext({ directory: source, destination: archive, tabsVersion: "2.0.0" });
  bytes = await FS.readFile(archive);
  digest = Crypto.createHash("sha256").update(bytes).digest("hex");
});
afterAll(async () => {
  await FS.rm(directory, { recursive: true, force: true });
});
it("reads the complete shipped text and computes its fingerprint without executing it", async () => {
  const result = await readReviewSource(bytes, { ...identity, digest }, "dist/index.html");
  if (!("text" in result)) throw new Error("Expected plain text");
  expect(result.text).toBe(text);
  expect(result.sha256).toBe(Crypto.createHash("sha256").update(text).digest("hex"));
  expect(result.digest).toBe(digest);
});
it("rejects traversal, wrong digests, wrong identity and nonexistent archive members", async () => {
  for (const file of [
    "../private",
    "/etc/passwd",
    "dist/../index.html",
    "dist\\index.html",
    "x\0y",
  ])
    expect(() => validateReviewSourceRequest(file, digest)).toThrow();
  await expect(
    readReviewSource(bytes, { ...identity, digest: "a".repeat(64) }, "dist/index.html"),
  ).rejects.toThrow("fingerprint");
  await expect(
    readReviewSource(bytes, { ...identity, digest, name: "other" }, "dist/index.html"),
  ).rejects.toThrow("identity");
  await expect(readReviewSource(bytes, { ...identity, digest }, "missing.js")).rejects.toThrow(
    "not present",
  );
});
it("reports binary and oversized files instead of emitting partial or executable responses", async () => {
  expect(await readReviewSource(bytes, { ...identity, digest }, "binary.dat")).toMatchObject({
    omitted: "binary",
  });
  expect(await readReviewSource(bytes, { ...identity, digest }, "large.txt")).toMatchObject({
    omitted: "too-large",
  });
});
it("requires reviewer access and exact digest, returns private JSON, and never writes review decisions", async () => {
  const queries: string[] = [];
  let storageReads = 0;
  const pool = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("FROM exchange_sessions"))
        return { rows: [{ id: "42", login: "reviewer", csrf_hash: "unused" }] };
      if (sql.includes("SELECT digest, bytes, object_key"))
        return { rows: [{ digest, bytes: bytes.length, object_key: "quarantine/package" }] };
      return { rows: [] };
    },
  } as unknown as Pool;
  const storage = {
    async send() {
      storageReads++;
      return { Body: Readable.from([bytes]) };
    },
  } as unknown as S3Client;
  const server = createExchangeServer(pool, storage, {
    origin: "http://localhost:8787",
    githubClientId: "test",
    githubClientSecret: "test",
    bucket: "test",
    publishingEnabled: false,
    adminGithubIds: new Set(["42"]),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/review/tabs-example/hello/0.1.0/source`;
    const headers = { Cookie: "tabs_exchange_session=opaque" };
    expect((await fetch(`${base}?digest=${digest}&file=dist/index.html`)).status).toBe(403);
    expect(storageReads).toBe(0);
    expect(
      (await fetch(`${base}?digest=${"b".repeat(64)}&file=dist/index.html`, { headers })).status,
    ).toBe(409);
    expect(storageReads).toBe(0);
    expect((await fetch(`${base}?digest=${digest}&file=../private`, { headers })).status).toBe(400);
    const response = await fetch(`${base}?digest=${digest}&file=dist/index.html`, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect((await response.json()).text).toBe(text);
    expect(queries.every((sql) => sql.startsWith("SELECT"))).toBe(true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
