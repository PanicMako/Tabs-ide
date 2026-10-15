import type { Pool } from "pg";
import type { ExchangeActor } from "./auth.ts";
import type { ExchangeConfig } from "./config.ts";
export class ReviewerRoleError extends Error {}

export async function changeReviewerRole(
  pool: Pool,
  actor: ExchangeActor,
  config: ExchangeConfig,
  body: Record<string, unknown>,
) {
  if (!actor.operator || actor.tokenScope)
    throw new ReviewerRoleError("Operator session required.");
  if (
    typeof body.login !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(body.login) ||
    (body.action !== "grant" && body.action !== "revoke") ||
    typeof body.reason !== "string" ||
    !body.reason.trim() ||
    body.reason.length > 1000
  )
    throw new ReviewerRoleError(
      "Provide a known GitHub login, grant/revoke action and a reason of at most 1000 characters.",
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const target = await client.query<{ id: string; login: string }>(
      "SELECT id, login FROM exchange_users WHERE lower(login) = lower($1) FOR UPDATE",
      [body.login],
    );
    if (target.rows.length !== 1)
      throw new ReviewerRoleError("The recipient must first sign in to this Exchange.");
    const user = target.rows[0]!;
    const id = String(user.id);
    if (id === actor.id || config.operatorGithubIds?.has(id) || config.adminGithubIds.has(id))
      throw new ReviewerRoleError(
        "Operator and configured reviewer accounts must be managed through server configuration.",
      );
    const active = body.action === "grant";
    const changed = await client.query(
      `INSERT INTO exchange_reviewers(user_id, active, changed_by, reason) VALUES($1, $2, $3, $4)
       ON CONFLICT(user_id) DO UPDATE SET active = EXCLUDED.active, changed_by = EXCLUDED.changed_by,
       reason = EXCLUDED.reason, changed_at = now() WHERE exchange_reviewers.active <> EXCLUDED.active
       RETURNING user_id`,
      [id, active, actor.id, body.reason.trim()],
    );
    if (changed.rowCount)
      await client.query(
        "INSERT INTO exchange_reviewer_events(user_id, actor_id, action, reason) VALUES($1, $2, $3, $4)",
        [id, actor.id, body.action, body.reason.trim()],
      );
    await client.query("COMMIT");
    return { login: user.login, active, changed: Boolean(changed.rowCount) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
