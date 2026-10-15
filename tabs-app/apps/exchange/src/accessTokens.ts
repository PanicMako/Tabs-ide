import * as Crypto from "node:crypto";
import type { Pool } from "pg";
import type { ExchangeActor } from "./auth.ts";

export async function issueAccessToken(pool: Pool, actor: ExchangeActor, input: unknown) {
  if (actor.tokenScope || !input || typeof input !== "object")
    throw new Error("Invalid access-token request.");
  const { label, scope, namespace } = input as Record<string, unknown>;
  if (
    typeof label !== "string" ||
    !label.trim() ||
    label.length > 100 ||
    (scope !== "read" && scope !== "publish")
  )
    throw new Error("Token needs a label and read or publish scope.");
  if (scope === "publish") {
    if (typeof namespace !== "string" || !/^[a-z][a-z0-9-]{1,62}$/.test(namespace))
      throw new Error("Publish token requires a valid namespace.");
    const member = await pool.query(
      "SELECT role FROM exchange_namespace_members WHERE namespace = $1 AND user_id = $2",
      [namespace, actor.id],
    );
    if (member.rowCount !== 1) throw new Error("Namespace membership required.");
  } else if (namespace !== undefined && namespace !== null && namespace !== "")
    throw new Error("Read tokens must not claim a publisher namespace.");
  const token = `tex_${Crypto.randomBytes(32).toString("base64url")}`;
  const id = Crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await pool.query(
    "INSERT INTO exchange_access_tokens(id, token_hash, user_id, label, scope, namespace, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [
      id,
      Crypto.createHash("sha256").update(token).digest("hex"),
      actor.id,
      label.trim(),
      scope,
      scope === "publish" ? namespace : null,
      expiresAt,
    ],
  );
  return { id, token, expiresAt, scope, namespace: scope === "publish" ? namespace : null };
}
