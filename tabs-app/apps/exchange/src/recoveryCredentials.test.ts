import type { Pool } from "pg";
import { expect, it, vi } from "vitest";
import { invalidateRestoredCredentials } from "./recoveryCredentials.ts";

it("invalidates login state and active tokens atomically and reports only counts", async () => {
  const query = vi.fn().mockResolvedValue({ rowCount: 0 });
  query
    .mockResolvedValueOnce({ rowCount: 0 })
    .mockResolvedValueOnce({ rowCount: 3 })
    .mockResolvedValueOnce({ rowCount: 2 })
    .mockResolvedValueOnce({ rowCount: 4 });
  const release = vi.fn();
  const pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pool;
  expect(await invalidateRestoredCredentials(pool)).toEqual({
    sessions: 3,
    oauthStates: 2,
    tokens: 4,
  });
  expect(query.mock.calls.map((call) => call[0])).toEqual([
    "BEGIN",
    "DELETE FROM exchange_sessions",
    "DELETE FROM exchange_oauth_states",
    "UPDATE exchange_access_tokens SET revoked_at = now() WHERE revoked_at IS NULL",
    "COMMIT",
  ]);
  expect(release).toHaveBeenCalledOnce();
});
it("rolls back partial invalidation and releases the connection on failure", async () => {
  const query = vi.fn().mockResolvedValue({ rowCount: 0 });
  query
    .mockResolvedValueOnce({ rowCount: 0 })
    .mockResolvedValueOnce({ rowCount: 3 })
    .mockRejectedValueOnce(new Error("Test failure"));
  const release = vi.fn();
  const pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pool;
  await expect(invalidateRestoredCredentials(pool)).rejects.toThrow("Test failure");
  expect(query.mock.calls.map((call) => call[0])).toEqual([
    "BEGIN",
    "DELETE FROM exchange_sessions",
    "DELETE FROM exchange_oauth_states",
    "ROLLBACK",
  ]);
  expect(release).toHaveBeenCalledOnce();
});
