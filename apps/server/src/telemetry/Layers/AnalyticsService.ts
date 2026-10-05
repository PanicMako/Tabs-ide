/**
 * AnalyticsServiceLive - Basic pseudonymous PostHog telemetry layer.
 *
 * Persists a random installation-scoped anonymous id to state dir, buffers
 * events in memory, and flushes batches to PostHog over Effect HttpClient.
 *
 * @module AnalyticsServiceLive
 */

import { Config, DateTime, Effect, FileSystem, Layer, Ref } from "effect";
import * as Semaphore from "effect/Semaphore";
import { basicUsageEvent, dailyUsageEventUuid } from "../UsageEvents.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { TABS_ANALYTICS_PROJECT } from "../ProjectConfig.ts";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { ServerConfig } from "../../config.ts";
import { AnalyticsService, type AnalyticsServiceShape } from "../Services/AnalyticsService.ts";
import { clearTelemetryIdentifier, getTelemetryIdentifier } from "../Identify.ts";
import { version } from "../../../package.json" with { type: "json" };

interface BufferedAnalyticsEvent {
  readonly event: string;
  readonly uuid: string;
  readonly identifier: string;
  readonly capturedAt: string;
}

const TELEMETRY_RETRY_BASE_MS = 5_000;
const TELEMETRY_RETRY_MAX_MS = 5 * 60_000;

export function telemetryRetryDelayMs(consecutiveFailures: number): number {
  const exponent = Math.max(0, Math.min(16, Math.floor(consecutiveFailures) - 1));
  return Math.min(TELEMETRY_RETRY_MAX_MS, TELEMETRY_RETRY_BASE_MS * 2 ** exponent);
}

const TelemetryEnvConfig = Config.all({
  posthogKey: Config.string("TABS_POSTHOG_KEY").pipe(
    Config.withDefault(TABS_ANALYTICS_PROJECT.key),
  ),
  posthogHost: Config.string("TABS_POSTHOG_HOST").pipe(
    Config.withDefault(TABS_ANALYTICS_PROJECT.host),
  ),
  enabled: Config.boolean("TABS_TELEMETRY_ENABLED").pipe(Config.withDefault(true)),
  flushBatchSize: Config.number("TABS_TELEMETRY_FLUSH_BATCH_SIZE").pipe(Config.withDefault(20)),
  maxBufferedEvents: Config.number("TABS_TELEMETRY_MAX_BUFFERED_EVENTS").pipe(
    Config.withDefault(1_000),
  ),
});

