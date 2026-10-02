import * as FS from "node:fs/promises";
import * as Path from "node:path";
import type { ServerResponse } from "node:http";
import { renderListingMetadata, type ListingMetadata } from "./listingMetadata.ts";

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".tgz": "application/gzip",
  ".gz": "application/gzip",
  ".md": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

export function frontendAsset(pathname: string): string | undefined {
  if (pathname === "/admin" || pathname === "/admin/") return "admin/index.html";
  if (pathname === "/admin/reviewers" || pathname === "/admin/reviewers/")
    return "admin/reviewers/index.html";
  if (pathname === "/admin/security" || pathname === "/admin/security/")
    return "admin/security/index.html";
  if (pathname === "/docs/extensions/search.json") return "docs/extensions/search.json";
  if (pathname === "/extensions" || pathname === "/extensions/") return "extensions/index.html";
  if (/^\/extensions\/[a-z][a-z0-9-]{1,62}\/[a-z][a-z0-9-]{1,62}\/?$/.test(pathname))
    return "extensions/detail/index.html";
  if (pathname === "/account/tokens" || pathname === "/account/tokens/")
    return "account/tokens/index.html";
  if (pathname === "/publish" || pathname === "/publish/") return "publish/index.html";
  if (/^\/account\/submissions\/[a-f0-9]{64}\/?$/.test(pathname))
    return "account/submissions/detail/index.html";
  if (pathname === "/account/extensions" || pathname === "/account/extensions/")
    return "account/extensions/index.html";
  if (pathname === "/account" || pathname === "/account/") return "account/index.html";
  if (pathname === "/account/namespaces" || pathname === "/account/namespaces/")
    return "account/namespaces/index.html";
  if (pathname === "/developers/releases/manifest.json") return "developers/releases/manifest.json";
  const release =
    /^\/developers\/releases\/([0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{16})\/(tabs-extension-(?:api|cli)-[0-9]+\.[0-9]+\.[0-9]+\.tgz|tabs-developer-bundle\.tar\.gz|release\.json|README\.md|SHA256SUMS)$/.exec(
      pathname,
    );
  if (release) return `developers/releases/${release[1]}/${release[2]}`;
  if (pathname === "/") return "index.html";
  if (pathname === "/resources" || pathname === "/resources/") return "resources/index.html";
  if (pathname === "/developers" || pathname === "/developers/") return "developers/index.html";
  if (pathname === "/docs/extensions" || pathname === "/docs/extensions/")
    return "docs/extensions/index.html";
  const documentation = /^\/docs\/extensions\/([a-z][a-z0-9-]{0,80})\/?$/.exec(pathname);
  if (documentation) return `docs/extensions/${documentation[1]}/index.html`;
  if (/^\/_astro\/[A-Za-z0-9_.-]+\.(?:css|js|woff2)$/.test(pathname)) return pathname.slice(1);
  return undefined;
}

export async function serveFrontend(
  pathname: string,
  response: ServerResponse,
  directory = Path.join(import.meta.dirname, "../frontend/dist"),
  metadata?: () => Promise<ListingMetadata | undefined>,
): Promise<boolean> {
  const asset = frontendAsset(pathname);
  if (!asset) return false;
  let bytes: Buffer;
  try {
    bytes = await FS.readFile(Path.join(directory, asset));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (asset === "extensions/detail/index.html" && metadata) {
    const listing = await metadata();
    if (listing) bytes = Buffer.from(renderListingMetadata(bytes.toString("utf8"), listing));
  }
  response.writeHead(200, {
    "Content-Type": types[Path.extname(asset)] ?? "text/plain; charset=utf-8",
    "Content-Length": bytes.length,
    "Cache-Control": response.getHeader("Cache-Control") ?? "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(bytes);
  return true;
}
