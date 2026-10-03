/**
 * UsageService - scans provider transcripts and returns priced usage buckets.
 *
 * Scans local provider transcript directories (Claude and Codex), parsing usage
 * records and aggregating tokens and pricing across days/hours.
 *
 * @module UsageService
 */
import {
  USAGE_CONTRACT_VERSION,
  type UsageProviderKind,
  type UsageSource,
  type UsageSummary,
  type UsageSummaryInput,
  UsageReadError,
} from "@tabs/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { ServerConfig } from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import { resolveClaudeHomePath } from "../provider/Drivers/ClaudeHome.ts";
import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";
import { UsageAggregator } from "./usageAggregation.ts";
import { createOverrideRateTable, parseRateTable, type RateTable } from "./usagePricing.ts";
import { listTranscriptFiles, readTranscriptRecords } from "./usageTranscriptReader.ts";
import {
  decodeScanCache,
  dedupeWithinFile,
  encodeScanCache,
  pruneScanCache,
  type ScanCache,
} from "./usageScanCache.ts";
import type { UsageRecord } from "./usageTranscripts.ts";

const LITELLM_RATES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

function parseJsonSafe(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const RATES_TTL_MS = 24 * 60 * 60 * 1000;
const MTIME_SLACK_MS = 36 * 60 * 60 * 1000;
const CACHE_RETENTION_DAYS = 90;

export interface UsageServiceShape {
  readonly readSummary: (input: UsageSummaryInput) => Effect.Effect<UsageSummary, UsageReadError>;
}

export class UsageService extends Context.Service<UsageService, UsageServiceShape>()(
  "tabs/usage/UsageService",
) {}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const httpClient = yield* HttpClient.HttpClient;

  const fileCache: ScanCache = new Map();
  let cacheDirty = false;

  const ratesCachePath = path.join(config.stateDir, "usage-model-rates.json");
  const scanCachePath = path.join(config.stateDir, "usage-scan-cache.json");
  let rates: RateTable = new Map();
  let ratesFetchedAtMs: number | null = null;
  let ratesStatus: "live" | "cached" | "unavailable" = "unavailable";

  const ensureRates = Effect.fn("UsageService.ensureRates")(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (ratesFetchedAtMs !== null && now - ratesFetchedAtMs < RATES_TTL_MS) return;

    if (ratesFetchedAtMs === null) {
      const fromDisk = yield* fileSystem.readFileString(ratesCachePath).pipe(
        Effect.map((raw) => parseJsonSafe(raw)),
        Effect.catchCause(() => Effect.succeed(null)),
      );
      if (fromDisk !== null && fromDisk.document) {
        const parsed = parseRateTable(fromDisk.document);
        if (parsed.size > 0) {
          rates = parsed;
          ratesFetchedAtMs = fromDisk.fetchedAtMs ?? now;
          ratesStatus = "cached";
          if (now - (fromDisk.fetchedAtMs ?? 0) < RATES_TTL_MS) return;
        }
      }
    }

    const fetched = yield* httpClient.get(LITELLM_RATES_URL).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.json),
      Effect.timeout(10_000),
      Effect.catchCause(() => Effect.succeed(null)),
    );
    if (fetched === null) {
      if (rates.size > 0) ratesStatus = "cached";
      return;
    }

    const parsed = parseRateTable(fetched);
    if (parsed.size === 0) return;

    rates = parsed;
    ratesFetchedAtMs = now;
    ratesStatus = "live";

    yield* fileSystem
      .writeFileString(ratesCachePath, JSON.stringify({ fetchedAtMs: now, document: fetched }))
      .pipe(Effect.catchCause(() => Effect.void));
  });

  const resolveClaudeTranscriptDir = (homePath: string) =>
    Effect.gen(function* () {
      const nested = path.join(homePath, ".claude", "projects");
      const nestedExists = yield* fileSystem
        .exists(nested)
        .pipe(Effect.catchCause(() => Effect.succeed(false)));
      return nestedExists ? nested : path.join(homePath, "projects");
    });

  const resolveTranscriptDirs = Effect.fn("UsageService.resolveTranscriptDirs")(function* () {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.catchCause(() =>
        Effect.fail(
          new UsageReadError({
            message: "Server settings could not be read.",
          }),
        ),
      ),
    );

    const claudeHome = yield* resolveClaudeHomePath((settings.providers as any)?.claudeAgent);
    const claudeDir = yield* resolveClaudeTranscriptDir(claudeHome);
    const codexLayout = yield* resolveCodexHomeLayout((settings.providers as any)?.codex);

    return [
      { provider: "claude" as UsageProviderKind, dir: claudeDir },
      {
        provider: "codex" as UsageProviderKind,
        dir: path.join(codexLayout.sharedHomePath, "sessions"),
      },
    ];
  });

  const ensureScanCacheLoaded = yield* Effect.cached(
    Effect.gen(function* () {
      const rawString = yield* fileSystem
        .readFileString(scanCachePath)
        .pipe(Effect.catchCause(() => Effect.succeed(null)));
      if (rawString !== null) {
        const doc = parseJsonSafe(rawString);
        if (doc !== null) {
          const loaded = decodeScanCache(doc);
          if (loaded) {
            for (const [key, value] of loaded.entries()) {
              fileCache.set(key, value);
            }
          }
        }
      }
    }),
  );

  const persistScanCache = Effect.fn("UsageService.persistScanCache")(function* () {
    if (!cacheDirty) return;
    const serialized = encodeScanCache(fileCache);
    yield* fileSystem
      .writeFileString(scanCachePath, JSON.stringify(serialized))
      .pipe(Effect.catchCause(() => Effect.void));
    cacheDirty = false;
  });

  const readFileRecords = (
    filePath: string,
    size: number,
    mtimeMs: number,
    provider: UsageProviderKind,
  ): Effect.Effect<readonly UsageRecord[]> =>
    Effect.gen(function* () {
      const cacheKey = `${provider} ${filePath}`;
      const cached = fileCache.get(cacheKey);
      if (cached !== undefined && cached.size === size && cached.mtimeMs === mtimeMs) {
        return cached.records;
      }

      const raw = yield* Effect.promise(() => readTranscriptRecords(filePath, provider));
      const records = dedupeWithinFile(raw ?? []);
      fileCache.set(cacheKey, { size, mtimeMs, provider, records });
      cacheDirty = true;
      return records;
    });

  const readSummary = (input: UsageSummaryInput): Effect.Effect<UsageSummary, UsageReadError> =>
    Effect.gen(function* () {
      const startedAtMs = yield* Clock.currentTimeMillis;
      yield* ensureScanCacheLoaded;
      yield* ensureRates();

      const dirs = yield* resolveTranscriptDirs().pipe(Effect.provideService(Path.Path, path));

      const startTimestamp = Date.parse(`${input.sinceDay}T00:00:00Z`);
      const windowStartMs = Number.isNaN(startTimestamp)
        ? startedAtMs - 30 * 86_400_000
        : startTimestamp - MTIME_SLACK_MS;

      const settings = yield* settingsService.getSettings.pipe(
        Effect.catchCause(() => Effect.succeed(null)),
      );
      const overrideTable = settings?.usagePriceOverrides
        ? createOverrideRateTable(settings.usagePriceOverrides)
        : undefined;

      const aggregator = new UsageAggregator({
        timeZone: input.timeZone,
        sinceDay: input.sinceDay,
        untilDay: input.untilDay,
        rates,
        overrides: overrideTable,
      });

      const sources: UsageSource[] = [];
      const livePaths = new Set<string>();
      const walkedRoots: string[] = [];

      for (const { provider, dir } of dirs) {
        const exists = yield* fileSystem
          .exists(dir)
          .pipe(Effect.catchCause(() => Effect.succeed(false)));

        if (!exists) {
          sources.push({
            provider,
            homePath: dir,
            transcriptCount: 0,
            totalBytes: 0,
            lastModifiedMs: 0,
          });
          continue;
        }

        walkedRoots.push(dir);
        const files = yield* Effect.promise(() => listTranscriptFiles(dir, windowStartMs));
        let totalBytes = 0;
        let maxMtime = 0;

        for (const file of files) {
          livePaths.add(file.path);
          totalBytes += file.size;
          if (file.mtimeMs > maxMtime) maxMtime = file.mtimeMs;

          const records = yield* readFileRecords(file.path, file.size, file.mtimeMs, provider);
          for (const record of records) {
            aggregator.add(record);
          }
        }

        sources.push({
          provider,
          homePath: dir,
          transcriptCount: files.length,
          totalBytes,
          lastModifiedMs: maxMtime,
        });
      }

      const pruned = pruneScanCache(fileCache, {
        livePaths,
        walkedRoots,
        windowStartMs,
        retentionCutoffMs: startedAtMs - CACHE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      });
      if (pruned > 0) cacheDirty = true;
      yield* persistScanCache();

      const aggregated = aggregator.finish();
      const finishedAtMs = yield* Clock.currentTimeMillis;

      const summary: UsageSummary = {
        contractVersion: USAGE_CONTRACT_VERSION,
        readAt: new Date(finishedAtMs).toISOString(),
        timeZone: input.timeZone,
        sinceDay: input.sinceDay,
        untilDay: input.untilDay,
        ...(input.sinceTime ? { sinceTime: input.sinceTime } : {}),
        ...(input.untilTime ? { untilTime: input.untilTime } : {}),
        buckets: aggregated.buckets,
        distinctSessions: aggregated.distinctSessions,
        sources,
        pricing: {
          status: ratesStatus,
          source: ratesStatus === "live" || ratesStatus === "cached" ? "LiteLLM" : "none",
          fetchedAt: ratesFetchedAtMs !== null ? new Date(ratesFetchedAtMs).toISOString() : null,
          knownModels: rates.size,
        },
        scanDurationMs: Math.max(0, finishedAtMs - startedAtMs),
      };

      return summary;
    });

  return {
    readSummary,
  };
});

export const layer = Layer.effect(UsageService, make);
