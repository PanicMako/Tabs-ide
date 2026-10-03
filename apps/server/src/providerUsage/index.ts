// FILE: providerUsage/index.ts
// Purpose: Orchestrate live provider-usage fetchers with caching, coalescing, and Effect bindings.

import * as os from "node:os";
import type {
  ServerListProviderUsageInput,
  ServerListProviderUsageResult,
  ServerProviderUsageSnapshot,
} from "@tabs/contracts";
import { Effect } from "effect";

import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { errorSnapshot } from "./parse.ts";
import { PROVIDER_USAGE_FETCHERS } from "./registry.ts";
import type { ProviderUsageContext } from "./types.ts";

export const SUPPORTED_USAGE_PROVIDERS: readonly string[] = [
  "codex",
  "claudeAgent",
  "cursor",
  "copilot",
  "grok",
  "antigravity",
  "gemini",
  "openrouter",
  "droid",
  "kilo",
  "opencode",
  "pi",
];

function buildContext(homeDir = os.homedir()): ProviderUsageContext {
  return {
    homeDir,
    env: process.env,
    platform: process.platform,
    nowMs: Date.now(),
  };
}

async function fetchProviderUsage(
  provider: string,
  providerContext: ProviderUsageContext,
): Promise<ServerProviderUsageSnapshot | null> {
  const fetcher = PROVIDER_USAGE_FETCHERS[provider];
  if (!fetcher) {
    return null;
  }

  return fetcher
    .fetch(providerContext)
    .catch((err) =>
      errorSnapshot(
        provider,
        providerContext.nowMs,
        "live-usage",
        err?.message ?? "Usage fetch failed unexpectedly.",
      ),
    );
}

const SNAPSHOT_CACHE_TTL_MS = 5 * 60 * 1000;
const SNAPSHOT_CACHE_DEGRADED_TTL_MS = 60 * 1000;

interface CachedSnapshot {
  snapshot: ServerProviderUsageSnapshot;
  fetchedAtMs: number;
  credentialKey: string;
}

interface InFlightSnapshot {
  credentialKey: string;
  promise: Promise<ServerProviderUsageSnapshot | null>;
}

const snapshotCache = new Map<string, CachedSnapshot>();
const inFlightFetches = new Map<string, InFlightSnapshot>();

const snapshotCacheTtlMs = (snapshot: ServerProviderUsageSnapshot): number =>
  snapshot.stale === true
    ? 0
    : (snapshot.status ?? "ok") === "ok"
      ? SNAPSHOT_CACHE_TTL_MS
      : SNAPSHOT_CACHE_DEGRADED_TTL_MS;

export function __resetProviderUsageCacheForTests(): void {
  snapshotCache.clear();
  inFlightFetches.clear();
}

export async function resolveProviderUsageSnapshot(input: {
  provider: string;
  forceRefresh?: boolean;
  homeDir?: string;
  claudeBinaryPath?: string;
}): Promise<ServerProviderUsageSnapshot | null> {
  const baseContext = buildContext(input.homeDir ?? os.homedir());
  const providerContext: ProviderUsageContext = {
    ...baseContext,
    ...(input.claudeBinaryPath !== undefined ? { claudeBinaryPath: input.claudeBinaryPath } : {}),
  };

  const fetcher = PROVIDER_USAGE_FETCHERS[input.provider];
  if (!fetcher) {
    return null;
  }

  let credentialKey = "";
  if (fetcher.cacheKey) {
    try {
      credentialKey = (await fetcher.cacheKey(providerContext)) ?? "";
    } catch {
      credentialKey = "";
    }
  }

  const cached = snapshotCache.get(input.provider);
  const nowMs = providerContext.nowMs;
  const isCacheFresh =
    cached &&
    cached.credentialKey === credentialKey &&
    nowMs - cached.fetchedAtMs < snapshotCacheTtlMs(cached.snapshot);

  if (!input.forceRefresh && isCacheFresh) {
    return cached.snapshot;
  }

  const inFlight = inFlightFetches.get(input.provider);
  if (inFlight && inFlight.credentialKey === credentialKey) {
    return inFlight.promise;
  }

  const fetchPromise = (async () => {
    try {
      const snapshot = await fetchProviderUsage(input.provider, providerContext);
      if (snapshot) {
        snapshotCache.set(input.provider, {
          snapshot,
          fetchedAtMs: nowMs,
          credentialKey,
        });
      }
      return snapshot;
    } finally {
      inFlightFetches.delete(input.provider);
    }
  })();

  inFlightFetches.set(input.provider, { credentialKey, promise: fetchPromise });
  return fetchPromise;
}

export async function listProviderUsageSnapshots(input: {
  forceRefresh?: boolean;
  provider?: string;
  homeDir?: string;
  claudeBinaryPath?: string;
}): Promise<ServerProviderUsageSnapshot[]> {
  const targets = input.provider ? [input.provider] : SUPPORTED_USAGE_PROVIDERS;

  const results = await Promise.all(
    targets.map((provider) =>
      resolveProviderUsageSnapshot({
        provider,
        ...(input.forceRefresh !== undefined ? { forceRefresh: input.forceRefresh } : {}),
        ...(input.homeDir !== undefined ? { homeDir: input.homeDir } : {}),
        ...(input.claudeBinaryPath !== undefined
          ? { claudeBinaryPath: input.claudeBinaryPath }
          : {}),
      }),
    ),
  );

  return results.filter((s): s is ServerProviderUsageSnapshot => s !== null);
}

export const collectProviderUsageSnapshots = listProviderUsageSnapshots;

export const listProviderUsageSnapshotsEffect = (
  input: ServerListProviderUsageInput,
): Effect.Effect<ServerListProviderUsageResult, never, ServerConfig | ServerSettingsService> =>
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const settingsService = yield* ServerSettingsService;
    const settings = yield* settingsService.getSettings.pipe(
      Effect.catchCause(() => Effect.succeed({ providers: {} } as any)),
    );
    const claudeBinary = (settings.providers as any)?.claudeAgent?.binaryPath ?? "claude";

    const snapshots = yield* Effect.promise(() =>
      listProviderUsageSnapshots({
        ...(input.forceRefresh !== undefined ? { forceRefresh: input.forceRefresh } : {}),
        ...(input.provider !== undefined ? { provider: input.provider } : {}),
        homeDir: os.homedir(),
        claudeBinaryPath: claudeBinary,
      }),
    );

    return snapshots;
  });
