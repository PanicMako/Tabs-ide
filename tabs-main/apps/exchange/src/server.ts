import * as Crypto from "node:crypto";
import * as FS from "node:fs/promises";
import * as Http from "node:http";
import * as OS from "node:os";
import * as Path from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import { inspectTabsext } from "@tabs/extension-package";
import type { Pool, PoolClient } from "pg";
import {
  actorFor,
  completeGithubLogin,
  logout,
  requireMutation,
  startGithubLogin,
} from "./auth.ts";
import { createPool, createStorage, loadConfig, type ExchangeConfig } from "./config.ts";
import { boundedObject, putImmutablePackageObject } from "./storage.ts";
import { refreshPublishedHead } from "./publishedHeads.ts";
import { decodeSearchCursor, encodeSearchCursor } from "./searchCursor.ts";
import { decodeVersionCursor, encodeVersionCursor } from "./versionCursor.ts";
import { SignedMetadataEvents } from "./signedMetadataEvents.ts";

const PACKAGE_ROUTE = /^\/v1\/extensions\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})$/;
const VERSION_ROUTE =
  /^\/v1\/extensions\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})\/versions\/([^/]+)$/;
const UPLOAD_ROUTE = /^\/v1\/publisher\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})\/versions$/;
const REVIEW_ROUTE = /^\/v1\/review\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})\/([^/]+)$/;
const APPEAL_ROUTE =
  /^\/v1\/publisher\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})\/versions\/([^/]+)\/appeals$/;
const APPEAL_RESPONSE_ROUTE = /^\/v1\/review\/appeals\/([1-9][0-9]*)\/response$/;
const REVIEW_DOWNLOAD_ROUTE =
  /^\/v1\/review\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})\/([^/]+)\/download$/;
const REVIEW_HISTORY_ROUTE =
  /^\/v1\/review\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})\/history$/;
const TUF_METADATA_ROUTE =
  /^\/v1\/tuf\/metadata\/((?:[1-9][0-9]*\.)?(?:root|snapshot|targets)|timestamp)\.json$/;
const TUF_TARGET_ROUTE =
  /^\/v1\/tuf\/targets\/extensions\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})\/(?:(?:([a-f0-9]{64})\.)?([0-9A-Za-z.+-]+))\.tabsext$/;
const MEMBER_ROUTE = /^\/v1\/namespaces\/([a-z][a-z0-9-]{1,62})\/members$/;
const VERIFY_NAMESPACE_ROUTE = /^\/v1\/review\/namespaces\/([a-z][a-z0-9-]{1,62})\/verification$/;
const BLOCKED_DIGEST_REMOVE_ROUTE = /^\/v1\/review\/blocked-digests\/([a-f0-9]{64})\/remove$/;
const RESERVED_NAMESPACES = new Set(["tabs", "official", "admin", "system"]);
const TERMS_VERSION = "2026-09-24";
const PUBLISHED_RELEASE_JOIN = `JOIN exchange_published_targets p
  ON p.namespace = v.namespace AND p.name = v.name AND p.version = v.version
  AND p.digest = v.digest AND p.bytes = v.bytes`;
const VERSION_PAGE_SIZE = 100;
const MAX_BLOCKED_DIGEST_BATCH = 100;
const MAX_CONCURRENT_UPLOADS = 2;
const UPLOAD_DEADLINE_MS = 120_000;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function json(response: Http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
  });
  response.end(JSON.stringify(body));
}

async function readLimited(
  request: Http.IncomingMessage,
  max: number,
  deadlineMs?: number,
): Promise<Buffer> {
  const length = Number(request.headers["content-length"]);
  if (Number.isFinite(length) && length > max) throw new HttpError(413, "Request is too large.");
  const chunks: Buffer[] = [];
  let size = 0;
  const deadline = deadlineMs
    ? setTimeout(() => request.destroy(new Error("Upload deadline exceeded.")), deadlineMs)
    : undefined;
  try {
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > max) throw new HttpError(413, "Request is too large.");
      chunks.push(bytes);
    }
  } finally {
    if (deadline) clearTimeout(deadline);
  }
  return Buffer.concat(chunks);
}

async function readJson(request: Http.IncomingMessage): Promise<Record<string, unknown>> {
  const bytes = await readLimited(request, 64 * 1024);
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // The caller receives a generic malformed-body response.
  }
  throw new HttpError(400, "Expected a JSON object.");
}

async function inTransaction<T>(
  pool: Pool,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

interface DigestBlock {
  readonly digest: string;
  readonly reason: string;
}

function parseDigestBlock(value: unknown): DigestBlock {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "A SHA-256 digest and reason are required.");
  }
  const { digest, reason } = value as Record<string, unknown>;
  if (
    typeof digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(digest) ||
    typeof reason !== "string" ||
    !reason.trim() ||
    reason.length > 2000
  ) {
    throw new HttpError(400, "A SHA-256 digest and reason are required.");
  }
  return { digest, reason: reason.trim() };
}

