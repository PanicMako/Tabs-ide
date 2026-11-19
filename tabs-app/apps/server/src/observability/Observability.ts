import { layerOtlpSerialization, makeLocalFileTracer } from "@tabs/shared/observability";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Tracer from "effect/Tracer";
import { OtlpExporter, OtlpMetrics, OtlpTracer } from "effect/unstable/observability";

import { ServerConfig, otlpResource } from "../config";
import { ServerLoggerLive } from "../serverLogger";

const TRACE_MAX_BYTES = 20 * 1_024 * 1_024;
const TRACE_MAX_FILES = 4;
const TRACE_BATCH_WINDOW_MS = 250;

/** Writes real Effect spans to bounded, rotated NDJSON alongside the normal server log. */
export const ObservabilityLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    // With a traces endpoint set, every span is also sent there. The local file
    // tracer wraps the OTLP one, so the file keeps working whether or not a
    // collector is reachable.
    const traces = config.otlpTracesExport;
    const otlpTracer =
      config.otlpTracesUrl === undefined
        ? undefined
        : yield* OtlpTracer.make({
            url: config.otlpTracesUrl,
            exportInterval: `${traces.exportIntervalMs} millis`,
            headers: traces.headers,
            resource: otlpResource(config),
          }).pipe(
            Effect.provide(
              Layer.mergeAll(layerOtlpSerialization(traces.protocol), OtlpExporter.layerFlusher),
            ),
          );
    const tracer = yield* makeLocalFileTracer({
      ...(otlpTracer === undefined ? {} : { delegate: otlpTracer }),
      filePath: config.serverTracePath,
      maxBytes: TRACE_MAX_BYTES,
      maxFiles: TRACE_MAX_FILES,
      batchWindowMs: TRACE_BATCH_WINDOW_MS,
    });
    const metrics = config.otlpMetricsExport;
    const metricsExporter =
      config.otlpMetricsUrl === undefined
        ? Layer.empty
        : OtlpMetrics.layer({
            url: config.otlpMetricsUrl,
            exportInterval: `${metrics.exportIntervalMs} millis`,
            headers: metrics.headers,
            resource: otlpResource(config),
          }).pipe(Layer.provide(layerOtlpSerialization(metrics.protocol)));
    return Layer.mergeAll(ServerLoggerLive, Layer.succeed(Tracer.Tracer, tracer), metricsExporter);
  }),
);
export const layer = ObservabilityLive;
