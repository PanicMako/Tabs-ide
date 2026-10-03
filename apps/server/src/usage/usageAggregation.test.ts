import { describe, expect, it } from "vitest";

import { UsageAggregator } from "./usageAggregation.ts";
import type { RateTable } from "./usagePricing.ts";
import type { UsageRecord } from "./usageTranscripts.ts";

const rates: RateTable = new Map([
  [
    "claude-fable-5",
    {
      inputCostPerToken: 1e-5,
      outputCostPerToken: 5e-5,
      cacheReadCostPerToken: 1e-6,
      cacheCreationCostPerToken: 1.25e-5,
    },
  ],
]);

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    provider: "claude",
    timestampMs: Date.parse("2026-08-07T04:05:13.944Z"),
    model: "claude-fable-5",
    sessionId: "session-a",
    totals: {
      uncachedInputTokens: 100,
      cachedInputTokens: 1000,
      cacheCreationTokens: 10,
      outputTokens: 50,
      reasoningTokens: 0,
    },
    reportedCostUsd: null,
    dedupeKey: null,
    ...overrides,
  };
}

function aggregate(records: readonly UsageRecord[], timeZone = "UTC") {
  const aggregator = new UsageAggregator({
    timeZone,
    sinceDay: "2026-08-01",
    untilDay: "2026-08-31",
    rates,
  });
  for (const item of records) aggregator.add(item);
  return aggregator.finish();
}

describe("UsageAggregator", () => {
  it("sums tokens correctly", () => {
    const result = aggregate([record(), record()]);

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]?.outputTokens).toBe(100);
    expect(result.buckets[0]?.turnCount).toBe(2);
    expect(result.distinctSessions).toBe(1);
  });

  it("prices fresh input, cache reads, cache writes, and output separately", () => {
    const result = aggregate([record()]);

    expect(result.buckets[0]?.estimatedCostUsd).toBeCloseTo(0.004625, 9);
    expect(result.buckets[0]?.cacheSavingsUsd).toBeCloseTo(0.009, 9);
    expect(result.buckets[0]?.costSource).toBe("modelPriced");
  });

  it("prefers a provider-reported cost", () => {
    const result = aggregate([record({ reportedCostUsd: 1.25 })]);

    expect(result.buckets[0]?.estimatedCostUsd).toBe(1.25);
    expect(result.buckets[0]?.costSource).toBe("providerReported");
  });

  it("leaves unknown models unpriced instead of inventing a fallback rate", () => {
    const result = aggregate([record({ model: "unknown-model" })]);

    expect(result.buckets[0]?.estimatedCostUsd).toBe(0);
    expect(result.buckets[0]?.unpricedTokens).toBe(1160);
    expect(result.buckets[0]?.costSource).toBe("unpriced");
  });

  it("keeps only the first record with the same dedupe key", () => {
    const result = aggregate([
      record({ dedupeKey: "message-1" }),
      record({ dedupeKey: "message-1" }),
    ]);

    expect(result.buckets[0]?.turnCount).toBe(1);
  });

  it("buckets by the day in the requested time zone", () => {
    const utc = aggregate([record()], "UTC");
    const losAngeles = aggregate([record()], "America/Los_Angeles");

    expect(utc.buckets[0]?.day).toBe("2026-08-07");
    expect(losAngeles.buckets[0]?.day).toBe("2026-08-06");
  });
});
