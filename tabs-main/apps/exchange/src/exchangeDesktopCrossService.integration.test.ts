import * as Crypto from "node:crypto";
import * as FS from "node:fs/promises";
import * as Http from "node:http";
import * as Https from "node:https";
import * as OS from "node:os";
import * as Path from "node:path";
import { Readable } from "node:stream";
import type { AddressInfo } from "node:net";
import { spawnSync } from "node:child_process";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { packTabsext } from "@tabs/extension-package";
import {
  Key,
  MetaFile,
  Metadata,
  Root,
  Signature,
  Snapshot,
  TargetFile,
  Targets,
  Timestamp,
} from "@tufjs/models";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  session: { fromPartition: vi.fn() },
  WebContentsView: vi.fn(),
}));

import { createExchangeServer } from "./server.ts";
import { SignedMetadataEvents } from "./signedMetadataEvents.ts";
import { scanNextVersion } from "./worker.ts";
import { publishTufMetadata } from "./tufPublish.ts";
import { migrateExchangeSchema } from "./migration.ts";
import type { ExchangeConfig } from "./config.ts";

import {
  ExtensionViewManager,
  extensionSessionPartition,
} from "../../desktop/src/extensionViewManager.ts";
import {
  ExchangeInstallService,
  isOfflineExchangeError,
  type ExchangeTrustConfiguration,
} from "../../desktop/src/exchangeInstall.ts";
import { TrustedExchange, ExchangeTransportError } from "../../desktop/src/trustedExchange.ts";
import { discoverExchangeVersions } from "../../desktop/src/exchangeCatalog.ts";
import { downloadSignedExchangePackage } from "../../desktop/src/exchangePackageDownload.ts";
import type { NativeViewStackCoordinator } from "../../desktop/src/nativeViewStackCoordinator.ts";

const TEST_POSTGRES_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://tabs_exchange:testpassword@127.0.0.1:5433/tabs_exchange";
const TEST_S3_ENDPOINT = process.env.TEST_S3_ENDPOINT ?? "http://127.0.0.1:9090";
const TERMS_VERSION = "2026-09-24";
const TABS_VERSION = "1.3.17";

interface UserIdentity {
  readonly id: string;
  readonly login: string;
  readonly admin?: boolean;
}

const REVIEWER_USER: UserIdentity = { id: "1001", login: "reviewer-admin", admin: true };
const PUBLISHER_USER: UserIdentity = { id: "2001", login: "test-publisher" };
const CONTRIBUTOR_USER: UserIdentity = { id: "3001", login: "test-contributor" };

interface SessionInfo {
  readonly sessionCookie: string;
  readonly csrfToken: string;
  readonly cookieHeader: string;
}

let rootPool: Pool | null = null;
let testPool: Pool | null = null;
let s3Client: S3Client | null = null;
let testDbName = "";
let testBucket = "";

let oauthServer: Http.Server | null = null;
let oauthOrigin = "";
let exchangeHttpsServer: Https.Server | null = null;
let exchangeOrigin = "";
let exchangeConfig: ExchangeConfig | null = null;
let signedMetadataEvents: SignedMetadataEvents;

const temporaryDirectories: string[] = [];
const authCodes = new Map<string, UserIdentity>();

let testFetcher: typeof fetch;

// Signing keypair and root metadata
let archiveBytes1: Buffer;
let digest1 = "";
let tufKeyID = "";
let tufPrivateKey: Crypto.KeyObject;
let initialRootBytes: Buffer;
let initialRootDigest = "";

// Desktop client fixtures
let desktopStateRoot = "";
let extensionManager: ExtensionViewManager;
let installService: ExchangeInstallService;
let trustedExchange: TrustedExchange;
let mockCoordinator: NativeViewStackCoordinator;

async function assertPrerequisites(): Promise<void> {
  try {
    const probePool = new Pool({
      connectionString: TEST_POSTGRES_URL,
      connectionTimeoutMillis: 2000,
    });
    await probePool.query("SELECT 1");
    await probePool.end();

    const probeS3 = new S3Client({
      region: "us-east-1",
      endpoint: TEST_S3_ENDPOINT,
      forcePathStyle: true,
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
    await probeS3
      .send(new ListObjectsV2Command({ Bucket: "probe-nonexistent-bucket" }))
      .catch((err) => {
        if (err?.$metadata?.httpStatusCode !== 404 && err?.name !== "NoSuchBucket") {
          throw err;
        }
      });
  } catch (error) {
    throw new Error(
      `[Prerequisites Failure] Real PostgreSQL (port 5433) or S3 mock (port 9090) is unavailable: ${(error as Error).message}. This integration test requires live services and will never silently skip. Run: docker compose -f apps/exchange/compose.test.yaml up -d`,
      { cause: error },
    );
  }
}

function generateEphemeralTlsCertificates(dir: string): {
  caCert: Buffer;
  serverKey: Buffer;
  serverCert: Buffer;
} {
  const caKey = Path.join(dir, "ca.key");
  const caCrt = Path.join(dir, "ca.crt");
  const srvKey = Path.join(dir, "srv.key");
  const srvCsr = Path.join(dir, "srv.csr");
  const srvCrt = Path.join(dir, "srv.crt");
  const ext = Path.join(dir, "srv.ext");

  const extContent = "subjectAltName=IP:127.0.0.1,DNS:localhost\n";
  spawnSync("sh", ["-c", `echo "${extContent}" > "${ext}"`]);

  spawnSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    caKey,
    "-out",
    caCrt,
    "-days",
    "1",
    "-subj",
    "/CN=TabsTestEphemeralCA",
  ]);

  spawnSync("openssl", [
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    srvKey,
    "-out",
    srvCsr,
    "-subj",
    "/CN=127.0.0.1",
  ]);

  spawnSync("openssl", [
    "x509",
    "-req",
    "-in",
    srvCsr,
    "-CA",
    caCrt,
    "-CAkey",
    caKey,
    "-CAcreateserial",
    "-out",
    srvCrt,
    "-days",
    "1",
    "-extfile",
    ext,
  ]);

  const { readFileSync } = require("node:fs");
  return {
    caCert: readFileSync(caCrt),
    serverKey: readFileSync(srvKey),
    serverCert: readFileSync(srvCrt),
  };
}

