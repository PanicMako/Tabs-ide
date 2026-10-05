import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ConfigProvider, Effect, FileSystem, Layer } from "effect";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { ServerSettingsService } from "../../serverSettings.ts";
import { ServerConfig } from "../../config.ts";
import { getTelemetryIdentifier } from "../Identify.ts";
import { AnalyticsService } from "../Services/AnalyticsService.ts";
import { AnalyticsServiceLayerLive, telemetryRetryDelayMs } from "./AnalyticsService.ts";
import { basicUsageEvent, isActiveUsageReport, dailyUsageEventUuid } from "../UsageEvents.ts";

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
      readonly uuid?: string;
      readonly distinct_id?: string;
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
  it.effect("without a Tabs project key, removes legacy identity and sends nothing", () =>
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
        }).pipe(
          Effect.provide(AnalyticsServiceLayerLive),
          Effect.provide(ServerSettingsService.layerTest()),
        );
      }).pipe(
        Effect.provide(configLayer),
        Effect.provide(NodeHttpServer.layerTest),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ TABS_POSTHOG_KEY: "" }))),
      );
    }),
  );

  it.effect("defaults on with a Tabs key, sends only daily markers, and drains batches", () =>
    Effect.gen(function* () {
      const capturedRequests: Array<RecordedBatchRequest> = [];
      const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
        prefix: "tabs-telemetry-base-",
      });

      const telemetryLayer = AnalyticsServiceLayerLive.pipe(Layer.provideMerge(serverConfigLayer));
      const configLayer = ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          TABS_POSTHOG_KEY: "phc_test_key",
          TABS_POSTHOG_HOST: "",
          TABS_TELEMETRY_FLUSH_BATCH_SIZE: 1,
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
        Layer.provide(ServerSettingsService.layerTest()),
        Layer.provideMerge(NodeHttpServer.layerTest),
      );

      yield* Effect.gen(function* () {
        yield* Layer.launch(batchServerLayer).pipe(Effect.forkScoped);
        const telemetryIdentifier = yield* getTelemetryIdentifier;
        assert.equal(telemetryIdentifier !== null, true);
        const analytics = yield* AnalyticsService;

        for (let index = 0; index < 45; index += 1) {
          yield* analytics.record("provider.turn.sent", {
            provider: "codex",
            model: "private/custom-model",
            input: "private prompt",
            reasoningEffort: "high",
            attachmentCount: index,
          });
        }
        yield* analytics.record("server.boot.heartbeat", { projectCount: 100 });
        yield* analytics.record("provider.session.started", { provider: "claude" });
        yield* analytics.record("untrusted-event-name/private/repo");

        yield* analytics.flush;
      }).pipe(Effect.provide(runtimeLayer));

      const batchRequests = capturedRequests.filter(
        (request): request is RecordedBatchRequest & { readonly body: RecordedBatchBody } =>
          Array.isArray(request.body?.batch),
      );
      assert.equal(batchRequests.length, 2);
      assert.equal(
        batchRequests.every((request) => request.path === "/batch/" || request.path === "/batch"),
        true,
      );
      const events = batchRequests.flatMap((request) => request.body.batch);
      assert.deepEqual(events.map((event) => event.event).toSorted(), [
        "tabs.installation.active",
        "tabs.installation.opened",
      ]);
      for (const event of events) {
        assert.deepEqual(Object.keys(event.properties ?? {}).toSorted(), [
          "$geoip_disable",
          "$process_person_profile",
          "arch",
          "clientType",
          "platform",
          "tabsVersion",
        ]);
        assert.equal(event.properties?.clientType, "cli-web-client");
      }
      assert.equal(JSON.stringify(capturedRequests).includes("private"), false);
    }),
  );
  it.effect("opt-out drops queued markers and deletes identity; re-enabling rotates identity", () =>
    Effect.gen(function* () {
      const captured: Array<RecordedBatchRequest["body"]> = [];
      const batchServer = HttpServer.serve(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          captured.push(
            yield* request.json.pipe(Effect.map((body) => body as RecordedBatchRequest["body"])),
          );
          return HttpServerResponse.jsonUnsafe({});
        }),
      );
      const settingsLayer = ServerSettingsService.layerTest();
      const runtime = AnalyticsServiceLayerLive.pipe(
        Layer.provideMerge(settingsLayer),
        Layer.provideMerge(
          ServerConfig.layerTest(process.cwd(), { prefix: "tabs-analytics-toggle-" }),
        ),
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              TABS_POSTHOG_KEY: "phc_test_key",
              TABS_POSTHOG_HOST: "",
            }),
          ),
        ),
        Layer.provideMerge(NodeHttpServer.layerTest),
      );
      yield* Effect.gen(function* () {
        yield* Layer.launch(batchServer).pipe(Effect.forkScoped);
        const analytics = yield* AnalyticsService;
        const settings = yield* ServerSettingsService;
        const fs = yield* FileSystem.FileSystem;
        const config = yield* ServerConfig;
        const oldId = yield* fs.readFileString(config.anonymousIdPath);
        yield* analytics.record("provider.turn.sent");
        yield* settings.updateSettings({ enableUsageAnalytics: false });
        yield* analytics.flush;
        assert.equal(captured.length, 0);
        assert.equal(yield* fs.exists(config.anonymousIdPath), false);
        yield* analytics.record("provider.turn.sent");
        yield* analytics.flush;
        assert.equal(captured.length, 0);
        yield* settings.updateSettings({ enableUsageAnalytics: true });
        yield* analytics.record("client.interacted");
        yield* analytics.flush;
        const newId = yield* fs.readFileString(config.anonymousIdPath);
        assert.notEqual(newId, oldId);
        assert.equal(captured.length, 1);
        assert.equal(captured[0]?.batch?.[0]?.distinct_id, newId);
        assert.equal(captured[0]?.batch?.[0]?.event, "tabs.installation.active");
      }).pipe(Effect.provide(runtime));
    }),
  );

  it.effect("the environment kill switch takes priority over an enabled setting", () =>
    Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const analytics = yield* AnalyticsService;
        const fs = yield* FileSystem.FileSystem;
        const config = yield* ServerConfig;
        yield* analytics.record("provider.turn.sent");
        yield* analytics.flush;
        assert.equal(yield* fs.exists(config.anonymousIdPath), false);
      }).pipe(
        Effect.provide(AnalyticsServiceLayerLive),
        Effect.provide(ServerSettingsService.layerTest()),
        Effect.provide(ServerConfig.layerTest(process.cwd(), { prefix: "tabs-analytics-kill-" })),
        Effect.provide(NodeHttpServer.layerTest),
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              TABS_POSTHOG_KEY: "phc_test_key",
              TABS_TELEMETRY_ENABLED: false,
            }),
          ),
        ),
      );
    }),
  );
});

