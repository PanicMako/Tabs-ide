/**
 * AnalyticsServiceLive - Opt-in pseudonymous PostHog telemetry layer.
 *
 * Persists a random installation-scoped anonymous id to state dir, buffers
 * events in memory, and flushes batches to PostHog over Effect HttpClient.
 *
 * @module AnalyticsServiceLive
 */

import { Config, DateTime, Effect, Layer, Ref } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { ServerConfig } from "../../config.ts";
import { AnalyticsService, type AnalyticsServiceShape } from "../Services/AnalyticsService.ts";
import { clearTelemetryIdentifier, getTelemetryIdentifier } from "../Identify.ts";
import { version } from "../../../package.json" with { type: "json" };

interface BufferedAnalyticsEvent {
  readonly event: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly capturedAt: string;
}

/** Only bounded operational fields are permitted; arbitrary strings never leave the process. */
export function safeTelemetryProperties(properties?: Readonly<Record<string, unknown>>) {
  const safe: Record<string, boolean | number | string> = {};
  const booleanKeys = new Set(["hasResumeCursor", "hasCwd", "hasModel", "hasInput"]);
  const countKeys = new Set(["threadCount", "projectCount", "attachmentCount", "turns", "count"]);
  const enums: Record<string, readonly string[]> = {
    provider: [
      "codex",
      "claude",
      "cursor",
      "copilot",
      "grok",
      "opencode",
      "antigravity",
      "gemini",
      "droid",
      "kilo",
      "openrouter",
    ],
    strategy: ["adopt-existing", "resume-thread", "replace-legacy-session"],
    runtimeMode: ["full-access", "approval-required"],
    interactionMode: ["default", "plan"],
    decision: ["accept", "decline", "cancel", "acceptForSession"],
  };
  for (const [key, value] of Object.entries(properties ?? {})) {
    if (booleanKeys.has(key) && typeof value === "boolean") safe[key] = value;
    else if (
      countKeys.has(key) &&
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    )
      safe[key] = value;
    else if (typeof value === "string" && enums[key]?.includes(value)) safe[key] = value;
  }
  return safe;
}

const TELEMETRY_RETRY_BASE_MS = 5_000;
const TELEMETRY_RETRY_MAX_MS = 5 * 60_000;

export function telemetryRetryDelayMs(consecutiveFailures: number): number {
  const exponent = Math.max(0, Math.min(16, Math.floor(consecutiveFailures) - 1));
  return Math.min(TELEMETRY_RETRY_MAX_MS, TELEMETRY_RETRY_BASE_MS * 2 ** exponent);
}

const TelemetryEnvConfig = Config.all({
  posthogKey: Config.string("TABS_POSTHOG_KEY").pipe(
    Config.withDefault("phc_XOWci4oZP4VvLiEyrFqkFjP4CZn55mjYYBMREK5Wd6m"),
  ),
  posthogHost: Config.string("TABS_POSTHOG_HOST").pipe(
    Config.withDefault("https://us.i.posthog.com"),
  ),
  enabled: Config.boolean("TABS_TELEMETRY_ENABLED").pipe(Config.withDefault(false)),
  flushBatchSize: Config.number("TABS_TELEMETRY_FLUSH_BATCH_SIZE").pipe(Config.withDefault(20)),
  maxBufferedEvents: Config.number("TABS_TELEMETRY_MAX_BUFFERED_EVENTS").pipe(
    Config.withDefault(1_000),
  ),
});

const makeAnalyticsService = Effect.gen(function* () {
  const telemetryConfig = yield* TelemetryEnvConfig;
  const httpClient = yield* HttpClient.HttpClient;
  const serverConfig = yield* ServerConfig;
  if (!telemetryConfig.enabled) {
    yield* clearTelemetryIdentifier;
    return { record: () => Effect.void, flush: Effect.void } satisfies AnalyticsServiceShape;
  }
  const identifier = yield* getTelemetryIdentifier;
  const bufferRef = yield* Ref.make<ReadonlyArray<BufferedAnalyticsEvent>>([]);
  const consecutiveFailuresRef = yield* Ref.make(0);
  const retryAfterRef = yield* Ref.make(0);
  const clientType = serverConfig.mode === "desktop" ? "desktop-app" : "cli-web-client";

  const enqueueBufferedEvent = (event: string, properties?: Readonly<Record<string, unknown>>) =>
    Effect.flatMap(DateTime.now, (now) =>
      Ref.modify(bufferRef, (current) => {
        const appended = [
          ...current,
          {
            event,
            ...(properties ? { properties } : {}),
            capturedAt: DateTime.formatIso(now),
          } satisfies BufferedAnalyticsEvent,
        ];

        const next =
          appended.length > telemetryConfig.maxBufferedEvents
            ? appended.slice(appended.length - telemetryConfig.maxBufferedEvents)
            : appended;

        return [
          {
            size: next.length,
            dropped: next.length !== appended.length,
          } as const,
          next,
        ] as const;
      }),
    );

  const sendBatch = (events: ReadonlyArray<BufferedAnalyticsEvent>) =>
    Effect.gen(function* () {
      if (!telemetryConfig.enabled || !identifier) return;

      const payload = {
        api_key: telemetryConfig.posthogKey,
        batch: events.map((event) => ({
          event: event.event,
          distinct_id: identifier,
          properties: {
            ...safeTelemetryProperties(event.properties),
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
      );
    });

  const flush: AnalyticsServiceShape["flush"] = Effect.gen(function* () {
    if (Date.now() < (yield* Ref.get(retryAfterRef))) return;
    while (true) {
      const batch = yield* Ref.modify(bufferRef, (current) => {
        if (current.length === 0) {
          return [[] as ReadonlyArray<BufferedAnalyticsEvent>, current] as const;
        }
        const nextBatch = current.slice(0, telemetryConfig.flushBatchSize);
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
          Ref.update(bufferRef, (current) => [...batch, ...current]).pipe(
            Effect.flatMap(() => Effect.fail(error)),
          ),
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
  );

  const record: AnalyticsServiceShape["record"] = Effect.fnUntraced(function* (event, properties) {
    if (!telemetryConfig.enabled || !identifier) return;

    const enqueueResult = yield* enqueueBufferedEvent(event, properties);
    if (enqueueResult.dropped) {
      yield* Effect.logDebug("analytics buffer full; dropping oldest event", {
        size: enqueueResult.size,
        event,
      });
    }
  });

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
