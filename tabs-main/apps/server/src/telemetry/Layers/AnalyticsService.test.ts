import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ConfigProvider, Effect, FileSystem, Layer } from "effect";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { ServerConfig } from "../../config.ts";
import { getTelemetryIdentifier } from "../Identify.ts";
import { AnalyticsService } from "../Services/AnalyticsService.ts";
import {
  AnalyticsServiceLayerLive,
  telemetryRetryDelayMs,
  safeTelemetryProperties,
} from "./AnalyticsService.ts";

it("backs telemetry retries off to a five-minute ceiling", () => {
  assert.equal(telemetryRetryDelayMs(1), 5_000);
  assert.equal(telemetryRetryDelayMs(2), 10_000);
  assert.equal(telemetryRetryDelayMs(7), 300_000);
  assert.equal(telemetryRetryDelayMs(100), 300_000);
});

interface RecordedBatchRequest {
  readonly path: string;
  readonly body: {
    readonly batch?: ReadonlyArray<{
      readonly event?: string;
      readonly properties?: {
        readonly attachmentCount?: number;
        readonly clientType?: string;
      };
    }>;
  } | null;
}

interface RecordedBatchBody {
  readonly batch: ReadonlyArray<{
    readonly event?: string;
    readonly properties?: {
      readonly attachmentCount?: number;
      readonly clientType?: string;
    };
  }>;
}

it.layer(NodeServices.layer)("AnalyticsService test", (it) => {
  it.effect("defaults off, removes legacy identity, and never sends before consent", () =>
    Effect.gen(function* () {
      const configLayer = ServerConfig.layerTest(process.cwd(), { prefix: "tabs-no-consent-" });
      yield* Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const config = yield* ServerConfig;
        yield* fs.writeFileString(config.anonymousIdPath, "legacy-identifier");
        yield* Effect.gen(function* () {
          const analytics = yield* AnalyticsService;
          yield* analytics.record("server.boot.heartbeat", { threadCount: 1 });
          yield* analytics.flush;
          assert.equal(yield* fs.exists(config.anonymousIdPath), false);
        }).pipe(Effect.provide(AnalyticsServiceLayerLive));
      }).pipe(
        Effect.provide(configLayer),
        Effect.provide(NodeHttpServer.layerTest),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
      );
    }),
  );

  it.effect("flush drains all buffered events across multiple batches", () =>
    Effect.gen(function* () {
      const capturedRequests: Array<RecordedBatchRequest> = [];
      const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
        prefix: "tabs-telemetry-base-",
      });

      const telemetryLayer = AnalyticsServiceLayerLive.pipe(Layer.provideMerge(serverConfigLayer));
      const configLayer = ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          TABS_TELEMETRY_ENABLED: true,
          TABS_POSTHOG_KEY: "phc_test_key",
          TABS_POSTHOG_HOST: "",
          TABS_TELEMETRY_FLUSH_BATCH_SIZE: 20,
        }),
      );
      const batchServerLayer = HttpServer.serve(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (request.method !== "POST") {
            return HttpServerResponse.empty({ status: 404 });
          }

          const payload = yield* request.json.pipe(
            Effect.map((body) => body as RecordedBatchRequest["body"]),
            Effect.orElseSucceed(() => null),
          );

          capturedRequests.push({ path: request.url, body: payload });

          return HttpServerResponse.jsonUnsafe({});
        }),
      );
      const runtimeLayer = telemetryLayer.pipe(
        Layer.provide(configLayer),
        Layer.provideMerge(NodeHttpServer.layerTest),
      );

      yield* Effect.gen(function* () {
        yield* Layer.launch(batchServerLayer).pipe(Effect.forkScoped);
        const telemetryIdentifier = yield* getTelemetryIdentifier;
        assert.equal(telemetryIdentifier !== null, true);
        const analytics = yield* AnalyticsService;

        for (let index = 0; index < 45; index += 1) {
          yield* analytics.record("test.flush.drain", { attachmentCount: index });
        }

        yield* analytics.flush;
      }).pipe(Effect.provide(runtimeLayer));

      const batchRequests = capturedRequests.filter(
        (request): request is RecordedBatchRequest & { readonly body: RecordedBatchBody } =>
          Array.isArray(request.body?.batch),
      );
      assert.equal(batchRequests.length, 3);
      assert.equal(
        batchRequests.every((request) => request.path === "/batch/" || request.path === "/batch"),
        true,
      );
      const deliveredIndexes = batchRequests.flatMap((request) =>
        request.body.batch
          .filter((event) => event.event === "test.flush.drain")
          .map((event) => event.properties?.attachmentCount)
          .filter((index): index is number => typeof index === "number"),
      );

      const sorted = deliveredIndexes.toSorted((a, b) => a - b);
      assert.equal(sorted.length, 45);
      assert.deepEqual(
        sorted,
        Array.from({ length: 45 }, (_, index) => index),
      );
      assert.equal(
        batchRequests.every((request) =>
          request.body.batch.every((event) => event.properties?.clientType === "cli-web-client"),
        ),
        true,
      );
    }),
  );
});

it("drops secret-bearing and unbounded telemetry properties", () => {
  assert.deepEqual(
    safeTelemetryProperties({
      provider: "codex",
      hasInput: true,
      attachmentCount: 2,
      model: "private/custom-model",
      apiKey: "secret",
      cwd: "/private/repo",
      input: "private prompt",
      providerInstanceId: "personal-account",
      decision: "secret",
      count: Infinity,
    }),
    { provider: "codex", hasInput: true, attachmentCount: 2 },
  );
});
