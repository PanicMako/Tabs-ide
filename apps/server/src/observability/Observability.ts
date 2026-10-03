import { makeLocalFileTracer } from "@tabs/shared/observability";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Tracer from "effect/Tracer";

import { ServerConfig } from "../config";
import { ServerLoggerLive } from "../serverLogger";

const TRACE_MAX_BYTES = 20 * 1_024 * 1_024;
const TRACE_MAX_FILES = 4;
const TRACE_BATCH_WINDOW_MS = 250;

/** Writes real Effect spans to bounded, rotated NDJSON alongside the normal server log. */
export const ObservabilityLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const tracer = yield* makeLocalFileTracer({
      filePath: config.serverTracePath,
      maxBytes: TRACE_MAX_BYTES,
      maxFiles: TRACE_MAX_FILES,
      batchWindowMs: TRACE_BATCH_WINDOW_MS,
    });
    return Layer.mergeAll(ServerLoggerLive, Layer.succeed(Tracer.Tracer, tracer));
  }),
);
