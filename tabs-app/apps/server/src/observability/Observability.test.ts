import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as NodeOS from "node:os";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Tracer from "effect/Tracer";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import { DEFAULT_SIGNAL_EXPORT } from "@tabs/shared/observability";
import * as OtelEnvironment from "@tabs/shared/otelEnvironment";

import * as ServerConfig from "../config.ts";
import * as Observability from "./Observability.ts";

interface ExportedRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** Answers every export with a 200 and keeps what was posted for assertions. */
const layerCollector = (requests: Array<ExportedRequest>) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() => {
        requests.push({
          url: request.url,
          headers: request.headers,
          body:
            request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
        });
        return HttpClientResponse.fromWeb(request, new Response(null, { status: 200 }));
      }),
    ),
  );

const layerConfig = (overrides: Partial<ServerConfig.ServerConfig["Service"]>) =>
  Layer.effect(
    ServerConfig.ServerConfig,
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const baseDir = path.join(NodeOS.tmpdir(), "tabs-observability-test");
      const derivedPaths = yield* ServerConfig.deriveServerPaths(baseDir, undefined);
      return ServerConfig.make({
        logLevel: "Info",
        traceMinLevel: "Info",
        traceTimingEnabled: false,
        traceBatchWindowMs: 200,
        traceMaxBytes: 1024,
        traceMaxFiles: 1,
        otlpTracesUrl: undefined,
        otlpMetricsUrl: undefined,
        otlpLogsUrl: undefined,
        otlpTracesExport: DEFAULT_SIGNAL_EXPORT,
        otlpMetricsExport: DEFAULT_SIGNAL_EXPORT,
        otlpLogsExport: DEFAULT_SIGNAL_EXPORT,
        otelEnvironment: OtelEnvironment.none,
        cwd: baseDir,
        baseDir,
        ...derivedPaths,
        mode: "web",
        autoBootstrapProjectFromCwd: false,
        logWebSocketEvents: false,
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
        port: 0,
        host: undefined,
        desktopBootstrapToken: undefined,
        desktopTelemetryFd: undefined,
        desktopTelemetryControlFd: undefined,
        resourceMonitorPath: undefined,
        staticDir: undefined,
        devUrl: undefined,
        devAllowedOrigins: [],
        noBrowser: false,
        startupPresentation: "browser",
        ...overrides,
      });
    }),
  ).pipe(Layer.provide(NodePath.layer));

const spanThrough = (overrides: Partial<ServerConfig.ServerConfig["Service"]>) =>
  Effect.gen(function* () {
    const requests: Array<ExportedRequest> = [];
    yield* Effect.void.pipe(
      Effect.withSpan("observability-under-test"),
      Effect.provide(
        Observability.layer.pipe(
          Layer.provide(layerConfig({ traceTimingEnabled: false, ...overrides })),
          Layer.provide(layerCollector(requests)),
          Layer.provide(NodeServices.layer),
        ),
      ),
    );
    return requests;
  });

describe("server observability", () => {
  it.effect("sends spans to the traces endpoint when one is configured", () =>
    Effect.gen(function* () {
      const requests = yield* spanThrough({ otlpTracesUrl: "http://collector.test/v1/traces" });
      const traces = requests.filter(
        (request) => request.url === "http://collector.test/v1/traces",
      );
      assert.isAbove(traces.length, 0);
      assert.include(traces.map((request) => request.body).join("\n"), "observability-under-test");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("sends metrics to the metrics endpoint when one is configured", () =>
    Effect.gen(function* () {
      const requests = yield* spanThrough({
        otlpMetricsUrl: "http://collector.test/v1/metrics",
      });
      assert.isAbove(
        requests.filter((request) => request.url === "http://collector.test/v1/metrics").length,
        0,
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("exports nothing when no traces endpoint is configured", () =>
    Effect.gen(function* () {
      const requests = yield* spanThrough({ otlpTracesUrl: undefined });
      assert.deepStrictEqual(
        requests.filter((request) => request.url.includes("traces")),
        [],
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
