import * as NodeModule from "node:module";
import * as Effect from "effect/Effect";

// Explicit persistence for processes that cannot rely on a graceful exit.
// This is a no-op when caching is disabled, including normal dev launches.
export const flushCompileCache = Effect.try({
  try: () => NodeModule.flushCompileCache(),
  catch: (error) => error,
}).pipe(Effect.ignore);

// Node persists its cache on the normal Unix shutdown path (including the
// backend's handled SIGTERM). Serializing it during startup blocks the first
// client requests. Windows uses taskkill /F, so it still needs the early flush.
export function flushCompileCacheForStartup(platform: NodeJS.Platform = process.platform) {
  return platform === "win32" ? flushCompileCache : Effect.void;
}

// HTTP/WebSocket shutdown may outlast the desktop's two-second grace period.
// Persist before runtime teardown starts, even when a later finalizer blocks.
export const persistCompileCacheOnShutdown = Effect.acquireRelease(
  Effect.sync(() => {
    let flushed = false;
    const flush = () => {
      if (flushed) return;
      flushed = true;
      Effect.runSync(flushCompileCache);
    };
    process.prependOnceListener("SIGINT", flush);
    process.prependOnceListener("SIGTERM", flush);
    return flush;
  }),
  (flush) =>
    Effect.sync(() => {
      process.off("SIGINT", flush);
      process.off("SIGTERM", flush);
    }),
);
