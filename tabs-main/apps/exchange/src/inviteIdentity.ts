import type { PoolClient } from "pg";

export function validInviteIdentity(body: Record<string, unknown>): boolean {
  if (body.githubLogin !== undefined)
    return (
      body.githubUserId === undefined &&
      typeof body.githubLogin === "string" &&
      /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(body.githubLogin)
    );
  return (
    typeof body.githubUserId === "string" &&
    /^\d{1,19}$/.test(body.githubUserId) &&
    BigInt(body.githubUserId) <= 9223372036854775807n
  );
}

// Call only after checking namespace ownership. No public account enumeration API.
export async function resolveInviteIdentity(
  client: Pick<PoolClient, "query">,
  body: Record<string, unknown>,
): Promise<string | undefined> {
  if (!validInviteIdentity(body)) throw new Error("Invalid invitation identity.");
  const result =
    typeof body.githubLogin === "string"
      ? await client.query<{ id: string }>(
          "SELECT id FROM exchange_users WHERE lower(login) = lower($1) LIMIT 2",
          [body.githubLogin],
        )
      : await client.query<{ id: string }>("SELECT id FROM exchange_users WHERE id = $1", [
          body.githubUserId,
        ]);
  return result.rowCount === 1 ? String(result.rows[0]!.id) : undefined;
}
