import * as Crypto from "node:crypto";
import * as FS from "node:fs/promises";
import * as Http from "node:http";
import * as OS from "node:os";
import * as Path from "node:path";
import type { AddressInfo } from "node:net";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
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
import { createExchangeServer } from "./server.ts";
import { scanNextVersion } from "./worker.ts";
import { publishTufMetadata } from "./tufPublish.ts";
import { migrateExchangeSchema } from "./migration.ts";
import { backupExchangeData, restoreExchangeData } from "./backupRestore.ts";
import type { ExchangeConfig } from "./config.ts";

const TEST_POSTGRES_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://tabs_exchange:testpassword@127.0.0.1:5433/tabs_exchange";
const TEST_S3_ENDPOINT = process.env.TEST_S3_ENDPOINT ?? "http://127.0.0.1:9090";
const TERMS_VERSION = "2026-09-24";

interface UserIdentity {
  readonly id: string;
  readonly login: string;
  readonly admin?: boolean;
}

const REVIEWER_USER: UserIdentity = { id: "1001", login: "reviewer-admin", admin: true };
const PUBLISHER_USER: UserIdentity = { id: "2001", login: "test-publisher" };
const CONTRIBUTOR_USER: UserIdentity = { id: "3001", login: "test-contributor" };
const OUTSIDER_USER: UserIdentity = { id: "4001", login: "test-outsider" };

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
let exchangeServer: Http.Server | null = null;
let exchangeOrigin = "";
let exchangeConfig: ExchangeConfig | null = null;

const temporaryDirectories: string[] = [];
const authCodes = new Map<string, UserIdentity>();

async function checkPrerequisites(): Promise<boolean> {
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
    // Check S3 availability via list or head
    await probeS3
      .send(new ListObjectsV2Command({ Bucket: "probe-nonexistent-bucket" }))
      .catch((err) => {
        // 404 NoSuchBucket means S3 endpoint is alive and speaking S3 protocol
        if (err?.$metadata?.httpStatusCode !== 404 && err?.name !== "NoSuchBucket") {
          throw err;
        }
      });
    return true;
  } catch (error) {
    console.warn(
      `[Checkpoint 1 Integration] PostgreSQL or S3 container not reachable at ${TEST_POSTGRES_URL} / ${TEST_S3_ENDPOINT}: ${(error as Error).message}. Run: docker compose -f apps/exchange/compose.test.yaml up -d`,
    );
    return false;
  }
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
        const code = body.code;
        const identity = authCodes.get(code);
        if (!identity) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "bad_verification_code" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ access_token: `token-${code}`, token_type: "bearer" }));
        return;
      }
      if (req.method === "GET" && url.pathname === "/user") {
        const authHeader = req.headers.authorization ?? "";
        const token = authHeader.replace(/^Bearer\s+/, "");
        const code = token.replace(/^token-/, "");
        const identity = authCodes.get(code);
        if (!identity) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "Bad credentials" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: Number(identity.id), login: identity.login }));
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

