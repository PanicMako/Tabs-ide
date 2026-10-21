// @effect-diagnostics nodeBuiltinImport:off
import type * as NodeHttp from "node:http";

/**
 * Node surfaces late socket write failures (EPIPE, ECONNRESET,
 * ERR_STREAM_DESTROYED) as "error" events. An "error" event without a
 * listener escalates into an uncaught exception and terminates the whole
 * server process, taking every other client and all in-flight provider
 * work with it.
 *
 * Two emitters need coverage:
 *
 * - Upgrade sockets. Once a connection upgrades (the websocket RPC path,
 *   including its auth rejection responses), Node's http server detaches
 *   its own socket error handling, so the raw socket has no listener at
 *   all until the websocket server adopts it.
 * - Server responses. Response streams have no default error listener
 *   either.
 *
 * A disconnected client only affects its own request: the request fiber is
 * already interrupted through the response "close" event, so the write
 * failure needs no handling beyond being observed.
 */
export function guardHttpResponseWriteErrors<T extends NodeHttp.Server>(
  server: T,
  onError?: (error: unknown) => void,
  options: { startupWaitMs?: number; maxPendingRequests?: number } = {},
): T {
  const guardedResponses = new WeakSet<NodeHttp.ServerResponse>();
  const pending = new Set<{
    request: NodeHttp.IncomingMessage;
    response: NodeHttp.ServerResponse;
    cancel: () => void;
  }>();
  const unavailable = (request: NodeHttp.IncomingMessage, response: NodeHttp.ServerResponse) => {
    request.resume();
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(503, { "Retry-After": "1", "Cache-Control": "no-store" });
    response.end();
  };
  // newListener fires before attachment. Forward on the next microtask, once
  // the real handler can apply its normal routing, authentication and CORS.
  server.on("newListener", (event) => {
    if (event !== "request") return;
    queueMicrotask(() => {
      if (server.listenerCount("request") <= 1) return;
      for (const item of pending) {
        item.cancel();
        if (!item.response.destroyed && !item.response.writableEnded) {
          server.emit("request", item.request, item.response);
        }
      }
    });
  });
  server.on("request", (request, response) => {
    if (!guardedResponses.has(response)) {
      guardedResponses.add(response);
      response.on("error", (error) => onError?.(error));
    }
    // The platform opens its socket before attaching application routes.
    // Retain a bounded number of requests briefly instead of returning a
    // response without the application's CORS policy on every startup retry.
    if (server.listenerCount("request") === 1) {
      if (pending.size >= (options.maxPendingRequests ?? 64)) {
        unavailable(request, response);
        return;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const item = {
        request,
        response,
        cancel: () => {
          pending.delete(item);
          clearTimeout(timer);
          response.removeListener("close", item.cancel);
        },
      };
      pending.add(item);
      response.once("close", item.cancel);
      timer = setTimeout(() => {
        item.cancel();
        unavailable(request, response);
      }, options.startupWaitMs ?? 5_000);
      timer.unref();
    }
  });
  server.on("upgrade", (_request, socket) => {
    socket.on("error", (error) => {
      onError?.(error);
    });
  });
  return server;
}
