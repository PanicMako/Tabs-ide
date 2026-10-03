// FILE: providerUsage/rateLimitResilience.ts
// Purpose: Shared "keep last-good + back off" resilience for live usage fetchers.

import type { ServerProviderUsageSnapshot } from "@tabs/contracts";
import { errorSnapshot } from "./parse";

export const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;
export const MAX_RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;
const MAX_TRACKED_KEYS = 32;

interface ResilienceEntry {
  lastGoodSnapshot: ServerProviderUsageSnapshot | null;
  cooldownUntilMs: number;
}

export interface RateLimitResilience {
  serveDuringCooldown(key: string, nowMs: number): ServerProviderUsageSnapshot | null;
  rememberLastGood(key: string, snapshot: ServerProviderUsageSnapshot, nowMs: number): void;
  enterCooldown(
    key: string,
    nowMs: number,
    retryAfterMs: number | undefined,
  ): ServerProviderUsageSnapshot;
  reset(): void;
}

export function createRateLimitResilience(options: {
  provider: string;
  source: string;
  detail: (retryMins: number) => string;
  defaultCooldownMs?: number;
  maxCooldownMs?: number;
}): RateLimitResilience {
  const defaultCooldownMs = options.defaultCooldownMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS;
  const maxCooldownMs = options.maxCooldownMs ?? MAX_RATE_LIMIT_COOLDOWN_MS;
  const store = new Map<string, ResilienceEntry>();

  const entryFor = (key: string, nowMs: number): ResilienceEntry => {
    const existing = store.get(key);
    if (existing) {
      store.delete(key);
      store.set(key, existing);
      return existing;
    }
    if (store.size >= MAX_TRACKED_KEYS) {
      for (const [candidateKey, candidate] of store) {
        if (candidate.cooldownUntilMs <= nowMs) {
          store.delete(candidateKey);
          break;
        }
      }
    }
    const entry: ResilienceEntry = { lastGoodSnapshot: null, cooldownUntilMs: 0 };
    store.set(key, entry);
    return entry;
  };

  const detailFor = (entry: ResilienceEntry, nowMs: number): string =>
    options.detail(Math.max(1, Math.ceil((entry.cooldownUntilMs - nowMs) / 60_000)));

  const snapshotForCooldown = (
    entry: ResilienceEntry,
    nowMs: number,
  ): ServerProviderUsageSnapshot => {
    const lastGood = entry.lastGoodSnapshot;
    return lastGood
      ? { ...lastGood, status: "ok", detail: detailFor(entry, nowMs), stale: true }
      : errorSnapshot(options.provider, nowMs, options.source, detailFor(entry, nowMs));
  };

  return {
    serveDuringCooldown(key, nowMs) {
      const entry = store.get(key);
      if (!entry || nowMs >= entry.cooldownUntilMs) {
        return null;
      }
      return snapshotForCooldown(entry, nowMs);
    },
    rememberLastGood(key, snapshot, nowMs) {
      const entry = entryFor(key, nowMs);
      entry.lastGoodSnapshot = snapshot;
      entry.cooldownUntilMs = 0;
    },
    enterCooldown(key, nowMs, retryAfterMs) {
      const entry = entryFor(key, nowMs);
      const backoffMs = Math.min(
        Math.max(retryAfterMs ?? defaultCooldownMs, 0) || defaultCooldownMs,
        maxCooldownMs,
      );
      entry.cooldownUntilMs = nowMs + backoffMs;
      return snapshotForCooldown(entry, nowMs);
    },
    reset() {
      store.clear();
    },
  };
}
