import * as Crypto from "node:crypto";
import * as FS from "node:fs/promises";
import * as Path from "node:path";
import { CreateBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { createPool, createStorage, loadConfig } from "./config.ts";
import {
  acceptanceState,
  localAcceptanceSettings,
  type LocalAcceptanceState,
} from "./localAcceptanceSettings.ts";
import { migrateExchangeSchema } from "./migration.ts";
import { createExchangeServer } from "./server.ts";
import { recordWorkerHeartbeat, scanNextVersion } from "./worker.ts";

const directory = Path.resolve(import.meta.dirname, "../../../.test-data/exchange-real-github");
let stage = "configuration validation";
async function run() {
  const settings = localAcceptanceSettings(process.env);
  const arguments_ = process.argv.slice(2);
  if (arguments_.some((value) => value !== "--enable-private-submissions") || arguments_.length > 1)
    throw new Error("Unsupported local acceptance argument.");
  const publishing = arguments_.includes("--enable-private-submissions");
  await FS.mkdir(directory, { recursive: true, mode: 0o700 });
  await FS.chmod(directory, 0o700);
  const file = Path.join(directory, "state.json");
  let state: LocalAcceptanceState;
  try {
    state = acceptanceState(JSON.parse(await FS.readFile(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const suffix = Crypto.randomBytes(8).toString("hex");
    state = {
      version: 1,
      kind: "real-github-local",
      database: `tabs_exchange_auth_${suffix}`,
      bucket: `tabs-exchange-auth-${suffix}`,
      createdAt: new Date().toISOString(),
    };
    await FS.writeFile(file, JSON.stringify(state, null, 2), { flag: "wx", mode: 0o600 });
  }
  // Never read credentials from this state file or repurpose an existing registry.
  process.env.DATABASE_URL = settings.database.toString();
  const root = createPool();
  try {
    stage = "database provisioning";
    const present = await root.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      state.database,
    ]);
    if (!present.rowCount) await root.query(`CREATE DATABASE ${state.database}`);
  } finally {
    await root.end();
  }
  const database = new URL(settings.database);
  database.pathname = `/${state.database}`;
  process.env.DATABASE_URL = database.toString();
  process.env.S3_ENDPOINT = settings.storage.origin;
  process.env.S3_REGION = "us-east-1";
  process.env.S3_ACCESS_KEY_ID = process.env.TEST_S3_ACCESS_KEY_ID ?? "test";
  process.env.S3_SECRET_ACCESS_KEY = process.env.TEST_S3_SECRET_ACCESS_KEY ?? "test";
  process.env.S3_BUCKET = state.bucket;
  process.env.EXCHANGE_PUBLISHING_ENABLED = String(publishing);
  const pool = createPool();
  const storage = createStorage();
  let server: ReturnType<typeof createExchangeServer> | undefined;
  try {
    stage = "storage provisioning";
    try {
      await storage.send(new ListObjectsV2Command({ Bucket: state.bucket, MaxKeys: 1 }));
    } catch (error) {
      if (
        (error as { name?: string }).name !== "NoSuchBucket" &&
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404
      )
        throw error;
      await storage.send(new CreateBucketCommand({ Bucket: state.bucket }));
    }
    stage = "schema migration";
    await migrateExchangeSchema(
      pool,
      await FS.readFile(Path.join(import.meta.dirname, "schema.sql"), "utf8"),
    );
    const config = loadConfig();
    server = createExchangeServer(pool, storage, config);
    stage = "loopback listener startup";
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(8787, "127.0.0.1", () => {
        server!.removeListener("error", reject);
        resolve();
      });
    });
    console.log(
      `Real GitHub acceptance ready at ${config.origin}. Private registry; submissions ${publishing ? "enabled for allowlisted local testing" : "disabled"}. No fixture identities. Resources persist on shutdown.`,
    );
    console.log(`Local resource identity: ${file}`);
    let stopped = false;
    const workerId = Crypto.randomUUID();
    const stop = () => {
      stopped = true;
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    try {
      stage = "local scan worker";
      while (!stopped) {
        await recordWorkerHeartbeat(pool, workerId);
        const scanned = await scanNextVersion(pool, storage, config);
        if (scanned) await recordWorkerHeartbeat(pool, workerId, true);
        await new Promise((resolve) => setTimeout(resolve, scanned ? 20 : 500));
      }
    } finally {
      process.removeListener("SIGTERM", stop);
      process.removeListener("SIGINT", stop);
    }
  } finally {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    storage.destroy();
    await pool.end();
  }
}
if (import.meta.main)
  void run().catch(() => {
    console.error(
      `Local acceptance stopped during ${stage}. Check the private configuration and local test services. Resources are retained; no credentials or connection URLs are printed.`,
    );
    process.exitCode = 1;
  });
