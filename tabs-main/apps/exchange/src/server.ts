import * as Crypto from "node:crypto";
import * as FS from "node:fs/promises";
import * as Http from "node:http";
import * as OS from "node:os";
import * as Path from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import { inspectTabsext, readTabsextListingAsset } from "@tabs/extension-package";
import { TABS_EXTENSION_API_VERSION } from "@tabs/extension-api";
import { exchangeErrorCode, exchangeErrorGuidance } from "@tabs/shared/exchangeErrors";
import type { Pool, PoolClient } from "pg";
import {
  actorFor,
  completeGithubLogin,
  logout,
  requireMutation,
  startGithubLogin,
} from "./auth.ts";
import { createPool, createStorage, loadConfig, type ExchangeConfig } from "./config.ts";
import { boundedObject, putImmutablePackageObject, verifiedPackageObject } from "./storage.ts";
import { refreshPublishedHead } from "./publishedHeads.ts";
import { decodeSearchCursor, encodeSearchCursor } from "./searchCursor.ts";
import { decodeVersionCursor, encodeVersionCursor } from "./versionCursor.ts";
import { SignedMetadataEvents } from "./signedMetadataEvents.ts";
import { metadataFreshness, type StoredMetadataRow } from "./metadataFreshness.ts";
import { evaluateOperationalReadiness } from "./operationalAlerts.ts";
import { issueAccessToken } from "./accessTokens.ts";
import { changeReviewerRole, ReviewerRoleError } from "./reviewerRoles.ts";
import { acceptPublisherAgreement, publisherAgreement } from "./publisherAgreement.ts";
import { resolveInviteIdentity, validInviteIdentity } from "./inviteIdentity.ts";
import { serveFrontend } from "./frontend.ts";
import { listingMetadata } from "./listingMetadata.ts";
import { CATALOG_DISPLAY_NAME, CATALOG_RELEVANCE, catalogPattern } from "./catalogSearch.ts";

const PACKAGE_ROUTE = /^\/v1\/extensions\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})$/;
const VERSION_ROUTE =
  /^\/v1\/extensions\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})\/versions\/([^/]+)$/;
const UPLOAD_ROUTE = /^\/v1\/publisher\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})\/versions$/;
const REVIEW_ROUTE = /^\/v1\/review\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})\/([^/]+)$/;
const RESCAN_ROUTE =
  /^\/v1\/review\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})\/([^/]+)\/rescan$/;
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
const MEMBER_REMOVE_ROUTE = /^\/v1\/namespaces\/([a-z][a-z0-9-]{1,62})\/members\/([1-9][0-9]*)$/;
const INVITATION_ACCEPT_ROUTE = /^\/v1\/publisher\/invitations\/([1-9][0-9]*)\/accept$/;
const INVITATION_DECLINE_ROUTE = /^\/v1\/publisher\/invitations\/([1-9][0-9]*)\/decline$/;
const INVITATION_CANCEL_ROUTE =
  /^\/v1\/namespaces\/([a-z][a-z0-9-]{1,62})\/invitations\/([1-9][0-9]*)\/cancel$/;
const VERIFY_NAMESPACE_ROUTE = /^\/v1\/review\/namespaces\/([a-z][a-z0-9-]{1,62})\/verification$/;
const BLOCKED_DIGEST_REMOVE_ROUTE = /^\/v1\/review\/blocked-digests\/([a-f0-9]{64})\/remove$/;
const RESERVED_NAMESPACES = new Set(["tabs", "official", "admin", "system"]);
const TERMS_VERSION = "2026-09-24";
const PUBLISHED_RELEASE_JOIN = `JOIN exchange_published_targets p
  ON p.namespace = v.namespace AND p.name = v.name AND p.version = v.version
  AND p.digest = v.digest AND p.bytes = v.bytes`;
const VERSION_PAGE_SIZE = 100;
const PUBLICATION_HISTORY_JOIN = `LEFT JOIN exchange_publication_history publication
  ON publication.namespace = v.namespace AND publication.name = v.name
  AND publication.version = v.version AND publication.digest = v.digest`;
const MAX_BLOCKED_DIGEST_BATCH = 100;
const MAX_CONCURRENT_UPLOADS = 2;
const UPLOAD_DEADLINE_MS = 120_000;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly recovery?: string,
  ) {
    super(message);
  }
}

