import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPool, createStorage, loadConfig } from "./config";

beforeEach(() => {
  for (const [key, value] of Object.entries({
    EXCHANGE_ORIGIN: "http://localhost:8787",
    GITHUB_CLIENT_ID: "test-client",
    GITHUB_CLIENT_SECRET: "test-secret",
    S3_BUCKET: "test-bucket",
    EXCHANGE_OPERATOR_GITHUB_IDS: "",
    EXCHANGE_ADMIN_GITHUB_IDS: "",
    EXCHANGE_ALLOWED_GITHUB_IDS: "",
    EXCHANGE_VISIBILITY: "public",
    EXCHANGE_NAMESPACE_MANAGEMENT_ENABLED: "",
    EXCHANGE_PUBLISHING_ENABLED: "false",
  }))
    vi.stubEnv(key, value);
});
afterEach(() => vi.unstubAllEnvs());
it("uses Neon's generated AWS variables without replacing explicit S3 configuration", async () => {
  for (const key of ["S3_ENDPOINT", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
    vi.stubEnv(key, "");
  }
  vi.stubEnv("AWS_ENDPOINT_URL_S3", "https://storage.example.test");
  vi.stubEnv("AWS_REGION", "ap-southeast-1");
  vi.stubEnv("AWS_ACCESS_KEY_ID", "neon-test-id");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "neon-test-secret");
  const neon = createStorage();
  try {
    expect((await neon.config.endpoint!()).hostname).toBe("storage.example.test");
    expect(await neon.config.region()).toBe("ap-southeast-1");
    expect((await neon.config.credentials()).accessKeyId).toBe("neon-test-id");
    expect(neon.config.forcePathStyle).toBe(true);
  } finally {
    neon.destroy();
  }
  vi.stubEnv("S3_ENDPOINT", "http://localhost:9090");
  vi.stubEnv("S3_REGION", "us-east-1");
  vi.stubEnv("S3_ACCESS_KEY_ID", "local-id");
  vi.stubEnv("S3_SECRET_ACCESS_KEY", "local-secret");
  const explicit = createStorage();
  try {
    expect((await explicit.config.endpoint!()).hostname).toBe("localhost");
    expect(await explicit.config.region()).toBe("us-east-1");
    expect((await explicit.config.credentials()).accessKeyId).toBe("local-id");
  } finally {
    explicit.destroy();
  }
});
it("uses pooled queries and a separate direct connection for session operations", async () => {
  const pooled = "postgresql://user:password@ep-test-pooler.aws.neon.tech/neondb";
  const direct = "postgresql://user:password@ep-test.aws.neon.tech/neondb";
  vi.stubEnv("DATABASE_URL", pooled);
  vi.stubEnv("DATABASE_URL_UNPOOLED", direct);
  const queries = createPool();
  const sessions = createPool({ direct: true });
  try {
    expect(queries.options.connectionString).toBe(pooled);
    expect(sessions.options.connectionString).toBe(direct);
    expect(sessions.options.max).toBe(1);
  } finally {
    await Promise.all([queries.end(), sessions.end()]);
  }
});
it("rejects a pooled session connection and keeps direct-only local deployments working", async () => {
  vi.stubEnv("DATABASE_URL", "postgresql://user:password@ep-test-pooler.aws.neon.tech/neondb");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  expect(() => createPool({ direct: true })).toThrow("DATABASE_URL_UNPOOLED");
  vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost/test");
  const local = createPool({ direct: true });
  expect(local.options.connectionString).toBe("postgresql://user:password@localhost/test");
  await local.end();
});
it("permits an operator without granting legacy reviewer access and normalizes explicit numeric identities", () => {
  vi.stubEnv("EXCHANGE_OPERATOR_GITHUB_IDS", " 123,456,123 ");
  const config = loadConfig();
  expect([...config.operatorGithubIds!]).toEqual(["123", "456"]);
  expect(config.adminGithubIds.size).toBe(0);
  expect(config.publishingEnabled).toBe(false);
  vi.stubEnv("EXCHANGE_ADMIN_GITHUB_IDS", " 789, 987 ");
  expect([...loadConfig().adminGithubIds]).toEqual(["789", "987"]);
});
it("rejects ambiguous account identifiers in every configured role", () => {
  for (const name of [
    "EXCHANGE_OPERATOR_GITHUB_IDS",
    "EXCHANGE_ADMIN_GITHUB_IDS",
    "EXCHANGE_ALLOWED_GITHUB_IDS",
  ]) {
    for (const value of ["username", "0", "-1", "01", "1.5", "12,username"]) {
      vi.stubEnv(name, value);
      expect(() => loadConfig()).toThrow(`${name} requires numeric GitHub IDs.`);
    }
    vi.stubEnv(name, "");
  }
});
it("requires a private registry allowlist independently of operator privileges", () => {
  vi.stubEnv("EXCHANGE_VISIBILITY", "private");
  vi.stubEnv("EXCHANGE_OPERATOR_GITHUB_IDS", "123");
  expect(() => loadConfig()).toThrow("explicit GitHub numeric ID allowlist");
  vi.stubEnv("EXCHANGE_ALLOWED_GITHUB_IDS", "123");
  expect(loadConfig().allowedGithubIds?.has("123")).toBe(true);
});
it("accepts canonical HTTPS origins and rejects credentials, subpaths, and non-HTTP localhost schemes", () => {
  vi.stubEnv("EXCHANGE_ORIGIN", "https://exchange.example.test");
  expect(loadConfig().origin).toBe("https://exchange.example.test");
  for (const origin of [
    "https://private:secret@example.test",
    "https://example.test/exchange",
    "https://example.test?q=x",
    "https://example.test#x",
    "ftp://localhost",
    "http://example.test",
  ]) {
    vi.stubEnv("EXCHANGE_ORIGIN", origin);
    expect(() => loadConfig()).toThrow(/EXCHANGE_ORIGIN/);
  }
});
it("passes operator and reviewer settings to both deployed registry processes", () => {
  const compose = readFileSync(new URL("../compose.yaml", import.meta.url), "utf8");
  for (const service of ["api", "worker"]) {
    const block = compose.split(`\n  ${service}:`)[1]!.split(/\n(?:  \w|volumes:)/)[0]!;
    expect(block).toContain("EXCHANGE_OPERATOR_GITHUB_IDS: ${EXCHANGE_OPERATOR_GITHUB_IDS:-}");
    expect(block).toContain("EXCHANGE_ADMIN_GITHUB_IDS: ${EXCHANGE_ADMIN_GITHUB_IDS:-}");
    expect(block).toContain("EXCHANGE_PUBLISHING_ENABLED: ${EXCHANGE_PUBLISHING_ENABLED:-false}");
  }
});