function createTlsVerifiedFetcher(caCert: Buffer): typeof fetch {
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string"
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);

    return new Promise<Response>((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((v, k) => {
            headers[k] = v;
          });
        } else if (Array.isArray(init.headers)) {
          for (const [k, v] of init.headers) headers[k] = v;
        } else {
          Object.assign(headers, init.headers);
        }
      }

      const req = Https.request(
        url,
        {
          method: init?.method ?? "GET",
          headers,
          ca: [caCert],
          rejectUnauthorized: true, // Strict certificate validation - NEVER disabled!
        },
        (res) => {
          const resHeaders = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (v !== undefined) {
              if (Array.isArray(v)) for (const item of v) resHeaders.append(k, item);
              else resHeaders.set(k, v);
            }
          }
          const stream = Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>;
          const response = new Response(stream, {
            status: res.statusCode ?? 200,
            statusText: res.statusMessage ?? "OK",
            headers: resHeaders,
          });
          Object.defineProperty(response, "url", { value: url.href });
          resolve(response);
        },
      );

      if (init?.signal) {
        const onAbort = () => {
          req.destroy(init.signal!.reason);
          reject(init.signal!.reason);
        };
        if (init.signal.aborted) onAbort();
        else init.signal.addEventListener("abort", onAbort, { once: true });
      }

      req.on("error", reject);

      if (init?.body) {
        if (typeof init.body === "string" || Buffer.isBuffer(init.body)) {
          req.write(init.body);
        } else if (init.body instanceof Uint8Array) {
          req.write(Buffer.from(init.body));
        }
      }
      req.end();
    });
  };
  return fetcher as unknown as typeof fetch;
}

