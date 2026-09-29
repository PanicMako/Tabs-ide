import * as Crypto from "node:crypto";
import * as FS from "node:fs/promises";
import * as Http from "node:http";
import * as OS from "node:os";
import * as Path from "node:path";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import type { Pool } from "pg";
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { packTabsext } from "@tabs/extension-package";
import { afterEach, describe, expect, it } from "vitest";
import { createExchangeServer } from "./server.ts";
import type { ExchangeConfig } from "./config.ts";
import { SignedMetadataEvents } from "./signedMetadataEvents.ts";

const servers: Array<ReturnType<typeof createExchangeServer>> = [];
const temporaryDirectories: string[] = [];
const reviewObject = Buffer.from("reviewed extension package");
const digest = Crypto.createHash("sha256").update(reviewObject).digest("hex");
const csrf = "test-csrf-token";
const config: ExchangeConfig = {
  origin: "http://localhost:8787",
  githubClientId: "test",
  githubClientSecret: "test",
  adminGithubIds: new Set(["42"]),
  bucket: "test",
  tabsVersion: "1.3.17",
  publishingEnabled: false,
};

async function fixture(
  scanPassed = true,
  storedDigest = digest,
  submissionStatus = "review",
  tuf?: {
    metadata?: Buffer;
    target?: Buffer;
    targetStatus?: "approved" | "revoked";
    publishedTarget?: boolean;
  },
  blockedDigest?: string,
  catalogRows?: Array<Record<string, unknown>>,
  allowUploads = false,
  signedMetadataEvents?: SignedMetadataEvents,
  duplicateUpload = false,
  storedReviewObject = reviewObject,
  invitation?: { owner?: boolean; targetId?: string; status?: string; expiresAt?: Date },
  membership?: {
    owner?: boolean;
    ownerCount?: number;
    targetRole?: "owner" | "contributor";
    finalGranted?: boolean;
  },
) {
  const actions: string[] = [];
  const publicQueries: string[] = [];
  let uploadObjectStored = false;
  const client = {
    async query(sql: string, params?: unknown[]) {
      actions.push(sql);
      if (duplicateUpload && sql.startsWith("INSERT INTO exchange_versions")) {
        throw Object.assign(new Error("duplicate version"), { code: "23505" });
      }
      if (sql.includes("SELECT name FROM exchange_namespaces")) {
        return { rows: [{ name: "example" }], rowCount: 1 };
      }
      if (
        sql.includes("SELECT role FROM exchange_namespace_members") &&
        sql.includes("role = 'owner'")
      ) {
        return {
          rows:
            invitation?.owner === false || membership?.owner === false ? [] : [{ role: "owner" }],
          rowCount: invitation?.owner === false || membership?.owner === false ? 0 : 1,
        };
      }
      if (sql.includes("SELECT id FROM exchange_users")) {
        return { rows: [{ id: params?.[0] }], rowCount: 1 };
      }
      if (
        sql.includes("SELECT role FROM exchange_namespace_members") &&
        !sql.includes("role = 'owner'")
      ) {
        if (membership?.targetRole) {
          return { rows: [{ role: membership.targetRole }], rowCount: 1 };
        }
        if (uploadObjectStored && membership?.finalGranted !== false) {
          return { rows: [{ role: "contributor" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("SELECT count(*)::text AS count FROM exchange_namespace_members")) {
        return { rows: [{ count: String(membership?.ownerCount ?? 2) }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO exchange_namespace_invitations")) {
        return { rows: [{ id: "7" }], rowCount: 1 };
      }
      if (sql.includes("SELECT namespace, role, user_id, status")) {
        if (invitation?.expiresAt && invitation.expiresAt.getTime() <= Date.now()) {
          return { rows: [], rowCount: 0 };
        }
        return {
          rows: [
            {
              namespace: "example",
              role: "contributor",
              user_id: invitation?.targetId ?? "42",
              status: invitation?.status ?? "pending",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("SELECT namespace, user_id, status FROM exchange_namespace_invitations")) {
        return {
          rows: [
            {
              namespace: "example",
              user_id: invitation?.targetId ?? "42",
              status: invitation?.status ?? "pending",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("SELECT status FROM exchange_namespace_invitations")) {
        return { rows: [{ status: invitation?.status ?? "pending" }], rowCount: 1 };
      }
      if (
        sql.includes("INSERT INTO exchange_namespace_members") &&
        sql.includes("ON CONFLICT DO NOTHING")
      ) {
        return { rows: [{ user_id: "42" }], rowCount: 1 };
      }
      if (sql.includes("SELECT status, digest, bytes, object_key, scan_result")) {
        return {
          rows: [
            {
              status: submissionStatus,
              digest: storedDigest,
              bytes: reviewObject.length,
              object_key: "quarantine/example/dashboard/1.0.0.tabsext",
              scan_result: { passed: scanPassed, digest: storedDigest, files: {} },
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("SELECT status, digest FROM exchange_versions")) {
        return {
          rows: [{ status: submissionStatus, digest: storedDigest }],
          rowCount: 1,
        };
      }
      if (sql.includes("SELECT v.digest, v.status")) {
        return {
          rows: [{ digest: storedDigest, status: submissionStatus }],
          rowCount: 1,
        };
      }
      if (sql.includes("INSERT INTO exchange_appeals")) {
        return { rows: [{ id: "1" }], rowCount: 1 };
      }
      if (sql.includes("SELECT id FROM exchange_appeals")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO exchange_blocked_digests")) {
        if (params?.[0] === blockedDigest) return { rows: [], rowCount: 0 };
        return { rows: [{ digest: params?.[0] }], rowCount: 1 };
      }
      if (sql.includes("DELETE FROM exchange_blocked_digests")) {
        return { rows: [{ digest: params?.[0] }], rowCount: 1 };
      }
      if (sql.includes("FROM exchange_blocked_digests")) {
        const digests = params?.[0];
        return blockedDigest && Array.isArray(digests) && digests.includes(blockedDigest)
          ? { rows: [{ digest: blockedDigest }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("SELECT namespace, name, version, digest FROM exchange_versions")) {
        return {
          rows: [{ namespace: "example", name: "dashboard", version: "1.0.0", digest }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const pool = {
    async query(sql: string, params?: unknown[]) {
      publicQueries.push(sql);
      if (sql.includes("AS stale_scans")) {
        return {
          rows: [
            {
              queued: 2,
              scanning: 1,
              stale_scans: 1,
              awaiting_review: 3,
              awaiting_signed_publication: 2,
              pending_signed_revocations: 1,
              oldest_queued_at: "2026-09-28T00:00:00Z",
              last_reviewed_at: null,
              last_worker_heartbeat_at: "2026-09-28T00:00:05Z",
              last_scan_at: "2026-09-28T00:00:04Z",
              worker_recently_seen: true,
              last_signed_publication_at: "2026-09-27T00:00:00Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("WHERE v.status = 'revoked' ORDER BY v.reviewed_at")) {
        return {
          rows: [{ namespace: "example", name: "dashboard", version: "1.0.0", digest }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM exchange_tuf_metadata")) {
        if (sql.includes("WHERE name = ANY")) {
          return {
            rows: tuf?.metadata ? [{ name: "timestamp.json", bytes: tuf.metadata }] : [],
            rowCount: tuf?.metadata ? 1 : 0,
          };
        }
        return {
          rows:
            tuf?.metadata && params?.[0] === "timestamp.json"
              ? [
                  {
                    bytes: tuf.metadata,
                    sha256: Crypto.createHash("sha256").update(tuf.metadata).digest("hex"),
                  },
                ]
              : [],
          rowCount: tuf?.metadata && params?.[0] === "timestamp.json" ? 1 : 0,
        };
      }
      if (sql.includes("uploader.login AS uploader_login")) {
        return {
          rows: [
            {
              version: "1.0.0",
              digest,
              status: "approved",
              uploader_login: "publisher",
              reviewer_login: "reviewer",
              review_reason: "Reviewed package",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM exchange_review_events e")) {
        return {
          rows: [
            {
              version: "1.0.0",
              digest,
              action: "approve",
              reviewer_login: "reviewer",
              reason: "Reviewed package",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM exchange_published_heads h")) {
        const isPublic = Boolean(
          tuf?.target && tuf.targetStatus === "approved" && tuf.publishedTarget !== false,
        );
        const rows = isPublic
          ? (catalogRows ?? [
              {
                namespace: "example",
                name: "dashboard",
                version: "1.0.0",
                digest,
                manifest: { displayName: "Dashboard" },
                verified: false,
              },
            ])
          : [];
        const after = rows
          .filter(
            (entry) =>
              params?.[1] === null ||
              `${entry.namespace}.${entry.name}` > `${params?.[1]}.${params?.[2]}`,
          )
          .sort((left, right) =>
            `${left.namespace}.${left.name}`.localeCompare(`${right.namespace}.${right.name}`),
          )
          .slice(0, Number(params?.[3]));
        return { rows: after, rowCount: after.length };
      }
      if (sql.includes("FROM exchange_versions") && sql.includes("status = 'approved'")) {
        const isPublic = Boolean(
          tuf?.target && tuf.targetStatus === "approved" && tuf.publishedTarget !== false,
        );
        const rows: Array<Record<string, unknown>> = isPublic
          ? (catalogRows ?? [
              {
                namespace: "example",
                name: "dashboard",
                version: "1.0.0",
                digest: Crypto.createHash("sha256").update(tuf!.target!).digest("hex"),
                bytes: tuf!.target!.length,
                manifest: { displayName: "Dashboard" },
                verified: false,
                object_key: "approved/example/dashboard/1.0.0.tabsext",
              },
            ])
          : [];
        if (sql.includes("AS cursor_time")) {
          const cursorTime = "2026-09-28T10:11:12.123456Z";
          const versions = rows
            .map((entry) => ({
              ...entry,
              version: String(entry["version"]),
              cursor_time: cursorTime,
            }))
            .filter(
              (entry) =>
                params?.[2] === null ||
                cursorTime < String(params?.[2]) ||
                (cursorTime === params?.[2] && String(entry.version) < String(params?.[3])),
            )
            .sort((left, right) =>
              left.version === right.version
                ? 0
                : String(left.version) < String(right.version)
                  ? 1
                  : -1,
            )
            .slice(0, Number(params?.[4]));
          return { rows: versions, rowCount: versions.length };
        }
        return {
          rows,
          rowCount: rows.length,
        };
      }
      if (sql.includes("FROM exchange_sessions")) {
        return {
          rows: [
            {
              id: "42",
              login: "reviewer",
              csrf_hash: Crypto.createHash("sha256").update(csrf).digest("hex"),
            },
          ],
          rowCount: 1,
        };
      }
      if (
        sql.includes("FROM exchange_namespace_invitations i") &&
        sql.includes("u.id = i.user_id")
      ) {
        return {
          rows: [
            {
              id: "7",
              user_id: "43",
              login: "invitee",
              role: "contributor",
              expires_at: "2026-10-01T00:00:00Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM exchange_namespace_invitations i")) {
        return {
          rows: [
            {
              id: "7",
              namespace: "example",
              role: "contributor",
              inviter_login: "owner",
              expires_at: "2026-10-01T00:00:00Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (
        sql.includes("FROM exchange_namespace_members m") &&
        sql.includes("JOIN exchange_users u")
      ) {
        return {
          rows: [
            { user_id: "42", login: "owner", role: "owner" },
            { user_id: "43", login: "contributor", role: "contributor" },
          ],
          rowCount: 2,
        };
      }
      if (allowUploads && sql.includes("FROM exchange_namespace_members WHERE")) {
        return { rows: [{ role: "owner" }], rowCount: 1 };
      }
      if (sql.includes("UPDATE exchange_appeals")) {
        return { rows: [{ id: "1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    async connect() {
      return client;
    },
  } as unknown as Pool;
  const storage = {
    async send(command: unknown) {
      if (command instanceof PutObjectCommand) uploadObjectStored = true;
      return { Body: Readable.from([tuf?.target ?? storedReviewObject]) };
    },
  } as unknown as S3Client;
  const server = createExchangeServer(
    pool,
    storage,
    allowUploads ? { ...config, publishingEnabled: true } : config,
    signedMetadataEvents,
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${address.port}`, actions, publicQueries };
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => FS.rm(directory, { recursive: true, force: true })),
  );
});

describe("Exchange HTTP boundaries", () => {
  it("reports a duplicate submitted version without publishing it", async () => {
    const directory = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-exchange-duplicate-test-"));
    temporaryDirectories.push(directory);
    const archive = Path.join(directory, "hello.tabsext");
    await packTabsext({
      directory: Path.resolve(import.meta.dirname, "../../../examples/hello-extension"),
      destination: archive,
      tabsVersion: "1.3.17",
    });
    const ready = await fixture(
      true,
      digest,
      "review",
      undefined,
      undefined,
      undefined,
      true,
      undefined,
      true,
    );
    const response = await fetch(`${ready.base}/v1/publisher/tabs-example/hello/versions`, {
      method: "POST",
      headers: {
        Origin: config.origin,
        Cookie: "tabs_exchange_session=opaque",
        "X-CSRF-Token": csrf,
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(await FS.readFile(archive)),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "This extension version was already submitted.",
    });
    expect(ready.actions.some((sql) => sql.startsWith("INSERT INTO exchange_versions"))).toBe(true);
  });

  it("serves a machine-readable public contract without treating catalog data as authority", async () => {
    const ready = await fixture(true, digest, "approved");
    const response = await fetch(`${ready.base}/v1/openapi.json`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const contract = await response.json();
    expect(contract.openapi).toBe("3.1.0");
    expect(contract.info.description).toContain("not installation authority");
    expect(Object.keys(contract.paths)).toEqual([
      "/v1/extensions",
      "/v1/extensions/{namespace}/{name}",
      "/v1/extensions/{namespace}/{name}/versions/{version}",
      "/v1/extensions/{namespace}/{name}/versions/{version}/download",
      "/v1/tuf/metadata/{file}",
      "/v1/tuf/targets/extensions/{namespace}/{name}/{version}.tabsext",
      "/v1/tuf/events",
    ]);
  });

  it("rejects search parameters outside the public contract", async () => {
    const ready = await fixture(true, digest, "approved");
    for (const query of [
      "limit=0",
      "limit=101",
      "limit=1.5",
      "limit=nan",
      `q=${"x".repeat(101)}`,
    ]) {
      expect((await fetch(`${ready.base}/v1/extensions?${query}`)).status).toBe(400);
    }
  });

  it("paginates public search without repeating an extension", async () => {
    const target = Buffer.from("approved");
    const rows = ["alpha", "bravo", "charlie"].map((name) => ({
      namespace: "example",
      name,
      version: "1.0.0",
      digest,
      manifest: { displayName: name },
      verified: false,
    }));
    const ready = await fixture(
      true,
      digest,
      "approved",
      { target, targetStatus: "approved" },
      undefined,
      rows,
    );
    const path = `${ready.base}/v1/extensions?limit=2`;
    const first = await fetch(path);
    expect(first.status).toBe(200);
    const firstPage = await first.json();
    expect(firstPage.extensions.map((entry: { name: string }) => entry.name)).toEqual([
      "alpha",
      "bravo",
    ]);
    expect(typeof firstPage.nextCursor).toBe("string");
    const second = await fetch(`${path}&cursor=${encodeURIComponent(firstPage.nextCursor)}`);
    const secondPage = await second.json();
    expect(secondPage.extensions.map((entry: { name: string }) => entry.name)).toEqual(["charlie"]);
    expect(secondPage.nextCursor).toBeNull();
    expect((await fetch(`${path}&cursor=bad%2Fcursor`)).status).toBe(400);
  });

  it("paginates public version lists with bounded opaque cursors", async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({
      namespace: "example",
      name: "dashboard",
      version: `1.0.${index}`,
      digest,
      bytes: 100,
      manifest: { displayName: "Dashboard" },
      verified: false,
    }));
    const ready = await fixture(
      true,
      digest,
      "approved",
      {
        target: Buffer.from("approved"),
        targetStatus: "approved",
      },
      undefined,
      rows,
    );
    const path = `${ready.base}/v1/extensions/example/dashboard`;
    const first = await fetch(path);
    expect(first.status).toBe(200);
    const firstPage = await first.json();
    expect(firstPage.versions).toHaveLength(100);
    expect(firstPage.versions[0]).not.toHaveProperty("cursor_time");
    expect(typeof firstPage.nextCursor).toBe("string");
    const second = await fetch(`${path}?cursor=${encodeURIComponent(firstPage.nextCursor)}`);
    expect(second.status).toBe(200);
    const secondPage = await second.json();
    expect(secondPage.versions).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
    expect(
      new Set([...firstPage.versions, ...secondPage.versions].map((entry) => entry.version)).size,
    ).toBe(101);
    expect((await fetch(`${path}?cursor=bad%2Fcursor`)).status).toBe(400);
  });
  it("exposes scan queue operations only to reviewers", async () => {
    const ready = await fixture();
    const path = `${ready.base}/v1/review/operations`;
    expect((await fetch(path)).status).toBe(403);
    expect(ready.publicQueries.some((sql) => sql.includes("AS stale_scans"))).toBe(false);
    expect(
      ready.publicQueries.some((sql) => sql.includes("WHERE v.status = 'revoked' ORDER BY")),
    ).toBe(false);
    const response = await fetch(path, { headers: { Cookie: "tabs_exchange_session=opaque" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      queue: {
        queued: 2,
        scanning: 1,
        stale_scans: 1,
        awaiting_review: 3,
        awaiting_signed_publication: 2,
        pending_signed_revocations: 1,
        worker_recently_seen: true,
      },
      pendingRevocations: [{ namespace: "example", name: "dashboard", digest }],
      metadataFreshness: [
        { role: "root", status: "missing", expiresAt: null },
        { role: "timestamp", status: "missing", expiresAt: null },
        { role: "snapshot", status: "missing", expiresAt: null },
        { role: "targets", status: "missing", expiresAt: null },
      ],
    });
    expect(ready.publicQueries.filter((sql) => sql.includes("AS stale_scans"))).toHaveLength(1);
    expect(
      ready.publicQueries.filter((sql) => sql.includes("WHERE v.status = 'revoked' ORDER BY")),
    ).toHaveLength(1);
  });
  it("restricts exact extension review history to admins", async () => {
    const ready = await fixture();
    const path = `${ready.base}/v1/review/example/dashboard/history`;
    expect((await fetch(path)).status).toBe(403);
    const response = await fetch(path, { headers: { Cookie: "tabs_exchange_session=opaque" } });
    expect(response.status).toBe(200);
    const history = await response.json();
    expect(history).toMatchObject({
      namespace: "example",
      name: "dashboard",
      versions: [{ uploader_login: "publisher", reviewer_login: "reviewer" }],
      decisions: [{ action: "approve", reason: "Reviewed package" }],
    });
    expect(JSON.stringify(history)).not.toContain("object_key");
    expect(
      ready.publicQueries.filter((sql) => sql.includes("WHERE v.namespace = $1 AND v.name = $2")),
    ).toHaveLength(1);
    expect(
      ready.publicQueries.filter((sql) => sql.includes("WHERE e.namespace = $1 AND e.name = $2")),
    ).toHaveLength(1);
  });

  it("requires invitation acceptance before granting namespace membership", async () => {
    const ready = await fixture(true, digest, "review", undefined, undefined, undefined, true);
    const account = await fetch(`${ready.base}/v1/me`, {
      headers: { Cookie: "tabs_exchange_session=opaque" },
    });
    expect((await account.json()).termsVersion).toBe("2026-09-24");
    const headers = {
      Origin: config.origin,
      Cookie: "tabs_exchange_session=opaque",
      "X-CSRF-Token": csrf,
      "Content-Type": "application/json",
    };
    const incoming = await fetch(`${ready.base}/v1/publisher/invitations`, {
      headers: { Cookie: "tabs_exchange_session=opaque" },
    });
    expect(incoming.status).toBe(200);
    expect((await incoming.json()).invitations[0]).toMatchObject({
      id: "7",
      namespace: "example",
      role: "contributor",
    });
    const invite = await fetch(`${ready.base}/v1/namespaces/example/members`, {
      method: "POST",
      headers,
      body: JSON.stringify({ githubUserId: "43", role: "contributor" }),
    });
    expect(invite.status).toBe(202);
    expect(await invite.json()).toMatchObject({ invitationId: "7", userId: "43" });
    expect(
      ready.actions.some((sql) => sql.includes("INSERT INTO exchange_namespace_members")),
    ).toBe(false);
    const withoutTerms = await fetch(`${ready.base}/v1/publisher/invitations/7/accept`, {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(withoutTerms.status).toBe(400);
    expect(
      ready.actions.some((sql) => sql.includes("INSERT INTO exchange_namespace_members")),
    ).toBe(false);
    const accepted = await fetch(`${ready.base}/v1/publisher/invitations/7/accept`, {
      method: "POST",
      headers,
      body: JSON.stringify({ acceptTermsVersion: "2026-09-24" }),
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ namespace: "example", role: "contributor" });
    expect(
      ready.actions.some((sql) => sql.includes("INSERT INTO exchange_namespace_members")),
    ).toBe(true);
    expect(ready.actions.some((sql) => sql.includes("status = 'accepted'"))).toBe(true);
    expect(ready.actions.some((sql) => sql.includes("accepted_terms_version = $2"))).toBe(true);
  });

  it("rejects invitations to non-owners and acceptance by another account", async () => {
    const notOwner = await fixture(
      true,
      digest,
      "review",
      undefined,
      undefined,
      undefined,
      true,
      undefined,
      false,
      reviewObject,
      { owner: false },
    );
    const headers = {
      Origin: config.origin,
      Cookie: "tabs_exchange_session=opaque",
      "X-CSRF-Token": csrf,
      "Content-Type": "application/json",
    };
    const invite = await fetch(`${notOwner.base}/v1/namespaces/example/members`, {
      method: "POST",
      headers,
      body: JSON.stringify({ githubUserId: "43", role: "owner" }),
    });
    expect(invite.status).toBe(403);
    const wrongRecipient = await fixture(
      true,
      digest,
      "review",
      undefined,
      undefined,
      undefined,
      true,
      undefined,
      false,
      reviewObject,
      { targetId: "43" },
    );
    const accepted = await fetch(`${wrongRecipient.base}/v1/publisher/invitations/7/accept`, {
      method: "POST",
      headers,
      body: JSON.stringify({ acceptTermsVersion: "2026-09-24" }),
    });
    expect(accepted.status).toBe(409);
    expect(
      wrongRecipient.actions.some((sql) => sql.includes("INSERT INTO exchange_namespace_members")),
    ).toBe(false);
    const expired = await fixture(
      true,
      digest,
      "review",
      undefined,
      undefined,
      undefined,
      true,
      undefined,
      false,
      reviewObject,
      { expiresAt: new Date(0) },
    );
    const expiredResponse = await fetch(`${expired.base}/v1/publisher/invitations/7/accept`, {
      method: "POST",
      headers,
      body: JSON.stringify({ acceptTermsVersion: "2026-09-24" }),
    });
    expect(expiredResponse.status).toBe(409);
    expect(
      expired.actions.some((sql) => sql.includes("INSERT INTO exchange_namespace_members")),
    ).toBe(false);
  });

  it("lets a recipient decline a pending invitation without accepting terms", async () => {
    const ready = await fixture();
    const response = await fetch(`${ready.base}/v1/publisher/invitations/7/decline`, {
      method: "POST",
      headers: {
        Origin: config.origin,
        Cookie: "tabs_exchange_session=opaque",
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ namespace: "example", status: "declined" });
    expect(ready.actions.some((sql) => sql.includes("status = 'declined'"))).toBe(true);
    expect(
      ready.actions.some((sql) => sql.includes("INSERT INTO exchange_namespace_members")),
    ).toBe(false);
    const wrongRecipient = await fixture(
      true,
      digest,
      "review",
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      false,
      reviewObject,
      { targetId: "43" },
    );
    const denied = await fetch(`${wrongRecipient.base}/v1/publisher/invitations/7/decline`, {
      method: "POST",
      headers: {
        Origin: config.origin,
        Cookie: "tabs_exchange_session=opaque",
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(denied.status).toBe(409);
  });

  it("lets an owner cancel a pending invitation with an audited reason", async () => {
    const ready = await fixture();
    const response = await fetch(`${ready.base}/v1/namespaces/example/invitations/7/cancel`, {
      method: "POST",
      headers: {
        Origin: config.origin,
        Cookie: "tabs_exchange_session=opaque",
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason: "Wrong account invited" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ namespace: "example", status: "revoked" });
    expect(ready.actions.some((sql) => sql.includes("decision_reason = $3"))).toBe(true);
    const nonOwner = await fixture(
      true,
      digest,
      "review",
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      false,
      reviewObject,
      { owner: false },
    );
    const denied = await fetch(`${nonOwner.base}/v1/namespaces/example/invitations/7/cancel`, {
      method: "POST",
      headers: {
        Origin: config.origin,
        Cookie: "tabs_exchange_session=opaque",
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason: "Wrong account invited" }),
    });
    expect(denied.status).toBe(403);
  });

  it("lists members only for owners and audits access removal", async () => {
    const ready = await fixture(
      true,
      digest,
      "review",
      undefined,
      undefined,
      undefined,
      true,
      undefined,
      false,
      reviewObject,
      undefined,
      { targetRole: "contributor" },
    );
    const list = await fetch(`${ready.base}/v1/namespaces/example/members`, {
      headers: { Cookie: "tabs_exchange_session=opaque" },
    });
    expect(list.status).toBe(200);
    const listing = await list.json();
    expect(listing.members).toHaveLength(2);
    expect(listing.invitations).toHaveLength(1);
    const removed = await fetch(`${ready.base}/v1/namespaces/example/members/43`, {
      method: "DELETE",
      headers: {
        Origin: config.origin,
        Cookie: "tabs_exchange_session=opaque",
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason: "Contributor left the team" }),
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({
      namespace: "example",
      userId: "43",
      removedRole: "contributor",
    });
    expect(
      ready.actions.some((sql) => sql.includes("DELETE FROM exchange_namespace_members")),
    ).toBe(true);
    expect(
      ready.actions.some((sql) => sql.includes("INSERT INTO exchange_namespace_member_events")),
    ).toBe(true);
    expect(ready.actions.some((sql) => sql.includes("status = 'revoked'"))).toBe(true);
    const outsider = await fixture();
    expect(
      (
        await fetch(`${outsider.base}/v1/namespaces/example/members`, {
          headers: { Cookie: "tabs_exchange_session=opaque" },
        })
      ).status,
    ).toBe(403);
    const publishingDisabled = await fixture(
      true,
      digest,
      "review",
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      false,
      reviewObject,
      undefined,
      { targetRole: "contributor" },
    );
    const emergencyRemoval = await fetch(
      `${publishingDisabled.base}/v1/namespaces/example/members/43`,
      {
        method: "DELETE",
        headers: {
          Origin: config.origin,
          Cookie: "tabs_exchange_session=opaque",
          "X-CSRF-Token": csrf,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: "Emergency access revocation" }),
      },
    );
    expect(emergencyRemoval.status).toBe(200);
  });

  it("preserves the last namespace owner", async () => {
    const ready = await fixture(
      true,
      digest,
      "review",
      undefined,
      undefined,
      undefined,
      true,
      undefined,
      false,
      reviewObject,
      undefined,
      { ownerCount: 1, targetRole: "owner" },
    );
    const response = await fetch(`${ready.base}/v1/namespaces/example/members/42`, {
      method: "DELETE",
      headers: {
        Origin: config.origin,
        Cookie: "tabs_exchange_session=opaque",
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason: "Leaving" }),
    });
    expect(response.status).toBe(409);
    expect(
      ready.actions.some((sql) => sql.includes("DELETE FROM exchange_namespace_members")),
    ).toBe(false);
  });

  it("rechecks publisher membership after an archive reaches quarantine", async () => {
    const directory = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-exchange-revoked-upload-"));
    temporaryDirectories.push(directory);
    const archive = Path.join(directory, "hello.tabsext");
    await packTabsext({
      directory: Path.resolve(import.meta.dirname, "../../../examples/hello-extension"),
      destination: archive,
      tabsVersion: "1.3.17",
    });
    const ready = await fixture(
      true,
      digest,
      "review",
      undefined,
      undefined,
      undefined,
      true,
      undefined,
      false,
      reviewObject,
      undefined,
      { finalGranted: false },
    );
    const response = await fetch(`${ready.base}/v1/publisher/tabs-example/hello/versions`, {
      method: "POST",
      headers: {
        Origin: config.origin,
        Cookie: "tabs_exchange_session=opaque",
        "X-CSRF-Token": csrf,
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(await FS.readFile(archive)),
    });
    expect(response.status).toBe(403);
    expect(ready.actions.some((sql) => sql.includes("INSERT INTO exchange_versions"))).toBe(false);
  });

  it("limits concurrent publisher uploads and releases slots after disconnects", async () => {
    const ready = await fixture(true, digest, "review", undefined, undefined, undefined, true);
    const headers = {
      Origin: config.origin,
      Cookie: "tabs_exchange_session=opaque",
      "X-CSRF-Token": csrf,
      "Content-Type": "application/octet-stream",
      "Content-Length": "100",
    };
    const upload = () => {
      const request = Http.request(`${ready.base}/v1/publisher/example/dashboard/versions`, {
        method: "POST",
        headers,
      });
      request.on("error", () => {});
      request.write("x");
      return request;
    };
    const first = upload();
    const second = upload();
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (
          ready.publicQueries.filter((sql) => sql.includes("FROM exchange_namespace_members WHERE"))
            .length >= 2
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(
        ready.publicQueries.filter((sql) => sql.includes("FROM exchange_namespace_members WHERE")),
      ).toHaveLength(2);
      const crowded = await fetch(`${ready.base}/v1/publisher/example/dashboard/versions`, {
        method: "POST",
        headers: { ...headers, "Content-Length": "1" },
        body: "x",
      });
      expect(crowded.status).toBe(429);
      expect(crowded.headers.get("connection")).toBe("close");
    } finally {
      first.destroy();
      second.destroy();
    }
    let retryStatus = 429;
    for (let attempt = 0; attempt < 100 && retryStatus === 429; attempt++) {
      const retry = await fetch(`${ready.base}/v1/publisher/example/dashboard/versions`, {
        method: "POST",
        headers: { ...headers, "Content-Length": "1" },
        body: "x",
      });
      retryStatus = retry.status;
      if (retryStatus === 429) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(retryStatus).toBe(400);
  });

  it("rejects declared oversized archives without retaining the upload connection", async () => {
    const ready = await fixture(true, digest, "review", undefined, undefined, undefined, true);
    const response = await new Promise<Http.IncomingMessage>((resolve, reject) => {
      const request = Http.request(`${ready.base}/v1/publisher/example/dashboard/versions`, {
        method: "POST",
        headers: {
          Origin: config.origin,
          Cookie: "tabs_exchange_session=opaque",
          "X-CSRF-Token": csrf,
          "Content-Type": "application/octet-stream",
          "Content-Length": String(25 * 1024 * 1024 + 1),
        },
      });
      request.once("response", resolve);
      request.once("error", reject);
      request.write("x");
    });
    expect(response.statusCode).toBe(413);
    expect(response.headers.connection).toBe("close");
    response.resume();
  });

  it("serves the signed-publication head without ranking historical releases on each search", async () => {
    const target = Buffer.from("approved extension archive");
    const rows = [
      {
        namespace: "example",
        name: "dashboard",
        version: "1.2.0",
        digest,
        manifest: { displayName: "Dashboard", version: "1.2.0" },
        verified: false,
      },
    ];
    const ready = await fixture(
      true,
      digest,
      "approved",
      { target, targetStatus: "approved" },
      undefined,
      rows,
    );
    const response = await fetch(`${ready.base}/v1/extensions`);
    expect(response.status).toBe(200);
    expect((await response.json()).extensions).toMatchObject([{ version: "1.2.0" }]);
    expect(
      ready.publicQueries.filter((sql) => sql.includes("exchange_published_heads h")),
    ).toHaveLength(1);
  });

  it("serves only published signed metadata bytes", async () => {
    const metadata = Buffer.from('{"signed":"test"}');
    const ready = await fixture(true, digest, "review", { metadata });
    const result = await fetch(`${ready.base}/v1/tuf/metadata/timestamp.json`);
    expect(result.status).toBe(200);
    expect(Buffer.from(await result.arrayBuffer())).toEqual(metadata);
    expect(result.headers.get("cache-control")).toBe("no-store");
    const missing = await fetch(`${ready.base}/v1/tuf/metadata/2.root.json`);
    expect(missing.status).toBe(404);
  });

  it("serves approved TUF targets but blocks revoked and wrong digest paths", async () => {
    const target = Buffer.from("approved extension archive");
    const hash = Crypto.createHash("sha256").update(target).digest("hex");
    const ready = await fixture(true, digest, "review", {
      target,
      targetStatus: "approved",
    });
    const path = "/v1/tuf/targets/extensions/example/dashboard/1.0.0.tabsext";
    const result = await fetch(`${ready.base}${path}`);
    expect(result.status).toBe(200);
    expect(Buffer.from(await result.arrayBuffer())).toEqual(target);
    expect(
      (await fetch(`${ready.base}${path.replace("1.0.0", `${"f".repeat(64)}.1.0.0`)}`)).status,
    ).toBe(404);
    expect((await fetch(`${ready.base}${path.replace("1.0.0", `${hash}.1.0.0`)}`)).status).toBe(
      200,
    );
    const revoked = await fixture(true, digest, "review", {
      target,
      targetStatus: "revoked",
    });
    expect((await fetch(`${revoked.base}${path}`)).status).toBe(404);
  });

  it("keeps approved versions out of discovery and downloads until signed publication", async () => {
    const target = Buffer.from("approved but not signed");
    const ready = await fixture(true, digest, "approved", {
      target,
      targetStatus: "approved",
      publishedTarget: false,
    });
    const catalog = await fetch(`${ready.base}/v1/extensions`);
    expect((await catalog.json()).extensions).toEqual([]);
    expect((await fetch(`${ready.base}/v1/extensions/example/dashboard`)).status).toBe(404);
    expect(
      (await fetch(`${ready.base}/v1/extensions/example/dashboard/versions/1.0.0`)).status,
    ).toBe(404);
    expect(
      (await fetch(`${ready.base}/v1/extensions/example/dashboard/versions/1.0.0/download`)).status,
    ).toBe(404);
    expect(
      (await fetch(`${ready.base}/v1/tuf/targets/extensions/example/dashboard/1.0.0.tabsext`))
        .status,
    ).toBe(404);
    const approvedQueries = ready.publicQueries.filter((sql) =>
      sql.includes("status = 'approved'"),
    );
    expect(approvedQueries).toHaveLength(5);
    expect(approvedQueries.every((sql) => sql.includes("exchange_published_targets"))).toBe(true);

    const published = await fixture(true, digest, "approved", {
      target,
      targetStatus: "approved",
    });
    const visible = await fetch(`${published.base}/v1/extensions`);
    expect((await visible.json()).extensions).toEqual([
      expect.objectContaining({ namespace: "example", name: "dashboard", version: "1.0.0" }),
    ]);
    const downloaded = await fetch(
      `${published.base}/v1/extensions/example/dashboard/versions/1.0.0/download`,
    );
    expect(downloaded.status).toBe(200);
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(target);
  });

  it("serves the accessible publisher shell but keeps publishing disabled", async () => {
    const { base } = await fixture();
    const page = await fetch(`${base}/publisher`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('id="metadata-freshness"');
    expect(html).toContain('id="invitations" aria-label="Pending namespace invitations"');
    expect(html).toContain('id="blocked-digest-batch-value"');
    expect(html).toContain('src="/publisher.js" type="module"');
    const parser = await fetch(`${base}/publisherBatch.js`);
    expect(parser.status).toBe(200);
    expect(parser.headers.get("content-type")).toContain("text/javascript");
    expect(await parser.text()).toContain("parseBlockedDigestBatch");
    const create = await fetch(`${base}/v1/namespaces`, { method: "POST" });
    expect(create.status).toBe(503);
  });

  it("streams unsigned hints only after signed metadata publication", async () => {
    const events = new SignedMetadataEvents();
    const ready = await fixture(
      true,
      digest,
      "review",
      undefined,
      undefined,
      undefined,
      false,
      events,
    );
    const controller = new AbortController();
    const response = await fetch(`${ready.base}/v1/tuf/events`, { signal: controller.signal });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    try {
      const initial = await reader.read();
      expect(new TextDecoder().decode(initial.value)).toContain("retry: 10000");
      const next = reader.read();
      events.publishHint();
      expect(new TextDecoder().decode((await next).value)).toContain("event: signed-metadata");
    } finally {
      controller.abort();
      await reader.cancel().catch(() => undefined);
      events.stop();
    }
  });

  it("requires reviewer authentication and exact digest", async () => {
    const { base, actions } = await fixture();
    const denied = await fetch(`${base}/v1/review/queue`);
    expect(denied.status).toBe(403);
    const result = await fetch(`${base}/v1/review/example/dashboard/1.0.0`, {
      method: "POST",
      headers: {
        Origin: config.origin,
        Cookie: "tabs_exchange_session=opaque",
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "approve",
        digest: "b".repeat(64),
        reason: "Reviewed",
      }),
    });
    expect(result.status).toBe(409);
    expect(actions.some((sql) => sql.includes("INSERT INTO exchange_review_events"))).toBe(false);
  });

  it("blocks scan failures and audits approved decisions", async () => {
    const blocked = await fixture(false);
    const headers = {
      Origin: config.origin,
      Cookie: "tabs_exchange_session=opaque",
      "X-CSRF-Token": csrf,
      "Content-Type": "application/json",
    };
    const body = JSON.stringify({
      action: "approve",
      digest,
      reason: "Reviewed package",
    });
    const rejected = await fetch(`${blocked.base}/v1/review/example/dashboard/1.0.0`, {
      method: "POST",
      headers,
      body,
    });
    expect(rejected.status).toBe(409);
    const ready = await fixture(true);
    const approved = await fetch(`${ready.base}/v1/review/example/dashboard/1.0.0`, {
      method: "POST",
      headers,
      body,
    });
    expect(approved.status).toBe(200);
    expect(ready.actions.some((sql) => sql.includes("INSERT INTO exchange_review_events"))).toBe(
      true,
    );
  });

  it("rechecks blocked material when approving an older passed scan", async () => {
    const ready = await fixture(true, digest, "review", undefined, digest);
    const result = await fetch(`${ready.base}/v1/review/example/dashboard/1.0.0`, {
      method: "POST",
      headers: {
        Origin: config.origin,
        Cookie: "tabs_exchange_session=opaque",
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "approve", digest, reason: "Reviewed" }),
    });
    expect(result.status).toBe(409);
    expect(ready.actions.some((sql) => sql.includes("UPDATE exchange_versions SET status"))).toBe(
      false,
    );
  });

  it("does not approve an object changed after its scan", async () => {
    const ready = await fixture(
      true,
      digest,
      "review",
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      false,
      Buffer.from("changed extension package"),
    );
    const result = await fetch(`${ready.base}/v1/review/example/dashboard/1.0.0`, {
      method: "POST",
      headers: {
        Origin: config.origin,
        Cookie: "tabs_exchange_session=opaque",
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "approve", digest, reason: "Reviewed" }),
    });
    expect(result.status).toBe(409);
    expect(await result.json()).toEqual({
      error: "Quarantined package no longer matches the reviewed digest.",
    });
    expect(ready.actions.some((sql) => sql.includes("UPDATE exchange_versions SET status"))).toBe(
      false,
    );
    expect(ready.actions.some((sql) => sql.includes("INSERT INTO exchange_review_events"))).toBe(
      false,
    );
  });

  it("audits a reviewer-requested rescan of the exact awaiting-review digest", async () => {
    const ready = await fixture();
    const route = `${ready.base}/v1/review/example/dashboard/1.0.0/rescan`;
    const headers = {
      Origin: config.origin,
      Cookie: "tabs_exchange_session=opaque",
      "X-CSRF-Token": csrf,
      "Content-Type": "application/json",
    };
    const mismatch = await fetch(route, {
      method: "POST",
      headers,
      body: JSON.stringify({ digest: "b".repeat(64), reason: "Retry transient scanner error" }),
    });
    expect(mismatch.status).toBe(409);
    expect(ready.actions.some((sql) => sql.includes("SET status = 'queued'"))).toBe(false);
    const response = await fetch(route, {
      method: "POST",
      headers,
      body: JSON.stringify({ digest, reason: "Retry transient scanner error" }),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "queued", digest });
    expect(ready.actions.some((sql) => sql.includes("scan_result = NULL"))).toBe(true);
    expect(ready.actions.some((sql) => sql.includes("'rescan'"))).toBe(true);
  });

  it("does not rescan an approved version", async () => {
    const ready = await fixture(true, digest, "approved");
    const response = await fetch(`${ready.base}/v1/review/example/dashboard/1.0.0/rescan`, {
      method: "POST",
      headers: {
        Origin: config.origin,
        Cookie: "tabs_exchange_session=opaque",
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ digest, reason: "Retry" }),
    });
    expect(response.status).toBe(409);
    expect(ready.actions.some((sql) => sql.includes("INSERT INTO exchange_review_events"))).toBe(
      false,
    );
  });

  it("audits an added block and revokes matching approved versions", async () => {
    const ready = await fixture();
    const headers = {
      Origin: config.origin,
      Cookie: "tabs_exchange_session=opaque",
      "X-CSRF-Token": csrf,
      "Content-Type": "application/json",
    };
    const denied = await fetch(`${ready.base}/v1/review/blocked-digests`, {
      method: "POST",
      headers: { ...headers, "X-CSRF-Token": "bad" },
      body: JSON.stringify({ digest, reason: "Known malicious package" }),
    });
    expect(denied.status).toBe(403);
    const added = await fetch(`${ready.base}/v1/review/blocked-digests`, {
      method: "POST",
      headers,
      body: JSON.stringify({ digest, reason: "Known malicious package" }),
    });
    expect(added.status).toBe(201);
    expect(await added.json()).toMatchObject({ revoked: 1 });
    expect(ready.actions.some((sql) => sql.includes("exchange_blocked_digest_events"))).toBe(true);
    expect(ready.actions.some((sql) => sql.includes("'revoke'"))).toBe(true);
    expect(ready.actions.some((sql) => sql.includes("DELETE FROM exchange_published_heads"))).toBe(
      true,
    );
    expect(ready.actions.indexOf("SELECT pg_advisory_xact_lock(1261492744)")).toBeLessThan(
      ready.actions.findIndex((sql) =>
        sql.includes("UPDATE exchange_versions SET status = 'revoked'"),
      ),
    );
    const removed = await fetch(`${ready.base}/v1/review/blocked-digests/${digest}/remove`, {
      method: "POST",
      headers,
      body: JSON.stringify({ reason: "False positive" }),
    });
    expect(removed.status).toBe(200);
    expect(ready.actions.some((sql) => sql.includes("DELETE FROM exchange_blocked_digests"))).toBe(
      true,
    );
  });

  it("imports a bounded reviewer digest batch in one transaction", async () => {
    const ready = await fixture();
    const headers = {
      Origin: config.origin,
      Cookie: "tabs_exchange_session=opaque",
      "X-CSRF-Token": csrf,
      "Content-Type": "application/json",
    };
    const entries = [
      { digest, reason: "Confirmed malicious package" },
      { digest: "b".repeat(64), reason: "Confirmed malicious asset" },
    ];
    const response = await fetch(`${ready.base}/v1/review/blocked-digests/batch`, {
      method: "POST",
      headers,
      body: JSON.stringify({ entries }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ blocked: 2 });
    expect(ready.actions.filter((sql) => sql === "BEGIN")).toHaveLength(1);
    expect(ready.actions.filter((sql) => sql === "COMMIT")).toHaveLength(1);
    expect(
      ready.actions.filter((sql) => sql.includes("INSERT INTO exchange_blocked_digest_events")),
    ).toHaveLength(2);

    const duplicate = await fetch(`${ready.base}/v1/review/blocked-digests/batch`, {
      method: "POST",
      headers,
      body: JSON.stringify({ entries: [entries[0], entries[0]] }),
    });
    expect(duplicate.status).toBe(400);
    const oversized = await fetch(`${ready.base}/v1/review/blocked-digests/batch`, {
      method: "POST",
      headers,
      body: JSON.stringify({ entries: Array.from({ length: 101 }, () => entries[0]) }),
    });
    expect(oversized.status).toBe(400);
    expect(ready.actions.filter((sql) => sql === "BEGIN")).toHaveLength(1);
  });

  it("rolls back a digest batch when any hash is already blocked", async () => {
    const blocked = "b".repeat(64);
    const ready = await fixture(true, digest, "review", undefined, blocked);
    const response = await fetch(`${ready.base}/v1/review/blocked-digests/batch`, {
      method: "POST",
      headers: {
        Origin: config.origin,
        Cookie: "tabs_exchange_session=opaque",
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        entries: [
          { digest, reason: "First finding" },
          { digest: blocked, reason: "Existing finding" },
        ],
      }),
    });
    expect(response.status).toBe(409);
    expect(ready.actions).toContain("ROLLBACK");
    expect(ready.actions).not.toContain("COMMIT");
  });

  it("audits revocation only for an approved version", async () => {
    const ready = await fixture(true, digest, "approved");
    const result = await fetch(`${ready.base}/v1/review/example/dashboard/1.0.0`, {
      method: "POST",
      headers: {
        Origin: config.origin,
        Cookie: "tabs_exchange_session=opaque",
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "revoke",
        digest,
        reason: "Confirmed malicious behavior",
      }),
    });
    expect(result.status).toBe(200);
    expect(ready.actions.some((sql) => sql.includes("INSERT INTO exchange_review_events"))).toBe(
      true,
    );
    expect(ready.actions.some((sql) => sql.includes("DELETE FROM exchange_published_heads"))).toBe(
      true,
    );
    expect(ready.actions.indexOf("SELECT pg_advisory_xact_lock(1261492744)")).toBeLessThan(
      ready.actions.findIndex((sql) => sql.includes("UPDATE exchange_versions SET status = $5")),
    );
  });

  it("accepts an exact-digest appeal only for a rejected or revoked version", async () => {
    const headers = {
      Origin: config.origin,
      Cookie: "tabs_exchange_session=opaque",
      "X-CSRF-Token": csrf,
      "Content-Type": "application/json",
    };
    const ready = await fixture(true, digest, "rejected");
    const path = `${ready.base}/v1/publisher/example/dashboard/versions/1.0.0/appeals`;
    const wrong = await fetch(path, {
      method: "POST",
      headers,
      body: JSON.stringify({
        digest: "b".repeat(64),
        message: "Please reconsider",
      }),
    });
    expect(wrong.status).toBe(409);
    const accepted = await fetch(path, {
      method: "POST",
      headers,
      body: JSON.stringify({
        digest,
        message: "I corrected the documentation",
      }),
    });
    expect(accepted.status).toBe(201);
    expect(ready.actions.some((sql) => sql.includes("INSERT INTO exchange_appeals"))).toBe(true);
    const approved = await fixture(true, digest, "approved");
    const denied = await fetch(
      `${approved.base}/v1/publisher/example/dashboard/versions/1.0.0/appeals`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ digest, message: "Please reconsider" }),
      },
    );
    expect(denied.status).toBe(409);
  });

  it("requires reviewer authentication and records one appeal response", async () => {
    const ready = await fixture();
    const path = `${ready.base}/v1/review/appeals/1/response`;
    expect((await fetch(path, { method: "POST" })).status).toBe(403);
    const answered = await fetch(path, {
      method: "POST",
      headers: {
        Origin: config.origin,
        Cookie: "tabs_exchange_session=opaque",
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        response: "Please submit a corrected new version",
      }),
    });
    expect(answered.status).toBe(200);
  });

  it("does not verify a publisher without an HTTPS ownership proof", async () => {
    const ready = await fixture();
    const result = await fetch(`${ready.base}/v1/review/namespaces/example/verification`, {
      method: "POST",
      headers: {
        Origin: config.origin,
        Cookie: "tabs_exchange_session=opaque",
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        verified: true,
        proofUrl: "http://example.com/proof",
        reason: "Claimed ownership",
      }),
    });
    expect(result.status).toBe(400);
    expect(ready.actions).toEqual([]);
  });
});
