import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { Readable } from "node:stream";
import type { S3Client } from "@aws-sdk/client-s3";
import { packTabsext } from "@tabs/extension-package";
import type { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import type { ExchangeConfig } from "./config.ts";
import { scanNextVersion } from "./worker.ts";

const roots: string[] = [];
const config: ExchangeConfig = {
  origin: "http://localhost:8787",
  githubClientId: "test",
  githubClientSecret: "test",
  adminGithubIds: new Set(),
  bucket: "quarantine",
  tabsVersion: "1.3.17",
  publishingEnabled: true,
};

async function fixture() {
  const root = FS.mkdtempSync(Path.join(OS.tmpdir(), "tabs-exchange-worker-test-"));
  roots.push(root);
  const source = Path.join(root, "source");
  FS.mkdirSync(Path.join(source, "dist"), { recursive: true });
  FS.writeFileSync(Path.join(source, "dist", "index.html"), "<!doctype html><title>Test</title>");
  FS.writeFileSync(
    Path.join(source, "tabs-extension.json"),
    JSON.stringify({
      manifestVersion: 1,
      publisher: "example",
      name: "dashboard",
      version: "1.0.0",
      displayName: "Dashboard",
      description: "A test extension",
      engines: { tabs: ">=1.3.0 <2.0.0" },
      contributes: { tools: [{ id: "main", label: "Main", entry: "dist/index.html" }] },
    }),
  );
  const archive = Path.join(root, "package.tabsext");
  const inspected = await packTabsext({
    directory: source,
    destination: archive,
    tabsVersion: "1.3.17",
  });
  return { inspected, bytes: FS.readFileSync(archive) };
}

afterEach(() => {
  for (const root of roots.splice(0)) FS.rmSync(root, { recursive: true, force: true });
});

describe("Exchange quarantine worker", () => {
  it("moves a verified, scanned package to manual review", async () => {
    const { inspected, bytes } = await fixture();
    const updates: Array<{ sql: string; values: unknown[] | undefined }> = [];
    const pool = {
      async query(sql: string, values?: unknown[]) {
        if (sql.includes("RETURNING namespace, name, version, digest, object_key, scan_token")) {
          return {
            rows: [
              {
                namespace: "example",
                name: "dashboard",
                version: "1.0.0",
                digest: inspected.digest,
                object_key: "quarantine/test",
                scan_token: values?.[0],
              },
            ],
          };
        }
        if (sql.includes("SELECT manifest, scan_result")) return { rows: [] };
        updates.push({ sql, values });
        return { rows: [], rowCount: 1 };
      },
    } as unknown as Pool;
    const storage = {
      async send() {
        return { Body: Readable.from([bytes]) };
      },
    } as unknown as S3Client;
    expect(await scanNextVersion(pool, storage, config)).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.sql).toContain("status = 'review'");
    const result = JSON.parse(updates[0]!.values?.[4] as string);
    expect(result.passed).toBe(true);
    expect(result.digest).toBe(inspected.digest);
    expect(result.files["dist/index.html"]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("cannot pass a package whose quarantined bytes changed", async () => {
    const { inspected } = await fixture();
    let result: { passed: boolean; issues: Array<{ code: string }> } | null = null;
    const pool = {
      async query(sql: string, values?: unknown[]) {
        if (sql.includes("RETURNING namespace, name, version, digest, object_key, scan_token")) {
          return {
            rows: [
              {
                namespace: "example",
                name: "dashboard",
                version: "1.0.0",
                digest: inspected.digest,
                object_key: "quarantine/test",
                scan_token: values?.[0],
              },
            ],
          };
        }
        if (sql.includes("status = 'review'")) result = JSON.parse(values?.[4] as string);
        return { rows: [], rowCount: 1 };
      },
    } as unknown as Pool;
    const storage = {
      async send() {
        return { Body: Readable.from([Buffer.from("tampered")]) };
      },
    } as unknown as S3Client;
    expect(await scanNextVersion(pool, storage, config)).toBe(true);
    expect(result).toMatchObject({ passed: false, issues: [{ code: "scan-failed" }] });
  });
});
