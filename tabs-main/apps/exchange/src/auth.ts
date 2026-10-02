import * as Crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import type { ExchangeConfig } from "./config.ts";
import { loginReturnRoute } from "./loginReturn.ts";

const SESSION_AGE_SECONDS = 60 * 60 * 24 * 7;
const STATE_AGE_SECONDS = 60 * 10;
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const MAX_GITHUB_JSON_BYTES = 128 * 1024;

function token(): string {
  return Crypto.randomBytes(32).toString("base64url");
}

function hash(value: string): string {
  return Crypto.createHash("sha256").update(value).digest("hex");
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function githubJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok || response.url !== url || !response.body) {
    throw new Error("GitHub authentication request failed or changed destination.");
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (
    !contentType.startsWith("application/json") &&
    !contentType.startsWith("application/vnd.github+json")
  ) {
    throw new Error("GitHub authentication returned an unexpected content type.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_GITHUB_JSON_BYTES) {
        throw new Error("GitHub authentication response is too large.");
      }
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function cookies(request: IncomingMessage): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) result[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return result;
}

function cookie(
  name: string,
  value: string,
  origin: string,
  maxAge: number,
  httpOnly = true,
): string {
  const secure = new URL(origin).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}${httpOnly ? "; HttpOnly" : ""}`;
}

export interface ExchangeActor {
  readonly id: string;
  readonly login: string;
  readonly admin: boolean;
  readonly operator?: boolean;
  readonly csrf: string;
  readonly tokenScope?: "read" | "publish";
  readonly tokenNamespace?: string;
}

export async function startGithubLogin(
  response: ServerResponse,
  pool: Pool,
  config: ExchangeConfig,
  returnTo?: string | null,
): Promise<void> {
  const state = token();
  await pool.query(
    "INSERT INTO exchange_oauth_states(state_hash, expires_at, return_route) VALUES ($1, now() + interval '10 minutes', $2)",
    [hash(state), loginReturnRoute(returnTo)],
  );
  response.setHeader(
    "Set-Cookie",
    cookie("tabs_exchange_oauth", state, config.origin, STATE_AGE_SECONDS),
  );
  const authorizeBase =
    (process.env.NODE_ENV === "test" && config.testGithubAuthUrls?.authorizeUrl) ||
    "https://github.com/login/oauth/authorize";
  const url = new URL(authorizeBase);
  url.searchParams.set("client_id", config.githubClientId);
  url.searchParams.set("redirect_uri", `${config.origin}/auth/github/callback`);
  url.searchParams.set("state", state);
  response.writeHead(302, { Location: url.toString() }).end();
}

export async function completeGithubLogin(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  pool: Pool,
  config: ExchangeConfig,
): Promise<void> {
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (
    !state ||
    state.length !== 43 ||
    !code ||
    code.length > 2048 ||
    state !== cookies(request).tabs_exchange_oauth
  ) {
    throw new Error("OAuth state mismatch.");
  }
  const consumed = await pool.query(
    "DELETE FROM exchange_oauth_states WHERE state_hash = $1 AND expires_at > now() RETURNING state_hash, return_route",
    [hash(state)],
  );
  if (consumed.rowCount !== 1) throw new Error("OAuth state expired or already used.");
  const tokenUrl =
    (process.env.NODE_ENV === "test" && config.testGithubAuthUrls?.tokenUrl) || GITHUB_TOKEN_URL;
  const grant = await githubJson(tokenUrl, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.githubClientId,
      client_secret: config.githubClientSecret,
      code,
      redirect_uri: `${config.origin}/auth/github/callback`,
    }),
  });
  if (
    !record(grant) ||
    typeof grant.access_token !== "string" ||
    !grant.access_token ||
    grant.access_token.length > 2048 ||
    /\s|[\u0000-\u001f\u007f]/.test(grant.access_token)
  ) {
    throw new Error("GitHub did not provide a valid access token.");
  }
  const userUrl =
    (process.env.NODE_ENV === "test" && config.testGithubAuthUrls?.userUrl) || GITHUB_USER_URL;
  const user = await githubJson(userUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${grant.access_token}`,
      "User-Agent": "Tabs-Exchange",
    },
  });
  if (
    !record(user) ||
    !Number.isSafeInteger(user.id) ||
    (user.id as number) <= 0 ||
    typeof user.login !== "string" ||
    !user.login ||
    user.login.length > 100
  ) {
    throw new Error("Invalid GitHub identity response.");
  }
  const id = String(user.id);
  if (config.visibility === "private" && !config.allowedGithubIds?.has(id))
    throw new Error(
      "Authentication required: this account is not allowed on this private registry.",
    );
  await pool.query(
    "INSERT INTO exchange_users(id, login) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET login = EXCLUDED.login",
    [id, user.login],
  );
  const sessionToken = token();
  const csrf = token();
  await pool.query(
    "INSERT INTO exchange_sessions(token_hash, user_id, csrf_hash, expires_at) VALUES ($1, $2, $3, now() + interval '7 days')",
    [hash(sessionToken), id, hash(csrf)],
  );
  response.setHeader("Set-Cookie", [
    cookie("tabs_exchange_session", sessionToken, config.origin, SESSION_AGE_SECONDS),
    cookie("tabs_exchange_csrf", csrf, config.origin, SESSION_AGE_SECONDS, false),
    cookie("tabs_exchange_oauth", "", config.origin, 0),
  ]);
  response
    .writeHead(302, {
      Location: `${config.origin}${loginReturnRoute(consumed.rows[0]?.return_route)}`,
    })
    .end();
}

