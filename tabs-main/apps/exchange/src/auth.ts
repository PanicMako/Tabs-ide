import * as Crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import type { ExchangeConfig } from "./config.ts";

const SESSION_AGE_SECONDS = 60 * 60 * 24 * 7;
const STATE_AGE_SECONDS = 60 * 10;

function token(): string {
  return Crypto.randomBytes(32).toString("base64url");
}

function hash(value: string): string {
  return Crypto.createHash("sha256").update(value).digest("hex");
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
  readonly csrf: string;
}

export async function startGithubLogin(
  response: ServerResponse,
  pool: Pool,
  config: ExchangeConfig,
): Promise<void> {
  const state = token();
  await pool.query(
    "INSERT INTO exchange_oauth_states(state_hash, expires_at) VALUES ($1, now() + interval '10 minutes')",
    [hash(state)],
  );
  response.setHeader(
    "Set-Cookie",
    cookie("tabs_exchange_oauth", state, config.origin, STATE_AGE_SECONDS),
  );
  const url = new URL("https://github.com/login/oauth/authorize");
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
  if (!state || !code || state !== cookies(request).tabs_exchange_oauth) {
    throw new Error("OAuth state mismatch.");
  }
  const consumed = await pool.query(
    "DELETE FROM exchange_oauth_states WHERE state_hash = $1 AND expires_at > now() RETURNING state_hash",
    [hash(state)],
  );
  if (consumed.rowCount !== 1) throw new Error("OAuth state expired or already used.");
  const exchange = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.githubClientId,
      client_secret: config.githubClientSecret,
      code,
      redirect_uri: `${config.origin}/auth/github/callback`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!exchange.ok) throw new Error("GitHub token exchange failed.");
  const grant = (await exchange.json()) as { access_token?: string };
  if (!grant.access_token) throw new Error("GitHub did not provide an access token.");
  const profile = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${grant.access_token}`,
      "User-Agent": "Tabs-Exchange",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!profile.ok) throw new Error("GitHub identity lookup failed.");
  const user = (await profile.json()) as { id?: number; login?: string };
  if (!Number.isSafeInteger(user.id) || !user.login) {
    throw new Error("Invalid GitHub identity response.");
  }
  const id = String(user.id);
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
  response.writeHead(302, { Location: `${config.origin}/publisher` }).end();
}

export async function actorFor(
  request: IncomingMessage,
  pool: Pool,
  config: ExchangeConfig,
): Promise<ExchangeActor | null> {
  const value = cookies(request).tabs_exchange_session;
  if (!value) return null;
  const result = await pool.query<{
    id: string;
    login: string;
    csrf_hash: string;
  }>(
    "SELECT u.id, u.login, s.csrf_hash FROM exchange_sessions s JOIN exchange_users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()",
    [hash(value)],
  );
  const row = result.rows[0];
  if (!row) return null;
  const csrf = request.headers["x-csrf-token"];
  return {
    id: row.id,
    login: row.login,
    admin: config.adminGithubIds.has(row.id),
    csrf: typeof csrf === "string" && hash(csrf) === row.csrf_hash ? "valid" : "invalid",
  };
}

export function requireMutation(
  request: IncomingMessage,
  actor: ExchangeActor | null,
  config: ExchangeConfig,
): ExchangeActor {
  if (!actor) throw new Error("Authentication required.");
  if (request.headers.origin !== config.origin || actor.csrf !== "valid") {
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
