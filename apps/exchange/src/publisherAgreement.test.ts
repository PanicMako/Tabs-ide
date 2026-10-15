import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { acceptPublisherAgreement, publisherAgreement } from "./publisherAgreement.ts";
describe("publisher agreement records", () => {
  it("records acceptance idempotently without rewriting the original timestamp", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await acceptPublisherAgreement({ query } as unknown as Pool, "42", "terms-v1");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT DO NOTHING"), [
      "42",
      "terms-v1",
    ]);
  });
  it("looks up the exact account and version without inferring acceptance", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const database = { query } as unknown as Pool;
    expect(await publisherAgreement(database, "42", "terms-v2")).toBeNull();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("user_id = $1 AND terms_version = $2"),
      ["42", "terms-v2"],
    );
    query.mockResolvedValue({ rows: [{ accepted_at: new Date("2026-10-01T00:00:00Z") }] });
    expect(await publisherAgreement(database, "42", "terms-v2")).toBe("2026-10-01T00:00:00.000Z");
  });
});
