import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { S3Client } from "@aws-sdk/client-s3";
import type { AddressInfo } from "node:net";
import { createExchangeServer } from "./server.ts";

describe("authenticated submission detail", () => {
  it("requires a session, binds lookup to current membership, and does not claim approval is publication", async () => {
    const digest = "a".repeat(64);
    let member = true;
    const queries: Array<{ sql: string; values?: unknown[] | undefined }> = [];
    const pool = {
      async query(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes("FROM exchange_sessions"))
          return { rows: [{ id: "42", login: "publisher", csrf_hash: "" }], rowCount: 1 };
        if (sql.includes("WHERE v.digest = $1 AND m.user_id = $2"))
          return {
            rows: member
              ? [
                  {
                    digest,
                    status: "approved",
                    published: false,
                    scan_result: { issues: [] },
                    submitted_at: "2026-10-01T00:00:00Z",
                  },
                ]
              : [],
            rowCount: member ? 1 : 0,
          };
        throw new Error("Unexpected test query");
      },
    } as unknown as Pool;
    const server = createExchangeServer(pool, {} as S3Client, {
      origin: "http://localhost:8787",
      githubClientId: "test",
      githubClientSecret: "test",
      adminGithubIds: new Set(),
      bucket: "test",
      publishingEnabled: false,
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/publisher/submissions/${digest}`;
      expect((await fetch(endpoint)).status).toBe(401);
      expect(queries).toHaveLength(0);
      const headers = { Cookie: "tabs_exchange_session=test-session" };
      const response = await fetch(endpoint, { headers });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("private");
      expect(await response.json()).toMatchObject({
        digest,
        status: "approved",
        published: false,
        scan_result: { issues: [] },
      });
      const lookup = queries.find((entry) => entry.sql.includes("WHERE v.digest"))!;
      expect(lookup.values).toEqual([digest, "42"]);
      expect(lookup.sql).toContain("p.bytes = v.bytes");
      member = false;
      expect((await fetch(endpoint, { headers })).status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
