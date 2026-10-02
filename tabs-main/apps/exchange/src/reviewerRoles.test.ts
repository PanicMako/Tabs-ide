import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { changeReviewerRole } from "./reviewerRoles.ts";
import { actorFor } from "./auth.ts";
import type { IncomingMessage } from "node:http";
const config = {
  origin: "https://exchange.example",
  githubClientId: "test",
  githubClientSecret: "test",
  bucket: "test",
  publishingEnabled: false,
  adminGithubIds: new Set<string>(),
  operatorGithubIds: new Set(["1"]),
};
const operator = { id: "1", login: "operator", admin: true, operator: true, csrf: "valid" };
function fixture(target = "2", changed = 1) {
  const query = vi.fn(async (sql: string) =>
    sql.startsWith("SELECT id")
      ? { rows: [{ id: target, login: "reviewer" }] }
      : { rows: [], rowCount: changed },
  );
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  return { pool: { connect } as unknown as Pool, query, release, connect };
}
describe("operator-controlled reviewer assignments", () => {
  it("denies reviewers and publisher tokens before touching the database", async () => {
    for (const actor of [
      { ...operator, operator: false },
      { ...operator, tokenScope: "publish" as const },
    ]) {
      const f = fixture();
      await expect(changeReviewerRole(f.pool, actor, config, {})).rejects.toThrow(
        "Operator session required",
      );
      expect(f.connect).not.toHaveBeenCalled();
    }
  });
  it("atomically records the assignment and its audit event", async () => {
    const f = fixture();
    await expect(
      changeReviewerRole(f.pool, operator, config, {
        login: "reviewer",
        action: "grant",
        reason: "Trusted reviewer",
      }),
    ).resolves.toMatchObject({ active: true, changed: true });
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining("FOR UPDATE"), ["reviewer"]);
    expect(f.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO exchange_reviewer_events"),
      ["2", "1", "grant", "Trusted reviewer"],
    );
    expect(f.query).toHaveBeenCalledWith("COMMIT");
    expect(f.release).toHaveBeenCalled();
  });
  it("rolls back attempts to modify operator identities", async () => {
    const f = fixture("1");
    await expect(
      changeReviewerRole(f.pool, operator, config, {
        login: "operator",
        action: "revoke",
        reason: "test",
      }),
    ).rejects.toThrow("server configuration");
    expect(f.query).toHaveBeenCalledWith("ROLLBACK");
    expect(f.query).not.toHaveBeenCalledWith("COMMIT");
  });
  it("does not duplicate audit events for a repeated assignment", async () => {
    const f = fixture("2", 0);
    const result = await changeReviewerRole(f.pool, operator, config, {
      login: "reviewer",
      action: "grant",
      reason: "test",
    });
    expect(result.changed).toBe(false);
    expect(
      f.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO exchange_reviewer_events")),
    ).toBe(false);
  });
  it("rechecks delegated access for the same session after revocation", async () => {
    let active = true;
    const pool = {
      query: vi.fn(async () => ({
        rows: [{ id: "2", login: "reviewer", csrf_hash: "", reviewer_active: active }],
      })),
    } as unknown as Pool;
    const request = {
      headers: { cookie: "tabs_exchange_session=test-session" },
    } as IncomingMessage;
    expect((await actorFor(request, pool, config))?.admin).toBe(true);
    active = false;
    expect((await actorFor(request, pool, config))?.admin).toBe(false);
    expect((await actorFor(request, pool, config))?.operator).toBe(false);
  });
});