const privateResponses = new WeakSet<Http.ServerResponse>();
function publicCors(response: Http.ServerResponse): Record<string, string> {
  return privateResponses.has(response) ? {} : { "Access-Control-Allow-Origin": "*" };
}
function json(response: Http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": privateResponses.has(response) ? "private, no-store" : "no-store",
    "X-Content-Type-Options": "nosniff",
    ...publicCors(response),
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
      if (
        config.visibility === "private" ||
        request.headers.authorization ||
        request.headers.cookie
      ) {
        privateResponses.add(response);
        response.setHeader("Cache-Control", "private, no-store");
        response.setHeader("Vary", "Authorization, Cookie");
      }
      if (request.method === "GET" && path === "/v1/registry") {
        json(response, 200, {
          protocolVersion: "1.0.0",
          extensionApiVersion: TABS_EXTENSION_API_VERSION,
          maxPackageBytes: 25 * 1024 * 1024,
          visibility: config.visibility ?? "public",
          authentication:
            config.visibility === "private" ? "session-or-read-token" : "anonymous-read",
          publishingEnabled: config.publishingEnabled,
          reviewRequired: true,
        });
        return;
      }
      if (request.headers.authorization) {
        const actor = await actorFor(request, pool, config);
        const publishRoute =
          /^\/v1\/publisher\/([a-z][a-z0-9-]{1,62})\/[a-z][a-z0-9-]{1,62}\/versions(?:\/[0-9A-Za-z.+-]{1,128})?$/.exec(
            path,
          );
        const readRoute =
          request.method === "GET" &&
          (path.startsWith("/v1/extensions") ||
            TUF_METADATA_ROUTE.test(path) ||
            TUF_TARGET_ROUTE.test(path));
        const canRead = actor?.tokenScope === "read" && readRoute;
        const canPublish =
          actor?.tokenScope === "publish" &&
          publishRoute?.[1] === actor.tokenNamespace &&
          (request.method === "GET" || (request.method === "POST" && UPLOAD_ROUTE.test(path)));
        if (!canRead && !canPublish)
          throw new HttpError(401, "This token cannot access this operation.");
      }
      if (
        config.visibility === "private" &&
        path.startsWith("/v1/") &&
        path !== "/v1/openapi.json" &&
        path !== "/v1/me" &&
        !path.startsWith("/v1/publisher/") &&
        !path.startsWith("/v1/tokens")
      ) {
        const actor = await actorFor(request, pool, config);
        if (!actor || (actor.tokenScope && actor.tokenScope !== "read"))
          throw new HttpError(401, "Private registry access requires a current read credential.");
      }
      if (path === "/v1/tokens" && request.method === "GET") {
        const actor = await actorFor(request, pool, config);
        if (!actor || actor.tokenScope) throw new HttpError(401, "Sign in to manage tokens.");
        const result = await pool.query(
          "SELECT id, label, scope, namespace, created_at, expires_at, revoked_at FROM exchange_access_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100",
          [actor.id],
        );
        json(response, 200, { tokens: result.rows });
        return;
      }
      if (path === "/v1/tokens" && request.method === "POST") {
        const actor = requireMutation(request, await actorFor(request, pool, config), config);
        try {
          json(response, 201, await issueAccessToken(pool, actor, await readJson(request)));
        } catch {
          throw new HttpError(400, "Invalid token request or namespace access.");
        }
        return;
      }
      if (/^\/v1\/tokens\/[0-9a-f-]{36}$/.test(path) && request.method === "DELETE") {
        const actor = requireMutation(request, await actorFor(request, pool, config), config);
        await pool.query(
          "UPDATE exchange_access_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2",
          [path.split("/").at(-1), actor.id],
        );
        response.writeHead(204).end();
        return;
      }
      const submissionStatus =
        /^\/v1\/publisher\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})\/versions\/([0-9A-Za-z.+-]{1,128})$/.exec(
          path,
        );
      if (submissionStatus && request.method === "GET") {
        const actor = await actorFor(request, pool, config);
        if (
          !actor ||
          (actor.tokenScope &&
            (actor.tokenScope !== "publish" || actor.tokenNamespace !== submissionStatus[1]))
        )
          throw new HttpError(401, "Publisher access required.");
        const found = await pool.query(
          `SELECT v.namespace, v.name, v.version, v.digest, v.status, v.review_reason,
                  v.manifest, v.scan_result, v.submitted_at, v.reviewed_at, v.scan_claimed_at,
                  v.scan_started_at, v.scan_completed_at,
                  (p.digest IS NOT NULL) AS published FROM exchange_versions v
           JOIN exchange_namespace_members m ON m.namespace = v.namespace
           LEFT JOIN exchange_published_targets p ON p.namespace = v.namespace AND p.name = v.name
             AND p.version = v.version AND p.digest = v.digest AND p.bytes = v.bytes
           WHERE v.namespace = $1 AND v.name = $2 AND v.version = $3 AND m.user_id = $4`,
          [submissionStatus[1], submissionStatus[2], submissionStatus[3], actor.id],
        );
        if (!found.rows[0]) throw new HttpError(404, "Submission not found.");
        json(response, 200, found.rows[0]);
        return;
      }
      const submissionDetail = /^\/v1\/publisher\/submissions\/([a-f0-9]{64})$/.exec(path);
      if (submissionDetail && request.method === "GET") {
        const actor = await actorFor(request, pool, config);
        if (!actor || actor.tokenScope) throw new HttpError(401, "Publisher session required.");
        const found = await pool.query(
          `SELECT v.namespace, v.name, v.version, v.digest, v.status, v.review_reason,
                  v.manifest, v.scan_result, v.submitted_at, v.reviewed_at, v.scan_claimed_at,
                  v.scan_started_at, v.scan_completed_at,
                  (p.digest IS NOT NULL) AS published FROM exchange_versions v
           JOIN exchange_namespace_members m ON m.namespace = v.namespace
           LEFT JOIN exchange_published_targets p ON p.namespace = v.namespace AND p.name = v.name
             AND p.version = v.version AND p.digest = v.digest AND p.bytes = v.bytes
           WHERE v.digest = $1 AND m.user_id = $2 LIMIT 2`,
          [submissionDetail[1], actor.id],
        );
        if (found.rows.length !== 1) throw new HttpError(404, "Submission not found.");
        json(response, 200, found.rows[0]);
        return;
      }
      if (request.method === "GET" && path === "/v1/tuf/events") {
        if (config.visibility === "private")
          throw new HttpError(
            503,
            "Private registry clients use authenticated polling for signed metadata.",
          );
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
      if (
        request.method === "GET" &&
        (await serveFrontend(
          path,
          response,
          undefined,
          config.visibility === "private"
            ? undefined
            : async () => {
                const identity =
                  /^\/extensions\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})\/?$/.exec(path);
                if (!identity) return undefined;
                const version = url.searchParams.get("version");
                if (version !== null && !/^[0-9A-Za-z.+-]{1,128}$/.test(version)) return undefined;
                const found = await pool.query(
                  `SELECT v.manifest FROM exchange_versions v ${PUBLISHED_RELEASE_JOIN}
             ${version === null ? "JOIN exchange_published_heads h ON h.namespace = v.namespace AND h.name = v.name AND h.version = v.version" : ""}
             WHERE v.namespace = $1 AND v.name = $2 AND v.status = 'approved'
               ${version === null ? "" : "AND v.version = $3"} LIMIT 1`,
                  [identity[1], identity[2], ...(version === null ? [] : [version])],
                );
                const canonical = `/extensions/${identity[1]}/${identity[2]}${version === null ? "" : `?${new URLSearchParams({ version })}`}`;
                return listingMetadata(found.rows[0]?.manifest, config.origin, canonical);
              },
        ))
      )
        return;
      const publicFiles: Record<string, { file: string; type: string }> = {
        "/v1/openapi.json": {
          file: "public-openapi.json",
          type: "application/json; charset=utf-8",
        },
        "/publisher": {
          file: "publisher.html",
          type: "text/html; charset=utf-8",
        },
        "/extensions": { file: "marketplace.html", type: "text/html; charset=utf-8" },
        "/marketplace.js": {
          file: "../dist/marketplace.js",
          type: "text/javascript; charset=utf-8",
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
      const portalAsset = /^\/extensions\/[a-z][a-z0-9-]{1,62}\/[a-z][a-z0-9-]{1,62}\/?$/.test(path)
        ? publicFiles["/extensions"]
        : publicFiles[path];
      if (request.method === "GET" && portalAsset) {
        const asset = portalAsset;
        const bytes = await FS.readFile(Path.join(import.meta.dirname, asset.file));
        response.writeHead(200, {
          "Content-Type": asset.type,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy":
            "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'",
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
        await startGithubLogin(response, pool, config, url.searchParams.get("returnTo"));
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
                operator: actor.operator === true,
                publishingEnabled: config.publishingEnabled,
                termsVersion: TERMS_VERSION,
              }
            : null,
        );
        return;
      }
      if (path === "/v1/operator/reviewers" && request.method === "GET") {
        const actor = await actorFor(request, pool, config);
        if (!actor?.operator || actor.tokenScope)
          throw new HttpError(403, "Operator session required.");
        const reviewers =
          await pool.query(`SELECT u.login, r.active, r.reason, r.changed_at, a.login AS changed_by
          FROM exchange_reviewers r JOIN exchange_users u ON u.id = r.user_id
          JOIN exchange_users a ON a.id = r.changed_by ORDER BY r.changed_at DESC LIMIT 100`);
        const events =
          await pool.query(`SELECT e.id, u.login, a.login AS actor, e.action, e.reason, e.created_at
          FROM exchange_reviewer_events e JOIN exchange_users u ON u.id = e.user_id
          JOIN exchange_users a ON a.id = e.actor_id ORDER BY e.id DESC LIMIT 100`);
        json(response, 200, { reviewers: reviewers.rows, events: events.rows });
        return;
      }
      if (path === "/v1/operator/reviewers" && request.method === "POST") {
        const actor = requireMutation(request, await actorFor(request, pool, config), config);
        if (!actor.operator || actor.tokenScope)
          throw new HttpError(403, "Operator session required.");
        try {
          json(
            response,
            200,
            await changeReviewerRole(pool, actor, config, await readJson(request)),
          );
        } catch (error) {
          if (error instanceof ReviewerRoleError) throw new HttpError(400, error.message);
          throw error;
        }
        return;
      }
      if (path === "/v1/publisher/agreement" && request.method === "GET") {
        const actor = await actorFor(request, pool, config);
        if (!actor || actor.tokenScope) throw new HttpError(401, "Publisher session required.");
        json(response, 200, {
          termsVersion: TERMS_VERSION,
          acceptedAt: await publisherAgreement(pool, actor.id, TERMS_VERSION),
        });
        return;
      }
      if (path === "/v1/publisher/agreement" && request.method === "POST") {
        if (!config.publishingEnabled)
          throw new HttpError(
            503,
            "Publisher submissions are not enabled.",
            "PUBLISHING_DISABLED",
            "Contact the registry operator. Do not retry automatically.",
          );
        const actor = requireMutation(request, await actorFor(request, pool, config), config);
        const body = await readJson(request);
        if (body.acceptTermsVersion !== TERMS_VERSION)
          throw new HttpError(400, "Accept the current publisher terms version.");
        await acceptPublisherAgreement(pool, actor.id, TERMS_VERSION);
        json(response, 200, {
          termsVersion: TERMS_VERSION,
          acceptedAt: await publisherAgreement(pool, actor.id, TERMS_VERSION),
        });
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
      if (request.method === "GET" && path === "/v1/publisher/invitations") {
        const actor = await actorFor(request, pool, config);
        if (!actor) throw new HttpError(403, "Publisher sign-in required.");
        const found = await pool.query(
          `SELECT i.id, i.namespace, i.role, i.created_at, i.expires_at, u.login AS inviter_login
           FROM exchange_namespace_invitations i
           JOIN exchange_users u ON u.id = i.invited_by
           WHERE i.user_id = $1 AND i.status = 'pending' AND i.expires_at > now()
           ORDER BY i.created_at DESC LIMIT 100`,
          [actor.id],
        );
        json(response, 200, { invitations: found.rows });
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
        const digest = url.searchParams.get("digest");
        if (digest !== null && !/^[a-f0-9]{64}$/.test(digest))
          throw new HttpError(400, "Invalid package digest.");
        const found = await pool.query(
          `SELECT a.id, a.namespace, a.name, a.version, a.digest, a.message, a.created_at,
                  a.response, a.responded_at FROM exchange_appeals a
           JOIN exchange_namespace_members m ON m.namespace = a.namespace
           WHERE m.user_id = $1 AND ($2::text IS NULL OR a.digest = $2)
           ORDER BY a.created_at DESC, a.id DESC LIMIT 100`,
          [actor.id, digest],
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
          await acceptPublisherAgreement(client, actor.id, TERMS_VERSION);
        });
        json(response, 201, { name, verified: false });
        return;
      }
      const memberList = request.method === "GET" ? MEMBER_ROUTE.exec(path) : null;
      if (memberList) {
        const actor = await actorFor(request, pool, config);
        if (!actor) throw new HttpError(403, "Publisher sign-in required.");
        const owner = await pool.query(
          "SELECT role FROM exchange_namespace_members WHERE namespace = $1 AND user_id = $2 AND role = 'owner'",
          [memberList[1], actor.id],
        );
        if (owner.rowCount !== 1) throw new HttpError(403, "Namespace owner access required.");
        const members = await pool.query(
          `SELECT m.user_id, u.login, m.role FROM exchange_namespace_members m
           JOIN exchange_users u ON u.id = m.user_id
           WHERE m.namespace = $1 ORDER BY m.role DESC, u.login, m.user_id`,
          [memberList[1]],
        );
        const invitations = await pool.query(
          `SELECT i.id, i.user_id, u.login, i.role, i.expires_at
           FROM exchange_namespace_invitations i
           JOIN exchange_users u ON u.id = i.user_id
           WHERE i.namespace = $1 AND i.status = 'pending' AND i.expires_at > now()
           ORDER BY i.created_at DESC LIMIT 100`,
          [memberList[1]],
        );
        json(response, 200, {
          namespace: memberList[1],
          members: members.rows,
          invitations: invitations.rows,
        });
        return;
      }
      const memberRemove = request.method === "DELETE" ? MEMBER_REMOVE_ROUTE.exec(path) : null;
      if (memberRemove) {
        const actor = requireMutation(request, await actorFor(request, pool, config), config);
        if (BigInt(memberRemove[2]!) > 9223372036854775807n) {
          throw new HttpError(400, "Invalid GitHub user ID.");
        }
        const body = await readJson(request);
        if (typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 2000) {
          throw new HttpError(400, "Removing a member requires a reason.");
        }
        const reason = body.reason.trim();
        const removedRole = await inTransaction(pool, async (client) => {
          const namespace = await client.query(
            "SELECT name FROM exchange_namespaces WHERE name = $1 FOR UPDATE",
            [memberRemove[1]],
          );
          if (namespace.rowCount !== 1) throw new HttpError(404, "Namespace not found.");
          const owner = await client.query(
            "SELECT role FROM exchange_namespace_members WHERE namespace = $1 AND user_id = $2 AND role = 'owner'",
            [memberRemove[1], actor.id],
          );
          if (owner.rowCount !== 1)
            throw new HttpError(403, "Only namespace owners can remove members.");
          const target = await client.query<{ role: "owner" | "contributor" }>(
            "SELECT role FROM exchange_namespace_members WHERE namespace = $1 AND user_id = $2",
            [memberRemove[1], memberRemove[2]],
          );
          if (!target.rows[0]) throw new HttpError(404, "Namespace member not found.");
          if (target.rows[0].role === "owner") {
            const owners = await client.query<{ count: string }>(
              "SELECT count(*)::text AS count FROM exchange_namespace_members WHERE namespace = $1 AND role = 'owner'",
              [memberRemove[1]],
            );
            if (Number(owners.rows[0]?.count ?? 0) <= 1) {
              throw new HttpError(409, "The last namespace owner cannot be removed.");
            }
          }
          await client.query(
            "DELETE FROM exchange_namespace_members WHERE namespace = $1 AND user_id = $2",
            [memberRemove[1], memberRemove[2]],
          );
          await client.query(
            `UPDATE exchange_namespace_invitations SET status = 'revoked', decided_at = now(),
             decided_by = $3, decision_reason = $4
             WHERE namespace = $1 AND invited_by = $2 AND status = 'pending'`,
            [memberRemove[1], memberRemove[2], actor.id, reason],
          );
          await client.query(
            `INSERT INTO exchange_namespace_member_events(namespace, user_id, role, actor_id, action, reason)
             VALUES ($1, $2, $3, $4, 'remove', $5)`,
            [memberRemove[1], memberRemove[2], target.rows[0].role, actor.id, reason],
          );
          return target.rows[0].role;
        });
        json(response, 200, {
          namespace: memberRemove[1],
          userId: memberRemove[2],
          removedRole,
        });
        return;
      }
      const memberMatch = request.method === "POST" ? MEMBER_ROUTE.exec(path) : null;
      if (memberMatch) {
        if (!config.publishingEnabled)
          throw new HttpError(503, "Publisher submissions are not enabled.");
        const actor = requireMutation(request, await actorFor(request, pool, config), config);
        const body = await readJson(request);
        if (!validInviteIdentity(body) || (body.role !== "owner" && body.role !== "contributor")) {
          throw new HttpError(400, "Member requires a GitHub username and role.");
        }
        let targetId: string | undefined;
        const invitationId = await inTransaction(pool, async (client) => {
          const namespace = await client.query(
            "SELECT name FROM exchange_namespaces WHERE name = $1 FOR UPDATE",
            [memberMatch[1]],
          );
          if (namespace.rowCount !== 1) throw new HttpError(404, "Namespace not found.");
          const owner = await client.query(
            "SELECT role FROM exchange_namespace_members WHERE namespace = $1 AND user_id = $2 AND role = 'owner'",
            [memberMatch[1], actor.id],
          );
          if (owner.rowCount !== 1)
            throw new HttpError(403, "Only namespace owners can invite members.");
          targetId = await resolveInviteIdentity(client, body);
          if (!targetId) throw new HttpError(404, "That GitHub user must sign in first.");
          const existing = await client.query(
            "SELECT role FROM exchange_namespace_members WHERE namespace = $1 AND user_id = $2",
            [memberMatch[1], targetId],
          );
          if (existing.rowCount) throw new HttpError(409, "That user is already a member.");
          await client.query(
            `UPDATE exchange_namespace_invitations SET status = 'expired', decided_at = now()
             WHERE namespace = $1 AND user_id = $2 AND status = 'pending' AND expires_at <= now()`,
            [memberMatch[1], targetId],
          );
          const invited = await client.query<{ id: string }>(
            `INSERT INTO exchange_namespace_invitations(namespace, user_id, role, invited_by, status, expires_at)
             VALUES ($1, $2, $3, $4, 'pending', now() + interval '14 days') RETURNING id`,
            [memberMatch[1], targetId, body.role, actor.id],
          );
          return invited.rows[0]!.id;
        }).catch((error: unknown) => {
          if ((error as { code?: unknown }).code === "23505") {
            throw new HttpError(409, "A pending invitation already exists for that user.");
          }
          throw error;
        });
        json(response, 202, {
          namespace: memberMatch[1],
          userId: targetId,
          role: body.role,
          invitationId,
        });
        return;
      }
      const invitationAccept =
        request.method === "POST" ? INVITATION_ACCEPT_ROUTE.exec(path) : null;
      if (invitationAccept) {
        if (!config.publishingEnabled)
          throw new HttpError(503, "Publisher submissions are not enabled.");
        const actor = requireMutation(request, await actorFor(request, pool, config), config);
        const body = await readJson(request);
        if (body.acceptTermsVersion !== TERMS_VERSION) {
          throw new HttpError(400, "Publisher terms must be accepted.");
        }
        const accepted = await inTransaction(pool, async (client) => {
          const found = await client.query<{
            namespace: string;
            role: "owner" | "contributor";
            user_id: string;
            status: string;
          }>(
            `SELECT namespace, role, user_id, status
             FROM exchange_namespace_invitations
             WHERE id = $1 AND expires_at > clock_timestamp() FOR UPDATE`,
            [invitationAccept[1]],
          );
          const invitation = found.rows[0];
          if (
            !invitation ||
            String(invitation.user_id) !== actor.id ||
            invitation.status !== "pending"
          ) {
            throw new HttpError(409, "Invitation is unavailable or expired.");
          }
          const added = await client.query(
            `INSERT INTO exchange_namespace_members(namespace, user_id, role)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING user_id`,
            [invitation.namespace, actor.id, invitation.role],
          );
          if (added.rowCount !== 1) throw new HttpError(409, "Already a namespace member.");
          await client.query(
            `UPDATE exchange_namespace_invitations SET status = 'accepted', decided_at = now(),
             accepted_terms_version = $2, decided_by = $3
             WHERE id = $1`,
            [invitationAccept[1], TERMS_VERSION, actor.id],
          );
          await acceptPublisherAgreement(client, actor.id, TERMS_VERSION);
          return invitation;
        });
        json(response, 200, { namespace: accepted.namespace, role: accepted.role });
        return;
      }
      const invitationDecline =
        request.method === "POST" ? INVITATION_DECLINE_ROUTE.exec(path) : null;
      if (invitationDecline) {
        const actor = requireMutation(request, await actorFor(request, pool, config), config);
        const namespace = await inTransaction(pool, async (client) => {
          const found = await client.query<{ namespace: string; user_id: string; status: string }>(
            `SELECT namespace, user_id, status FROM exchange_namespace_invitations
             WHERE id = $1 FOR UPDATE`,
            [invitationDecline[1]],
          );
          const invitation = found.rows[0];
          if (
            !invitation ||
            String(invitation.user_id) !== actor.id ||
            invitation.status !== "pending"
          ) {
            throw new HttpError(409, "Invitation is unavailable.");
          }
          await client.query(
            `UPDATE exchange_namespace_invitations SET status = 'declined', decided_at = now(),
             decided_by = $2 WHERE id = $1`,
            [invitationDecline[1], actor.id],
          );
          return invitation.namespace;
        });
        json(response, 200, { namespace, status: "declined" });
        return;
      }
      const invitationCancel =
        request.method === "POST" ? INVITATION_CANCEL_ROUTE.exec(path) : null;
      if (invitationCancel) {
        const actor = requireMutation(request, await actorFor(request, pool, config), config);
        const body = await readJson(request);
        if (typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 2000) {
          throw new HttpError(400, "Cancelling an invitation requires a reason.");
        }
        const reason = body.reason.trim();
        await inTransaction(pool, async (client) => {
          const namespace = await client.query(
            "SELECT name FROM exchange_namespaces WHERE name = $1 FOR UPDATE",
            [invitationCancel[1]],
          );
          if (namespace.rowCount !== 1) throw new HttpError(404, "Namespace not found.");
          const owner = await client.query(
            "SELECT role FROM exchange_namespace_members WHERE namespace = $1 AND user_id = $2 AND role = 'owner'",
            [invitationCancel[1], actor.id],
          );
          if (owner.rowCount !== 1)
            throw new HttpError(403, "Only namespace owners can cancel invitations.");
          const found = await client.query<{ status: string }>(
            `SELECT status FROM exchange_namespace_invitations
             WHERE id = $1 AND namespace = $2 FOR UPDATE`,
            [invitationCancel[2], invitationCancel[1]],
          );
          if (found.rows[0]?.status !== "pending") {
            throw new HttpError(409, "Invitation is no longer pending.");
          }
          await client.query(
            `UPDATE exchange_namespace_invitations SET status = 'revoked', decided_at = now(),
             decided_by = $2, decision_reason = $3 WHERE id = $1`,
            [invitationCancel[2], actor.id, reason],
          );
        });
        json(response, 200, { namespace: invitationCancel[1], status: "revoked" });
        return;
      }
      const uploadMatch = request.method === "POST" ? UPLOAD_ROUTE.exec(path) : null;
      if (uploadMatch || (request.method === "POST" && path === "/v1/publisher/upload")) {
        if (!config.publishingEnabled)
          throw new HttpError(
            503,
            "Publisher submissions are not enabled.",
            "PUBLISHING_DISABLED",
            "Contact the registry operator. Do not retry automatically.",
          );
        const authenticated = await actorFor(request, pool, config);
        const actor =
          uploadMatch &&
          authenticated?.tokenScope === "publish" &&
          authenticated.tokenNamespace === uploadMatch[1]
            ? authenticated
            : requireMutation(request, authenticated, config);
        if (uploadMatch) {
          const member = await pool.query(
            "SELECT role FROM exchange_namespace_members WHERE namespace = $1 AND user_id = $2",
            [uploadMatch[1], actor.id],
          );
          if (member.rowCount !== 1) throw new HttpError(403, "Not a namespace publisher.");
        }
        if (request.headers["content-type"] !== "application/octet-stream") {
          throw new HttpError(415, "Upload a raw .tabsext archive.");
        }
        if (!(await publisherAgreement(pool, actor.id, TERMS_VERSION)))
          throw new HttpError(
            403,
            "Accept the current publisher terms on this registry's Publish page before uploading, including through the CLI.",
            "TERMS_ACCEPTANCE_REQUIRED",
            "Sign in to /account on this registry and accept its current publisher terms.",
          );
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
            const inspected = await inspectTabsext(archive, null).catch(() => {
              throw new HttpError(400, "Invalid Tabs extension package.");
            });
            const namespace = inspected.manifest.publisher;
            const selectedNamespace = request.headers["x-tabs-publisher-namespace"];
            if (selectedNamespace !== undefined && selectedNamespace !== namespace)
              throw new HttpError(400, "The package publisher must match the selected namespace.");
            const name = inspected.manifest.name;
            if (uploadMatch && (namespace !== uploadMatch[1] || name !== uploadMatch[2])) {
              throw new HttpError(400, "Package identity does not match the namespace and name.");
            }
            const member = await pool.query(
              "SELECT role FROM exchange_namespace_members WHERE namespace = $1 AND user_id = $2",
              [namespace, actor.id],
            );
            if (member.rowCount !== 1) throw new HttpError(403, "Not a namespace publisher.");
            const key = `quarantine/${namespace}/${name}/${inspected.manifest.version}/${inspected.digest}.tabsext`;
            await putImmutablePackageObject(storage, config.bucket, key, bytes, inspected.digest);
            try {
              await inTransaction(pool, async (client) => {
                await client.query(
                  "SELECT name FROM exchange_namespaces WHERE name = $1 FOR UPDATE",
                  [namespace],
                );
                const currentMember = await client.query(
                  "SELECT role FROM exchange_namespace_members WHERE namespace = $1 AND user_id = $2",
                  [namespace, actor.id],
                );
                if (currentMember.rowCount !== 1) {
                  throw new HttpError(403, "Namespace publishing access changed during upload.");
                }
                await client.query(
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
              });
            } catch (error) {
              if ((error as { code?: unknown }).code === "23505") {
                throw new HttpError(
                  409,
                  "This extension version was already submitted.",
                  "VERSION_ALREADY_SUBMITTED",
                  "Check submission status. For corrected content, increment the manifest version and rebuild.",
                );
              }
              throw error;
            }
            json(response, 202, {
              namespace,
              name,
              version: inspected.manifest.version,
              digest: inspected.digest,
              status: "queued",
              submissionId: inspected.digest,
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
        const category = url.searchParams.get("category") ?? "";
        const sort = url.searchParams.get("sort") ?? (query.trim() ? "relevance" : "newest");
        if (
          (category && !/^[a-z][a-z0-9-]{1,39}$/.test(category)) ||
          !["name", "newest", "relevance"].includes(sort)
        )
          throw new HttpError(400, "Invalid catalog filter or sort.");
        if (query.length > 100) throw new HttpError(400, "Search query is too long.");
        const rawLimit = url.searchParams.get("limit");
        const limit = rawLimit === null ? 30 : Number(rawLimit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          throw new HttpError(400, "Invalid search limit.");
        }
        const cursorValue = url.searchParams.get("cursor");
        const cursor = cursorValue === null ? null : decodeSearchCursor(cursorValue);
        if (cursorValue !== null && !cursor) throw new HttpError(400, "Invalid search cursor.");
        if (
          cursor &&
          ((sort === "newest") !== (cursor.publishedAt !== undefined) ||
            (sort === "relevance") !== (cursor.relevance !== undefined) ||
            (sort === "name") !== (cursor.sortName !== undefined) ||
            cursor.submittedAt)
        )
          throw new HttpError(400, "Cursor does not match catalog sorting.");
        const heads = await pool.query(
          `SELECT v.namespace, v.name, v.version, v.digest, v.manifest, v.submitted_at, n.verified,
                  publication.first_published_at,
                  ${CATALOG_RELEVANCE} AS relevance,
                  ${CATALOG_DISPLAY_NAME} AS sort_name,
                  to_char(publication.first_published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
           FROM exchange_published_heads h
           JOIN exchange_versions v ON v.namespace = h.namespace AND v.name = h.name AND v.version = h.version
           ${PUBLISHED_RELEASE_JOIN}
           ${PUBLICATION_HISTORY_JOIN}
           JOIN exchange_namespaces n ON n.name = v.namespace
           WHERE v.status = 'approved'
             AND (v.namespace ILIKE $1 OR v.name ILIKE $1
               OR (v.namespace || '.' || v.name) ILIKE $1
               OR v.manifest->>'displayName' ILIKE $1
               OR v.manifest->>'description' ILIKE $1
               OR EXISTS (
                 SELECT 1 FROM jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(v.manifest->'listing'->'keywords') = 'array'
                     THEN v.manifest->'listing'->'keywords' ELSE '[]'::jsonb END
                 ) AS keyword(value) WHERE keyword.value ILIKE $1
               ))
             AND ($5::text = '' OR v.manifest->'listing'->'categories' @> jsonb_build_array($5::text))
             AND ($2::text IS NULL OR ($7::text = 'newest' AND (COALESCE(publication.first_published_at, '0001-01-01 UTC'::timestamptz), v.namespace, v.name) < (COALESCE($6::timestamptz, '0001-01-01 UTC'::timestamptz), $2::text, $3::text)) OR ($7::text = 'name' AND (${CATALOG_DISPLAY_NAME}, v.namespace COLLATE "C", v.name COLLATE "C") > ($10::text COLLATE "C", $2::text COLLATE "C", $3::text COLLATE "C")) OR ($7::text = 'relevance' AND (-(${CATALOG_RELEVANCE}), v.namespace, v.name) > (-$9::integer, $2::text, $3::text)))
           ORDER BY ${sort === "newest" ? "COALESCE(publication.first_published_at, '0001-01-01 UTC'::timestamptz) DESC, v.namespace DESC, v.name DESC" : sort === "relevance" ? "relevance DESC, v.namespace, v.name" : 'sort_name, v.namespace COLLATE "C", v.name COLLATE "C"'} LIMIT $4`,
          [
            catalogPattern(query),
            cursor?.namespace ?? null,
            cursor?.name ?? null,
            limit + 1,
            category,
            cursor?.publishedAt ?? null,
            sort,
            query,
            cursor?.relevance ?? null,
            cursor?.sortName ?? null,
          ],
        );
        const page = heads.rows.slice(0, limit);
        const last = page.at(-1);
        json(response, 200, {
          extensions: page,
          hasMore: heads.rows.length > limit,
          nextCursor:
            heads.rows.length > limit && last
              ? encodeSearchCursor({
                  namespace: last.namespace,
                  name: last.name,
                  ...(sort === "newest" ? { publishedAt: last.cursor_time ?? null } : {}),
                  ...(sort === "relevance" ? { relevance: last.relevance } : {}),
                  ...(sort === "name" ? { sortName: last.sort_name } : {}),
                })
              : null,
        });
        return;
      }
      const listingAsset =
        request.method === "GET"
          ? /^\/v1\/extensions\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})\/versions\/([0-9A-Za-z.+-]{1,128})\/assets\/(readme|icon|screenshot\/([0-5]))$/.exec(
              path,
            )
          : null;
      if (listingAsset) {
        const found = await pool.query(
          `SELECT v.digest, v.bytes, v.object_key FROM exchange_versions v ${PUBLISHED_RELEASE_JOIN} WHERE v.namespace = $1 AND v.name = $2 AND v.version = $3 AND v.status = 'approved'`,
          listingAsset.slice(1, 4),
        );
        const release = found.rows[0];
        if (!release) throw new HttpError(404, "Published listing asset not found.");
        const bytes = await boundedObject(storage, config.bucket, release.object_key);
        if (
          bytes.length !== release.bytes ||
          Crypto.createHash("sha256").update(bytes).digest("hex") !== release.digest
        )
          throw new Error("Listing package failed integrity verification.");
        const temporary = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-listing-"));
        try {
          const archive = Path.join(temporary, "package.tabsext");
          await FS.writeFile(archive, bytes, { flag: "wx", mode: 0o600 });
          const asset = await readTabsextListingAsset(
            archive,
            release.digest,
            listingAsset[5] === undefined ? (listingAsset[4] as "readme" | "icon") : "screenshot",
            listingAsset[5] === undefined ? undefined : Number(listingAsset[5]),
          );
          if (!asset) throw new HttpError(404, "This release has no requested listing asset.");
          response.writeHead(200, {
            "Content-Type": asset.type,
            "Content-Length": asset.bytes.length,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            ...publicCors(response),
          });
          response.end(asset.bytes);
        } finally {
          await FS.rm(temporary, { recursive: true, force: true });
        }
        return;
      }
      const overviewMatch =
        request.method === "GET"
          ? /^\/v1\/extensions\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})\/overview$/.exec(
              path,
            )
          : null;
      if (overviewMatch) {
        const found = await pool.query(
          `SELECT v.namespace, v.name, v.version, v.digest, v.bytes, v.manifest, v.submitted_at, n.verified,
                  publication.first_published_at
           FROM exchange_published_heads h
           JOIN exchange_versions v ON v.namespace = h.namespace AND v.name = h.name AND v.version = h.version
           ${PUBLISHED_RELEASE_JOIN}
           ${PUBLICATION_HISTORY_JOIN}
           JOIN exchange_namespaces n ON n.name = v.namespace
           WHERE v.namespace = $1 AND v.name = $2 AND v.status = 'approved' LIMIT 1`,
          overviewMatch.slice(1),
        );
        if (!found.rows[0]) throw new HttpError(404, "Published extension not found.");
        json(response, 200, found.rows[0]);
        return;
      }
      const packageMatch = request.method === "GET" ? PACKAGE_ROUTE.exec(path) : null;
      if (packageMatch) {
        const cursorValue = url.searchParams.get("cursor");
        const cursor = cursorValue === null ? null : decodeVersionCursor(cursorValue);
        if (cursorValue !== null && !cursor) throw new HttpError(400, "Invalid version cursor.");
        const found = await pool.query(
          `SELECT v.namespace, v.name, v.version, v.digest, v.bytes, v.manifest, v.submitted_at, n.verified,
                  publication.first_published_at,
                  to_char(v.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
           FROM exchange_versions v ${PUBLISHED_RELEASE_JOIN}
           ${PUBLICATION_HISTORY_JOIN}
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
          first_published_at: string | Date | null;
        }>(
          `SELECT v.digest, v.bytes, v.manifest, v.object_key, publication.first_published_at
           FROM exchange_versions v ${PUBLISHED_RELEASE_JOIN}
           ${PUBLICATION_HISTORY_JOIN}
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
            first_published_at: release.first_published_at ?? null,
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
          "Cache-Control": "private, no-store",
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
        const metadata = await pool.query<StoredMetadataRow>(
          `SELECT name, bytes FROM exchange_tuf_metadata
           WHERE name = ANY($1::text[])`,
          [["root.json", "timestamp.json", "snapshot.json", "targets.json"]],
        );
        const freshness = metadataFreshness(metadata.rows);
        json(response, 200, {
          queue: found.rows[0],
          pendingRevocations: pending.rows,
          metadataFreshness: freshness,
          readiness: evaluateOperationalReadiness(true, {
            ...found.rows[0],
            metadataFreshness: freshness,
          }),
        });
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
            if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash)
              throw new Error("HTTPS ownership proof without credentials or fragment required.");
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
        const bytes = await verifiedPackageObject(
          storage,
          config.bucket,
          submission.object_key,
          submission.bytes,
          submission.digest,
        );
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
      const rescanMatch = request.method === "POST" ? RESCAN_ROUTE.exec(path) : null;
      if (rescanMatch) {
        const actor = requireMutation(request, await actorFor(request, pool, config), config);
        if (!actor.admin) throw new HttpError(403, "Reviewer access required.");
        const body = await readJson(request);
        if (
          typeof body.digest !== "string" ||
          !/^[a-f0-9]{64}$/.test(body.digest) ||
          typeof body.reason !== "string" ||
          !body.reason.trim() ||
          body.reason.length > 2000
        ) {
          throw new HttpError(400, "Rescan requires the exact digest and a reason.");
        }
        const digest = body.digest;
        const reason = body.reason.trim();
        const version = decodeURIComponent(rescanMatch[3]!);
        await inTransaction(pool, async (client) => {
          const found = await client.query<{ status: string; digest: string }>(
            `SELECT status, digest FROM exchange_versions
             WHERE namespace = $1 AND name = $2 AND version = $3 FOR UPDATE`,
            [rescanMatch[1], rescanMatch[2], version],
          );
          const submission = found.rows[0];
          if (!submission || submission.digest !== digest || submission.status !== "review") {
            throw new HttpError(409, "Only the exact awaiting-review submission can be rescanned.");
          }
          await client.query(
            `UPDATE exchange_versions SET status = 'queued', scan_result = NULL,
             scan_claimed_at = NULL, scan_token = NULL
             WHERE namespace = $1 AND name = $2 AND version = $3 AND digest = $4`,
            [rescanMatch[1], rescanMatch[2], version, digest],
          );
          await client.query(
            `INSERT INTO exchange_review_events(namespace, name, version, digest, actor_id, action, reason)
             VALUES ($1, $2, $3, $4, $5, 'rescan', $6)`,
            [rescanMatch[1], rescanMatch[2], version, digest, actor.id, reason],
          );
        });
        json(response, 202, { status: "queued", digest });
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
            bytes: number;
            object_key: string;
            scan_result: {
              passed?: boolean;
              digest?: string;
              files?: Record<string, string>;
            } | null;
          }>(
            `SELECT status, digest, bytes, object_key, scan_result FROM exchange_versions
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
            try {
              await verifiedPackageObject(
                storage,
                config.bucket,
                submission.object_key,
                submission.bytes,
                digest,
              );
            } catch {
              throw new HttpError(
                409,
                "Quarantined package no longer matches the reviewed digest.",
              );
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
        json(response, error.status, {
          error: error.message,
          message: error.message,
          code: error.code ?? exchangeErrorCode(error.status),
          recovery:
            error.recovery ?? exchangeErrorGuidance(error.status, { code: error.code }).message,
        });
      } else if (
        error instanceof Error &&
        /^(Authentication required|CSRF validation failed)/.test(error.message)
      ) {
        const guidance = exchangeErrorGuidance(403, null);
        json(response, 403, {
          error: error.message,
          message: error.message,
          code: guidance.code,
          recovery: guidance.message,
        });
      } else {
        process.stderr.write(`Exchange request error: ${String(error)}\n`);
        const guidance = exchangeErrorGuidance(500, null);
        json(response, 500, {
          error: "Internal Exchange error.",
          message: "Internal Exchange error.",
          code: guidance.code,
          recovery: guidance.message,
        });
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
