import type * as http from "node:http";
import Mime from "@effect/platform-node/Mime";
import * as Effect from "effect/Effect";
import { ASSET_ROUTE_PREFIX, resolveDraftWorkspaceAsset } from "./AssetAccess.ts";
import { openMediaFile } from "./MediaFile.ts";

export function parseMediaRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!header) return size > 0 ? { start: 0, end: size - 1 } : null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size <= 0) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(size - 1, Number(match[2])) : size - 1) : size - 1;
  return Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 0 &&
    end >= start &&
    start < size
    ? { start, end }
    : null;
}
/** Signed, exact-file previews with descriptor validation and media range requests. */
export const handleWorkspaceAssetRequest = Effect.fn("WorkspaceAssetRoute.handle")(function* (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
) {
  if (!url.pathname.startsWith(`${ASSET_ROUTE_PREFIX}/`)) return false;
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Range, Content-Length, Accept-Ranges",
  );
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", "private, no-store");
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Methods": "GET, HEAD",
      "Access-Control-Allow-Headers": "Range",
    });
    response.end();
    return true;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return true;
  }
  const remainder = url.pathname.slice(ASSET_ROUTE_PREFIX.length + 1);
  const slash = remainder.indexOf("/");
  const filePath =
    slash < 0
      ? null
      : yield* resolveDraftWorkspaceAsset(remainder.slice(0, slash), remainder.slice(slash + 1));
  if (!filePath) {
    response.writeHead(404);
    response.end();
    return true;
  }
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const file = yield* openMediaFile(filePath);
      if (!file) {
        response.writeHead(404);
        response.end();
        return true;
      }
      const size = Number(file.info.size);
      if (!Number.isSafeInteger(size)) {
        response.writeHead(413);
        response.end();
        return true;
      }
      const range = parseMediaRange(
        typeof request.headers.range === "string" ? request.headers.range : undefined,
        size,
      );
      if (request.headers.range && !range) {
        response.writeHead(416, { "Content-Range": `bytes */${size}` });
        response.end();
        return true;
      }
      const start = range?.start ?? 0,
        end = range?.end ?? -1;
      const mimeType = Mime.getType(filePath) ?? "application/octet-stream";
      response.writeHead(request.headers.range ? 206 : 200, {
        "Content-Type": mimeType,
        "Content-Length": String(Math.max(0, end - start + 1)),
        "Accept-Ranges": "bytes",
        // Active document types stay sandboxed; PDF and media viewers need their native handlers.
        ...(["text/html", "image/svg+xml", "application/xhtml+xml"].includes(mimeType)
          ? { "Content-Security-Policy": "default-src 'none'; sandbox" }
          : {}),
        ...(request.headers.range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
      });
      if (request.method === "HEAD" || size === 0) {
        response.end();
        return true;
      }
      yield* Effect.promise(
        () =>
          new Promise<void>((resolve, reject) => {
            const stream = file.handle.createReadStream({ autoClose: false, start, end });
            const cleanup = () => {
              response.removeListener("finish", finish);
              response.removeListener("close", close);
              stream.removeListener("error", failure);
            };
            const finish = () => {
              cleanup();
              resolve();
            };
            const close = () => {
              stream.destroy();
              cleanup();
              resolve();
            };
            const failure = (error: Error) => {
              cleanup();
              response.destroy(error);
              reject(error);
            };
            response.once("finish", finish);
            response.once("close", close);
            stream.once("error", failure);
            stream.pipe(response);
          }),
      );
      return true;
    }),
  );
});
