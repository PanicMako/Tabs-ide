import { USAGE_CONTRACT_VERSION, type UsageBucket, type UsageSummary } from "@tabs/contracts";
import { mergeUsage } from "@tabs/shared/usageMerge";
import { expect, it } from "vitest";

import { ALL_TIME_SINCE_DAY, ledgerPeriods, sliceSummary, smoothPath } from "./usageLedger";

const bucket = (day: string, provider: "codex" | "claude", tokens: number) =>
  ({
    day,
    provider,
    model: `${provider}-model`,
    totals: {
      uncachedInputTokens: tokens,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
    },
    costUsd: 0,
    cacheSavingsUsd: 0,
    costSource: "unpriced",
    records: 1,
    unpricedRecords: 1,
    sessions: 1,
  }) as unknown as UsageBucket;

const summary = (sinceDay: string) =>
  ({
    contractVersion: USAGE_CONTRACT_VERSION,
    readAt: "2026-10-08T12:00:00.000Z",
    timeZone: "UTC",
    sinceDay,
    untilDay: "2026-10-08",
    buckets: [
      bucket("2026-10-05", "codex", 100),
      bucket("2026-10-07", "claude", 40),
      bucket("2026-10-07", "codex", 10),
    ],
    sources: ["codex", "claude"].map((provider) => ({
      fingerprint: { hostId: "h", provider, resolvedHomePath: `/${provider}`, volumeId: "v" },
      status: "ok",
      scannedFiles: 1,
      skippedFiles: 0,
      malformedRecords: 0,
      distinctSessions: 1,
      message: null,
    })),
    pricing: { status: "fresh", source: "fixture", fetchedAt: null, knownModels: 0 },
    scanDurationMs: 1,
  }) as unknown as UsageSummary;

it("lays out quiet days too, starting an all-time window at the first active day", () => {
  const allTime = summary(ALL_TIME_SINCE_DAY);
  const periods = ledgerPeriods(allTime, mergeUsage(allTime), false);
  expect(periods.map((period) => [period.key, period.totalTokens])).toEqual([
    ["2026-10-05", 100],
    ["2026-10-06", 0],
    ["2026-10-07", 50],
    ["2026-10-08", 0],
  ]);
  const week = summary("2026-10-02");
  expect(ledgerPeriods(week, mergeUsage(week), false)[0]?.key).toBe("2026-10-02");
});

it("narrows a summary to one day and one provider", () => {
  const sliced = mergeUsage(
    sliceSummary(summary("2026-10-02"), {
      periodKey: "2026-10-07",
      hourly: false,
      provider: "claude",
    }),
  );
  expect(sliced.totalTokens).toBe(40);
  expect(sliced.models.map((model) => model.model)).toEqual(["claude-model"]);
});

it("smooths without overshooting a flat run", () => {
  const path = smoothPath([
    [0, 10],
    [1, 10],
    [2, 0],
    [3, 10],
  ]);
  const ys = [...path.matchAll(/[ ,]([-\d.]+)(?= |C|$)/g)].map((match) => Number(match[1]));
  expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...ys)).toBeLessThanOrEqual(10);
  expect(path.startsWith("M0,10C")).toBe(true);
});
