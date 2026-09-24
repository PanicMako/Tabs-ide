import * as Crypto from "node:crypto";
import * as FS from "node:fs/promises";
import * as Http from "node:http";
import * as OS from "node:os";
import * as Path from "node:path";
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
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
import { boundedObject } from "./storage.ts";

const PACKAGE_ROUTE = /^\/v1\/extensions\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})$/;
const VERSION_ROUTE =
  /^\/v1\/extensions\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})\/versions\/([^/]+)$/;
const UPLOAD_ROUTE = /^\/v1\/publisher\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})\/versions$/;
const REVIEW_ROUTE = /^\/v1\/review\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})\/([^/]+)$/;
const REVIEW_DOWNLOAD_ROUTE =
  /^\/v1\/review\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,62})\/([^/]+)\/download$/;
const MEMBER_ROUTE = /^\/v1\/namespaces\/([a-z][a-z0-9-]{1,62})\/members$/;
const VERIFY_NAMESPACE_ROUTE = /^\/v1\/review\/namespaces\/([a-z][a-z0-9-]{1,62})\/verification$/;
const RESERVED_NAMESPACES = new Set(["tabs", "official", "admin", "system"]);
const TERMS_VERSION = "2026-09-24";

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

async function readLimited(request: Http.IncomingMessage, max: number): Promise<Buffer> {
  const length = Number(request.headers["content-length"]);
  if (Number.isFinite(length) && length > max) throw new HttpError(413, "Request is too large.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > max) throw new HttpError(413, "Request is too large.");
    chunks.push(bytes);
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

export function createExchangeServer(
  pool: Pool,
  storage: S3Client,
  config: ExchangeConfig,
): Http.Server {
  return Http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", config.origin);
      const path = url.pathname;
      const publicFiles: Record<string, { file: string; type: string }> = {
        "/publisher": { file: "publisher.html", type: "text/html; charset=utf-8" },
        "/publisher-terms": { file: "publisher-terms.html", type: "text/html; charset=utf-8" },
        "/publisher.js": { file: "publisher.js", type: "text/javascript; charset=utf-8" },
        "/publisher.css": { file: "publisher.css", type: "text/css; charset=utf-8" },
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
                  v.review_reason, v.submitted_at, v.reviewed_at
           FROM exchange_versions v JOIN exchange_namespace_members m ON m.namespace = v.namespace
           WHERE m.user_id = $1 ORDER BY v.submitted_at DESC LIMIT 100`,
          [actor.id],
        );
        json(response, 200, { submissions: found.rows });
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
        const bytes = await readLimited(request, 25 * 1024 * 1024);
        const temporary = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-exchange-upload-"));
        try {
          const archive = Path.join(temporary, "package.tabsext");
          await FS.writeFile(archive, bytes, { flag: "wx", mode: 0o600 });
          const inspected = await inspectTabsext(archive, config.tabsVersion);
          if (inspected.manifest.publisher !== namespace || inspected.manifest.name !== name) {
            throw new HttpError(400, "Package identity does not match the namespace and name.");
          }
          const key = `quarantine/${namespace}/${name}/${inspected.manifest.version}/${inspected.digest}.tabsext`;
          await storage.send(
            new PutObjectCommand({
              Bucket: config.bucket,
              Key: key,
              Body: bytes,
              ContentType: "application/octet-stream",
            }),
          );
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
        return;
      }
      if (request.method === "GET" && path === "/v1/extensions") {
        const query = (url.searchParams.get("q") ?? "").slice(0, 100);
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 30));
        const found = await pool.query(
          `SELECT DISTINCT ON (v.namespace, v.name)
             v.namespace, v.name, v.version, v.digest, v.manifest, v.submitted_at, n.verified
           FROM exchange_versions v JOIN exchange_namespaces n ON n.name = v.namespace
           WHERE v.status = 'approved' AND (v.namespace ILIKE $1 OR v.name ILIKE $1 OR v.manifest->>'displayName' ILIKE $1)
           ORDER BY v.namespace, v.name, v.submitted_at DESC LIMIT $2`,
          [`%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`, limit],
        );
        json(response, 200, { extensions: found.rows });
        return;
      }
      const packageMatch = request.method === "GET" ? PACKAGE_ROUTE.exec(path) : null;
      if (packageMatch) {
        const found = await pool.query(
          `SELECT v.namespace, v.name, v.version, v.digest, v.bytes, v.manifest, v.submitted_at, n.verified
           FROM exchange_versions v JOIN exchange_namespaces n ON n.name = v.namespace
           WHERE v.namespace = $1 AND v.name = $2 AND v.status = 'approved'
           ORDER BY v.submitted_at DESC`,
          [packageMatch[1], packageMatch[2]],
        );
        if (!found.rowCount) throw new HttpError(404, "Extension not found.");
        json(response, 200, { versions: found.rows });
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
          `SELECT digest, bytes, manifest, object_key FROM exchange_versions
           WHERE namespace = $1 AND name = $2 AND version = $3 AND status = 'approved'`,
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
        const found = await pool.query<{ digest: string; bytes: number; object_key: string }>(
          `SELECT digest, bytes, object_key FROM exchange_versions
           WHERE namespace = $1 AND name = $2 AND version = $3 AND status = 'approved'`,
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
        json(response, 200, { namespace: verifyNamespace[1], verified: body.verified });
        return;
      }
      const reviewDownload = request.method === "GET" ? REVIEW_DOWNLOAD_ROUTE.exec(path) : null;
      if (reviewDownload) {
        const actor = await actorFor(request, pool, config);
        if (!actor?.admin) throw new HttpError(403, "Reviewer access required.");
        const version = decodeURIComponent(reviewDownload[3]!);
        const found = await pool.query<{ digest: string; bytes: number; object_key: string }>(
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
          const found = await client.query<{
            status: string;
            digest: string;
            scan_result: { passed?: boolean } | null;
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
          if (action === "approve" && submission.scan_result?.passed !== true) {
            throw new HttpError(409, "Blocking scan results prevent approval.");
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
        });
        json(response, 200, {
          status: action === "approve" ? "approved" : action === "reject" ? "rejected" : "revoked",
          digest,
        });
        return;
      }
      throw new HttpError(404, "Route not found.");
    } catch (error) {
      if (response.headersSent) return;
      if (error instanceof HttpError) json(response, error.status, { error: error.message });
      else if (
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
  const server = createExchangeServer(createPool(), createStorage(), loadConfig());
  const port = Number(process.env.PORT ?? "8787");
  server.listen(port, "0.0.0.0", () =>
    process.stdout.write(`Tabs Exchange listening on ${port}\n`),
  );
}