function startExchangeServer(
  pool: Pool,
  storage: S3Client,
  config: ExchangeConfig,
): Promise<{ server: Http.Server; origin: string }> {
  return new Promise((resolve) => {
    const server = createExchangeServer(pool, storage, config);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

async function performLogin(identity: UserIdentity): Promise<SessionInfo> {
  const startRes = await fetch(`${exchangeOrigin}/auth/github/start`, { redirect: "manual" });
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

  const callbackRes = await fetch(
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

const describeLive = process.env.TABS_EXCHANGE_INTEGRATION === "1" ? describe : describe.skip;

describeLive("Exchange Real Local Service Flow (Checkpoint 1)", () => {
  beforeAll(async () => {
    if (!(await checkPrerequisites())) {
      throw new Error("Exchange integration tests require the local PostgreSQL and S3 stack.");
    }

    // Create isolated test database
    rootPool = new Pool({ connectionString: TEST_POSTGRES_URL });
    testDbName = `tabs_exchange_test_${Date.now()}_${Crypto.randomBytes(4).toString("hex")}`;
    await rootPool.query(`CREATE DATABASE ${testDbName}`);

    const testDbUrl = new URL(TEST_POSTGRES_URL);
    testDbUrl.pathname = `/${testDbName}`;
    testPool = new Pool({ connectionString: testDbUrl.toString(), max: 10 });

    const sqlPath = Path.join(import.meta.dirname, "schema.sql");
    const sql = await FS.readFile(sqlPath, "utf8");
    await migrateExchangeSchema(testPool, sql);

    // Create isolated S3 bucket
    testBucket = `tabs-exchange-test-${Date.now()}-${Crypto.randomBytes(4).toString("hex")}`;
    s3Client = new S3Client({
      region: "us-east-1",
      endpoint: TEST_S3_ENDPOINT,
      forcePathStyle: true,
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
    await s3Client.send(new CreateBucketCommand({ Bucket: testBucket }));

    // Start local OAuth fixture
    const oauth = await startOAuthFixture();
    oauthServer = oauth.server;
    oauthOrigin = oauth.origin;

    // Ephemeral config for Exchange server
    exchangeConfig = {
      origin: "http://127.0.0.1:0", // Will be bound on listen
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

    const exchange = await startExchangeServer(testPool, s3Client, exchangeConfig);
    exchangeServer = exchange.server;
    exchangeOrigin = exchange.origin;
    (exchangeConfig as { origin: string }).origin = exchangeOrigin;
  });

  afterAll(async () => {
    if (exchangeServer) {
      await new Promise((resolve) => exchangeServer!.close(resolve));
    }
    if (oauthServer) {
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
      } catch {
        // ignore bucket cleanup errors
      }
    }
    for (const dir of temporaryDirectories.splice(0)) {
      await FS.rm(dir, { recursive: true, force: true });
    }
  });

  it("exercises the full publisher, contributor, reviewer, worker, publication, and revocation lifecycle", async () => {
    expect(testPool).toBeTruthy();
    expect(s3Client).toBeTruthy();
    expect(exchangeConfig).toBeTruthy();

    // 1. Sign in as publisher, contributor, and reviewer
    const publisherSession = await performLogin(PUBLISHER_USER);
    const contributorSession = await performLogin(CONTRIBUTOR_USER);
    const reviewerSession = await performLogin(REVIEWER_USER);

    // Verify /v1/me returns authenticated actors
    const meRes = await fetch(`${exchangeOrigin}/v1/me`, {
      headers: { Cookie: publisherSession.cookieHeader },
    });
    expect(meRes.status).toBe(200);
    const meData = await meRes.json();
    expect(meData.id).toBe(PUBLISHER_USER.id);
    expect(meData.login).toBe(PUBLISHER_USER.login);

    // 2. Terms acceptance check: reject namespace without exact terms
    const badTermsRes = await fetch(`${exchangeOrigin}/v1/namespaces`, {
      method: "POST",
      headers: {
        Origin: exchangeOrigin,
        Cookie: publisherSession.cookieHeader,
        "X-CSRF-Token": publisherSession.csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "acme", acceptTermsVersion: "invalid-version" }),
    });
    expect(badTermsRes.status).toBe(400);

    // Accept exact terms and create namespace "acme"
    const createNsRes = await fetch(`${exchangeOrigin}/v1/namespaces`, {
      method: "POST",
      headers: {
        Origin: exchangeOrigin,
        Cookie: publisherSession.cookieHeader,
        "X-CSRF-Token": publisherSession.csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "acme", acceptTermsVersion: TERMS_VERSION }),
    });
    expect(createNsRes.status).toBe(201);
    const nsData = await createNsRes.json();
    expect(nsData.name).toBe("acme");

    // 3. Invite Contributor
    const inviteRes = await fetch(`${exchangeOrigin}/v1/namespaces/acme/members`, {
      method: "POST",
      headers: {
        Origin: exchangeOrigin,
        Cookie: publisherSession.cookieHeader,
        "X-CSRF-Token": publisherSession.csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ githubUserId: CONTRIBUTOR_USER.id, role: "contributor" }),
    });
    expect(inviteRes.status).toBe(202);
    const inviteData = await inviteRes.json();
    expect(inviteData.role).toBe("contributor");
    const invitationId = inviteData.invitationId;
    expect(invitationId).toBeTruthy();

    // Contributor accepts invitation with terms
    const acceptInviteRes = await fetch(
      `${exchangeOrigin}/v1/publisher/invitations/${invitationId}/accept`,
      {
        method: "POST",
        headers: {
          Origin: exchangeOrigin,
          Cookie: contributorSession.cookieHeader,
          "X-CSRF-Token": contributorSession.csrfToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ acceptTermsVersion: TERMS_VERSION }),
      },
    );
    expect(acceptInviteRes.status).toBe(200);

    // 4. Package real .tabsext v1.0.0
    const tempDir = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-service-ext-"));
    temporaryDirectories.push(tempDir);
    const sourceDir = Path.join(tempDir, "pkg1");
    await FS.cp(Path.resolve(import.meta.dirname, "../../../examples/hello-extension"), sourceDir, {
      recursive: true,
    });
    const manifestPath = Path.join(sourceDir, "tabs-extension.json");
    const manifest1 = JSON.parse(await FS.readFile(manifestPath, "utf8"));
    manifest1.publisher = "acme";
    manifest1.name = "dashboard";
    manifest1.version = "1.0.0";
    await FS.writeFile(manifestPath, JSON.stringify(manifest1, null, 2));

    const archive1 = Path.join(tempDir, "dashboard-1.0.0.tabsext");
    await packTabsext({ directory: sourceDir, destination: archive1, tabsVersion: "1.3.17" });
    const archiveBytes1 = await FS.readFile(archive1);
    const digest1 = Crypto.createHash("sha256").update(archiveBytes1).digest("hex");

    // Upload v1.0.0 via Contributor session
    const uploadRes1 = await fetch(`${exchangeOrigin}/v1/publisher/acme/dashboard/versions`, {
      method: "POST",
      headers: {
        Origin: exchangeOrigin,
        Cookie: contributorSession.cookieHeader,
        "X-CSRF-Token": contributorSession.csrfToken,
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(archiveBytes1),
    });
    expect(uploadRes1.status).toBe(202);
    const uploadData1 = await uploadRes1.json();
    expect(uploadData1.status).toBe("queued");
    expect(uploadData1.digest).toBe(digest1);

    // Verify S3 quarantine object length and digest
    const quarantineKey1 = `quarantine/acme/dashboard/1.0.0/${digest1}.tabsext`;
    const s3Quarantine1 = await s3Client!.send(
      new GetObjectCommand({ Bucket: testBucket, Key: quarantineKey1 }),
    );
    const s3Chunks: Buffer[] = [];
    for await (const chunk of s3Quarantine1.Body as any) {
      s3Chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const s3Bytes1 = Buffer.concat(s3Chunks);
    expect(s3Bytes1.length).toBe(archiveBytes1.length);
    expect(Crypto.createHash("sha256").update(s3Bytes1).digest("hex")).toBe(digest1);

    // 5. Run real scan worker
    const scanned1 = await scanNextVersion(testPool!, s3Client!, exchangeConfig!);
    expect(scanned1).toBe(true);

    const versionRow1 = await testPool!.query(
      "SELECT status, digest, bytes, scan_result FROM exchange_versions WHERE namespace = 'acme' AND name = 'dashboard' AND version = '1.0.0'",
    );
    expect(versionRow1.rows[0].status).toBe("review");
    expect(versionRow1.rows[0].scan_result.passed).toBe(true);
    expect(versionRow1.rows[0].scan_result.digest).toBe(digest1);

    // 6. Verify NOT public before signed publication
    const publicExtsBefore = await fetch(`${exchangeOrigin}/v1/extensions`);
    expect(publicExtsBefore.status).toBe(200);
    const publicExtsDataBefore = await publicExtsBefore.json();
    expect(publicExtsDataBefore.extensions).toEqual([]);

    const publicVersionBefore = await fetch(`${exchangeOrigin}/v1/extensions/acme/dashboard`);
    expect(publicVersionBefore.status).toBe(404);

    // 7. Reviewer approves exact digest
    const approveRes1 = await fetch(`${exchangeOrigin}/v1/review/acme/dashboard/1.0.0`, {
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
        reason: "Inspected manifest and package contents cleanly",
      }),
    });
    expect(approveRes1.status).toBe(200);

    const approvedRow1 = await testPool!.query(
      "SELECT status FROM exchange_versions WHERE namespace = 'acme' AND name = 'dashboard' AND version = '1.0.0'",
    );
    expect(approvedRow1.rows[0].status).toBe("approved");

    // STILL NOT public before signed TUF publication
    const publicExtsAfterApprove = await fetch(`${exchangeOrigin}/v1/extensions`);
    expect((await publicExtsAfterApprove.json()).extensions).toEqual([]);

    // 8. Generate ephemeral test TUF keys offline & publish signed metadata
    const tufStageDir = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-tuf-stage-"));
    temporaryDirectories.push(tufStageDir);

    const { privateKey, publicKey } = Crypto.generateKeyPairSync("ed25519");
    const publicBytes = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    const keyID = Crypto.createHash("sha256").update(publicBytes).digest("hex");
    const tufKey = new Key({
      keyID,
      keyType: "ed25519",
      scheme: "ed25519",
      keyVal: { public: publicBytes.toString("hex") },
    });
    const signTuf = <T extends Root | Targets | Snapshot | Timestamp>(signed: T): Buffer => {
      const metadata = new Metadata(signed);
      metadata.sign(
        (bytes) =>
          new Signature({ keyID, sig: Crypto.sign(null, bytes, privateKey).toString("hex") }),
      );
      return Buffer.from(JSON.stringify(metadata.toJSON()));
    };

    const commonTuf = { specVersion: "1.0.0", expires: "2030-01-01T00:00:00Z" };
    const rootTuf = new Root({ ...commonTuf, version: 1, consistentSnapshot: false });
    for (const role of ["root", "timestamp", "snapshot", "targets"]) rootTuf.addKey(tufKey, role);
    const rootBytes = signTuf(rootTuf);
    const rootDigest = Crypto.createHash("sha256").update(rootBytes).digest("hex");
    await FS.writeFile(Path.join(tufStageDir, "root.json"), rootBytes);

    const targetPath1 = "extensions/acme/dashboard/1.0.0.tabsext";
    const targetsTuf1 = signTuf(
      new Targets({
        ...commonTuf,
        version: 1,
        targets: {
          [targetPath1]: new TargetFile({
            path: targetPath1,
            length: archiveBytes1.length,
            hashes: { sha256: digest1 },
          }),
        },
      }),
    );
    const snapshotTuf1 = signTuf(
      new Snapshot({
        ...commonTuf,
        version: 1,
        meta: {
          "targets.json": new MetaFile({
            version: 1,
            length: targetsTuf1.length,
            hashes: { sha256: Crypto.createHash("sha256").update(targetsTuf1).digest("hex") },
          }),
        },
      }),
    );
    const timestampTuf1 = signTuf(
      new Timestamp({
        ...commonTuf,
        version: 1,
        snapshotMeta: new MetaFile({
          version: 1,
          length: snapshotTuf1.length,
          hashes: { sha256: Crypto.createHash("sha256").update(snapshotTuf1).digest("hex") },
        }),
      }),
    );
    await FS.writeFile(Path.join(tufStageDir, "targets.json"), targetsTuf1);
    await FS.writeFile(Path.join(tufStageDir, "snapshot.json"), snapshotTuf1);
    await FS.writeFile(Path.join(tufStageDir, "timestamp.json"), timestampTuf1);

    const publishedCount1 = await publishTufMetadata(
      testPool!,
      s3Client!,
      testBucket,
      tufStageDir,
      rootDigest,
    );
    expect(publishedCount1).toBe(4);

    // 9. Verify public search, version, and exact download routes
    const publicExts1 = await fetch(`${exchangeOrigin}/v1/extensions`);
    expect(publicExts1.status).toBe(200);
    const extsData1 = await publicExts1.json();
    expect(extsData1.extensions.length).toBe(1);
    expect(extsData1.extensions[0].namespace).toBe("acme");
    expect(extsData1.extensions[0].name).toBe("dashboard");
    expect(extsData1.extensions[0].version).toBe("1.0.0");

    const packageRes1 = await fetch(`${exchangeOrigin}/v1/extensions/acme/dashboard`);
    expect(packageRes1.status).toBe(200);
    const packageData1 = await packageRes1.json();
    expect(packageData1.versions.length).toBe(1);
    expect(packageData1.versions[0].version).toBe("1.0.0");

    const versionRes1 = await fetch(
      `${exchangeOrigin}/v1/extensions/acme/dashboard/versions/1.0.0`,
    );
    expect(versionRes1.status).toBe(200);
    const versionData1 = await versionRes1.json();
    expect(versionData1.downloadUrl).toBe(
      `${exchangeOrigin}/v1/extensions/acme/dashboard/versions/1.0.0/download`,
    );

    const downloadRes1 = await fetch(versionData1.downloadUrl);
    expect(downloadRes1.status).toBe(200);
    const downloadedBytes1 = Buffer.from(await downloadRes1.arrayBuffer());
    expect(downloadedBytes1.length).toBe(archiveBytes1.length);
    expect(Crypto.createHash("sha256").update(downloadedBytes1).digest("hex")).toBe(digest1);

    const tufTargetRes1 = await fetch(
      `${exchangeOrigin}/v1/tuf/targets/extensions/acme/dashboard/1.0.0.tabsext`,
    );
    expect(tufTargetRes1.status).toBe(200);
    const tufBytes1 = Buffer.from(await tufTargetRes1.arrayBuffer());
    expect(tufBytes1.length).toBe(archiveBytes1.length);

    // 10. Submit second version (v1.1.0) with permission change
    const sourceDir2 = Path.join(tempDir, "pkg2");
    await FS.cp(sourceDir, sourceDir2, { recursive: true });
    const manifestPath2 = Path.join(sourceDir2, "tabs-extension.json");
    const manifest2 = JSON.parse(await FS.readFile(manifestPath2, "utf8"));
    manifest2.version = "1.1.0";
    manifest2.capabilities = ["network"];
    manifest2.networkHosts = ["api.acme.example"];
    await FS.writeFile(manifestPath2, JSON.stringify(manifest2, null, 2));

    const archive2 = Path.join(tempDir, "dashboard-1.1.0.tabsext");
    await packTabsext({ directory: sourceDir2, destination: archive2, tabsVersion: "1.3.17" });
    const archiveBytes2 = await FS.readFile(archive2);
    const digest2 = Crypto.createHash("sha256").update(archiveBytes2).digest("hex");

    const uploadRes2 = await fetch(`${exchangeOrigin}/v1/publisher/acme/dashboard/versions`, {
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

    const scanned2 = await scanNextVersion(testPool!, s3Client!, exchangeConfig!);
    expect(scanned2).toBe(true);

    // Check diff/permission changes in scan result
    const versionRow2 = await testPool!.query(
      "SELECT scan_result FROM exchange_versions WHERE namespace = 'acme' AND name = 'dashboard' AND version = '1.1.0'",
    );
    const scanResult2 = versionRow2.rows[0].scan_result;
    expect(scanResult2.passed).toBe(true);
    expect(scanResult2.capabilityChanges.added).toContain("network");
    expect(scanResult2.issues.some((i: any) => i.code === "capabilities-increased")).toBe(true);
    expect(scanResult2.reviewDiff).toBeDefined();

    // Reviewer approves v1.1.0
    const approveRes2 = await fetch(`${exchangeOrigin}/v1/review/acme/dashboard/1.1.0`, {
      method: "POST",
      headers: {
        Origin: exchangeOrigin,
        Cookie: reviewerSession.cookieHeader,
        "X-CSRF-Token": reviewerSession.csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "approve",
        digest: digest2,
        reason: "Approved network capability increase to api.acme.example",
      }),
    });
    expect(approveRes2.status).toBe(200);

    // Publish updated signed TUF metadata with v1.1.0
    const targetPath2 = "extensions/acme/dashboard/1.1.0.tabsext";
    const targetsTuf2 = signTuf(
      new Targets({
        ...commonTuf,
        version: 2,
        targets: {
          [targetPath1]: new TargetFile({
            path: targetPath1,
            length: archiveBytes1.length,
            hashes: { sha256: digest1 },
          }),
          [targetPath2]: new TargetFile({
            path: targetPath2,
            length: archiveBytes2.length,
            hashes: { sha256: digest2 },
          }),
        },
      }),
    );
    const snapshotTuf2 = signTuf(
      new Snapshot({
        ...commonTuf,
        version: 2,
        meta: {
          "targets.json": new MetaFile({
            version: 2,
            length: targetsTuf2.length,
            hashes: { sha256: Crypto.createHash("sha256").update(targetsTuf2).digest("hex") },
          }),
        },
      }),
    );
    const timestampTuf2 = signTuf(
      new Timestamp({
        ...commonTuf,
        version: 2,
        snapshotMeta: new MetaFile({
          version: 2,
          length: snapshotTuf2.length,
          hashes: { sha256: Crypto.createHash("sha256").update(snapshotTuf2).digest("hex") },
        }),
      }),
    );
    await FS.writeFile(Path.join(tufStageDir, "targets.json"), targetsTuf2);
    await FS.writeFile(Path.join(tufStageDir, "snapshot.json"), snapshotTuf2);
    await FS.writeFile(Path.join(tufStageDir, "timestamp.json"), timestampTuf2);

    await publishTufMetadata(testPool!, s3Client!, testBucket, tufStageDir);

    // Verify latest head is now 1.1.0
    const publicExts2 = await fetch(`${exchangeOrigin}/v1/extensions`);
    const extsData2 = await publicExts2.json();
    expect(extsData2.extensions[0].version).toBe("1.1.0");

    // 11. Revoke v1.1.0
    const revokeRes = await fetch(`${exchangeOrigin}/v1/review/acme/dashboard/1.1.0`, {
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
        reason: "Security vulnerability reported",
      }),
    });
    expect(revokeRes.status).toBe(200);

    // Immediate suppression from public routes
    const revokedVersionRes = await fetch(
      `${exchangeOrigin}/v1/extensions/acme/dashboard/versions/1.1.0`,
    );
    expect(revokedVersionRes.status).toBe(404);

    const revokedDownloadRes = await fetch(
      `${exchangeOrigin}/v1/extensions/acme/dashboard/versions/1.1.0/download`,
    );
    expect(revokedDownloadRes.status).toBe(404);

    // Catalog head immediately falls back to 1.0.0
    const publicExtsAfterRevoke = await fetch(`${exchangeOrigin}/v1/extensions`);
    const extsDataAfterRevoke = await publicExtsAfterRevoke.json();
    expect(extsDataAfterRevoke.extensions[0].version).toBe("1.0.0");

    // Publish fresh signed metadata (version 3) removing 1.1.0
    const targetsTuf3 = signTuf(
      new Targets({
        ...commonTuf,
        version: 3,
        targets: {
          [targetPath1]: new TargetFile({
            path: targetPath1,
            length: archiveBytes1.length,
            hashes: { sha256: digest1 },
          }),
        },
      }),
    );
    const snapshotTuf3 = signTuf(
      new Snapshot({
        ...commonTuf,
        version: 3,
        meta: {
          "targets.json": new MetaFile({
            version: 3,
            length: targetsTuf3.length,
            hashes: { sha256: Crypto.createHash("sha256").update(targetsTuf3).digest("hex") },
          }),
        },
      }),
    );
    const timestampTuf3 = signTuf(
      new Timestamp({
        ...commonTuf,
        version: 3,
        snapshotMeta: new MetaFile({
          version: 3,
          length: snapshotTuf3.length,
          hashes: { sha256: Crypto.createHash("sha256").update(snapshotTuf3).digest("hex") },
        }),
      }),
    );
    await FS.writeFile(Path.join(tufStageDir, "targets.json"), targetsTuf3);
    await FS.writeFile(Path.join(tufStageDir, "snapshot.json"), snapshotTuf3);
    await FS.writeFile(Path.join(tufStageDir, "timestamp.json"), timestampTuf3);

    await publishTufMetadata(testPool!, s3Client!, testBucket, tufStageDir);

    // Authenticated removal from TUF target route
    const tufTargetRevoked = await fetch(
      `${exchangeOrigin}/v1/tuf/targets/extensions/acme/dashboard/1.1.0.tabsext`,
    );
    expect(tufTargetRevoked.status).toBe(404);
  }, 30_000);

  describe("Negative Service Boundary Tests", () => {
    it("rejects approval with mismatched digest", async () => {
      const reviewerSession = await performLogin(REVIEWER_USER);
      const wrongDigest = "0000000000000000000000000000000000000000000000000000000000000000";
      const res = await fetch(`${exchangeOrigin}/v1/review/acme/dashboard/1.0.0`, {
        method: "POST",
        headers: {
          Origin: exchangeOrigin,
          Cookie: reviewerSession.cookieHeader,
          "X-CSRF-Token": reviewerSession.csrfToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "approve", digest: wrongDigest, reason: "wrong digest" }),
      });
      expect(res.status).toBe(409);
    });

    it("rejects approval when quarantine object is mutated in storage", async () => {
      const publisherSession = await performLogin(PUBLISHER_USER);
      const reviewerSession = await performLogin(REVIEWER_USER);

      const tempDir = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-service-mutated-"));
      temporaryDirectories.push(tempDir);
      const sourceDir = Path.join(tempDir, "pkg");
      await FS.cp(
        Path.resolve(import.meta.dirname, "../../../examples/hello-extension"),
        sourceDir,
        {
          recursive: true,
        },
      );
      const manifestPath = Path.join(sourceDir, "tabs-extension.json");
      const manifest = JSON.parse(await FS.readFile(manifestPath, "utf8"));
      manifest.publisher = "acme";
      manifest.name = "dashboard";
      manifest.version = "1.2.0";
      await FS.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      const archive = Path.join(tempDir, "dashboard-1.2.0.tabsext");
      await packTabsext({ directory: sourceDir, destination: archive, tabsVersion: "1.3.17" });
      const archiveBytes = await FS.readFile(archive);
      const digest = Crypto.createHash("sha256").update(archiveBytes).digest("hex");

      await fetch(`${exchangeOrigin}/v1/publisher/acme/dashboard/versions`, {
        method: "POST",
        headers: {
          Origin: exchangeOrigin,
          Cookie: publisherSession.cookieHeader,
          "X-CSRF-Token": publisherSession.csrfToken,
          "Content-Type": "application/octet-stream",
        },
        body: new Uint8Array(archiveBytes),
      });

      await scanNextVersion(testPool!, s3Client!, exchangeConfig!);

      // Tamper with the object in S3 directly
      const key = `quarantine/acme/dashboard/1.2.0/${digest}.tabsext`;
      await s3Client!.send(
        new PutObjectCommand({
          Bucket: testBucket,
          Key: key,
          Body: Buffer.from("tampered corrupted contents"),
        }),
      );

      // Attempt approval
      const approveRes = await fetch(`${exchangeOrigin}/v1/review/acme/dashboard/1.2.0`, {
        method: "POST",
        headers: {
          Origin: exchangeOrigin,
          Cookie: reviewerSession.cookieHeader,
          "X-CSRF-Token": reviewerSession.csrfToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "approve", digest, reason: "tamper test" }),
      });
      expect(approveRes.status).toBe(409); // Stored package object failed digest verification
    });

    it("rejects approval before scan is completed", async () => {
      const publisherSession = await performLogin(PUBLISHER_USER);
      const reviewerSession = await performLogin(REVIEWER_USER);

      const tempDir = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-service-unscanned-"));
      temporaryDirectories.push(tempDir);
      const sourceDir = Path.join(tempDir, "pkg");
      await FS.cp(
        Path.resolve(import.meta.dirname, "../../../examples/hello-extension"),
        sourceDir,
        {
          recursive: true,
        },
      );
      const manifestPath = Path.join(sourceDir, "tabs-extension.json");
      const manifest = JSON.parse(await FS.readFile(manifestPath, "utf8"));
      manifest.publisher = "acme";
      manifest.name = "dashboard";
      manifest.version = "1.3.0";
      await FS.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      const archive = Path.join(tempDir, "dashboard-1.3.0.tabsext");
      await packTabsext({ directory: sourceDir, destination: archive, tabsVersion: "1.3.17" });
      const archiveBytes = await FS.readFile(archive);
      const digest = Crypto.createHash("sha256").update(archiveBytes).digest("hex");

      await fetch(`${exchangeOrigin}/v1/publisher/acme/dashboard/versions`, {
        method: "POST",
        headers: {
          Origin: exchangeOrigin,
          Cookie: publisherSession.cookieHeader,
          "X-CSRF-Token": publisherSession.csrfToken,
          "Content-Type": "application/octet-stream",
        },
        body: new Uint8Array(archiveBytes),
      });

      // Do NOT run scanNextVersion (status remains 'queued')
      const approveRes = await fetch(`${exchangeOrigin}/v1/review/acme/dashboard/1.3.0`, {
        method: "POST",
        headers: {
          Origin: exchangeOrigin,
          Cookie: reviewerSession.cookieHeader,
          "X-CSRF-Token": reviewerSession.csrfToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "approve", digest, reason: "unscanned test" }),
      });
      expect(approveRes.status).toBe(409);
    });

    it("rejects review decision by non-reviewer", async () => {
      const contributorSession = await performLogin(CONTRIBUTOR_USER);
      const res = await fetch(`${exchangeOrigin}/v1/review/acme/dashboard/1.0.0`, {
        method: "POST",
        headers: {
          Origin: exchangeOrigin,
          Cookie: contributorSession.cookieHeader,
          "X-CSRF-Token": contributorSession.csrfToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "approve", digest: "any", reason: "not an admin" }),
      });
      expect(res.status).toBe(403);
    });

    it("rejects state-mutating requests with stale or missing CSRF token", async () => {
      const publisherSession = await performLogin(PUBLISHER_USER);
      const res = await fetch(`${exchangeOrigin}/v1/namespaces`, {
        method: "POST",
        headers: {
          Origin: exchangeOrigin,
          Cookie: publisherSession.cookieHeader,
          "X-CSRF-Token": "invalid-csrf-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "other-ns", acceptTermsVersion: TERMS_VERSION }),
      });
      expect(res.status).toBe(403); // CSRF validation failed
    });

    it("rejects duplicate version upload with 409", async () => {
      const publisherSession = await performLogin(PUBLISHER_USER);

      const tempDir = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-service-duplicate-"));
      temporaryDirectories.push(tempDir);
      const sourceDir = Path.join(tempDir, "pkg");
      await FS.cp(
        Path.resolve(import.meta.dirname, "../../../examples/hello-extension"),
        sourceDir,
        {
          recursive: true,
        },
      );
      const manifestPath = Path.join(sourceDir, "tabs-extension.json");
      const manifest = JSON.parse(await FS.readFile(manifestPath, "utf8"));
      manifest.publisher = "acme";
      manifest.name = "dashboard";
      manifest.version = "1.0.0"; // Already exists
      await FS.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      const archive = Path.join(tempDir, "dashboard-1.0.0.tabsext");
      await packTabsext({ directory: sourceDir, destination: archive, tabsVersion: "1.3.17" });
      const archiveBytes = await FS.readFile(archive);

      const res = await fetch(`${exchangeOrigin}/v1/publisher/acme/dashboard/versions`, {
        method: "POST",
        headers: {
          Origin: exchangeOrigin,
          Cookie: publisherSession.cookieHeader,
          "X-CSRF-Token": publisherSession.csrfToken,
          "Content-Type": "application/octet-stream",
        },
        body: new Uint8Array(archiveBytes),
      });
      expect(res.status).toBe(409);
    });

    it("rejects upload from a non-member before reading the archive", async () => {
      // Outsider is not a member of acme
      const outsiderSession = await performLogin(OUTSIDER_USER);

      const tempDir = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-service-outsider-"));
      temporaryDirectories.push(tempDir);
      const sourceDir = Path.join(tempDir, "pkg");
      await FS.cp(
        Path.resolve(import.meta.dirname, "../../../examples/hello-extension"),
        sourceDir,
        {
          recursive: true,
        },
      );
      const manifestPath = Path.join(sourceDir, "tabs-extension.json");
      const manifest = JSON.parse(await FS.readFile(manifestPath, "utf8"));
      manifest.publisher = "acme";
      manifest.name = "dashboard";
      manifest.version = "1.9.9";
      await FS.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      const archive = Path.join(tempDir, "dashboard-1.9.9.tabsext");
      await packTabsext({ directory: sourceDir, destination: archive, tabsVersion: "1.3.17" });
      const archiveBytes = await FS.readFile(archive);

      const res = await fetch(`${exchangeOrigin}/v1/publisher/acme/dashboard/versions`, {
        method: "POST",
        headers: {
          Origin: exchangeOrigin,
          Cookie: outsiderSession.cookieHeader,
          "X-CSRF-Token": outsiderSession.csrfToken,
          "Content-Type": "application/octet-stream",
        },
        body: new Uint8Array(archiveBytes),
      });
      expect(res.status).toBe(403);
    });

    it("rejects upload when membership is removed after preflight but before commit", async () => {
      const contributorSession = await performLogin(CONTRIBUTOR_USER);
      const tempDir = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-service-membership-race-"));
      temporaryDirectories.push(tempDir);
      const sourceDir = Path.join(tempDir, "pkg");
      await FS.cp(
        Path.resolve(import.meta.dirname, "../../../examples/hello-extension"),
        sourceDir,
        {
          recursive: true,
        },
      );
      const manifestPath = Path.join(sourceDir, "tabs-extension.json");
      const manifest = JSON.parse(await FS.readFile(manifestPath, "utf8"));
      manifest.publisher = "acme";
      manifest.name = "dashboard";
      manifest.version = "1.9.8";
      await FS.writeFile(manifestPath, JSON.stringify(manifest));
      const archive = Path.join(tempDir, "dashboard-1.9.8.tabsext");
      await packTabsext({ directory: sourceDir, destination: archive, tabsVersion: "1.3.17" });
      const archiveBytes = await FS.readFile(archive);

      let signalPreflight!: () => void;
      const preflight = new Promise<void>((resolve) => {
        signalPreflight = resolve;
      });
      const originalQuery = testPool!.query.bind(testPool!);
      const querySpy = vi.spyOn(testPool!, "query").mockImplementation((async (
        ...args: unknown[]
      ) => {
        const result = await (originalQuery as (...values: unknown[]) => Promise<unknown>)(...args);
        if (
          typeof args[0] === "string" &&
          args[0].includes("SELECT role FROM exchange_namespace_members") &&
          Array.isArray(args[1]) &&
          args[1][1] === CONTRIBUTOR_USER.id
        ) {
          signalPreflight();
        }
        return result;
      }) as Pool["query"]);

      let bodyController!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          bodyController = controller;
          controller.enqueue(new Uint8Array(archiveBytes.subarray(0, 1)));
        },
      });
      let bodyClosed = false;
      try {
        const upload = fetch(`${exchangeOrigin}/v1/publisher/acme/dashboard/versions`, {
          method: "POST",
          headers: {
            Origin: exchangeOrigin,
            Cookie: contributorSession.cookieHeader,
            "X-CSRF-Token": contributorSession.csrfToken,
            "Content-Type": "application/octet-stream",
          },
          body,
          duplex: "half",
        } as RequestInit & { duplex: "half" });

        await preflight;
        await originalQuery(
          "DELETE FROM exchange_namespace_members WHERE namespace = $1 AND user_id = $2",
          ["acme", CONTRIBUTOR_USER.id],
        );
        bodyController.enqueue(new Uint8Array(archiveBytes.subarray(1)));
        bodyController.close();
        bodyClosed = true;
        const result = await upload;
        expect(result.status).toBe(403);
        const version = await originalQuery(
          "SELECT status FROM exchange_versions WHERE namespace = $1 AND name = $2 AND version = $3",
          ["acme", "dashboard", "1.9.8"],
        );
        expect(version.rowCount).toBe(0);
      } finally {
        if (!bodyClosed) bodyController.close();
        querySpy.mockRestore();
        await originalQuery(
          "INSERT INTO exchange_namespace_members(namespace, user_id, role) VALUES ($1, $2, 'contributor') ON CONFLICT DO NOTHING",
          ["acme", CONTRIBUTOR_USER.id],
        );
      }
    });

    it("returns 404 for a target that does not exist", async () => {
      const res = await fetch(
        `${exchangeOrigin}/v1/tuf/targets/extensions/acme/dashboard/9.9.9.tabsext`,
      );
      expect(res.status).toBe(404);
    });

    it("reclaims an expired worker claim against PostgreSQL and scans the quarantined object", async () => {
      const publisherSession = await performLogin(PUBLISHER_USER);
      const tempDir = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-service-reclaim-"));
      temporaryDirectories.push(tempDir);
      const sourceDir = Path.join(tempDir, "pkg");
      await FS.cp(
        Path.resolve(import.meta.dirname, "../../../examples/hello-extension"),
        sourceDir,
        { recursive: true },
      );
      const manifestPath = Path.join(sourceDir, "tabs-extension.json");
      const manifest = JSON.parse(await FS.readFile(manifestPath, "utf8"));
      manifest.publisher = "acme";
      manifest.name = "dashboard";
      manifest.version = "1.9.9";
      await FS.writeFile(manifestPath, JSON.stringify(manifest));
      const archive = Path.join(tempDir, "dashboard-1.9.9.tabsext");
      await packTabsext({ directory: sourceDir, destination: archive, tabsVersion: "1.3.17" });
      const upload = await fetch(`${exchangeOrigin}/v1/publisher/acme/dashboard/versions`, {
        method: "POST",
        headers: {
          Origin: exchangeOrigin,
          Cookie: publisherSession.cookieHeader,
          "X-CSRF-Token": publisherSession.csrfToken,
          "Content-Type": "application/octet-stream",
        },
        body: new Uint8Array(await FS.readFile(archive)),
      });
      expect(upload.status).toBe(202);
      await testPool!.query(
        "UPDATE exchange_versions SET status = 'scanning', scan_claimed_at = now() - interval '11 minutes', scan_token = $4, submitted_at = now() - interval '1 day' WHERE namespace = $1 AND name = $2 AND version = $3",
        ["acme", "dashboard", "1.9.9", Crypto.randomUUID()],
      );
      expect(await scanNextVersion(testPool!, s3Client!, exchangeConfig!)).toBe(true);
      const scanned = await testPool!.query(
        "SELECT status, scan_token, scan_result FROM exchange_versions WHERE namespace = $1 AND name = $2 AND version = $3",
        ["acme", "dashboard", "1.9.9"],
      );
      expect(scanned.rows[0]?.status).toBe("review");
      expect(scanned.rows[0]?.scan_token).toBeNull();
      expect(scanned.rows[0]?.scan_result?.passed).toBe(true);
    });
  });

  it("restores database audit rows, object bytes, and serial sequence state into fresh services", async () => {
    const auditUser = "90000001";
    const auditNamespace = "backup-test";
    await testPool!.query(
      "INSERT INTO exchange_users(id, login) VALUES ($1, 'backup-actor') ON CONFLICT DO NOTHING",
      [auditUser],
    );
    await testPool!.query(
      "INSERT INTO exchange_namespaces(name, terms_version, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [auditNamespace, TERMS_VERSION, auditUser],
    );
    await testPool!.query(
      "INSERT INTO exchange_namespace_member_events(namespace, user_id, role, actor_id, action, reason) VALUES ($1, $2, 'contributor', $2, 'remove', 'backup audit test')",
      [auditNamespace, auditUser],
    );

    const backup = JSON.parse(
      JSON.stringify(await backupExchangeData(testPool!, s3Client!, testBucket)),
    ) as Awaited<ReturnType<typeof backupExchangeData>>;
    expect(backup.tableCounts.exchange_namespace_member_events).toBeGreaterThan(0);

    const restoredDbName = `tabs_exchange_restore_${Date.now()}_${Crypto.randomBytes(4).toString("hex")}`;
    const restoredBucket = `tabs-exchange-restore-${Date.now()}-${Crypto.randomBytes(4).toString("hex")}`;
    let restoredPool: Pool | null = null;
    try {
      await rootPool!.query(`CREATE DATABASE ${restoredDbName}`);
      const restoredUrl = new URL(TEST_POSTGRES_URL);
      restoredUrl.pathname = `/${restoredDbName}`;
      restoredPool = new Pool({ connectionString: restoredUrl.toString() });
      const sql = await FS.readFile(Path.join(import.meta.dirname, "schema.sql"), "utf8");
      await migrateExchangeSchema(restoredPool, sql);
      await s3Client!.send(new CreateBucketCommand({ Bucket: restoredBucket }));

      const hostileBackup = JSON.parse(JSON.stringify(backup)) as typeof backup;
      hostileBackup.tableRows.exchange_users![0]![
        "login) VALUES ('injected'); DROP TABLE exchange_namespaces; --"
      ] = "malicious-column";
      await expect(
        restoreExchangeData(hostileBackup, restoredPool, s3Client!, restoredBucket),
      ).rejects.toThrow();
      expect(
        (await restoredPool.query("SELECT count(*) AS count FROM exchange_namespaces")).rows[0]
          ?.count,
      ).toBe("0");

      const result = await restoreExchangeData(backup, restoredPool, s3Client!, restoredBucket);
      expect(result.restoredTables).toBe(Object.keys(backup.tableCounts).length);
      expect(result.restoredObjects).toBe(backup.objectCount);
      const auditRows = await restoredPool.query(
        "SELECT reason FROM exchange_namespace_member_events WHERE namespace = $1",
        [auditNamespace],
      );
      expect(auditRows.rows.some((row) => row.reason === "backup audit test")).toBe(true);

      // New audited writes must not collide with IDs restored from the backup.
      await restoredPool.query(
        "INSERT INTO exchange_namespace_member_events(namespace, user_id, role, actor_id, action, reason) VALUES ($1, $2, 'contributor', $2, 'remove', 'after restore')",
        [auditNamespace, auditUser],
      );

      for (const object of backup.objects) {
        const fetched = await s3Client!.send(
          new GetObjectCommand({ Bucket: restoredBucket, Key: object.key }),
        );
        const bytes = Buffer.from(await fetched.Body!.transformToByteArray());
        expect(bytes.length).toBe(object.bytes);
        expect(Crypto.createHash("sha256").update(bytes).digest("hex")).toBe(object.digest);
      }
    } finally {
      if (restoredPool) await restoredPool.end();
      const listed = await s3Client!.send(new ListObjectsV2Command({ Bucket: restoredBucket }));
      for (const object of listed.Contents ?? []) {
        if (object.Key) {
          await s3Client!.send(
            new DeleteObjectCommand({ Bucket: restoredBucket, Key: object.Key }),
          );
        }
      }
      await s3Client!.send(new DeleteBucketCommand({ Bucket: restoredBucket }));
      await rootPool!.query(`DROP DATABASE IF EXISTS ${restoredDbName} WITH (FORCE)`);
    }
  });
});