async function blockDigest(
  client: PoolClient,
  block: DigestBlock,
  actorId: string,
): Promise<number> {
  const { digest, reason } = block;
  const inserted = await client.query(
    `INSERT INTO exchange_blocked_digests(digest, reason, created_by)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING digest`,
    [digest, reason, actorId],
  );
  if (inserted.rowCount !== 1) throw new HttpError(409, `Digest ${digest} is already blocked.`);
  await client.query(
    `INSERT INTO exchange_blocked_digest_events(digest, action, reason, actor_id)
     VALUES ($1, 'add', $2, $3)`,
    [digest, reason, actorId],
  );
  const affected = await client.query<{
    namespace: string;
    name: string;
    version: string;
    digest: string;
  }>(
    `SELECT namespace, name, version, digest FROM exchange_versions
     WHERE status = 'approved' AND (
       digest = $1 OR EXISTS (
         SELECT 1 FROM jsonb_each_text(COALESCE(scan_result->'files', '{}'::jsonb)) AS file_hash(file, hash)
         WHERE file_hash.hash = $1
       )
     ) FOR UPDATE`,
    [digest],
  );
  for (const release of affected.rows) {
    const revocationReason = `Blocked package material: ${reason}`;
    await client.query(
      `UPDATE exchange_versions SET status = 'revoked', reviewed_at = now(),
         reviewed_by = $4, review_reason = $5
       WHERE namespace = $1 AND name = $2 AND version = $3`,
      [release.namespace, release.name, release.version, actorId, revocationReason],
    );
    await client.query(
      `INSERT INTO exchange_review_events(namespace, name, version, digest, actor_id, action, reason)
       VALUES ($1, $2, $3, $4, $5, 'revoke', $6)`,
      [release.namespace, release.name, release.version, release.digest, actorId, revocationReason],
    );
  }
  for (const identity of new Set(
    affected.rows.map((release) => `${release.namespace}.${release.name}`),
  )) {
    const separator = identity.indexOf(".");
    await refreshPublishedHead(client, identity.slice(0, separator), identity.slice(separator + 1));
  }
  return affected.rows.length;
}