it("can enable namespace management while keeping package submissions closed", () => {
  vi.stubEnv("EXCHANGE_NAMESPACE_MANAGEMENT_ENABLED", "true");
  vi.stubEnv("EXCHANGE_PUBLISHING_ENABLED", "false");
  expect(loadConfig()).toMatchObject({
    namespaceManagementEnabled: true,
    publishingEnabled: false,
  });
  vi.stubEnv("EXCHANGE_NAMESPACE_MANAGEMENT_ENABLED", "false");
  vi.stubEnv("EXCHANGE_PUBLISHING_ENABLED", "true");
  expect(loadConfig()).toMatchObject({
    namespaceManagementEnabled: false,
    publishingEnabled: true,
  });
});

it("allows only explicitly listed pilot publishers without opening public submissions", async () => {
  const { publishingEnabledForActor } = await import("./config");
  vi.stubEnv("EXCHANGE_PILOT_PUBLISHER_GITHUB_IDS", "123");
  vi.stubEnv("EXCHANGE_EMBEDDED_SCANNER_ENABLED", "true");
  const config = loadConfig();
  expect(config.publishingEnabled).toBe(false);
  expect(config.embeddedScannerEnabled).toBe(true);
  expect(publishingEnabledForActor(config, { id: "123" })).toBe(true);
  expect(publishingEnabledForActor(config, { id: "456" })).toBe(false);
  expect(publishingEnabledForActor(config, null)).toBe(false);
  vi.stubEnv("EXCHANGE_PILOT_PUBLISHER_GITHUB_IDS", "PanicMako");
  expect(() => loadConfig()).toThrow("numeric GitHub IDs");
});