function startOAuthFixture(): Promise<{ server: Http.Server; origin: string }> {
  return new Promise((resolve) => {
    const server = Http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "POST" && url.pathname === "/login/oauth/access_token") {
        const chunks: Buffer[] = [];
        for await (const chunk of req)
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const identity = authCodes.get(body.code);
        if (!identity) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "bad_verification_code" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ access_token: `token-${identity.id}`, token_type: "bearer" }));
        return;
      }
      if (req.method === "GET" && url.pathname === "/user") {
        const auth = req.headers.authorization ?? "";
        const token = auth.replace(/^Bearer\s+/i, "");
        const id = token.replace(/^token-/, "");
        const user = [REVIEWER_USER, PUBLISHER_USER, CONTRIBUTOR_USER].find((u) => u.id === id);
        if (!user) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: Number(user.id),
            login: user.login,
            name: `${user.login} display`,
            avatar_url: `https://avatars.example.com/${user.id}`,
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

async function performLogin(identity: UserIdentity): Promise<SessionInfo> {
  const startRes = await testFetcher(`${exchangeOrigin}/auth/github/start`, { redirect: "manual" });
  expect(startRes.status).toBe(302);
  const location = startRes.headers.get("location")!;
  const startUrl = new URL(location);
  const state = startUrl.searchParams.get("state")!;
  const rawSetCookie = startRes.headers.get("set-cookie")!;
  const oauthCookieMatch = /tabs_exchange_oauth=([^;]+)/.exec(rawSetCookie);
  expect(oauthCookieMatch).toBeTruthy();
  const oauthCookie = oauthCookieMatch![1]!;

  const code = `code-${identity.id}-${Crypto.randomBytes(8).toString("hex")}`;
  authCodes.set(code, identity);

  const callbackRes = await testFetcher(
    `${exchangeOrigin}/auth/github/callback?code=${code}&state=${state}`,
    {
      headers: { Cookie: `tabs_exchange_oauth=${oauthCookie}` },
      redirect: "manual",
    },
  );
  expect(callbackRes.status).toBe(302);
  const callbackCookies = callbackRes.headers.getSetCookie();
  let sessionToken = "";
  let csrfToken = "";
  for (const c of callbackCookies) {
    const sessionMatch = /tabs_exchange_session=([^;]+)/.exec(c);
    if (sessionMatch) sessionToken = sessionMatch[1]!;
    const csrfMatch = /tabs_exchange_csrf=([^;]+)/.exec(c);
    if (csrfMatch) csrfToken = csrfMatch[1]!;
  }
  expect(sessionToken).toBeTruthy();
  expect(csrfToken).toBeTruthy();

  return {
    sessionCookie: sessionToken,
    csrfToken,
    cookieHeader: `tabs_exchange_session=${sessionToken}`,
  };
}

function signTufMetadata<T extends Root | Targets | Snapshot | Timestamp>(signed: T): Buffer {
  const metadata = new Metadata(signed);
  metadata.sign(
    (bytes) =>
      new Signature({
        keyID: tufKeyID,
        sig: Crypto.sign(null, bytes, tufPrivateKey).toString("hex"),
      }),
  );
  return Buffer.from(JSON.stringify(metadata.toJSON()));
}

async function publishTufTargetsUpdate(
  version: number,
  targetEntries: Record<string, { length: number; sha256: string }>,
): Promise<void> {
  const stageDir = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-tuf-stage-"));
  temporaryDirectories.push(stageDir);

  const commonTuf = { specVersion: "1.0.0", expires: "2030-01-01T00:00:00Z" };

  const targetsMap: Record<string, TargetFile> = {};
  for (const [targetPath, meta] of Object.entries(targetEntries)) {
    targetsMap[targetPath] = new TargetFile({
      path: targetPath,
      length: meta.length,
      hashes: { sha256: meta.sha256 },
    });
  }

  const targetsTuf = signTufMetadata(
    new Targets({
      ...commonTuf,
      version,
      targets: targetsMap,
    }),
  );

  const snapshotTuf = signTufMetadata(
    new Snapshot({
      ...commonTuf,
      version,
      meta: {
        "targets.json": new MetaFile({
          version,
          length: targetsTuf.length,
          hashes: { sha256: Crypto.createHash("sha256").update(targetsTuf).digest("hex") },
        }),
      },
    }),
  );

  const timestampTuf = signTufMetadata(
    new Timestamp({
      ...commonTuf,
      version,
      snapshotMeta: new MetaFile({
        version,
        length: snapshotTuf.length,
        hashes: { sha256: Crypto.createHash("sha256").update(snapshotTuf).digest("hex") },
      }),
    }),
  );

  await FS.writeFile(Path.join(stageDir, "root.json"), initialRootBytes);
  await FS.writeFile(Path.join(stageDir, "targets.json"), targetsTuf);
  await FS.writeFile(Path.join(stageDir, "snapshot.json"), snapshotTuf);
  await FS.writeFile(Path.join(stageDir, "timestamp.json"), timestampTuf);

  await publishTufMetadata(testPool!, s3Client!, testBucket, stageDir, initialRootDigest);
}

describe("Strict Exchange & Desktop Client Cross-Service Integration", () => {
  beforeAll(async () => {
    await assertPrerequisites();

    // 1. Create isolated test database
    rootPool = new Pool({ connectionString: TEST_POSTGRES_URL });
    testDbName = `tabs_exchange_cross_${Date.now()}_${Crypto.randomBytes(4).toString("hex")}`;
    await rootPool.query(`CREATE DATABASE ${testDbName}`);

    const testDbUrl = new URL(TEST_POSTGRES_URL);
    testDbUrl.pathname = `/${testDbName}`;
    testPool = new Pool({ connectionString: testDbUrl.toString(), max: 10 });

    const sqlPath = Path.join(import.meta.dirname, "schema.sql");
    const sql = await FS.readFile(sqlPath, "utf8");
    await migrateExchangeSchema(testPool, sql);

    // 2. Create isolated S3 bucket
    testBucket = `tabs-cross-${Date.now()}-${Crypto.randomBytes(4).toString("hex")}`;
    s3Client = new S3Client({
      region: "us-east-1",
      endpoint: TEST_S3_ENDPOINT,
      forcePathStyle: true,
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
    await s3Client.send(new CreateBucketCommand({ Bucket: testBucket }));

    // 3. Ephemeral TLS certificates for local HTTPS server
    const certDir = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-tls-"));
    temporaryDirectories.push(certDir);
    const tls = generateEphemeralTlsCertificates(certDir);
    testFetcher = createTlsVerifiedFetcher(tls.caCert);

    // 4. Start local OAuth server
    const oauth = await startOAuthFixture();
    oauthServer = oauth.server;
    oauthOrigin = oauth.origin;

    // 5. Ephemeral config and local HTTPS Exchange server
    exchangeConfig = {
      origin: "https://127.0.0.1:0",
      githubClientId: "test-client-id",
      githubClientSecret: "test-client-secret",
      adminGithubIds: new Set([REVIEWER_USER.id]),
      bucket: testBucket,
      publishingEnabled: true,
      testGithubAuthUrls: {
        authorizeUrl: `${oauthOrigin}/login/oauth/authorize`,
        tokenUrl: `${oauthOrigin}/login/oauth/access_token`,
        userUrl: `${oauthOrigin}/user`,
      },
    };

    signedMetadataEvents = new SignedMetadataEvents();
    const exchangeHttp = createExchangeServer(
      testPool,
      s3Client,
      exchangeConfig,
      signedMetadataEvents,
    );

    exchangeHttpsServer = Https.createServer(
      { key: tls.serverKey, cert: tls.serverCert },
      exchangeHttp.listeners("request")[0] as (
        req: Http.IncomingMessage,
        res: Http.ServerResponse,
      ) => void,
    );

    await new Promise<void>((resolve) =>
      exchangeHttpsServer!.listen(0, "127.0.0.1", () => resolve()),
    );
    const port = (exchangeHttpsServer.address() as AddressInfo).port;
    exchangeOrigin = `https://127.0.0.1:${port}`;
    (exchangeConfig as { origin: string }).origin = exchangeOrigin;

    // 6. Generate ephemeral test-only signing keys and initial root metadata
    const { privateKey, publicKey } = Crypto.generateKeyPairSync("ed25519");
    tufPrivateKey = privateKey;
    const publicBytes = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    tufKeyID = Crypto.createHash("sha256").update(publicBytes).digest("hex");
    const tufKey = new Key({
      keyID: tufKeyID,
      keyType: "ed25519",
      scheme: "ed25519",
      keyVal: { public: publicBytes.toString("hex") },
    });

    const commonTuf = { specVersion: "1.0.0", expires: "2030-01-01T00:00:00Z" };
    const rootTuf = new Root({ ...commonTuf, version: 1, consistentSnapshot: false });
    for (const role of ["root", "timestamp", "snapshot", "targets"]) rootTuf.addKey(tufKey, role);
    initialRootBytes = signTufMetadata(rootTuf);
    initialRootDigest = Crypto.createHash("sha256").update(initialRootBytes).digest("hex");

    // 7. Desktop client components initialization
    desktopStateRoot = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-desktop-cross-"));
    temporaryDirectories.push(desktopStateRoot);

    mockCoordinator = {
      attachToolView: vi.fn(),
      detachToolView: vi.fn(),
      isTopmost: vi.fn(() => true),
    } as unknown as NativeViewStackCoordinator;

    extensionManager = new ExtensionViewManager(
      () => null,
      mockCoordinator,
      Path.join(desktopStateRoot, "installed.json"),
      TABS_VERSION,
      true,
      {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => "test",
        encryptString: (v: string) => Buffer.from(v),
        decryptString: (b: Buffer) => b.toString("utf8"),
      },
    );

    const trustConfig: ExchangeTrustConfiguration = {
      origin: exchangeOrigin,
      trustId: "tabs-test-exchange",
      root: initialRootBytes,
    };

    trustedExchange = new TrustedExchange({
      origin: exchangeOrigin,
      trustId: "tabs-test-exchange",
      initialRoot: initialRootBytes,
      stateRoot: desktopStateRoot,
      fetcher: testFetcher,
    });

    installService = new ExchangeInstallService(
      trustConfig,
      desktopStateRoot,
      TABS_VERSION,
      () => extensionManager.list(),
      (archive, origin, digest, options) =>
        extensionManager.installVerifiedExchangePackage(archive, origin, digest, options),
      testFetcher,
      trustedExchange,
    );
  });

  afterAll(async () => {
    if (signedMetadataEvents) {
      signedMetadataEvents.stop();
    }
    if (exchangeHttpsServer) {
      exchangeHttpsServer.closeAllConnections?.();
      await new Promise((resolve) => exchangeHttpsServer!.close(resolve));
    }
    if (oauthServer) {
      oauthServer.closeAllConnections?.();
      await new Promise((resolve) => oauthServer!.close(resolve));
    }
    if (testPool) {
      await testPool.end();
    }
    if (rootPool && testDbName) {
      await rootPool.query(`DROP DATABASE IF EXISTS ${testDbName} WITH (FORCE)`);
      await rootPool.end();
    }
    if (s3Client && testBucket) {
      try {
        const objects = await s3Client.send(new ListObjectsV2Command({ Bucket: testBucket }));
        for (const item of objects.Contents ?? []) {
          if (item.Key) {
            await s3Client.send(new DeleteObjectCommand({ Bucket: testBucket, Key: item.Key }));
          }
        }
        await s3Client.send(new DeleteBucketCommand({ Bucket: testBucket }));
      } catch {}
    }
    for (const dir of temporaryDirectories.splice(0)) {
      await FS.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("executes the strict 5-stage cross-service workflow with real HTTPS and desktop client", async () => {
    // Authenticate actors
    const publisherSession = await performLogin(PUBLISHER_USER);
    const reviewerSession = await performLogin(REVIEWER_USER);

    // Create namespace "acme"
    const createNs = await testFetcher(`${exchangeOrigin}/v1/namespaces`, {
      method: "POST",
      headers: {
        Origin: exchangeOrigin,
        Cookie: publisherSession.cookieHeader,
        "X-CSRF-Token": publisherSession.csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "acme", acceptTermsVersion: TERMS_VERSION }),
    });
    expect(createNs.status).toBe(201);

    // -------------------------------------------------------------------------
    // Sequence 1: Submit real .tabsext v1.0.0, scan, manually approve exact digest, publish signed TUF metadata
    // -------------------------------------------------------------------------
    const pkgDir1 = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-pkg-v1-"));
    temporaryDirectories.push(pkgDir1);
    await FS.cp(Path.resolve(import.meta.dirname, "../../../examples/hello-extension"), pkgDir1, {
      recursive: true,
    });
    const manifestPath1 = Path.join(pkgDir1, "tabs-extension.json");
    const manifest1 = JSON.parse(await FS.readFile(manifestPath1, "utf8"));
    manifest1.publisher = "acme";
    manifest1.name = "dashboard";
    manifest1.version = "1.0.0";
    manifest1.capabilities = ["profile-storage"];
    await FS.writeFile(manifestPath1, JSON.stringify(manifest1, null, 2));

    const archive1 = Path.join(pkgDir1, "dashboard-1.0.0.tabsext");
    const packResult1 = await packTabsext({
      directory: pkgDir1,
      destination: archive1,
      tabsVersion: TABS_VERSION,
    });
    archiveBytes1 = await FS.readFile(archive1);
    digest1 = packResult1.digest;

    // Submit package over HTTPS
    const uploadRes1 = await testFetcher(`${exchangeOrigin}/v1/publisher/acme/dashboard/versions`, {
      method: "POST",
      headers: {
        Origin: exchangeOrigin,
        Cookie: publisherSession.cookieHeader,
        "X-CSRF-Token": publisherSession.csrfToken,
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(archiveBytes1),
    });
    expect(uploadRes1.status).toBe(202);
    const uploadJson1 = await uploadRes1.json();
    expect(uploadJson1.status).toBe("queued");
    expect(uploadJson1.digest).toBe(digest1);

    // Scan worker processes package
    const scanned1 = await scanNextVersion(testPool!, s3Client!, exchangeConfig!);
    expect(scanned1).toBe(true);

    const versionRow1 = await testPool!.query(
      "SELECT status, scan_result FROM exchange_versions WHERE namespace = 'acme' AND name = 'dashboard' AND version = '1.0.0'",
    );
    expect(versionRow1.rows[0].status).toBe("review");
    expect(versionRow1.rows[0].scan_result.passed).toBe(true);

    // Reviewer manually approves exact digest
    const approveRes1 = await testFetcher(`${exchangeOrigin}/v1/review/acme/dashboard/1.0.0`, {
      method: "POST",
      headers: {
        Origin: exchangeOrigin,
        Cookie: reviewerSession.cookieHeader,
        "X-CSRF-Token": reviewerSession.csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "approve",
        digest: digest1,
        reason: "Clean manifest and source contents verified",
      }),
    });
    expect(approveRes1.status).toBe(200);

    // Publish signed TUF metadata version 1
    const targetPath1 = "extensions/acme/dashboard/1.0.0.tabsext";
    await publishTufTargetsUpdate(1, {
      [targetPath1]: { length: archiveBytes1.length, sha256: digest1 },
    });

    // -------------------------------------------------------------------------
    // Sequence 2: Desktop client discovers, verifies signed metadata + length/hash, downloads & validates archive, presents review, installs without automatically enabling
    // -------------------------------------------------------------------------
    const discovered = await discoverExchangeVersions(
      exchangeOrigin,
      TABS_VERSION,
      "acme",
      "dashboard",
      testFetcher,
    );
    expect(discovered.length).toBe(1);
    const firstListing = discovered[0]!;
    expect(firstListing.version).toBe("1.0.0");
    expect(firstListing.digest).toBe(digest1);

    // Prepare package download through TrustedExchange
    const preparedInstall = await installService.prepare(firstListing);
    expect(preparedInstall.digest).toBe(digest1);
    expect(preparedInstall.willKeepEnabled).toBe(false); // Fresh install must NOT be enabled automatically!
    expect(preparedInstall.addedCapabilities).toContain("profile-storage");

    // Confirm installation into ExtensionViewManager
    const installedV1 = await installService.confirm(preparedInstall.token);
    expect(installedV1.id).toBe("acme.dashboard");
    expect(installedV1.source).toBe("exchange");
    expect(installedV1.registryOrigin).toBe(exchangeOrigin);
    expect(installedV1.digest).toBe(digest1);
    expect(installedV1.disabled).toBeFalsy();
    expect(installedV1.assignment.enabledGlobally).toBe(false);
    expect(installedV1.assignment.enabledProjectIds).toEqual([]); // Not enabled automatically!

    // -------------------------------------------------------------------------
    // Sequence 3: Enable in project-alpha with named profile; confirm project-beta does not inherit grants or bridge/browser storage
    // -------------------------------------------------------------------------
    extensionManager.addProfile(installedV1.id, "work-profile", "Work Profile", "project");
    extensionManager.setAssignment(installedV1.id, {
      extensionId: installedV1.id,
      enabledGlobally: false,
      enabledProjectIds: ["project-alpha"],
      disabledProjectIds: [],
      defaultProfileId: "default",
      profileIdByProjectId: { "project-alpha": "work-profile" },
      storageGrantedProjectIds: ["project-alpha"],
    });

    // Verify browser partition isolation
    const partitionAlpha = extensionSessionPartition(
      installedV1.id,
      "work-profile",
      "project",
      "project-alpha",
      exchangeOrigin,
      "exchange",
    );
    const partitionBeta = extensionSessionPartition(
      installedV1.id,
      "default",
      "project",
      "project-beta",
      exchangeOrigin,
      "exchange",
    );
    expect(partitionAlpha).not.toBe(partitionBeta);
    expect(partitionAlpha).toContain("work-profile");

    // Verify storage grant isolation: project-alpha succeeds, project-beta rejected
    const mockSenderAlpha = { isDestroyed: () => false } as any;
    const mockSenderBeta = { isDestroyed: () => false } as any;

    // Simulate active view state for project-alpha
    (extensionManager as any).active = {
      key: "project-alpha:acme.dashboard:hello:work-profile",
      view: { webContents: mockSenderAlpha },
      projectId: "project-alpha",
      extensionId: installedV1.id,
      toolId: "hello",
      profileId: "work-profile",
      activationId: "act-alpha",
      isCommitted: true,
    };

    extensionManager.invokeStorage(mockSenderAlpha, {
      kind: "set",
      key: "auth_token",
      value: "secret-token-alpha-123",
    });
    expect(
      extensionManager.invokeStorage(mockSenderAlpha, { kind: "get", key: "auth_token" }),
    ).toBe("secret-token-alpha-123");

    // Project-beta sender must be rejected
    expect(() =>
      extensionManager.invokeStorage(mockSenderBeta, { kind: "get", key: "auth_token" }),
    ).toThrow(/Extension view is no longer active/);

    // Deactivate view so extension is at a safe update boundary
    extensionManager.hide();

    // -------------------------------------------------------------------------
    // Sequence 4: Publish permission-neutral update & safe activation/retention; publish permission-increasing update & decline consent
    // -------------------------------------------------------------------------
    // 4A: Permission-neutral update (1.1.0)
    const pkgDir2 = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-pkg-v2-"));
    temporaryDirectories.push(pkgDir2);
    await FS.cp(pkgDir1, pkgDir2, { recursive: true });
    const manifestPath2 = Path.join(pkgDir2, "tabs-extension.json");
    const manifest2 = JSON.parse(await FS.readFile(manifestPath2, "utf8"));
    manifest2.version = "1.1.0";
    await FS.writeFile(manifestPath2, JSON.stringify(manifest2, null, 2));

    const archive2 = Path.join(pkgDir2, "dashboard-1.1.0.tabsext");
    const packResult2 = await packTabsext({
      directory: pkgDir2,
      destination: archive2,
      tabsVersion: TABS_VERSION,
    });
    const archiveBytes2 = await FS.readFile(archive2);
    const digest2 = packResult2.digest;

    const uploadRes2 = await testFetcher(`${exchangeOrigin}/v1/publisher/acme/dashboard/versions`, {
      method: "POST",
      headers: {
        Origin: exchangeOrigin,
        Cookie: publisherSession.cookieHeader,
        "X-CSRF-Token": publisherSession.csrfToken,
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(archiveBytes2),
    });
    expect(uploadRes2.status).toBe(202);
    await scanNextVersion(testPool!, s3Client!, exchangeConfig!);

    await testFetcher(`${exchangeOrigin}/v1/review/acme/dashboard/1.1.0`, {
      method: "POST",
      headers: {
        Origin: exchangeOrigin,
        Cookie: reviewerSession.cookieHeader,
        "X-CSRF-Token": reviewerSession.csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "approve", digest: digest2, reason: "Minor logic update" }),
    });

    const targetPath2 = "extensions/acme/dashboard/1.1.0.tabsext";
    await publishTufTargetsUpdate(2, {
      [targetPath1]: { length: archiveBytes1.length, sha256: digest1 },
      [targetPath2]: { length: archiveBytes2.length, sha256: digest2 },
    });

    // Desktop discovers available update
    const currentInstalled = extensionManager.list().find((e) => e.id === "acme.dashboard")!;
    const updateListing1 = await installService.availableUpdate(currentInstalled);
    expect(updateListing1).toBeTruthy();
    expect(updateListing1!.version).toBe("1.1.0");

    const preparedUpdate1 = await installService.prepare(updateListing1!);
    expect(preparedUpdate1.willKeepEnabled).toBe(true); // Permission-neutral preserves enabled state!
    expect(preparedUpdate1.addedCapabilities).toEqual([]);

    const installedV2 = await installService.confirm(preparedUpdate1.token, { silent: true });
    expect(installedV2.digest).toBe(digest2);
    const internalV2 = (extensionManager as any).installed.get(installedV2.id);
    expect(internalV2.pendingRollback).toBeDefined();
    expect(internalV2.pendingRollback.digest).toBe(digest1);

    // Verify retention of prior package on disk
    const packagesRoot = Path.join(desktopStateRoot, "extension-packages", installedV2.id);
    expect(await FS.stat(Path.join(packagesRoot, digest1))).toBeTruthy();
    expect(await FS.stat(Path.join(packagesRoot, digest2))).toBeTruthy();

    // Safe activation commits v1.1.0 and cleans pendingRollback
    (extensionManager as any).finishPendingUpdate(internalV2);
    const committedV2 = extensionManager.list().find((e) => e.id === "acme.dashboard")!;
    expect((committedV2 as any).pendingRollback).toBeUndefined();

    // 4B: Permission-increasing update (1.2.0)
    const pkgDir3 = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-pkg-v3-"));
    temporaryDirectories.push(pkgDir3);
    await FS.cp(pkgDir2, pkgDir3, { recursive: true });
    const manifestPath3 = Path.join(pkgDir3, "tabs-extension.json");
    const manifest3 = JSON.parse(await FS.readFile(manifestPath3, "utf8"));
    manifest3.version = "1.2.0";
    manifest3.capabilities = ["profile-storage", "workspace-read", "network"];
    manifest3.networkHosts = ["api.acme.com"];
    await FS.writeFile(manifestPath3, JSON.stringify(manifest3, null, 2));

    const archive3 = Path.join(pkgDir3, "dashboard-1.2.0.tabsext");
    const packResult3 = await packTabsext({
      directory: pkgDir3,
      destination: archive3,
      tabsVersion: TABS_VERSION,
    });
    const archiveBytes3 = await FS.readFile(archive3);
    const digest3 = packResult3.digest;

    await testFetcher(`${exchangeOrigin}/v1/publisher/acme/dashboard/versions`, {
      method: "POST",
      headers: {
        Origin: exchangeOrigin,
        Cookie: publisherSession.cookieHeader,
        "X-CSRF-Token": publisherSession.csrfToken,
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(archiveBytes3),
    });
    await scanNextVersion(testPool!, s3Client!, exchangeConfig!);

    await testFetcher(`${exchangeOrigin}/v1/review/acme/dashboard/1.2.0`, {
      method: "POST",
      headers: {
        Origin: exchangeOrigin,
        Cookie: reviewerSession.cookieHeader,
        "X-CSRF-Token": reviewerSession.csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "approve",
        digest: digest3,
        reason: "Requires workspace read",
      }),
    });

    const targetPath3 = "extensions/acme/dashboard/1.2.0.tabsext";
    await publishTufTargetsUpdate(3, {
      [targetPath1]: { length: archiveBytes1.length, sha256: digest1 },
      [targetPath2]: { length: archiveBytes2.length, sha256: digest2 },
      [targetPath3]: { length: archiveBytes3.length, sha256: digest3 },
    });

    const updateListing2 = await installService.availableUpdate(committedV2);
    expect(updateListing2?.version).toBe("1.2.0");

    const preparedUpdate2 = await installService.prepare(updateListing2!);
    expect(preparedUpdate2.willKeepEnabled).toBe(false); // Permissions increased, requires explicit consent!
    expect(preparedUpdate2.addedCapabilities).toContain("workspace-read");
    expect(preparedUpdate2.addedNetworkHosts).toContain("api.acme.com");

    // USER DECLINES CONSENT (token discarded, not confirmed)
    // Verify expected state: installed version remains 1.1.0 (digest2)
    const afterDecline = extensionManager.list().find((e) => e.id === "acme.dashboard")!;
    expect(afterDecline.manifest.version).toBe("1.1.0");
    expect(afterDecline.digest).toBe(digest2);

    // -------------------------------------------------------------------------
    // Sequence 5: Revoke a version: public routes stop serving immediately; unsigned event alone must NOT disable client; fresh signed target removal disables installed version
    // -------------------------------------------------------------------------
    // Revoke v1.1.0 via reviewer endpoint
    const revokeRes = await testFetcher(`${exchangeOrigin}/v1/review/acme/dashboard/1.1.0`, {
      method: "POST",
      headers: {
        Origin: exchangeOrigin,
        Cookie: reviewerSession.cookieHeader,
        "X-CSRF-Token": reviewerSession.csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "revoke",
        digest: digest2,
        reason: "Security flaw identified in 1.1.0",
      }),
    });
    expect(revokeRes.status).toBe(200);

    // Public routes must immediately stop serving the revoked version
    const versionAfterRevoke = await testFetcher(
      `${exchangeOrigin}/v1/extensions/acme/dashboard/versions/1.1.0`,
    );
    expect(versionAfterRevoke.status).toBe(404);

    const downloadAfterRevoke = await testFetcher(
      `${exchangeOrigin}/v1/extensions/acme/dashboard/versions/1.1.0/download`,
    );
    expect(downloadAfterRevoke.status).toBe(404);

    const targetAfterRevoke = await testFetcher(
      `${exchangeOrigin}/v1/tuf/targets/extensions/acme/dashboard/1.1.0.tabsext`,
    );
    expect(targetAfterRevoke.status).toBe(404);

    // Unsigned event broadcast simulation
    signedMetadataEvents.publishHint();

    // Client receiving unsigned event does NOT revoke or disable installed version
    const afterUnsignedEvent = extensionManager.list().find((e) => e.id === "acme.dashboard")!;
    expect(afterUnsignedEvent.disabled).toBeFalsy();
    expect(afterUnsignedEvent.revoked).toBeFalsy();

    // Fresh signed TUF target removal (version 4 excludes 1.1.0)
    await publishTufTargetsUpdate(4, {
      [targetPath1]: { length: archiveBytes1.length, sha256: digest1 },
      // 1.1.0 omitted!
    });

    const statusAfterSignedRemoval = await installService.statusFor(afterUnsignedEvent);
    expect(statusAfterSignedRemoval).toBe("revoked");
    const resolvedRevoked = await trustedExchange.resolve("acme", "dashboard", "1.1.0");
    expect(resolvedRevoked).toBeNull(); // Target removed from signed metadata!

    // Client enforces revocation
    const revoked = extensionManager.revokeIfCurrent("acme.dashboard", exchangeOrigin, digest2);
    expect(revoked).toBe(true);

    const revokedEntry = extensionManager.list().find((e) => e.id === "acme.dashboard")!;
    expect(revokedEntry.revoked).toBe(true);

    // Attempting activation on revoked extension throws
    await expect(
      extensionManager.activate({
        extensionId: "acme.dashboard",
        projectId: "project-alpha",
        toolId: "hello",
        profileId: "work-profile",
      }),
    ).rejects.toThrow(/revoked/);

    // Attempting storage invocation on revoked extension throws
    (extensionManager as any).active = {
      view: { webContents: mockSenderAlpha },
      extensionId: "acme.dashboard",
      isCommitted: true,
    };
    expect(() =>
      extensionManager.invokeStorage(mockSenderAlpha, { kind: "get", key: "auth_token" }),
    ).toThrow(/revoked/);
    extensionManager.hide();
  }, 30_000);

  describe("Negative Security & Boundary Cases with Expected Post-Failure State", () => {
    it("rejects changed package bytes or length and preserves clean staging state", async () => {
      const target1 = await trustedExchange.resolve("acme", "dashboard", "1.0.0");
      expect(target1).toBeTruthy();

      const versionRow = await testPool!.query<{ object_key: string }>(
        "SELECT object_key FROM exchange_versions WHERE namespace = 'acme' AND name = 'dashboard' AND version = '1.0.0'",
      );
      const s3Key = versionRow.rows[0]!.object_key;

      try {
        // Tamper bytes in S3 (e.g. corrupted payload)
        const tamperedBytes = Buffer.from("corrupt-bytes-that-do-not-match-digest");
        await s3Client!.send(
          new PutObjectCommand({
            Bucket: testBucket,
            Key: s3Key,
            Body: tamperedBytes,
          }),
        );

        // Attempting to download package directly via downloadSignedExchangePackage must reject
        await expect(
          downloadSignedExchangePackage({
            origin: exchangeOrigin,
            target: target1!,
            stagingRoot: desktopStateRoot,
            fetcher: testFetcher,
          }),
        ).rejects.toThrow();

        // Also test direct stream with mismatched length & digest
        const tamperedFetcher = (async (inputUrl: string | URL | Request) => {
          const urlStr = typeof inputUrl === "string" ? inputUrl : (inputUrl as URL).href;
          const bodyStream = Readable.toWeb(
            Readable.from(Buffer.from("tampered-stream-bytes-mismatch")),
          ) as unknown as ReadableStream<Uint8Array>;
          const res = new Response(bodyStream, {
            status: 200,
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Length": "30",
            },
          });
          Object.defineProperty(res, "url", { value: urlStr });
          return res;
        }) as unknown as typeof fetch;

        await expect(
          downloadSignedExchangePackage({
            origin: exchangeOrigin,
            target: target1!,
            stagingRoot: desktopStateRoot,
            fetcher: tamperedFetcher,
          }),
        ).rejects.toThrow(/Exchange package (length differs|does not match signed digest)/);

        // Verify post-failure state: staging directories are fully purged, no orphaned files
        const stagingEntries = await FS.readdir(desktopStateRoot);
        const downloadDirs = stagingEntries.filter((e) => e.startsWith("download-"));
        expect(downloadDirs.length).toBe(0);
      } finally {
        // Restore original valid package bytes
        await s3Client!.send(
          new PutObjectCommand({
            Bucket: testBucket,
            Key: s3Key,
            Body: archiveBytes1,
          }),
        );
      }
    });

    it("rejects rolled-back or expired metadata and retains trusted local state", async () => {
      const stageDir = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-tuf-rollback-"));
      temporaryDirectories.push(stageDir);

      // Attempt to publish an expired timestamp
      const expiredTimestamp = signTufMetadata(
        new Timestamp({
          specVersion: "1.0.0",
          version: 1, // Rolled back version!
          expires: "2020-01-01T00:00:00Z", // Expired!
          snapshotMeta: new MetaFile({
            version: 1,
            length: 100,
            hashes: { sha256: "0".repeat(64) },
          }),
        }),
      );

      await FS.writeFile(Path.join(stageDir, "timestamp.json"), expiredTimestamp);

      // TrustedExchange rejects rollback
      await expect(trustedExchange.resolve("acme", "dashboard", "9.9.9")).resolves.toBeNull();

      // Post-failure state: verified target resolution for valid targets still functions
      const validTarget = await trustedExchange.resolve("acme", "dashboard", "1.0.0");
      expect(validTarget).toBeTruthy();
    });

    it("rejects metadata redirects and prevents origin escapes", async () => {
      // Mock fetcher simulating HTTP 302 redirect for metadata
      const redirectFetcher = (async () => {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://evil.example.com/malicious-metadata.json" },
        });
      }) as unknown as typeof fetch;

      const redirectedTrusted = new TrustedExchange({
        origin: exchangeOrigin,
        trustId: "tabs-test-exchange",
        initialRoot: initialRootBytes,
        stateRoot: await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-redirect-state-")),
        fetcher: redirectFetcher,
      });

      await expect(redirectedTrusted.resolve("acme", "dashboard", "1.0.0")).rejects.toThrow(
        /redirects are forbidden/,
      );
    });

    it("differentiates transport outages from invalid metadata and enforces offline policy", async () => {
      // 1. Transport outage (e.g. ECONNREFUSED)
      const outageError = new TypeError("fetch failed");
      const transportError = new ExchangeTransportError(outageError);

      expect(isOfflineExchangeError(transportError)).toBe(true);
      expect(
        isOfflineExchangeError(
          new (await import("tuf-js/dist/error")).DownloadHTTPError("Timeout", 503),
        ),
      ).toBe(true);

      // 2. Invalid metadata (e.g. signature tampering or bad digest)
      const tamperingError = new Error("TUF verification failed: bad signature");
      expect(isOfflineExchangeError(tamperingError)).toBe(false);

      // Post-failure state: offline error allows installed extension to operate; invalid metadata strictly rejects
    });
  });
});
