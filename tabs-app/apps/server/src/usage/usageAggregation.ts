import type { UsageBucket } from "@tabs/contracts";
import {
  cacheSavingsUsd,
  priceUsage,
  type RateTable,
  type UsageCostSource,
} from "./usagePricing.ts";
import { type UsageRecord } from "./usageTranscripts.ts";

export function makeDayFormatter(timeZone: string): (timestampMs: number) => string {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  return (timestampMs) => format.format(new Date(timestampMs));
}

interface MutableBucket {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  estimatedCostUsd: number;
  cacheSavingsUsd: number;
  pricedTokens: number;
  unpricedTokens: number;
  hasCustomPrice: boolean;
  records: number;
  providerReportedRecords: number;
  unpricedRecords: number;
  sessions: Set<string>;
  turnCount: number;
}

export interface AggregateOptions {
  readonly timeZone: string;
  readonly sinceDay: string;
  readonly untilDay: string;
  readonly rates: RateTable;
  readonly overrides?: RateTable | undefined;
  readonly sinceTimeMs?: number;
  readonly untilTimeMs?: number;
}

export interface AggregateResult {
  readonly buckets: readonly UsageBucket[];
  readonly distinctSessions: number;
}

export class UsageAggregator {
  private readonly formatDay: (timestampMs: number) => string;
  private readonly sinceDay: string;
  private readonly untilDay: string;
  private readonly rates: RateTable;
  private readonly overrides?: RateTable | undefined;
  private readonly buckets = new Map<string, MutableBucket>();
  private readonly seen = new Set<string>();
  private readonly sessions = new Set<string>();

  constructor(options: AggregateOptions) {
    this.formatDay = makeDayFormatter(options.timeZone);
    this.sinceDay = options.sinceDay;
    this.untilDay = options.untilDay;
    this.rates = options.rates;
    this.overrides = options.overrides;
  }

  add(record: UsageRecord): boolean {
    const day = this.formatDay(record.timestampMs);
    if (day < this.sinceDay || day > this.untilDay) {
      return false;
    }

    if (record.dedupeKey !== null) {
      if (this.seen.has(record.dedupeKey)) return false;
      this.seen.add(record.dedupeKey);
    }

    const key = `${day}:${record.provider}:${record.model}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        cacheCreationTokens: 0,
        estimatedCostUsd: 0,
        cacheSavingsUsd: 0,
        pricedTokens: 0,
        unpricedTokens: 0,
        hasCustomPrice: false,
        records: 0,
        providerReportedRecords: 0,
        unpricedRecords: 0,
        sessions: new Set<string>(),
        turnCount: 0,
      };
      this.buckets.set(key, bucket);
    }

    const inputTokens =
      record.totals.uncachedInputTokens +
      record.totals.cachedInputTokens +
      record.totals.cacheCreationTokens;
    const outputTokens = record.totals.outputTokens;
    const reasoningTokens = record.totals.reasoningTokens;
    const cachedInputTokens = record.totals.cachedInputTokens;

    bucket.inputTokens += inputTokens;
    bucket.outputTokens += outputTokens;
    bucket.reasoningTokens += reasoningTokens;
    bucket.cachedInputTokens += cachedInputTokens;
    bucket.cacheCreationTokens += record.totals.cacheCreationTokens;
    bucket.turnCount += 1;
    if (record.sessionId) {
      bucket.sessions.add(record.sessionId);
      this.sessions.add(record.sessionId);
    }

    const priced = priceUsage(
      this.rates,
      record.model,
      record.totals,
      record.reportedCostUsd,
      this.overrides,
    );
    const recordTokens = inputTokens + outputTokens;
    bucket.estimatedCostUsd += priced.costUsd;
    bucket.cacheSavingsUsd += cacheSavingsUsd(
      this.rates,
      record.model,
      record.totals,
      this.overrides,
    );
    bucket.records += 1;
    if (priced.costSource === "unpriced") {
      bucket.unpricedTokens += recordTokens;
      bucket.unpricedRecords += 1;
    } else {
      bucket.pricedTokens += recordTokens;
    }
    if (
      priced.costSource === "providerReported" ||
      (this.overrides !== undefined && this.overrides.has(record.model.trim()))
    ) {
      bucket.hasCustomPrice = true;
      if (priced.costSource === "providerReported") {
        bucket.providerReportedRecords += 1;
      }
    }

    return true;
  }

  finish(): AggregateResult {
    const buckets: UsageBucket[] = [];
    for (const [key, data] of this.buckets.entries()) {
      const [day, provider, ...modelParts] = key.split(":");
      const model = modelParts.join(":");
      buckets.push({
        day: day!,
        provider: provider!,
        model: model!,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        reasoningTokens: data.reasoningTokens,
        cachedInputTokens: data.cachedInputTokens,
        cacheCreationTokens: data.cacheCreationTokens,
        estimatedCostUsd: data.estimatedCostUsd,
        cacheSavingsUsd: data.cacheSavingsUsd,
        costSource: resolveCostSource(data),
        pricedTokens: data.pricedTokens,
        unpricedTokens: data.unpricedTokens,
        hasCustomPrice: data.hasCustomPrice,
        sessionCount: data.sessions.size,
        turnCount: data.turnCount,
      });
    }

    return {
      buckets,
      distinctSessions: this.sessions.size,
    };
  }
}

function resolveCostSource(bucket: MutableBucket): UsageCostSource {
  if (bucket.unpricedRecords === bucket.records) return "unpriced";
  if (bucket.providerReportedRecords === bucket.records) return "providerReported";
  return "modelPriced";
}
