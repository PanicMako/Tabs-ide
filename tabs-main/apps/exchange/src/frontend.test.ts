import { describe, expect, it } from "vitest";
import * as FS from "node:fs/promises";
import * as OS from "node:os";
import * as Path from "node:path";
import * as Http from "node:http";
import type { AddressInfo } from "node:net";
import { frontendAsset, serveFrontend } from "./frontend.ts";
import { listingMetadata } from "./listingMetadata.ts";

describe("Exchange frontend routes", () => {
  it("renders public listing metadata into the built detail document with correct headers", async () => {
    const directory = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-exchange-metadata-"));
    await FS.mkdir(Path.join(directory, "extensions/detail"), { recursive: true });
    await FS.writeFile(
      Path.join(directory, "extensions/detail/index.html"),
      '<html><head><title>Generic</title><meta name="description" content="Generic"></head><body></body></html>',
    );
    const server = Http.createServer(async (_request, response) => {
      response.setHeader("Cache-Control", "private, no-store");
      await serveFrontend("/extensions/acme/tool", response, directory, async () =>
        listingMetadata(
          { displayName: "Tool & team", description: 'Purpose <script> "text"' },
          "https://exchange.example",
          "/extensions/acme/tool",
        ),
      );
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
      const html = await response.text();
      expect(html).toContain("<title>Tool &amp; team · Tabs Exchange</title>");
      expect(html).toContain(
        'property="og:description" content="Purpose &lt;script&gt; &quot;text&quot;"',
      );
      expect(html).not.toContain("<script>");
      expect(response.headers.get("Content-Length")).toBe(String(Buffer.byteLength(html)));
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await FS.rm(directory, { recursive: true, force: true });
    }
  });
  it("serves only known build assets with CSP and preserves private caching", async () => {
    const directory = await FS.mkdtemp(Path.join(OS.tmpdir(), "tabs-exchange-frontend-"));
    await FS.writeFile(Path.join(directory, "index.html"), "<h1>Tabs Exchange</h1>");
    const server = Http.createServer(async (request, response) => {
      response.setHeader("Cache-Control", "private, no-store");
      if (
        !(await serveFrontend(
          new URL(request.url!, "http://localhost").pathname,
          response,
          directory,
        ))
      )
        response.writeHead(404).end();
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const page = await fetch(origin);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("Tabs Exchange");
      expect(page.headers.get("cache-control")).toBe("private, no-store");
      expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(page.headers.get("content-security-policy")).not.toContain("unsafe-inline");
      expect(page.headers.get("x-content-type-options")).toBe("nosniff");
      expect((await fetch(`${origin}/config.ts`)).status).toBe(404);
      expect((await fetch(`${origin}/docs/extensions/missing`)).status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await FS.rm(directory, { recursive: true, force: true });
    }
  });
  it("resolves the shared shell and documentation without touching API routes", () => {
    expect(frontendAsset("/admin")).toBe("admin/index.html");
    expect(frontendAsset("/admin/")).toBe("admin/index.html");
    expect(frontendAsset("/admin/reviewers")).toBe("admin/reviewers/index.html");
    expect(frontendAsset("/admin/reviewers/")).toBe("admin/reviewers/index.html");
    expect(frontendAsset("/_astro/dm-sans-latin-regular.woff2")).toBe(
      "_astro/dm-sans-latin-regular.woff2",
    );
    expect(frontendAsset("/_astro/../secret.woff2")).toBeUndefined();
    expect(frontendAsset("/admin/unknown")).toBeUndefined();
    expect(frontendAsset("/publish")).toBe("publish/index.html");
    expect(frontendAsset("/extensions")).toBe("extensions/index.html");
    expect(frontendAsset("/extensions/")).toBe("extensions/index.html");
    expect(frontendAsset("/extensions/acme/tool")).toBe("extensions/detail/index.html");
    expect(frontendAsset("/extensions/Acme/tool")).toBeUndefined();
    expect(frontendAsset("/account/tokens")).toBe("account/tokens/index.html");
    expect(frontendAsset("/admin/security")).toBe("admin/security/index.html");
    expect(frontendAsset("/admin/security/")).toBe("admin/security/index.html");
    expect(frontendAsset("/admin/security/../config.ts")).toBeUndefined();
    expect(frontendAsset("/publish/")).toBe("publish/index.html");
    expect(frontendAsset("/developers/releases/manifest.json")).toBe(
      "developers/releases/manifest.json",
    );
    expect(
      frontendAsset("/developers/releases/1.6.0-0123456789abcdef/tabs-developer-bundle.tar.gz"),
    ).toBe("developers/releases/1.6.0-0123456789abcdef/tabs-developer-bundle.tar.gz");
    expect(
      frontendAsset("/developers/releases/1.6.0-0123456789abcdef/../../config.ts"),
    ).toBeUndefined();
    expect(
      frontendAsset("/developers/releases/1.6.0-0123456789abcdef/package.json"),
    ).toBeUndefined();
    expect(frontendAsset("/")).toBe("index.html");
    expect(frontendAsset("/account")).toBe("account/index.html");
    expect(frontendAsset("/account/namespaces")).toBe("account/namespaces/index.html");
    expect(frontendAsset("/developers/")).toBe("developers/index.html");
    expect(frontendAsset("/resources")).toBe("resources/index.html");
    expect(frontendAsset("/resources/")).toBe("resources/index.html");
    expect(frontendAsset("/resources/unknown")).toBeUndefined();
    expect(frontendAsset("/docs/extensions")).toBe("docs/extensions/index.html");
    expect(frontendAsset("/docs/extensions/permissions")).toBe(
      "docs/extensions/permissions/index.html",
    );
    expect(frontendAsset("/_astro/Exchange.ABC123.css")).toBe("_astro/Exchange.ABC123.css");
    expect(frontendAsset("/v1/extensions")).toBeUndefined();
    expect(frontendAsset("/publisher")).toBeUndefined();
  });
  it.each([
    "/../config.ts",
    "/_astro/../../src/config.ts",
    "/_astro/%2e%2e/config.js",
    "/_astro/secret.json",
    "/docs/extensions/../secrets",
    "/docs/extensions/%2fetc",
    "/resources/../config.ts",
    "/resources/%2e%2e/config.ts",
    "/_astro/a.js/extra",
  ])("rejects arbitrary files and traversal: %s", (path) => {
    expect(frontendAsset(path)).toBeUndefined();
  });
});
