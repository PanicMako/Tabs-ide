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

async function fixture(capabilities?: string[], version = "1.0.0") {
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
      version,
      displayName: "Dashboard",
      description: "A test extension",
      engines: { tabs: ">=1.3.0 <2.0.0" },
      ...(capabilities ? { capabilities } : {}),
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
  it("carries the last approved version's capability diff into the review record", async () => {
    const { inspected, bytes } = await fixture(["profile-storage"]);
    const previous = await fixture([], "0.9.0");
    let result: {
      comparisonVersion?: string;
      capabilityChanges: { added: string[] };
      reviewDiff?: { entries: Array<{ file: string; patch?: string }> };
    } | null = null;
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
        if (sql.includes("SELECT version, digest, bytes, object_key")) {
          return {
            rows: [
              {
                version: "0.9.0",
                digest: previous.inspected.digest,
                bytes: previous.bytes.length,
                object_key: "quarantine/prior",
              },
            ],
          };
        }
        if (sql.includes("status = 'review'")) result = JSON.parse(values?.[4] as string);
        return { rows: [], rowCount: 1 };
      },
    } as unknown as Pool;
    const storage = {
      async send(command: { input?: { Key?: string } }) {
        return {
          Body: Readable.from([command.input?.Key === "quarantine/prior" ? previous.bytes : bytes]),
        };
      },
    } as unknown as S3Client;
    expect(await scanNextVersion(pool, storage, config)).toBe(true);
    expect(result).toMatchObject({
      comparisonVersion: "0.9.0",
      capabilityChanges: { added: ["profile-storage"] },
    });
    const review = result as unknown as {
      reviewDiff: { entries: Array<{ file: string; patch?: string }> };
    };
    expect(
      review.reviewDiff.entries.some(
        (entry) => entry.file === "tabs-extension.json" && entry.patch?.includes("profile-storage"),
      ),
    ).toBe(true);
  });
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
        if (sql.includes("SELECT version, digest, bytes, object_key")) return { rows: [] };
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
    expect(result.capabilityChanges).toEqual({ added: [], removed: [] });
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

  it("blocks review when the previously approved archive cannot be verified", async () => {
    const { inspected, bytes } = await fixture();
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
                object_key: "quarantine/current",
                scan_token: values?.[0],
              },
            ],
          };
        }
        if (sql.includes("SELECT version, digest, bytes, object_key")) {
          return {
            rows: [
              {
                version: "0.9.0",
                digest: "a".repeat(64),
                bytes: 8,
                object_key: "quarantine/prior",
              },
            ],
          };
        }
        if (sql.includes("status = 'review'")) result = JSON.parse(values?.[4] as string);
        return { rows: [], rowCount: 1 };
      },
    } as unknown as Pool;
    const storage = {
      async send(command: { input?: { Key?: string } }) {
        return {
          Body: Readable.from([
            command.input?.Key === "quarantine/prior" ? Buffer.from("tampered") : bytes,
          ]),
        };
      },
    } as unknown as S3Client;
    expect(await scanNextVersion(pool, storage, config)).toBe(true);
    expect(result).toMatchObject({ passed: false, issues: [{ code: "scan-failed" }] });
  });
});