const makeAnalyticsService = Effect.gen(function* () {
  const telemetryConfig = yield* TelemetryEnvConfig;
  const httpClient = yield* HttpClient.HttpClient;
  const serverConfig = yield* ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  // An unconfigured project or the environment kill switch must be a complete no-op.
  if (!telemetryConfig.enabled || !telemetryConfig.posthogKey.trim()) {
    yield* clearTelemetryIdentifier.pipe(Effect.ignore);
    return { record: () => Effect.void, flush: Effect.void } satisfies AnalyticsServiceShape;
  }
  const settingsService = yield* ServerSettingsService;
  const identifierRef = yield* Ref.make<string | null>(null);
  const bufferRef = yield* Ref.make<ReadonlyArray<BufferedAnalyticsEvent>>([]);
  const recordedDaysRef = yield* Ref.make<Readonly<Record<string, string>>>({});
  const stateLock = yield* Semaphore.make(1);
  const deliveryLock = yield* Semaphore.make(1);
  const synchronizeConsent = Effect.gen(function* () {
    const enabled = yield* settingsService.getSettings.pipe(
      Effect.map((settings) => settings.enableUsageAnalytics),
      Effect.orElseSucceed(() => false),
    );
    if (!enabled) {
      yield* Ref.set(bufferRef, []);
      yield* Ref.set(recordedDaysRef, {});
      yield* Ref.set(identifierRef, null);
      yield* clearTelemetryIdentifier.pipe(Effect.ignore);
      return null;
    }
    const existing = yield* Ref.get(identifierRef);
    if (existing) return existing;
    const identifier = yield* getTelemetryIdentifier;
    yield* Ref.set(identifierRef, identifier);
    return identifier;
  }).pipe(
    Effect.provideService(FileSystem.FileSystem, fileSystem),
    Effect.provideService(ServerConfig, serverConfig),
  );
  yield* stateLock.withPermits(1)(synchronizeConsent);
  const consecutiveFailuresRef = yield* Ref.make(0);
  const retryAfterRef = yield* Ref.make(0);
  const clientType = serverConfig.mode === "desktop" ? "desktop-app" : "cli-web-client";

  const enqueueBufferedEvent = (event: string, identifier: string) =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const day = DateTime.formatIso(now).slice(0, 10);
      const recorded = yield* Ref.get(recordedDaysRef);
      if (recorded[event] === day) return;
      yield* Ref.set(recordedDaysRef, { ...recorded, [event]: day });
      yield* Ref.update(bufferRef, (current) =>
        [
          ...current,
          {
            event,
            identifier,
            uuid: dailyUsageEventUuid(identifier, event, day),
            // Day-level timestamps avoid collecting precise launch or prompt times.
            capturedAt: `${day}T00:00:00.000Z`,
          },
        ].slice(-Math.max(1, telemetryConfig.maxBufferedEvents)),
      );
    });

  const sendBatch = (events: ReadonlyArray<BufferedAnalyticsEvent>) =>
    Effect.gen(function* () {
      const identifier = yield* stateLock.withPermits(1)(synchronizeConsent);
      const currentEvents = events.filter((event) => event.identifier === identifier);
      if (!identifier || currentEvents.length === 0) return;

      const payload = {
        api_key: telemetryConfig.posthogKey,
        batch: currentEvents.map((event) => ({
          event: event.event,
          uuid: event.uuid,
          distinct_id: identifier,
          properties: {
            $geoip_disable: true,
            $process_person_profile: false,
            platform: process.platform,
            arch: process.arch,
            tabsVersion: version,
            clientType,
          },
          timestamp: event.capturedAt,
        })),
      };

      yield* HttpClientRequest.post(`${telemetryConfig.posthogHost}/batch/`).pipe(
        HttpClientRequest.bodyJson(payload),
        Effect.flatMap(httpClient.execute),
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.timeout("5 seconds"),
      );
    });

  const flush: AnalyticsServiceShape["flush"] = Effect.gen(function* () {
    if (!(yield* stateLock.withPermits(1)(synchronizeConsent))) return;
    if (Date.now() < (yield* Ref.get(retryAfterRef))) return;
    while (true) {
      const batch = yield* Ref.modify(bufferRef, (current) => {
        if (current.length === 0) {
          return [[] as ReadonlyArray<BufferedAnalyticsEvent>, current] as const;
        }
        const nextBatch = current.slice(0, Math.max(1, telemetryConfig.flushBatchSize));
        const remaining = current.slice(nextBatch.length);
        return [nextBatch, remaining] as const;
      });

      if (batch.length === 0) {
        return;
      }

      yield* sendBatch(batch).pipe(
        Effect.tap(() =>
          Effect.all([Ref.set(consecutiveFailuresRef, 0), Ref.set(retryAfterRef, 0)]).pipe(
            Effect.asVoid,
          ),
        ),
        Effect.catch((error) =>
          Ref.update(bufferRef, (current) =>
            [...batch, ...current].slice(-Math.max(1, telemetryConfig.maxBufferedEvents)),
          ).pipe(Effect.flatMap(() => Effect.fail(error))),
        ),
      );
    }
  }).pipe(
    Effect.catch(() =>
      Effect.gen(function* () {
        const failures = yield* Ref.updateAndGet(consecutiveFailuresRef, (value) => value + 1);
        const retryInMs = telemetryRetryDelayMs(failures);
        yield* Ref.set(retryAfterRef, Date.now() + retryInMs);
        yield* Effect.logWarning("Telemetry flush failed; backing off", {
          failureCount: failures,
          retryInMs,
        });
      }),
    ),
    deliveryLock.withPermits(1),
  );

  const record: AnalyticsServiceShape["record"] = (event) =>
    stateLock.withPermits(1)(
      Effect.gen(function* () {
        const usageEvent = basicUsageEvent(event);
        if (!usageEvent) return;
        const identifier = yield* synchronizeConsent;
        if (!identifier) return;
        yield* enqueueBufferedEvent(usageEvent, identifier);
      }),
    );

  yield* Effect.forever(Effect.sleep(1000).pipe(Effect.flatMap(() => flush)), {
    disableYield: true,
  }).pipe(Effect.forkScoped);

  yield* Effect.addFinalizer(() => flush);

  return {
    record,
    flush,
  } satisfies AnalyticsServiceShape;
});

export const AnalyticsServiceLayerLive = Layer.effect(AnalyticsService, makeAnalyticsService);