export async function actorFor(
  request: IncomingMessage,
  pool: Pool,
  config: ExchangeConfig,
): Promise<ExchangeActor | null> {
  if (request.headers.authorization !== undefined) {
    const authorization = request.headers.authorization;
    if (!/^Bearer tex_[A-Za-z0-9_-]{43}$/.test(authorization)) return null;
    const result = await pool.query<{
      id: string;
      login: string;
      scope: "read" | "publish";
      namespace: string | null;
    }>(
      `SELECT u.id, u.login, t.scope, t.namespace FROM exchange_access_tokens t
       JOIN exchange_users u ON u.id = t.user_id
       WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND t.expires_at > now()
       AND (t.scope = 'read' OR EXISTS (SELECT 1 FROM exchange_namespace_members m WHERE m.namespace = t.namespace AND m.user_id = t.user_id))`,
      [hash(authorization.slice(7))],
    );
    const row = result.rows[0];
    if (!row || (config.visibility === "private" && !config.allowedGithubIds?.has(String(row.id))))
      return null;
    return {
      id: String(row.id),
      login: row.login,
      admin: false,
      csrf: "invalid",
      tokenScope: row.scope,
      ...(row.namespace ? { tokenNamespace: row.namespace } : {}),
    };
  }
  const value = cookies(request).tabs_exchange_session;
  if (!value) return null;
  const result = await pool.query<{
    id: string;
    login: string;
    csrf_hash: string;
    reviewer_active?: boolean;
  }>(
    "SELECT u.id, u.login, s.csrf_hash, EXISTS(SELECT 1 FROM exchange_reviewers r WHERE r.user_id = u.id AND r.active) AS reviewer_active FROM exchange_sessions s JOIN exchange_users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()",
    [hash(value)],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (config.visibility === "private" && !config.allowedGithubIds?.has(String(row.id))) return null;
  const csrf = request.headers["x-csrf-token"];
  return {
    id: row.id,
    login: row.login,
    admin:
      config.adminGithubIds.has(String(row.id)) ||
      config.operatorGithubIds?.has(String(row.id)) === true ||
      row.reviewer_active === true,
    operator: config.operatorGithubIds?.has(String(row.id)) === true,
    csrf: typeof csrf === "string" && hash(csrf) === row.csrf_hash ? "valid" : "invalid",
  };
}

export function requireMutation(
  request: IncomingMessage,
  actor: ExchangeActor | null,
  config: ExchangeConfig,
): ExchangeActor {
  if (!actor) throw new Error("Authentication required.");
  if (actor.tokenScope || request.headers.origin !== config.origin || actor.csrf !== "valid") {
    throw new Error("CSRF validation failed.");
  }
  return actor;
}

export async function logout(
  request: IncomingMessage,
  response: ServerResponse,
  pool: Pool,
  config: ExchangeConfig,
): Promise<void> {
  const value = cookies(request).tabs_exchange_session;
  if (value) await pool.query("DELETE FROM exchange_sessions WHERE token_hash = $1", [hash(value)]);
  response.setHeader("Set-Cookie", [
    cookie("tabs_exchange_session", "", config.origin, 0),
    cookie("tabs_exchange_csrf", "", config.origin, 0, false),
  ]);
  response.writeHead(204).end();
}
