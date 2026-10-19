import { afterEach, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createSigningBackup, fingerprint, signRelease } from "../frontend/src/lib/releaseSigning";
import { registerSigningRoot, signedReleaseFiles } from "./releaseWizard";
afterEach(() => vi.unstubAllEnvs());
const origin = "https://exchange.example";
function fixture(pin?: string, published = false) {
  const query = vi.fn(async (sql: string) => ({
    rows: sql.startsWith("SELECT sha256")
      ? pin
        ? [{ sha256: pin }]
        : []
      : sql.startsWith("SELECT name")
        ? published
          ? [{ name: "root.json" }]
          : []
        : [],
  }));
  const release = vi.fn();
  const pool = { connect: async () => ({ query, release }) } as unknown as Pool;
  return { pool, query, release };
}
it("registers a verified first root under the publication lock and audits the operator", async () => {
  vi.stubEnv("EXCHANGE_TUF_BOOTSTRAP_ROOT_SHA256", "");
  const backup = await createSigningBackup(origin),
    pin = await fingerprint(backup.root);
  const subject = fixture();
  await registerSigningRoot(subject.pool, "1", origin, {
    root: backup.root,
    fingerprint: pin,
    confirmOrigin: origin,
  });
  expect(subject.query.mock.calls.map((call) => call[0])).toContain(
    "SELECT pg_advisory_xact_lock(1261492744)",
  );
  expect(
    subject.query.mock.calls.some((call) =>
      call[0].startsWith("INSERT INTO exchange_signing_events"),
    ),
  ).toBe(true);
  expect(subject.query.mock.calls.at(-1)![0]).toBe("COMMIT");
  expect(subject.release).toHaveBeenCalledOnce();
});
it("rejects root replacement, incorrect confirmations, unsigned roots and configured-pin conflicts", async () => {
  vi.stubEnv("EXCHANGE_TUF_BOOTSTRAP_ROOT_SHA256", "");
  const backup = await createSigningBackup(origin),
    pin = await fingerprint(backup.root),
    body = { root: backup.root, fingerprint: pin, confirmOrigin: origin };
  for (const subject of [fixture("b".repeat(64)), fixture(undefined, true)]) {
    await expect(registerSigningRoot(subject.pool, "1", origin, body)).rejects.toThrow(
      "already configured",
    );
    expect(subject.query.mock.calls.at(-1)![0]).toBe("ROLLBACK");
  }
  await expect(
    registerSigningRoot(fixture().pool, "1", origin, { ...body, confirmOrigin: "other" }),
  ).rejects.toThrow("Confirm");
  const root = JSON.stringify({ ...JSON.parse(backup.root), signatures: [] });
  await expect(
    registerSigningRoot(fixture().pool, "1", origin, {
      ...body,
      root,
      fingerprint: await fingerprint(root),
    }),
  ).rejects.toThrow("self-signed");
  vi.stubEnv("EXCHANGE_TUF_BOOTSTRAP_ROOT_SHA256", "b".repeat(64));
  await expect(registerSigningRoot(fixture().pool, "1", origin, body)).rejects.toThrow(
    "configured trust pin",
  );
});
it("only accepts the four public metadata files, never a key backup or extra private material", async () => {
  const backup = await createSigningBackup(origin),
    files = await signRelease(
      {
        origin,
        root: backup.root,
        pin: await fingerprint(backup.root),
        versions: { root: 0, targets: 0, snapshot: 0, timestamp: 0 },
        targets: {},
      },
      backup,
    );
  expect(signedReleaseFiles(files)).toHaveLength(4);
  expect(() => signedReleaseFiles({ ...files, privateKey: "secret" })).toThrow("only the four");
  const parsed = JSON.parse(files["root.json"]);
  parsed.signed.privateKey = "secret";
  expect(() => signedReleaseFiles({ ...files, "root.json": JSON.stringify(parsed) })).toThrow(
    "Invalid public metadata",
  );
});

it("passes device-generated metadata through the real TUF publication gate and rolls back tampered packages", async () => {
  const { createHash } = await import("node:crypto");
  const { Readable } = await import("node:stream");
  const { publishBrowserRelease } = await import("./releaseWizard");
  vi.stubEnv("EXCHANGE_TUF_BOOTSTRAP_ROOT_SHA256", "");
  const archive = Buffer.from("approved package bytes"),
    digest = createHash("sha256").update(archive).digest("hex");
  const backup = await createSigningBackup(origin),
    pin = await fingerprint(backup.root);
  const signed = await signRelease(
    {
      origin,
      root: backup.root,
      pin,
      versions: { root: 0, targets: 0, snapshot: 0, timestamp: 0 },
      targets: {
        "extensions/maker/tool/1.0.0.tabsext": {
          length: archive.length,
          hashes: { sha256: digest },
        },
      },
    },
    backup,
  );
  const releaseRow = {
    namespace: "maker",
    name: "tool",
    version: "1.0.0",
    digest,
    bytes: archive.length,
    status: "approved",
    object_key: `quarantine/maker/tool/1.0.0/${digest}.tabsext`,
  };
  const query = vi.fn(async (sql: string) => ({
    rows: sql.startsWith("SELECT sha256")
      ? [{ sha256: pin }]
      : sql.startsWith("SELECT namespace, name, version, digest")
        ? [releaseRow]
        : [],
  }));
  const pool = { connect: async () => ({ query, release: vi.fn() }) } as unknown as Pool;
  const storage = {
    send: async () => ({ Body: Readable.from([archive]) }),
  } as unknown as import("@aws-sdk/client-s3").S3Client;
  await expect(publishBrowserRelease(pool, storage, "quarantine", "1", signed)).resolves.toEqual({
    published: 4,
  });
  expect(query.mock.calls.at(-1)![0]).toBe("COMMIT");
  query.mockClear();
  const corrupt = {
    send: async () => ({ Body: Readable.from([Buffer.from("malicious replacement")]) }),
  } as unknown as import("@aws-sdk/client-s3").S3Client;
  await expect(publishBrowserRelease(pool, corrupt, "quarantine", "1", signed)).rejects.toThrow(
    "does not match approved digest",
  );
  expect(query.mock.calls.at(-1)![0]).toBe("ROLLBACK");
  expect(
    query.mock.calls.some((call) => call[0].startsWith("INSERT INTO exchange_tuf_metadata")),
  ).toBe(false);
});