it("permits only the two adoption markers", () => {
  assert.equal(basicUsageEvent("provider.turn.sent"), "tabs.installation.active");
  assert.equal(basicUsageEvent("provider.turn.completed"), undefined);
  assert.equal(basicUsageEvent("provider.session.started"), undefined);
});

it("deduplicates daily events across retries and restarts without linking installations", () => {
  const first = dailyUsageEventUuid("install-a", "tabs.installation.active", "2026-10-05");
  assert.equal(first, dailyUsageEventUuid("install-a", "tabs.installation.active", "2026-10-05"));
  assert.notEqual(
    first,
    dailyUsageEventUuid("install-b", "tabs.installation.active", "2026-10-05"),
  );
  assert.notEqual(
    first,
    dailyUsageEventUuid("install-a", "tabs.installation.active", "2026-10-06"),
  );
  assert.notEqual(
    first,
    dailyUsageEventUuid("install-a", "tabs.installation.opened", "2026-10-05"),
  );
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

it("counts foreground interaction but excludes hidden, idle, and unfocused clients", () => {
  const active = {
    visible: true,
    focused: true,
    recentlyInteracted: true,
    appState: "active" as const,
  };
  assert.equal(isActiveUsageReport(active), true);
  assert.equal(isActiveUsageReport({ ...active, visible: false }), false);
  assert.equal(isActiveUsageReport({ ...active, focused: false }), false);
  assert.equal(isActiveUsageReport({ ...active, recentlyInteracted: false }), false);
  assert.equal(isActiveUsageReport({ ...active, appState: "background" }), false);
  assert.equal(basicUsageEvent("client.interacted"), "tabs.installation.active");
});
