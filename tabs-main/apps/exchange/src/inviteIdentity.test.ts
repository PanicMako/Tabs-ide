import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { resolveInviteIdentity, validInviteIdentity } from "./inviteIdentity.ts";
describe("known-account invitation identity", () => {
  it("accepts usernames or legacy IDs but not ambiguous or invalid identities", () => {
    expect(validInviteIdentity({ githubLogin: "my-user" })).toBe(true);
    expect(validInviteIdentity({ githubUserId: "42" })).toBe(true);
    for (const body of [
      { githubLogin: "@user" },
      { githubLogin: "a", githubUserId: "42" },
      { githubUserId: "9999999999999999999" },
      { githubLogin: "bad' OR true" },
    ])
      expect(validInviteIdentity(body)).toBe(false);
  });
  it("uses exact case-insensitive parameterized lookup and rejects unknown or ambiguous accounts", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "42" }], rowCount: 1 });
    const client = { query } as unknown as PoolClient;
    expect(await resolveInviteIdentity(client, { githubLogin: "My-User" })).toBe("42");
    expect(query).toHaveBeenCalledWith(
      "SELECT id FROM exchange_users WHERE lower(login) = lower($1) LIMIT 2",
      ["My-User"],
    );
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await resolveInviteIdentity(client, { githubLogin: "unknown" })).toBeUndefined();
    query.mockResolvedValue({ rows: [{ id: "42" }, { id: "43" }], rowCount: 2 });
    expect(await resolveInviteIdentity(client, { githubLogin: "ambiguous" })).toBeUndefined();
  });
});
