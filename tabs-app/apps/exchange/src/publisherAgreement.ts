import type { Pool, PoolClient } from "pg";
type Database = Pick<Pool | PoolClient, "query">;
export async function acceptPublisherAgreement(
  database: Database,
  userId: string,
  version: string,
): Promise<void> {
  await database.query(
    "INSERT INTO exchange_publisher_agreements(user_id, terms_version) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [userId, version],
  );
}
export async function publisherAgreement(
  database: Database,
  userId: string,
  version: string,
): Promise<string | null> {
  const result = await database.query<{ accepted_at: Date | string }>(
    "SELECT accepted_at FROM exchange_publisher_agreements WHERE user_id = $1 AND terms_version = $2",
    [userId, version],
  );
  const accepted = result.rows[0]?.accepted_at;
  return accepted instanceof Date ? accepted.toISOString() : (accepted ?? null);
}
