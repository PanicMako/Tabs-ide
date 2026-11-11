import * as FS from "node:fs";
import * as Path from "node:path";

/** Content types for files Tabs serves from disk over its custom schemes. */
export function protocolContentType(pathname: string): string {
  switch (Path.extname(pathname).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".md":
      return "text/markdown; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".ttf":
      return "font/ttf";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
}

/**
 * Read a file into a committed Response. Custom partitions can return empty
 * bodies through `session.fetch(file://...)`, so this reads the exact bytes.
 */
export async function readProtocolFile(
  pathname: string,
  initialHeaders?: HeadersInit,
): Promise<Response> {
  const contents = await FS.promises.readFile(pathname);
  const headers = new Headers(initialHeaders);
  headers.set("Content-Type", protocolContentType(pathname));
  return new Response(contents, { status: 200, headers });
}
