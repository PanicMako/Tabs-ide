import * as Crypto from "node:crypto";
import * as FS from "node:fs/promises";
import * as Http from "node:http";
import * as Path from "node:path";
import type { AddressInfo } from "node:net";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { packTabsext } from "@tabs/extension-package";
import { Pool } from "pg";
import type { ExchangeConfig } from "./config.ts";
import { migrateExchangeSchema } from "./migration.ts";
import { createExchangeServer } from "./server.ts";
import { recordWorkerHeartbeat, scanNextVersion } from "./worker.ts";

export function fixtureEndpoint(value: string, protocols: readonly string[]): URL {
  const url = new URL(value);
  if (
    !protocols.includes(url.protocol) ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.hash
  )
    throw new Error("Browser fixture requires an explicit loopback service endpoint.");
  return url;
}
export function requireBrowserFixture(environment: Record<string, string | undefined>) {
  if (environment.NODE_ENV !== "test" || environment.TABS_EXCHANGE_BROWSER_FIXTURE !== "1")
    throw new Error(
      "Set NODE_ENV=test and TABS_EXCHANGE_BROWSER_FIXTURE=1. This is not production OAuth.",
    );
}
export function fixtureFormPolicy(exchangeOrigin: string): string {
  const endpoint = fixtureEndpoint(exchangeOrigin, ["http:"]);
  if (endpoint.origin !== exchangeOrigin)
    throw new Error("Fixture callback must be an exact loopback origin.");
  return `default-src 'none'; form-action 'self' ${endpoint.origin}; base-uri 'none'; frame-ancestors 'none'`;
}
const users = {
  operator: { id: 5001, login: "fixture-operator" },
  publisher: { id: 2001, login: "fixture-publisher" },
  reviewer: { id: 1001, login: "fixture-reviewer" },
  contributor: { id: 3001, login: "fixture-contributor" },
  outsider: { id: 4001, login: "fixture-outsider" },
};
type Identity = (typeof users)[keyof typeof users];
const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
async function body(request: Http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of request) {
    const bytes = Buffer.from(value);
    size += bytes.length;
    if (size > 4096) throw new Error("Fixture request exceeded its limit.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function listen(server: Http.Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

export async function runBrowserFixture() {
  requireBrowserFixture(process.env);
  const database = fixtureEndpoint(
    process.env.TEST_DATABASE_URL ??
      "postgres://tabs_exchange:testpassword@127.0.0.1:5433/tabs_exchange",
    ["postgres:", "postgresql:"],
  );
  const storageUrl = fixtureEndpoint(process.env.TEST_S3_ENDPOINT ?? "http://127.0.0.1:9090", [
    "http:",
  ]);
  if (
    storageUrl.username ||
    storageUrl.password ||
    storageUrl.search ||
    storageUrl.pathname !== "/"
  )
    throw new Error("Use a credential-free loopback S3 origin.");
  const suffix = Crypto.randomBytes(8).toString("hex");
  const databaseName = `tabs_exchange_browser_${suffix}`;
  const bucket = `tabs-exchange-browser-${suffix}`;
  const directory = await FS.mkdtemp(
    Path.resolve(import.meta.dirname, "../../../.test-data/exchange-browser-"),
  );
  const rootPool = new Pool({
    connectionString: database.toString(),
    connectionTimeoutMillis: 2000,
  });
  let pool: Pool | undefined;
  let databaseCreated = false;
  let bucketCreated = false;
  const storage = new S3Client({
    region: "us-east-1",
    endpoint: storageUrl.origin,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? "test",
      secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY ?? "test",
    },
  });
  let exchange: Http.Server | undefined;
  let oauth: Http.Server | undefined;
  let exchangeOrigin = "";
  let stop = false;
  const stopSignal = () => {
    stop = true;
  };
  process.once("SIGINT", stopSignal);
  process.once("SIGTERM", stopSignal);
  try {
    await rootPool.query(`CREATE DATABASE ${databaseName}`);
    databaseCreated = true;
    database.pathname = `/${databaseName}`;
    pool = new Pool({ connectionString: database.toString(), max: 10 });
    await migrateExchangeSchema(
      pool,
      await FS.readFile(Path.join(import.meta.dirname, "schema.sql"), "utf8"),
    );
    await storage.send(new CreateBucketCommand({ Bucket: bucket }));
    bucketCreated = true;
    const codes = new Map<string, { identity: Identity; expires: number }>();
    const tokens = new Map<string, { identity: Identity; expires: number }>();
    oauth = Http.createServer((request, response) => {
      void (async () => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        const json = (status: number, value: unknown) => {
          response
            .writeHead(status, { "Content-Type": "application/json" })
            .end(JSON.stringify(value));
        };
        if (
          url.pathname === "/login/oauth/authorize" &&
          (request.method === "GET" || request.method === "POST")
        ) {
          const fields =
            request.method === "GET" ? url.searchParams : new URLSearchParams(await body(request));
          const state = fields.get("state") ?? "";
          const redirect = fields.get("redirect_uri") ?? "";
          if (
            !/^[A-Za-z0-9_-]{43}$/.test(state) ||
            redirect !== `${exchangeOrigin}/auth/github/callback`
          )
            return json(400, { error: "Invalid fixture authorization destination or state." });
          if (request.method === "GET") {
            response.writeHead(200, {
              "Content-Type": "text/html; charset=utf-8",
              "Content-Security-Policy": fixtureFormPolicy(exchangeOrigin),
            });
            response.end(
              `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local OAuth fixture — not GitHub</title><main><h1>Local OAuth fixture — not GitHub</h1><p>These are fake identities for an isolated test database. No real GitHub account is authenticated. No production publishing is enabled.</p><form method="post"><input type="hidden" name="state" value="${escape(state)}"><input type="hidden" name="redirect_uri" value="${escape(redirect)}"><fieldset><legend>Choose a fixture account</legend>${Object.keys(
                users,
              )
                .map(
                  (role) =>
                    `<button type="submit" name="role" value="${role}">Continue as fixture ${role}</button>`,
                )
                .join(" ")}</fieldset></form></main></html>`,
            );
            return;
          }
          const role = fields.get("role") ?? "";
          if (!Object.hasOwn(users, role)) return json(400, { error: "Choose a fixture role." });
          const code = Crypto.randomBytes(32).toString("hex");
          codes.set(code, {
            identity: users[role as keyof typeof users],
            expires: Date.now() + 600_000,
          });
          const callback = new URL(redirect);
          callback.searchParams.set("code", code);
          callback.searchParams.set("state", state);
          response.writeHead(302, { Location: callback.toString() }).end();
          return;
        }
        if (url.pathname === "/login/oauth/access_token" && request.method === "POST") {
          const input = JSON.parse(await body(request));
          const authorization = codes.get(input.code);
          codes.delete(input.code);
          if (
            !authorization ||
            authorization.expires <= Date.now() ||
            input.client_id !== "browser-fixture" ||
            input.client_secret !== "not-a-production-secret" ||
            input.redirect_uri !== `${exchangeOrigin}/auth/github/callback`
          )
            return json(400, { error: "Invalid fixture grant." });
          const token = Crypto.randomBytes(32).toString("hex");
          tokens.set(token, { identity: authorization.identity, expires: Date.now() + 60_000 });
          return json(200, { access_token: token, token_type: "bearer" });
        }
        if (url.pathname === "/user" && request.method === "GET") {
          const token = (request.headers.authorization ?? "").replace(/^Bearer /, "");
          const grant = tokens.get(token);
          tokens.delete(token);
          return grant && grant.expires > Date.now()
            ? json(200, grant.identity)
            : json(401, { error: "Invalid fixture token." });
        }
        json(404, { error: "Local test OAuth fixture only." });
      })().catch(() => {
        if (!response.headersSent) response.writeHead(400, { "Content-Type": "application/json" });
        response.end('{"error":"Fixture request failed."}');
      });
    });
    const oauthOrigin = await listen(oauth);
    const config: ExchangeConfig = {
      origin: "http://127.0.0.1:0",
      githubClientId: "browser-fixture",
      githubClientSecret: "not-a-production-secret",
      adminGithubIds: new Set(["1001"]),
      operatorGithubIds: new Set(["5001"]),
      bucket,
      publishingEnabled: true,
      testGithubAuthUrls: {
        authorizeUrl: `${oauthOrigin}/login/oauth/authorize`,
        tokenUrl: `${oauthOrigin}/login/oauth/access_token`,
        userUrl: `${oauthOrigin}/user`,
      },
    };
    exchange = createExchangeServer(pool, storage, config);
    exchangeOrigin = await listen(exchange);
    (config as { origin: string }).origin = exchangeOrigin;
    const packages = [];
    for (const version of ["1.0.0", "1.1.0"]) {
      const source = Path.join(directory, `source-${version}`);
      await FS.cp(Path.resolve(import.meta.dirname, "../../../examples/hello-extension"), source, {
        recursive: true,
      });
      const manifestFile = Path.join(source, "tabs-extension.json");
      const manifest = JSON.parse(await FS.readFile(manifestFile, "utf8"));
      Object.assign(manifest, {
        publisher: "fixture",
        name: "browser-tool",
        version,
        displayName: "Browser acceptance tool",
        description: "A fixture tool for reviewing project task notes.",
        listing: {
          readme: "README.md",
          categories: ["productivity"],
          keywords: ["task-notes", "browser-acceptance"],
        },
      });
      manifest.engines.api = "^1.7.0";
      await FS.writeFile(manifestFile, JSON.stringify(manifest, null, 2));
      const archive = Path.join(directory, `browser-tool-${version}.tabsext`);
      const packed = await packTabsext({
        directory: source,
        destination: archive,
        tabsVersion: "1.3.17",
      });
      packages.push({ archive, digest: packed.digest, version });
    }
    await FS.writeFile(
      Path.join(directory, "fixture.json"),
      JSON.stringify(
        {
          testOnly: true,
          origin: exchangeOrigin,
          databaseUrl: database.toString(),
          bucket,
          s3Origin: storageUrl.origin,
          packages,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify(
        {
          notice: "LOCAL OAUTH FIXTURE, NOT LIVE GITHUB OR PRODUCTION",
          origin: exchangeOrigin,
          evidenceDirectory: directory,
          packages,
        },
        null,
        2,
      ),
    );
    const workerId = Crypto.randomUUID();
    while (!stop) {
      await recordWorkerHeartbeat(pool, workerId);
      const scanned = await scanNextVersion(pool, storage, config);
      if (scanned) await recordWorkerHeartbeat(pool, workerId, true);
      await new Promise((resolve) => setTimeout(resolve, scanned ? 20 : 500));
    }
  } finally {
    process.removeListener("SIGINT", stopSignal);
    process.removeListener("SIGTERM", stopSignal);
    for (const server of [exchange, oauth])
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    if (pool) await pool.end();
    if (databaseCreated) await rootPool.query(`DROP DATABASE ${databaseName}`);
    await rootPool.end();
    if (bucketCreated) {
      let continuation: string | undefined;
      do {
        const objects = await storage.send(
          new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuation }),
        );
        for (const entry of objects.Contents ?? [])
          if (entry.Key)
            await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: entry.Key }));
        continuation = objects.NextContinuationToken;
      } while (continuation);
      await storage.send(new DeleteBucketCommand({ Bucket: bucket }));
    }
    storage.destroy();
    console.log(
      `Fixture stopped. Its temporary database/bucket were removed; evidence and packages retained at ${directory}.`,
    );
  }
}
if (import.meta.main)
  void runBrowserFixture().catch((error) => {
    console.error(error instanceof Error ? error.message : "Browser fixture failed.");
    process.exitCode = 1;
  });
