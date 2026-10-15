// @effect-diagnostics nodeBuiltinImport:off
import { createBrotliCompress, createGzip, createDeflate, constants } from "node:zlib";
import * as NodeStream from "@effect/platform-node/NodeStream";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { HttpEffect, HttpMiddleware, HttpServerResponse } from "effect/unstable/http";

type Algorithm = "br" | "gzip" | "deflate";
const preferred: readonly Algorithm[] = ["br", "gzip", "deflate"];
const supported = new Set(preferred);

// Backport the reviewed Effect compression policy to the installed beta runtime.
export const compression = HttpMiddleware.make((app) =>
  Effect.andThen(
    HttpEffect.appendPreResponseHandler((request, response) => {
      const body = response.body;
      if (
        response.status < 200 ||
        [204, 206, 304].includes(response.status) ||
        response.headers["content-encoding"] !== undefined ||
        /(?:^|,)\s*no-transform\s*(?:,|$)/i.test(response.headers["cache-control"] ?? "") ||
        body._tag === "Empty" ||
        body._tag === "FormData"
      )
        return Effect.succeed(response);
      const contentType = response.headers["content-type"] ?? body.contentType;
      if (!contentType || !defaultCompressible(contentType)) return Effect.succeed(response);
      const headers = { ...response.headers };
      const vary = headers.vary?.split(",").map((value) => value.trim().toLowerCase());
      if (!vary?.includes("*") && !vary?.includes("accept-encoding")) {
        headers.vary = headers.vary ? `${headers.vary}, Accept-Encoding` : "Accept-Encoding";
      }
      const algorithm = negotiate(request.headers["accept-encoding"], preferred, supported);
      const length = body.contentLength ?? Number(headers["content-length"] ?? NaN);
      if (!algorithm || length < 1024)
        return Effect.succeed(HttpServerResponse.setHeaders(response, headers));
      const input =
        body._tag === "Uint8Array"
          ? Stream.succeed(body.body)
          : body._tag === "Stream"
            ? body.stream
            : Stream.fromReadableStream({
                evaluate: () =>
                  body.body instanceof globalThis.Response
                    ? (body.body.body ??
                      new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }))
                    : body.body instanceof ReadableStream
                      ? body.body
                      : (new globalThis.Response(
                          body.body as ConstructorParameters<typeof globalThis.Response>[0],
                        ).body ??
                        new ReadableStream<Uint8Array>({
                          start: (controller) => controller.close(),
                        })),
                onError: (cause) => cause,
              });
      const compressed = NodeStream.pipeThroughDuplex(input, {
        evaluate: () =>
          algorithm === "br"
            ? createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })
            : algorithm === "gzip"
              ? createGzip({ level: 6 })
              : createDeflate({ level: 6 }),
      });
      delete headers["content-length"];
      headers["content-encoding"] = algorithm;
      if (headers.etag && !headers.etag.startsWith("W/")) headers.etag = `W/${headers.etag}`;
      return Effect.succeed(
        HttpServerResponse.stream(compressed, {
          status: response.status,
          statusText: response.statusText,
          headers,
          cookies: response.cookies,
          contentType,
        }),
      );
    }),
    app,
  ),
);

export const defaultCompressible = (contentType: string): boolean => {
  const semi = contentType.indexOf(";");
  const type = (semi === -1 ? contentType : contentType.slice(0, semi)).trim().toLowerCase();
  if (type.startsWith("text/")) {
    return true;
  }
  switch (type) {
    case "application/json":
    case "application/javascript":
    case "application/xml":
    case "image/svg+xml":
    case "application/wasm": {
      return true;
    }
  }
  return type.endsWith("+json") || type.endsWith("+xml");
};

const acceptMember = /^([a-z0-9!#$%&'*+.^_`|~-]+)(?:;q=(0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?))?$/;

/** @internal */
export const parseAcceptEncoding = (header: string): ReadonlyMap<string, number> | undefined => {
  const trimmed = header.trim();
  if (trimmed === "") {
    return undefined;
  }
  const accepted = new Map<string, number>();
  for (const part of trimmed.split(",")) {
    const member = part
      .trim()
      .toLowerCase()
      .replace(/[ \t]*;[ \t]*/g, ";");
    const match = acceptMember.exec(member);
    if (match === null) {
      return undefined;
    }
    accepted.set(match[1]!, match[2] === undefined ? 1 : Number(match[2]));
  }
  return accepted;
};

/** @internal */
export const negotiate = (
  header: string | undefined,
  preferred: ReadonlyArray<Algorithm>,
  supported: ReadonlySet<Algorithm>,
): Algorithm | undefined => {
  if (header === undefined) {
    return undefined;
  }
  const accepted = parseAcceptEncoding(header);
  if (accepted === undefined) {
    return undefined;
  }
  for (const algorithm of preferred) {
    if (!supported.has(algorithm)) {
      continue;
    }
    const quality = accepted.get(algorithm) ?? accepted.get("*");
    if (quality !== undefined && quality > 0) {
      return algorithm;
    }
  }
  return undefined;
};
