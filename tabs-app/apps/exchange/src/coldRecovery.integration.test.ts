import * as Crypto from "node:crypto";
import * as FS from "node:fs/promises";
import * as Path from "node:path";
import { execFileSync } from "node:child_process";
import type { IncomingMessage } from "node:http";
import { Pool } from "pg";
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
import { expect, it } from "vitest";
import { fixtureEndpoint } from "./browserFixture.ts";
import { migrateExchangeSchema } from "./migration.ts";
import { verifyExchangeObjects } from "./verifyObjects.ts";
import { invalidateRestoredCredentials } from "./recoveryCredentials.ts";
import { actorFor } from "./auth.ts";
import { issueAccessToken } from "./accessTokens.ts";
import type { ExchangeConfig } from "./config.ts";

const repository = Path.resolve(import.meta.dirname, "../../..");
const compose = Path.join(repository, "apps/exchange/compose.test.yaml");
const hash = (bytes: Crypto.BinaryLike) => Crypto.createHash("sha256").update(bytes).digest("hex");

it.skipIf(process.env.TABS_EXCHANGE_COLD_RECOVERY !== "1")(
  "cold-restores a PostgreSQL custom dump and private object copy into empty services, then invalidates restored credentials",
  async () => {
    const database = fixtureEndpoint(
      process.env.TEST_DATABASE_URL ??
        "postgres://tabs_exchange:testpassword@127.0.0.1:5433/tabs_exchange",
      ["postgres:", "postgresql:"],
    );
    const endpoint = fixtureEndpoint(process.env.TEST_S3_ENDPOINT ?? "http://127.0.0.1:9090", [
      "http:",
    ]);
    const docker = (args: string[], input?: Buffer) =>
      execFileSync("docker", args, {
        cwd: repository,
        input,
        timeout: 30_000,
        maxBuffer: 32 * 1024 * 1024,
      });
    const container = docker(["compose", "-f", compose, "ps", "-q", "postgres"]).toString().trim();
    expect(container).toMatch(/^[a-f0-9]{12,64}$/);
    const inspection = JSON.parse(docker(["inspect", container]).toString())[0];
    expect(inspection.Config.Labels["com.docker.compose.service"]).toBe("postgres");
    expect(inspection.NetworkSettings.Ports["5432/tcp"]).toContainEqual({
      HostIp: "127.0.0.1",
      HostPort: database.port,
    });
    const suffix = Crypto.randomBytes(8).toString("hex");
    const names = [`tabs_exchange_cold_source_${suffix}`, `tabs_exchange_cold_restore_${suffix}`];
    const buckets = [`tabs-exchange-cold-source-${suffix}`, `tabs-exchange-cold-restore-${suffix}`];
    const evidence = await FS.mkdtemp(Path.join(repository, ".test-data/exchange-cold-recovery-"));
    await FS.chmod(evidence, 0o700);
    const root = new Pool({ connectionString: database.toString(), connectionTimeoutMillis: 2000 });
    const pools: Pool[] = [];
    const createdDatabases: string[] = [];
    const createdBuckets: string[] = [];
    const storage = new S3Client({
      region: "us-east-1",
      endpoint: endpoint.origin,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? "test",
        secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY ?? "test",
      },
    });
    try {
      for (const name of names) {
        await root.query(`CREATE DATABASE ${name}`);
        createdDatabases.push(name);
        const url = new URL(database);
        url.pathname = `/${name}`;
        pools.push(new Pool({ connectionString: url.toString() }));
      }
      for (const bucket of buckets) {
        await storage.send(new CreateBucketCommand({ Bucket: bucket }));
        createdBuckets.push(bucket);
      }
      const [source, target] = pools as [Pool, Pool];
      const [sourceBucket, targetBucket] = buckets as [string, string];
      await migrateExchangeSchema(
        source,
        await FS.readFile(Path.join(import.meta.dirname, "schema.sql"), "utf8"),
      );
      await source.query(
        "INSERT INTO exchange_users(id, login) VALUES (2001, 'recovery-publisher'), (5001, 'recovery-operator')",
      );
      await source.query(
        "INSERT INTO exchange_namespaces(name, terms_version, created_by) VALUES ('recovery', 'test', 2001)",
      );
      await source.query(
        "INSERT INTO exchange_namespace_members(namespace, user_id, role) VALUES ('recovery', 2001, 'owner')",
      );
      await source.query(
        "INSERT INTO exchange_publisher_agreements(user_id, terms_version) VALUES (2001, 'test')",
      );
      await source.query(
        "INSERT INTO exchange_reviewers(user_id, active, changed_by, reason) VALUES (2001, true, 5001, 'Recovery fixture')",
      );
      await source.query(
        "INSERT INTO exchange_reviewer_events(user_id, actor_id, action, reason) VALUES (2001, 5001, 'grant', 'Recovery fixture')",
      );
      const project = Path.join(evidence, "project");
      await FS.cp(Path.join(repository, "examples/hello-extension"), project, { recursive: true });
      const manifestPath = Path.join(project, "tabs-extension.json");
      const manifest = JSON.parse(await FS.readFile(manifestPath, "utf8"));
      Object.assign(manifest, { publisher: "recovery", name: "tool", version: "1.0.0" });
      await FS.writeFile(manifestPath, JSON.stringify(manifest));
      const archive = Path.join(evidence, "tool.tabsext");
      const packed = await packTabsext({
        directory: project,
        destination: archive,
        tabsVersion: "1.3.17",
      });
      const bytes = await FS.readFile(archive);
      const objectKey = `quarantine/recovery/tool/1.0.0/${packed.digest}.tabsext`;
      await storage.send(
        new PutObjectCommand({ Bucket: sourceBucket, Key: objectKey, Body: bytes }),
      );
      await source.query(
        "INSERT INTO exchange_versions(namespace, name, version, digest, bytes, manifest, object_key, status, uploaded_by) VALUES ('recovery', 'tool', '1.0.0', $1, $2, $3, $4, 'review', 2001)",
        [packed.digest, bytes.length, JSON.stringify(manifest), objectKey],
      );
      await source.query(
        "INSERT INTO exchange_review_events(namespace, name, version, digest, actor_id, action, reason) VALUES ('recovery', 'tool', '1.0.0', $1, 5001, 'rescan', 'Recovery fixture')",
        [packed.digest],
      );
      const session = Crypto.randomBytes(32).toString("base64url");
      const csrf = Crypto.randomBytes(32).toString("base64url");
      await source.query(
        "INSERT INTO exchange_sessions(token_hash, user_id, csrf_hash, expires_at) VALUES ($1, 2001, $2, now() + interval '1 day')",
        [hash(session), hash(csrf)],
      );
      await source.query(
        "INSERT INTO exchange_oauth_states(state_hash, expires_at) VALUES ($1, now() + interval '10 minutes')",
        [hash(Crypto.randomBytes(32))],
      );
      const actor = { id: "2001", login: "recovery-publisher", admin: false, csrf: "valid" };
      const token = await issueAccessToken(source, actor, {
        label: "Recovery test",
        scope: "read",
      });
      const config: ExchangeConfig = {
        origin: "http://127.0.0.1",
        githubClientId: "cold-test",
        githubClientSecret: "cold-test",
        bucket: sourceBucket,
        publishingEnabled: false,
        adminGithubIds: new Set(),
        operatorGithubIds: new Set(["5001"]),
        visibility: "private",
        allowedGithubIds: new Set(["2001", "5001"]),
      };
      const request = (headers: IncomingMessage["headers"]) => ({ headers }) as IncomingMessage;
      const sessionRequest = request({
        cookie: `tabs_exchange_session=${session}`,
        "x-csrf-token": csrf,
      });
      const bearerRequest = request({ authorization: `Bearer ${token.token}` });
      expect(await actorFor(sessionRequest, source, config)).not.toBeNull();
      expect(await actorFor(bearerRequest, source, config)).not.toBeNull();

      // No API, worker, or signer is started for either environment: capture is cold.
      const tables = (
        await source.query<{ tablename: string }>(
          "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
        )
      ).rows.map((row) => row.tablename);
      const rows = async (pool: Pool, table: string) =>
        (
          await pool.query(
            `SELECT to_jsonb(t) AS row FROM "${table.replaceAll('"', '""')}" t ORDER BY to_jsonb(t)::text`,
          )
        ).rows;
      const snapshots = new Map<string, unknown>();
      for (const table of tables) snapshots.set(table, await rows(source, table));
      const before = await verifyExchangeObjects(source, storage, sourceBucket);
      expect(before).toEqual({ checked: 1, failed: 0, failures: [] });
      const dump = docker([
        "exec",
        container,
        "pg_dump",
        "-U",
        decodeURIComponent(database.username),
        "-d",
        names[0]!,
        "-Fc",
      ]);
      await FS.writeFile(Path.join(evidence, "exchange.pgcustom"), dump, { mode: 0o600 });
      const listed = await storage.send(new ListObjectsV2Command({ Bucket: sourceBucket }));
      const objectCopies = [];
      for (const item of listed.Contents ?? []) {
        const key = item.Key!;
        const response = await storage.send(
          new GetObjectCommand({ Bucket: sourceBucket, Key: key }),
        );
        const body = Buffer.from(await response.Body!.transformToByteArray());
        const local = Path.join(evidence, `object-${objectCopies.length}.bin`);
        await FS.writeFile(local, body, { mode: 0o600 });
        objectCopies.push({ key, local, sha256: hash(body), bytes: body.length });
      }
      expect(
        (await target.query("SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")).rows[0]
          .count,
      ).toBe("0");
      expect(
        (await storage.send(new ListObjectsV2Command({ Bucket: targetBucket }))).Contents ?? [],
      ).toHaveLength(0);
      docker(
        [
          "exec",
          "-i",
          container,
          "pg_restore",
          "-U",
          decodeURIComponent(database.username),
          "-d",
          names[1]!,
          "--no-owner",
          "--exit-on-error",
        ],
        await FS.readFile(Path.join(evidence, "exchange.pgcustom")),
      );
      for (const object of objectCopies) {
        const body = await FS.readFile(object.local);
        expect(hash(body)).toBe(object.sha256);
        await storage.send(
          new PutObjectCommand({ Bucket: targetBucket, Key: object.key, Body: body }),
        );
      }
      for (const table of tables) expect(await rows(target, table)).toEqual(snapshots.get(table));
      const after = await verifyExchangeObjects(target, storage, targetBucket);
      expect(after).toEqual(before);
      // The dump really restored credentials; now deliberately invalidate them.
      expect(await actorFor(sessionRequest, target, config)).not.toBeNull();
      expect(await actorFor(bearerRequest, target, config)).not.toBeNull();
      const invalidated = await invalidateRestoredCredentials(target);
      expect(invalidated).toEqual({ sessions: 1, oauthStates: 1, tokens: 1 });
      expect(await actorFor(sessionRequest, target, config)).toBeNull();
      expect(await actorFor(bearerRequest, target, config)).toBeNull();
      expect(await invalidateRestoredCredentials(target)).toEqual({
        sessions: 0,
        oauthStates: 0,
        tokens: 0,
      });
      const fresh = await issueAccessToken(target, actor, {
        label: "After recovery",
        scope: "read",
      });
      expect(
        await actorFor(request({ authorization: `Bearer ${fresh.token}` }), target, config),
      ).not.toBeNull();
      await target.query(
        "INSERT INTO exchange_reviewer_events(user_id, actor_id, action, reason) VALUES (2001, 5001, 'revoke', 'After restore')",
      );
      expect((await target.query("SELECT max(id) FROM exchange_reviewer_events")).rows[0].max).toBe(
        "2",
      );
      const report = {
        testOnly: true,
        cold: true,
        tablesCompared: tables.length,
        packagesChecked: after.checked,
        objectsCopied: objectCopies.length,
        dumpSha256: hash(dump),
        invalidated,
        credentialReplayDenied: true,
        newCredentialAccepted: true,
        auditSequenceContinues: true,
        limitation:
          "Local test identities and unsigned review-stage archive. Not production recovery, sign-in, signing-key, or desktop acceptance.",
      };
      await FS.writeFile(Path.join(evidence, "report.json"), JSON.stringify(report, null, 2), {
        mode: 0o600,
      });
      console.log(`Cold recovery evidence: ${Path.join(evidence, "report.json")}`);
    } finally {
      for (const pool of pools) await pool.end();
      for (const name of createdDatabases) await root.query(`DROP DATABASE ${name}`);
      await root.end();
      for (const bucket of createdBuckets) {
        const objects = await storage.send(new ListObjectsV2Command({ Bucket: bucket }));
        for (const object of objects.Contents ?? [])
          if (object.Key)
            await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }));
        await storage.send(new DeleteBucketCommand({ Bucket: bucket }));
      }
      storage.destroy();
    }
  },
  60_000,
);