export function createExchangeServer(
  pool: Pool,
  storage: S3Client,
  config: ExchangeConfig,
  signedMetadataEvents = new SignedMetadataEvents(),
): Http.Server {
  let activeUploads = 0;
  return Http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", config.origin);
      const path = url.pathname;
      if (request.method === "GET" && path === "/v1/tuf/events") {
        if (!signedMetadataEvents.subscribe(response)) {
          throw new HttpError(503, "Too many signed-metadata listeners.");
        }
        return;
      }
      const tufMetadata = request.method === "GET" ? TUF_METADATA_ROUTE.exec(path) : null;
      if (tufMetadata) {
        const name = `${tufMetadata[1]}.json`;
        const found = await pool.query<{ bytes: Buffer; sha256: string }>(
          "SELECT bytes, sha256 FROM exchange_tuf_metadata WHERE name = $1",
          [name],
        );
        const entry = found.rows[0];
        if (!entry) throw new HttpError(404, "Signed metadata is not published.");
        if (Crypto.createHash("sha256").update(entry.bytes).digest("hex") !== entry.sha256) {
          throw new Error("Stored signed metadata failed digest verification.");
        }
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": entry.bytes.length,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(entry.bytes);
        return;
      }
      const tufTarget = request.method === "GET" ? TUF_TARGET_ROUTE.exec(path) : null;
      if (tufTarget) {
        const [, namespace, name, hashPrefix, version] = tufTarget;
        const found = await pool.query<{
          digest: string;
          bytes: number;
          object_key: string;
        }>(
          `SELECT v.digest, v.bytes, v.object_key FROM exchange_versions v ${PUBLISHED_RELEASE_JOIN}
           WHERE v.namespace = $1 AND v.name = $2 AND v.version = $3 AND v.status = 'approved'`,
          [namespace, name, version],
        );
        const release = found.rows[0];
        if (!release || (hashPrefix && hashPrefix !== release.digest)) {
          throw new HttpError(404, "Approved target not found.");
        }
        const bytes = await boundedObject(storage, config.bucket, release.object_key);
        if (
          bytes.length !== release.bytes ||
          Crypto.createHash("sha256").update(bytes).digest("hex") !== release.digest
        ) {
          throw new Error("Approved target failed digest verification.");
        }
        response.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": bytes.length,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          Digest: `sha-256=${Buffer.from(release.digest, "hex").toString("base64")}`,
        });
        response.end(bytes);
        return;
      }
      const publicFiles: Record<string, { file: string; type: string }> = {
        "/v1/openapi.json": {
          file: "public-openapi.json",
          type: "application/json; charset=utf-8",
        },
        "/publisher": {
          file: "publisher.html",
          type: "text/html; charset=utf-8",
        },
        "/publisher-terms": {
          file: "publisher-terms.html",
          type: "text/html; charset=utf-8",
        },
        "/publisher.js": {
          file: "publisher.js",
          type: "text/javascript; charset=utf-8",
        },
        "/publisherBatch.js": {
          file: "publisherBatch.js",
          type: "text/javascript; charset=utf-8",
        },
        "/publisher.css": {
          file: "publisher.css",
          type: "text/css; charset=utf-8",
        },
      };
      if (request.method === "GET" && publicFiles[path]) {
        const asset = publicFiles[path]!;
        const bytes = await FS.readFile(Path.join(import.meta.dirname, asset.file));
        response.writeHead(200, {
          "Content-Type": asset.type,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy":
            "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'",
        });
        response.end(bytes);
        return;
      }
      if (request.method === "GET" && path === "/healthz") {
        await pool.query("SELECT 1");
        json(response, 200, { ok: true });
        return;
      }
      if (request.method === "GET" && path === "/auth/github/start") {
        await startGithubLogin(response, pool, config);
        return;
      }
      if (request.method === "GET" && path === "/auth/github/callback") {
        await completeGithubLogin(request, response, url, pool, config);
        return;
      }
      if (request.method === "GET" && path === "/v1/me") {
        const actor = await actorFor(request, pool, config);
        json(
          response,
          200,
          actor
            ? {
                id: actor.id,
                login: actor.login,
                admin: actor.admin,
                publishingEnabled: config.publishingEnabled,
              }
            : null,
        );
        return;
      }
      if (request.method === "GET" && path === "/v1/publisher/namespaces") {
        const actor = await actorFor(request, pool, config);
        if (!actor) throw new HttpError(401, "Authentication required.");
        const found = await pool.query(
          `SELECT n.name, n.verified, m.role FROM exchange_namespace_members m
           JOIN exchange_namespaces n ON n.name = m.namespace
           WHERE m.user_id = $1 ORDER BY n.name`,
          [actor.id],
        );
        json(response, 200, { namespaces: found.rows });
        return;
      }
      if (request.method === "GET" && path === "/v1/publisher/submissions") {
        const actor = await actorFor(request, pool, config);
        if (!actor) throw new HttpError(401, "Authentication required.");
        const found = await pool.query(
          `SELECT v.namespace, v.name, v.version, v.digest, v.status, v.scan_result,
                  v.review_reason, v.submitted_at, v.reviewed_at,
                  (p.digest IS NOT NULL) AS published
           FROM exchange_versions v JOIN exchange_namespace_members m ON m.namespace = v.namespace
           LEFT JOIN exchange_published_targets p ON p.namespace = v.namespace AND p.name = v.name
             AND p.version = v.version AND p.digest = v.digest AND p.bytes = v.bytes
           WHERE m.user_id = $1 ORDER BY v.submitted_at DESC LIMIT 100`,
          [actor.id],
        );
        json(response, 200, { submissions: found.rows });
        return;
      }
      if (request.method === "GET" && path === "/v1/publisher/appeals") {
        const actor = await actorFor(request, pool, config);
        if (!actor) throw new HttpError(401, "Authentication required.");
        const found = await pool.query(
          `SELECT a.id, a.namespace, a.name, a.version, a.digest, a.message, a.created_at,
                  a.response, a.responded_at FROM exchange_appeals a
           JOIN exchange_namespace_members m ON m.namespace = a.namespace
           WHERE m.user_id = $1 ORDER BY a.created_at DESC LIMIT 100`,
          [actor.id],
        );
        json(response, 200, { appeals: found.rows });
        return;
      }
      const appealMatch = request.method === "POST" ? APPEAL_ROUTE.exec(path) : null;
      if (appealMatch) {
        const actor = requireMutation(request, await actorFor(request, pool, config), config);
        const body = await readJson(request);
        if (
          typeof body.message !== "string" ||
          !body.message.trim() ||
          body.message.length > 4000 ||
          typeof body.digest !== "string" ||
          !/^[a-f0-9]{64}$/.test(body.digest)
        ) {
          throw new HttpError(400, "Appeal requires a message and exact package digest.");
        }
        const message = body.message.trim();
        const version = decodeURIComponent(appealMatch[3]!);
        const result = await inTransaction(pool, async (client) => {
          const found = await client.query<{ digest: string; status: string }>(
            `SELECT v.digest, v.status FROM exchange_versions v
             JOIN exchange_namespace_members m ON m.namespace = v.namespace
             WHERE v.namespace = $1 AND v.name = $2 AND v.version = $3 AND m.user_id = $4 FOR UPDATE OF v`,
            [appealMatch[1], appealMatch[2], version, actor.id],
          );
          if (!found.rows[0]) throw new HttpError(404, "Submission not found.");
          if (
            found.rows[0].digest !== body.digest ||
            !["rejected", "revoked"].includes(found.rows[0].status)
          ) {
            throw new HttpError(409, "Only the exact rejected or revoked version can be appealed.");
          }
          const open = await client.query(
            `SELECT id FROM exchange_appeals WHERE namespace = $1 AND name = $2 AND version = $3
             AND responded_at IS NULL`,
            [appealMatch[1], appealMatch[2], version],
          );
          if (open.rowCount) throw new HttpError(409, "An appeal is already awaiting a response.");
          return client.query<{ id: string }>(
            `INSERT INTO exchange_appeals(namespace, name, version, digest, actor_id, message)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [appealMatch[1], appealMatch[2], version, body.digest, actor.id, message],
          );
        });
        json(response, 201, { id: result.rows[0]?.id, status: "open" });
        return;
      }
      if (request.method === "POST" && path === "/v1/logout") {
        requireMutation(request, await actorFor(request, pool, config), config);
        await logout(request, response, pool, config);
        return;
      }
      if (request.method === "POST" && path === "/v1/namespaces") {
        if (!config.publishingEnabled)
          throw new HttpError(503, "Publisher submissions are not enabled.");
        const actor = requireMutation(request, await actorFor(request, pool, config), config);
        const body = await readJson(request);
        const name = body.name;
        if (typeof name !== "string" || !/^[a-z][a-z0-9-]{1,62}$/.test(name)) {
          throw new HttpError(400, "Invalid namespace.");
        }
        if (RESERVED_NAMESPACES.has(name)) throw new HttpError(403, "Namespace is reserved.");
        if (body.acceptTermsVersion !== TERMS_VERSION) {
          throw new HttpError(400, "Publisher terms must be accepted.");
        }
        await inTransaction(pool, async (client) => {
          await client.query(
            "INSERT INTO exchange_namespaces(name, terms_version, created_by) VALUES ($1, $2, $3)",
            [name, TERMS_VERSION, actor.id],
          );
          await client.query(
            "INSERT INTO exchange_namespace_members(namespace, user_id, role) VALUES ($1, $2, 'owner')",
            [name, actor.id],
          );
        });
        json(response, 201, { name, verified: false });
        return;
      }
      const memberMatch = request.method === "POST" ? MEMBER_ROUTE.exec(path) : null;
      if (memberMatch) {
        if (!config.publishingEnabled)
          throw new HttpError(503, "Publisher submissions are not enabled.");
        const actor = requireMutation(request, await actorFor(request, pool, config), config);
        const body = await readJson(request);
        if (
          typeof body.githubUserId !== "string" ||
          !/^\d{1,19}$/.test(body.githubUserId) ||
          (body.role !== "owner" && body.role !== "contributor")
        ) {
          throw new HttpError(400, "Member requires a GitHub user ID and role.");
        }
        if (body.githubUserId === actor.id && body.role !== "owner") {
          throw new HttpError(400, "Owners cannot remove their own ownership here.");
        }
        const owner = await pool.query(
          "SELECT role FROM exchange_namespace_members WHERE namespace = $1 AND user_id = $2 AND role = 'owner'",
          [memberMatch[1], actor.id],
        );
        if (owner.rowCount !== 1)
          throw new HttpError(403, "Only namespace owners can add members.");
        const member = await pool.query("SELECT id FROM exchange_users WHERE id = $1", [
          body.githubUserId,
        ]);
        if (member.rowCount !== 1) throw new HttpError(404, "That GitHub user must sign in first.");
        await pool.query(
          `INSERT INTO exchange_namespace_members(namespace, user_id, role) VALUES ($1, $2, $3)
           ON CONFLICT (namespace, user_id) DO UPDATE SET role = EXCLUDED.role`,
          [memberMatch[1], body.githubUserId, body.role],
        );
        json(response, 200, {
          namespace: memberMatch[1],
          userId: body.githubUserId,
          role: body.role,
        });
        return;
      }
      const uploadMatch = request.method === "POST" ? UPLOAD_ROUTE.exec(path) : null;
      if (uploadMatch) {
        if (!config.publishingEnabled)
          throw new HttpError(503, "Publisher submissions are not enabled.");
        const actor = requireMutation(request, await actorFor(request, pool, config), config);
        const namespace = uploadMatch[1]!;
        const name = uploadMatch[2]!;
        const member = await pool.query(
          "SELECT role FROM exchange_namespace_members WHERE namespace = $1 AND user_id = $2",
          [namespace, actor.id],
        );
        if (member.rowCount !== 1) throw new HttpError(403, "Not a namespace publisher.");
        if (request.headers["content-type"] !== "application/octet-stream") {
          throw new HttpError(415, "Upload a raw .tabsext archive.");
        }
        if (activeUploads >= MAX_CONCURRENT_UPLOADS) {
          response.setHeader("Connection", "close");
          throw new HttpError(429, "Too many extension uploads are in progress.");
        }
        activeUploads++;
        try {
          const bytes = await readLimited(request, 25 * 1024 * 1024, UPLOAD_DEADLINE_MS);
          const temporary = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-exchange-upload-"));
          try {
            const archive = Path.join(temporary, "package.tabsext");
            await FS.writeFile(archive, bytes, { flag: "wx", mode: 0o600 });
            const inspected = await inspectTabsext(archive, config.tabsVersion).catch(() => {
              throw new HttpError(400, "Invalid Tabs extension package.");
            });
            if (inspected.manifest.publisher !== namespace || inspected.manifest.name !== name) {
              throw new HttpError(400, "Package identity does not match the namespace and name.");
            }
            const key = `quarantine/${namespace}/${name}/${inspected.manifest.version}/${inspected.digest}.tabsext`;
            await putImmutablePackageObject(storage, config.bucket, key, bytes, inspected.digest);
            try {
              await pool.query(
                `INSERT INTO exchange_versions(namespace, name, version, digest, bytes, manifest, object_key, status, uploaded_by)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'queued', $8)`,
                [
                  namespace,
                  name,
                  inspected.manifest.version,
                  inspected.digest,
                  inspected.bytes,
                  JSON.stringify(inspected.manifest),
                  key,
                  actor.id,
                ],
              );
            } catch (error) {
              if ((error as { code?: unknown }).code === "23505") {
                throw new HttpError(409, "This extension version was already submitted.");
              }
              throw error;
            }
            json(response, 202, {
              namespace,
              name,
              version: inspected.manifest.version,
              digest: inspected.digest,
              status: "queued",
            });
          } finally {
            await FS.rm(temporary, { recursive: true, force: true });
          }
        } finally {
          activeUploads--;
        }
        return;
      }
      if (request.method === "GET" && path === "/v1/extensions") {
        const query = url.searchParams.get("q") ?? "";
        if (query.length > 100) throw new HttpError(400, "Search query is too long.");
        const rawLimit = url.searchParams.get("limit");
        const limit = rawLimit === null ? 30 : Number(rawLimit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          throw new HttpError(400, "Invalid search limit.");
        }
        const cursorValue = url.searchParams.get("cursor");
        const cursor = cursorValue === null ? null : decodeSearchCursor(cursorValue);
        if (cursorValue !== null && !cursor) throw new HttpError(400, "Invalid search cursor.");
        const heads = await pool.query(
          `SELECT v.namespace, v.name, v.version, v.digest, v.manifest, v.submitted_at, n.verified
           FROM exchange_published_heads h
           JOIN exchange_versions v ON v.namespace = h.namespace AND v.name = h.name AND v.version = h.version
           ${PUBLISHED_RELEASE_JOIN}
           JOIN exchange_namespaces n ON n.name = v.namespace
           WHERE v.status = 'approved'
             AND (v.namespace ILIKE $1 OR v.name ILIKE $1 OR v.manifest->>'displayName' ILIKE $1)
             AND ($2::text IS NULL OR (v.namespace, v.name) > ($2::text, $3::text))
           ORDER BY v.namespace, v.name LIMIT $4`,
          [
            `%${query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`,
            cursor?.namespace ?? null,
            cursor?.name ?? null,
            limit + 1,
          ],
        );
        const page = heads.rows.slice(0, limit);
        const last = page.at(-1);
        json(response, 200, {
          extensions: page,
          nextCursor:
            heads.rows.length > limit && last
              ? encodeSearchCursor({ namespace: last.namespace, name: last.name })
              : null,
        });
        return;
      }
      const packageMatch = request.method === "GET" ? PACKAGE_ROUTE.exec(path) : null;
      if (packageMatch) {
        const cursorValue = url.searchParams.get("cursor");
        const cursor = cursorValue === null ? null : decodeVersionCursor(cursorValue);
        if (cursorValue !== null && !cursor) throw new HttpError(400, "Invalid version cursor.");
        const found = await pool.query(
          `SELECT v.namespace, v.name, v.version, v.digest, v.bytes, v.manifest, v.submitted_at, n.verified,
                  to_char(v.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
           FROM exchange_versions v ${PUBLISHED_RELEASE_JOIN}
           JOIN exchange_namespaces n ON n.name = v.namespace
           WHERE v.namespace = $1 AND v.name = $2 AND v.status = 'approved'
             AND ($3::timestamptz IS NULL OR (v.submitted_at, v.version) < ($3::timestamptz, $4::text))
           ORDER BY v.submitted_at DESC, v.version DESC LIMIT $5`,
          [
            packageMatch[1],
            packageMatch[2],
            cursor?.submittedAt ?? null,
            cursor?.version ?? null,
            VERSION_PAGE_SIZE + 1,
          ],
        );
        if (!found.rowCount && !cursor) throw new HttpError(404, "Extension not found.");
        const page = found.rows.slice(0, VERSION_PAGE_SIZE);
        const next = page.at(-1);
        const nextCursor =
          found.rows.length > VERSION_PAGE_SIZE && next
            ? encodeVersionCursor({ submittedAt: next.cursor_time, version: next.version })
            : null;
        json(response, 200, {
          versions: page.map(({ cursor_time: _cursorTime, ...release }) => release),
          nextCursor,
        });
        return;
      }
      const versionMatch = request.method === "GET" ? VERSION_ROUTE.exec(path) : null;
      if (versionMatch) {
        const version = decodeURIComponent(versionMatch[3]!);
        const found = await pool.query<{
          digest: string;
          bytes: number;
          manifest: unknown;
          object_key: string;
        }>(
          `SELECT v.digest, v.bytes, v.manifest, v.object_key
           FROM exchange_versions v ${PUBLISHED_RELEASE_JOIN}
           WHERE v.namespace = $1 AND v.name = $2 AND v.version = $3 AND v.status = 'approved'`,
          [versionMatch[1], versionMatch[2], version],
        );
        const release = found.rows[0];
        if (!release) throw new HttpError(404, "Approved version not found.");
        if (!path.endsWith("/download")) {
          json(response, 200, {
            namespace: versionMatch[1],
            name: versionMatch[2],
            version,
            digest: release.digest,
            bytes: release.bytes,
            manifest: release.manifest,
            downloadUrl: `${config.origin}${path}/download`,
          });
          return;
        }
      }
      const downloadMatch = request.method === "GET" ? /^(.+)\/download$/.exec(path) : null;
      const downloadVersion = downloadMatch ? VERSION_ROUTE.exec(downloadMatch[1]!) : null;
      if (downloadVersion) {
        const version = decodeURIComponent(downloadVersion[3]!);
        const found = await pool.query<{
          digest: string;
          bytes: number;
          object_key: string;
        }>(
          `SELECT v.digest, v.bytes, v.object_key FROM exchange_versions v ${PUBLISHED_RELEASE_JOIN}
           WHERE v.namespace = $1 AND v.name = $2 AND v.version = $3 AND v.status = 'approved'`,
          [downloadVersion[1], downloadVersion[2], version],
        );
        const release = found.rows[0];
        if (!release) throw new HttpError(404, "Approved version not found.");
        const bytes = await boundedObject(storage, config.bucket, release.object_key);
        const digest = Crypto.createHash("sha256").update(bytes).digest("hex");
        if (digest !== release.digest || bytes.length !== release.bytes) {
          throw new Error("Approved package object failed digest verification.");
        }
        response.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": bytes.length,
          "Content-Disposition": `attachment; filename="${downloadVersion[1]}.${downloadVersion[2]}-${version}.tabsext"`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, max-age=0",
          ETag: `"${release.digest}"`,
          Digest: `sha-256=${Buffer.from(release.digest, "hex").toString("base64")}`,
        });
        response.end(bytes);
        return;
      }
      if (request.method === "GET" && path === "/v1/review/queue") {
        const actor = await actorFor(request, pool, config);
        if (!actor?.admin) throw new HttpError(403, "Reviewer access required.");
        const found = await pool.query(
          `SELECT namespace, name, version, digest, manifest, scan_result, status, uploaded_by, submitted_at
           FROM exchange_versions WHERE status IN ('review', 'queued', 'scanning')
           ORDER BY submitted_at ASC LIMIT 100`,
        );
        json(response, 200, { submissions: found.rows });
        return;
      }
      if (request.method === "GET" && path === "/v1/review/operations") {
        const actor = await actorFor(request, pool, config);
        if (!actor?.admin) throw new HttpError(403, "Reviewer access required.");
        const found = await pool.query(
          `SELECT count(*) FILTER (WHERE v.status = 'queued')::int AS queued,
                  count(*) FILTER (WHERE v.status = 'scanning')::int AS scanning,
                  count(*) FILTER (WHERE v.status = 'scanning' AND v.scan_claimed_at < now() - interval '10 minutes')::int AS stale_scans,
                  count(*) FILTER (WHERE v.status = 'review')::int AS awaiting_review,
                  count(*) FILTER (WHERE v.status = 'approved' AND p.digest IS NULL)::int AS awaiting_signed_publication,
                  count(*) FILTER (WHERE v.status = 'revoked' AND p.digest IS NOT NULL)::int AS pending_signed_revocations,
                  min(v.submitted_at) FILTER (WHERE v.status = 'queued') AS oldest_queued_at,
                  max(v.reviewed_at) AS last_reviewed_at,
                  (SELECT max(heartbeat_at) FROM exchange_worker_heartbeats) AS last_worker_heartbeat_at,
                  (SELECT max(last_scan_at) FROM exchange_worker_heartbeats) AS last_scan_at,
                  EXISTS (SELECT 1 FROM exchange_worker_heartbeats WHERE heartbeat_at >= now() - interval '15 seconds') AS worker_recently_seen,
                  (SELECT max(published_at) FROM exchange_tuf_metadata WHERE name = 'timestamp.json') AS last_signed_publication_at
           FROM exchange_versions v LEFT JOIN exchange_published_targets p
             ON p.namespace = v.namespace AND p.name = v.name AND p.version = v.version
             AND p.digest = v.digest AND p.bytes = v.bytes`,
        );
        const pending = await pool.query(
          `SELECT v.namespace, v.name, v.version, v.digest, v.reviewed_at
           FROM exchange_versions v JOIN exchange_published_targets p
             ON p.namespace = v.namespace AND p.name = v.name AND p.version = v.version
             AND p.digest = v.digest AND p.bytes = v.bytes
           WHERE v.status = 'revoked' ORDER BY v.reviewed_at ASC LIMIT 100`,
        );
        json(response, 200, { queue: found.rows[0], pendingRevocations: pending.rows });
        return;
      }
      const reviewHistory = request.method === "GET" ? REVIEW_HISTORY_ROUTE.exec(path) : null;
      if (reviewHistory) {
        const actor = await actorFor(request, pool, config);
        if (!actor?.admin) throw new HttpError(403, "Reviewer access required.");
        const namespace = reviewHistory[1]!;
        const name = reviewHistory[2]!;
        const versions = await pool.query(
          `SELECT v.version, v.digest, v.status, v.submitted_at, v.reviewed_at,
                  v.review_reason, uploader.login AS uploader_login,
                  reviewer.login AS reviewer_login
           FROM exchange_versions v
           JOIN exchange_users uploader ON uploader.id = v.uploaded_by
           LEFT JOIN exchange_users reviewer ON reviewer.id = v.reviewed_by
           WHERE v.namespace = $1 AND v.name = $2
           ORDER BY v.submitted_at DESC, v.version DESC LIMIT 100`,
          [namespace, name],
        );
        const decisions = await pool.query(
          `SELECT e.version, e.digest, e.action, e.reason, e.created_at,
                  reviewer.login AS reviewer_login
           FROM exchange_review_events e
           JOIN exchange_users reviewer ON reviewer.id = e.actor_id
           WHERE e.namespace = $1 AND e.name = $2
           ORDER BY e.created_at DESC, e.id DESC LIMIT 100`,
          [namespace, name],
        );
        json(response, 200, {
          namespace,
          name,
          versions: versions.rows,
          decisions: decisions.rows,
        });
        return;
      }
      if (request.method === "GET" && path === "/v1/review/appeals") {
        const actor = await actorFor(request, pool, config);
        if (!actor?.admin) throw new HttpError(403, "Reviewer access required.");
        const found = await pool.query(
          `SELECT a.id, a.namespace, a.name, a.version, a.digest, a.message, a.created_at,
                  a.response, a.responded_at, v.status, v.review_reason
           FROM exchange_appeals a JOIN exchange_versions v
             ON v.namespace = a.namespace AND v.name = a.name AND v.version = a.version
           WHERE a.responded_at IS NULL ORDER BY a.created_at ASC LIMIT 100`,
        );
        json(response, 200, { appeals: found.rows });
        return;
      }
      const appealResponse = request.method === "POST" ? APPEAL_RESPONSE_ROUTE.exec(path) : null;
      if (appealResponse) {
        const actor = requireMutation(request, await actorFor(request, pool, config), config);
        if (!actor.admin) throw new HttpError(403, "Reviewer access required.");
        const body = await readJson(request);
        if (
          typeof body.response !== "string" ||
          !body.response.trim() ||
          body.response.length > 4000
        ) {
          throw new HttpError(400, "A response is required.");
        }
        const changed = await pool.query(
          `UPDATE exchange_appeals SET response = $2, responded_by = $3, responded_at = now()
           WHERE id = $1 AND responded_at IS NULL RETURNING id`,
          [appealResponse[1], body.response.trim(), actor.id],
        );
        if (changed.rowCount !== 1) throw new HttpError(409, "Appeal is not open.");
        json(response, 200, { id: appealResponse[1], status: "answered" });
        return;
      }
      if (request.method === "GET" && path === "/v1/review/approved") {
        const actor = await actorFor(request, pool, config);
        if (!actor?.admin) throw new HttpError(403, "Reviewer access required.");
        const found = await pool.query(
          `SELECT namespace, name, version, digest, submitted_at, reviewed_at
           FROM exchange_versions WHERE status = 'approved'
           ORDER BY reviewed_at DESC LIMIT 100`,
        );
        json(response, 200, { versions: found.rows });
        return;
      }
      if (request.method === "GET" && path === "/v1/review/blocked-digests") {
        const actor = await actorFor(request, pool, config);
        if (!actor?.admin) throw new HttpError(403, "Reviewer access required.");
        const found = await pool.query(
          `SELECT digest, reason, created_by, created_at FROM exchange_blocked_digests
           ORDER BY created_at DESC LIMIT 500`,
        );
        json(response, 200, { blockedDigests: found.rows });
        return;
      }
      if (
        request.method === "POST" &&
        (path === "/v1/review/blocked-digests" || path === "/v1/review/blocked-digests/batch")
      ) {
        const actor = requireMutation(request, await actorFor(request, pool, config), config);
        if (!actor.admin) throw new HttpError(403, "Reviewer access required.");
        const body = await readJson(request);
        const batch = path.endsWith("/batch");
        if (
          batch &&
          (!Array.isArray(body.entries) ||
            body.entries.length < 1 ||
            body.entries.length > MAX_BLOCKED_DIGEST_BATCH)
        ) {
          throw new HttpError(400, "Batch requires 1 to 100 digest entries.");
        }
        const blocks = batch
          ? (body.entries as unknown[]).map(parseDigestBlock)
          : [parseDigestBlock(body)];
        if (new Set(blocks.map((entry) => entry.digest)).size !== blocks.length) {
          throw new HttpError(400, "Batch contains a duplicate digest.");
        }
        const revoked = await inTransaction(pool, async (client) => {
          await client.query("SELECT pg_advisory_xact_lock(1261492744)");
          await client.query("SELECT pg_advisory_xact_lock(7331, 1)");
          let count = 0;
          for (const block of blocks) count += await blockDigest(client, block, actor.id);
          return count;
        });
        json(
          response,
          201,
          batch
            ? { blocked: blocks.length, revoked }
            : { digest: blocks[0]!.digest, status: "blocked", revoked },
        );
        return;
      }
      const removeBlockedDigest =
        request.method === "POST" ? BLOCKED_DIGEST_REMOVE_ROUTE.exec(path) : null;
      if (removeBlockedDigest) {
        const actor = requireMutation(request, await actorFor(request, pool, config), config);
        if (!actor.admin) throw new HttpError(403, "Reviewer access required.");
        const body = await readJson(request);
        if (typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 2000) {
          throw new HttpError(400, "A removal reason is required.");
        }
        const reason = body.reason.trim();
        await inTransaction(pool, async (client) => {
          await client.query("SELECT pg_advisory_xact_lock(7331, 1)");
          const removed = await client.query(
            "DELETE FROM exchange_blocked_digests WHERE digest = $1 RETURNING digest",
            [removeBlockedDigest[1]],
          );
          if (removed.rowCount !== 1) throw new HttpError(404, "Blocked digest not found.");
          await client.query(
            `INSERT INTO exchange_blocked_digest_events(digest, action, reason, actor_id)
             VALUES ($1, 'remove', $2, $3)`,
            [removeBlockedDigest[1], reason, actor.id],
          );
        });
        json(response, 200, { digest: removeBlockedDigest[1], status: "removed" });
        return;
      }
      const verifyNamespace = request.method === "POST" ? VERIFY_NAMESPACE_ROUTE.exec(path) : null;
      if (verifyNamespace) {
        const actor = requireMutation(request, await actorFor(request, pool, config), config);
        if (!actor.admin) throw new HttpError(403, "Reviewer access required.");
        const body = await readJson(request);
        if (
          typeof body.verified !== "boolean" ||
          typeof body.reason !== "string" ||
          !body.reason.trim() ||
          body.reason.length > 2000
        ) {
          throw new HttpError(400, "Verification decision requires a reason.");
        }
        const reason = body.reason.trim();
        let proofUrl: string | null = null;
        if (body.verified) {
          if (typeof body.proofUrl !== "string" || body.proofUrl.length > 2000) {
            throw new HttpError(400, "Ownership proof URL is required for verification.");
          }
          try {
            const parsed = new URL(body.proofUrl);
            if (parsed.protocol !== "https:") throw new Error("HTTPS required.");
            proofUrl = parsed.toString();
          } catch {
            throw new HttpError(400, "Ownership proof must be an HTTPS URL.");
          }
        }
        await inTransaction(pool, async (client) => {
          const changed = await client.query(
            "UPDATE exchange_namespaces SET verified = $2 WHERE name = $1 RETURNING name",
            [verifyNamespace[1], body.verified],
          );
          if (changed.rowCount !== 1) throw new HttpError(404, "Namespace not found.");
          await client.query(
            `INSERT INTO exchange_namespace_verifications(namespace, actor_id, verified, proof_url, reason)
             VALUES ($1, $2, $3, $4, $5)`,
            [verifyNamespace[1], actor.id, body.verified, proofUrl, reason],
          );
        });
        json(response, 200, {
          namespace: verifyNamespace[1],
          verified: body.verified,
        });
        return;
      }
      const reviewDownload = request.method === "GET" ? REVIEW_DOWNLOAD_ROUTE.exec(path) : null;
      if (reviewDownload) {
        const actor = await actorFor(request, pool, config);
        if (!actor?.admin) throw new HttpError(403, "Reviewer access required.");
        const version = decodeURIComponent(reviewDownload[3]!);
        const found = await pool.query<{
          digest: string;
          bytes: number;
          object_key: string;
        }>(
          `SELECT digest, bytes, object_key FROM exchange_versions
           WHERE namespace = $1 AND name = $2 AND version = $3`,
          [reviewDownload[1], reviewDownload[2], version],
        );
        const submission = found.rows[0];
        if (!submission) throw new HttpError(404, "Submission not found.");
        const bytes = await boundedObject(storage, config.bucket, submission.object_key);
        if (
          bytes.length !== submission.bytes ||
          Crypto.createHash("sha256").update(bytes).digest("hex") !== submission.digest
        ) {
          throw new Error("Quarantined package object failed digest verification.");
        }
        response.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": bytes.length,
          "Content-Disposition": `attachment; filename="${reviewDownload[1]}.${reviewDownload[2]}-${version}.tabsext"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(bytes);
        return;
      }
      const reviewMatch = request.method === "POST" ? REVIEW_ROUTE.exec(path) : null;
      if (reviewMatch) {
        const actor = requireMutation(request, await actorFor(request, pool, config), config);
        if (!actor.admin) throw new HttpError(403, "Reviewer access required.");
        const body = await readJson(request);
        const action = body.action;
        const digest = body.digest;
        const reason = body.reason;
        if (
          !["approve", "reject", "revoke"].includes(String(action)) ||
          typeof digest !== "string" ||
          !/^[a-f0-9]{64}$/.test(digest) ||
          typeof reason !== "string" ||
          !reason.trim() ||
          reason.length > 2000
        )
          throw new HttpError(400, "Decision requires an action, exact digest, and reason.");
        await inTransaction(pool, async (client) => {
          await client.query("SELECT pg_advisory_xact_lock(1261492744)");
          await client.query("SELECT pg_advisory_xact_lock(7331, 1)");
          const found = await client.query<{
            status: string;
            digest: string;
            scan_result: {
              passed?: boolean;
              digest?: string;
              files?: Record<string, string>;
            } | null;
          }>(
            `SELECT status, digest, scan_result FROM exchange_versions
             WHERE namespace = $1 AND name = $2 AND version = $3 FOR UPDATE`,
            [reviewMatch[1], reviewMatch[2], decodeURIComponent(reviewMatch[3]!)],
          );
          const submission = found.rows[0];
          if (!submission || submission.digest !== digest) {
            throw new HttpError(409, "Submission digest has changed or was not found.");
          }
          if (
            action === "revoke" ? submission.status !== "approved" : submission.status !== "review"
          ) {
            throw new HttpError(409, "Submission is not in a reviewable state.");
          }
          if (
            action === "approve" &&
            (submission.scan_result?.passed !== true || submission.scan_result.digest !== digest)
          ) {
            throw new HttpError(409, "Blocking scan results prevent approval.");
          }
          if (action === "approve") {
            const fileDigests = Object.values(submission.scan_result?.files ?? {}).filter((value) =>
              /^[a-f0-9]{64}$/.test(value),
            );
            const blocked = await client.query(
              "SELECT digest FROM exchange_blocked_digests WHERE digest = ANY($1::text[]) LIMIT 1",
              [[digest, ...fileDigests]],
            );
            if (blocked.rowCount) {
              throw new HttpError(409, "This package contains a blocked digest.");
            }
          }
          const status =
            action === "approve" ? "approved" : action === "reject" ? "rejected" : "revoked";
          await client.query(
            `UPDATE exchange_versions SET status = $5, reviewed_at = now(), reviewed_by = $6, review_reason = $7
             WHERE namespace = $1 AND name = $2 AND version = $3 AND digest = $4`,
            [
              reviewMatch[1],
              reviewMatch[2],
              decodeURIComponent(reviewMatch[3]!),
              digest,
              status,
              actor.id,
              reason.trim(),
            ],
          );
          await client.query(
            `INSERT INTO exchange_review_events(namespace, name, version, digest, actor_id, action, reason)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              reviewMatch[1],
              reviewMatch[2],
              decodeURIComponent(reviewMatch[3]!),
              digest,
              actor.id,
              action,
              reason.trim(),
            ],
          );
          if (action === "revoke") {
            await refreshPublishedHead(client, reviewMatch[1]!, reviewMatch[2]!);
          }
        });
        json(response, 200, {
          status: action === "approve" ? "approved" : action === "reject" ? "rejected" : "revoked",
          digest,
        });
        return;
      }
      throw new HttpError(404, "Route not found.");
    } catch (error) {
      if (response.headersSent || (request.destroyed && !request.complete)) return;
      if (error instanceof HttpError) {
        if (error.status === 413) response.setHeader("Connection", "close");
        json(response, error.status, { error: error.message });
      } else if (
        error instanceof Error &&
        /^(Authentication required|CSRF validation failed)/.test(error.message)
      ) {
        json(response, 403, { error: error.message });
      } else {
        process.stderr.write(`Exchange request error: ${String(error)}\n`);
        json(response, 500, { error: "Internal Exchange error." });
      }
    }
  });
}

if (import.meta.main) {
  const pool = createPool();
  const signedMetadataEvents = new SignedMetadataEvents();
  const server = createExchangeServer(pool, createStorage(), loadConfig(), signedMetadataEvents);
  signedMetadataEvents.start(pool);
  server.on("close", () => signedMetadataEvents.stop());
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    signedMetadataEvents.stop();
    server.close(() => {
      void pool.end().catch((error) => {
        process.stderr.write(`Exchange database shutdown failed: ${String(error)}\n`);
        process.exitCode = 1;
      });
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  const port = Number(process.env.PORT ?? "8787");
  server.listen(port, "0.0.0.0", () =>
    process.stdout.write(`Tabs Exchange listening on ${port}\n`),
  );
}
