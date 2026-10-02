import type { AddressInfo } from "node:net";
import type { Pool } from "pg";
import type { S3Client } from "@aws-sdk/client-s3";
import { afterEach, expect, it, vi } from "vitest";
import { createExchangeServer } from "./server.ts";
const servers: ReturnType<typeof createExchangeServer>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
async function fixture(scope: "read" | "publish" | null = null) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM exchange_access_tokens"))
      return {
        rows: scope
          ? [
              {
                id: "42",
                login: "author",
                scope,
                namespace: scope === "publish" ? "publisher" : null,
              },
            ]
          : [],
      };
    return { rows: [], rowCount: 0 };
  });
  const storage = { send: vi.fn() };
  const server = createExchangeServer(
    { query } as unknown as Pool,
    storage as unknown as S3Client,
    {
      origin: "http://localhost:8787",
      githubClientId: "id",
      githubClientSecret: "secret",
      bucket: "test",
      publishingEnabled: false,
      adminGithubIds: new Set(["42"]),
      visibility: "private",
      allowedGithubIds: new Set(["42"]),
    },
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, query, storage };
}
const authorization = `Bearer tex_${"a".repeat(43)}`;
it("serves a non-enumerating same-origin private marketplace shell", async () => {
  const { origin, query, storage } = await fixture();
  for (const path of ["/extensions", "/extensions/publisher/tool"]) {
    const response = await fetch(`${origin}${path}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    const html = await response.text();
    if (html.includes('id="catalog-search"')) {
      expect(html).toContain('id="catalog-signin"');
      expect(html).toContain('id="catalog-error" hidden');
      expect(html).toContain('id="catalog-results" class="catalog-results"></ul>');
      expect(html).toContain('src="/_astro/');
    } else if (html.includes('id="extension-overview"')) {
      expect(html).toContain('id="extension-overview" hidden');
      expect(html).toContain('id="extension-title"></h1>');
      expect(html).toContain('id="extension-signin"');
      expect(html).toContain('src="/_astro/');
    } else {
      // Detail pages and source-only development retain the legacy shell until parity.
      expect(html).toContain('id="signin" hidden');
      expect(html).toContain("/marketplace.js");
    }
    expect(html).not.toContain("publisher/tool");
    expect(html).not.toContain('property="og:title"');
  }
  expect(query).not.toHaveBeenCalled();
  expect(storage.send).not.toHaveBeenCalled();
});
it("prevents unauthenticated enumeration of catalog, assets, downloads and signed metadata", async () => {
  const { origin, query, storage } = await fixture();
  for (const path of [
    "/v1/extensions",
    "/v1/extensions/publisher/tool",
    "/v1/extensions/publisher/tool/overview",
    "/v1/extensions/publisher/tool/versions/1.0.0/download",
    "/v1/extensions/publisher/tool/versions/1.0.0/assets/icon",
    "/v1/extensions/publisher/tool/versions/1.0.0/assets/screenshot/0",
    "/v1/tuf/metadata/timestamp.json",
    "/v1/tuf/targets/extensions/publisher/tool/1.0.0.tabsext",
  ]) {
    const response = await fetch(`${origin}${path}`);
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Vary")).toContain("Authorization");
  }
  expect(query).not.toHaveBeenCalled();
  expect(storage.send).not.toHaveBeenCalled();
});
it("read tokens browse but cannot access publisher account surfaces or administration", async () => {
  const { origin, query } = await fixture("read");
  expect((await fetch(`${origin}/v1/extensions`, { headers: { authorization } })).status).toBe(200);
  for (const path of [
    "/v1/me",
    "/v1/publisher/namespaces",
    "/v1/tokens",
    "/v1/review",
    "/v1/publisher/publisher/tool/versions/1.0.0",
  ])
    expect((await fetch(`${origin}${path}`, { headers: { authorization } })).status).toBe(401);
  expect(query.mock.calls.filter(([sql]) => sql.includes("exchange_published_heads"))).toHaveLength(
    1,
  );
});
it("publish tokens cannot read private registry packages, manage tokens or escape their namespace", async () => {
  const { origin } = await fixture("publish");
  for (const path of [
    "/v1/extensions",
    "/v1/tokens",
    "/v1/publisher/other/tool/versions/1.0.0",
    "/v1/tuf/metadata/timestamp.json",
  ])
    expect((await fetch(`${origin}${path}`, { headers: { authorization } })).status).toBe(401);
});
