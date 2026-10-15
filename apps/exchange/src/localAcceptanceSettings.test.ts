import { describe, expect, it } from "vitest";
import { acceptanceState, localAcceptanceSettings } from "./localAcceptanceSettings.ts";

const environment = {
  EXCHANGE_ORIGIN: "http://localhost:8787",
  EXCHANGE_VISIBILITY: "private",
  EXCHANGE_OPERATOR_GITHUB_IDS: "121330302",
  EXCHANGE_ALLOWED_GITHUB_IDS: "121330302",
  GITHUB_CLIENT_ID: "test-client-id",
  GITHUB_CLIENT_SECRET: "test-secret",
};

describe("real-account local acceptance safeguards", () => {
  it("uses local test services only after the real private-owner configuration is present", () => {
    const settings = localAcceptanceSettings(environment);
    expect(settings.database.hostname).toBe("127.0.0.1");
    expect(settings.storage.origin).toBe("http://127.0.0.1:9090");
    for (const overrides of [
      { EXCHANGE_ORIGIN: "http://127.0.0.1:8787" },
      { EXCHANGE_VISIBILITY: "public" },
      { EXCHANGE_OPERATOR_GITHUB_IDS: "42" },
      { EXCHANGE_ALLOWED_GITHUB_IDS: "42" },
      { EXCHANGE_ALLOWED_GITHUB_IDS: "121330302,invalid" },
      { GITHUB_CLIENT_SECRET: " " },
      { GITHUB_CLIENT_ID: "" },
      { NODE_ENV: "test" },
      { TABS_EXCHANGE_BROWSER_FIXTURE: "1" },
    ])
      expect(() => localAcceptanceSettings({ ...environment, ...overrides })).toThrow();
  });

  it("rejects remote services, URL options and credentialed storage without disclosing values", () => {
    for (const overrides of [
      { TEST_DATABASE_URL: "postgres://user:private-password@remote.example/db" },
      { TEST_DATABASE_URL: "postgres://user:private-password@127.0.0.1/db?sslmode=disable" },
      { TEST_DATABASE_URL: "postgres://127.0.0.1/db" },
      { TEST_S3_ENDPOINT: "http://remote.example" },
      { TEST_S3_ENDPOINT: "http://user:private-password@127.0.0.1:9090" },
      { TEST_S3_ENDPOINT: "http://127.0.0.1:9090/unrelated" },
    ]) {
      let message = "";
      try {
        localAcceptanceSettings({ ...environment, ...overrides });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe("");
      expect(message).not.toContain("private-password");
      expect(message).not.toContain("remote.example");
    }
  });

  it("refuses unrelated, malformed or mismatched persistent resource identities", () => {
    const state = {
      version: 1,
      kind: "real-github-local",
      database: "tabs_exchange_auth_0123456789abcdef",
      bucket: "tabs-exchange-auth-0123456789abcdef",
      createdAt: "2026-10-03T12:00:00.000Z",
    };
    expect(acceptanceState(state)).toEqual(state);
    for (const value of [
      null,
      {},
      { ...state, version: 2 },
      { ...state, kind: "fixture" },
      { ...state, database: "production" },
      { ...state, database: "tabs_exchange_auth_0123456789abcdef;DROP DATABASE production" },
      { ...state, bucket: "tabs-exchange-auth-fedcba9876543210" },
      { ...state, createdAt: "invalid" },
    ])
      expect(() => acceptanceState(value)).toThrow();
  });
});
