import type { UsageBucket, UsageSummary } from "@tabs/contracts";

export interface ProviderTotals {
  readonly provider: string;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly records: number;
  readonly sessions: number;
  readonly costShare: number;
  readonly tokenShare: number;
}

export interface ModelTotals {
  readonly model: string;
  readonly provider: string;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly records: number;
  readonly costShare: number;
}

export interface DailyTotals {
  readonly day: string;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly byProvider: ReadonlyMap<string, { costUsd: number; totalTokens: number }>;
}

export interface HourlyTotals {
  readonly day: string;
  readonly hourStart: string;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly byProvider: ReadonlyMap<string, { costUsd: number; totalTokens: number }>;
}

export interface CostQuality {
  readonly providerReportedShare: number;
  readonly modelPricedShare: number;
  readonly unpricedShare: number;
  readonly cacheSavingsUsd: number;
}

export interface MergedUsage {
  readonly costUsd: number;
  readonly uncachedInputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly records: number;
  readonly sessions: number;
  readonly providers: readonly ProviderTotals[];
  readonly models: readonly ModelTotals[];
  readonly daily: readonly DailyTotals[];
  readonly hourly: readonly HourlyTotals[];
  readonly costQuality: CostQuality;
}

function bucketTokens(bucket: UsageBucket): number {
  return bucket.inputTokens + bucket.outputTokens;
}

export function mergeUsage(summary: UsageSummary | null | undefined): MergedUsage {
  if (!summary || !summary.buckets || summary.buckets.length === 0) {
    return {
      costUsd: 0,
      uncachedInputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      records: 0,
      sessions: 0,
      providers: [],
      models: [],
      daily: [],
      hourly: [],
      costQuality: {
        providerReportedShare: 0,
        modelPricedShare: 0,
        unpricedShare: 0,
        cacheSavingsUsd: 0,
      },
    };
  }

  let costUsd = 0;
  let uncachedInputTokens = 0;
  let cachedInputTokens = 0;
  let cacheCreationTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let records = 0;
  let providerReportedTokens = 0;
  let modelPricedTokens = 0;
  let unpricedTokens = 0;
  let cacheSavingsUsd = 0;

  const providerAccumulator = new Map<
    string,
    { costUsd: number; totalTokens: number; records: number; sessions: number }
  >();
  const modelAccumulator = new Map<
    string,
    { model: string; provider: string; costUsd: number; totalTokens: number; records: number }
  >();
  const dailyAccumulator = new Map<
    string,
    {
      costUsd: number;
      totalTokens: number;
      byProvider: Map<string, { costUsd: number; totalTokens: number }>;
    }
  >();
  const hourlyAccumulator = new Map<
    string,
    {
      day: string;
      costUsd: number;
      totalTokens: number;
      byProvider: Map<string, { costUsd: number; totalTokens: number }>;
    }
  >();

  for (const bucket of summary.buckets) {
    const totalTokensInBucket = bucketTokens(bucket);
    costUsd += bucket.estimatedCostUsd;
    uncachedInputTokens += Math.max(
      0,
      bucket.inputTokens - bucket.cachedInputTokens - bucket.cacheCreationTokens,
    );
    cachedInputTokens += bucket.cachedInputTokens;
    cacheCreationTokens += bucket.cacheCreationTokens;
    outputTokens += bucket.outputTokens;
    reasoningTokens += bucket.reasoningTokens;
    records += bucket.turnCount;
    cacheSavingsUsd += bucket.cacheSavingsUsd;
    unpricedTokens += bucket.unpricedTokens;
    if (bucket.costSource === "providerReported") {
      providerReportedTokens += bucket.pricedTokens;
    } else if (bucket.costSource === "modelPriced") {
      modelPricedTokens += bucket.pricedTokens;
    }

    // Provider aggregation
    const prevProvider = providerAccumulator.get(bucket.provider) ?? {
      costUsd: 0,
      totalTokens: 0,
      records: 0,
      sessions: 0,
    };
    providerAccumulator.set(bucket.provider, {
      costUsd: prevProvider.costUsd + bucket.estimatedCostUsd,
      totalTokens: prevProvider.totalTokens + totalTokensInBucket,
      records: prevProvider.records + bucket.turnCount,
      sessions: prevProvider.sessions + bucket.sessionCount,
    });

    // Model aggregation
    const modelKey = `${bucket.provider}:${bucket.model}`;
    const prevModel = modelAccumulator.get(modelKey) ?? {
      model: bucket.model,
      provider: bucket.provider,
      costUsd: 0,
      totalTokens: 0,
      records: 0,
    };
    modelAccumulator.set(modelKey, {
      model: bucket.model,
      provider: bucket.provider,
      costUsd: prevModel.costUsd + bucket.estimatedCostUsd,
      totalTokens: prevModel.totalTokens + totalTokensInBucket,
      records: prevModel.records + bucket.turnCount,
    });

    // Daily aggregation
    const prevDaily = dailyAccumulator.get(bucket.day) ?? {
      costUsd: 0,
      totalTokens: 0,
      byProvider: new Map(),
    };
    prevDaily.costUsd += bucket.estimatedCostUsd;
    prevDaily.totalTokens += totalTokensInBucket;
    const prevDailyProv = prevDaily.byProvider.get(bucket.provider) ?? {
      costUsd: 0,
      totalTokens: 0,
    };
    prevDaily.byProvider.set(bucket.provider, {
      costUsd: prevDailyProv.costUsd + bucket.estimatedCostUsd,
      totalTokens: prevDailyProv.totalTokens + totalTokensInBucket,
    });
    dailyAccumulator.set(bucket.day, prevDaily);

    // Hourly aggregation if present
    if (bucket.hourStart) {
      const prevHourly = hourlyAccumulator.get(bucket.hourStart) ?? {
        day: bucket.day,
        costUsd: 0,
        totalTokens: 0,
        byProvider: new Map(),
      };
      prevHourly.costUsd += bucket.estimatedCostUsd;
      prevHourly.totalTokens += totalTokensInBucket;
      const prevHourlyProv = prevHourly.byProvider.get(bucket.provider) ?? {
        costUsd: 0,
        totalTokens: 0,
      };
      prevHourly.byProvider.set(bucket.provider, {
        costUsd: prevHourlyProv.costUsd + bucket.estimatedCostUsd,
        totalTokens: prevHourlyProv.totalTokens + totalTokensInBucket,
      });
      hourlyAccumulator.set(bucket.hourStart, prevHourly);
    }
  }

  const totalTokens = uncachedInputTokens + cachedInputTokens + cacheCreationTokens + outputTokens;
  const qualityTokens = providerReportedTokens + modelPricedTokens + unpricedTokens;

  const providers: ProviderTotals[] = Array.from(providerAccumulator.entries())
    .map(([provider, data]) => ({
      provider,
      costUsd: data.costUsd,
      totalTokens: data.totalTokens,
      records: data.records,
      sessions: data.sessions,
      costShare: costUsd > 0 ? data.costUsd / costUsd : 0,
      tokenShare: totalTokens > 0 ? data.totalTokens / totalTokens : 0,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);

  const models: ModelTotals[] = Array.from(modelAccumulator.entries())
    .map(([, data]) => {
      return {
        model: data.model,
        provider: data.provider,
        costUsd: data.costUsd,
        totalTokens: data.totalTokens,
        records: data.records,
        costShare: costUsd > 0 ? data.costUsd / costUsd : 0,
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd);

  const daily: DailyTotals[] = Array.from(dailyAccumulator.entries())
    .map(([day, data]) => ({
      day,
      costUsd: data.costUsd,
      totalTokens: data.totalTokens,
      byProvider: data.byProvider,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const hourly: HourlyTotals[] = Array.from(hourlyAccumulator.entries())
    .map(([hourStart, data]) => ({
      day: data.day,
      hourStart,
      costUsd: data.costUsd,
      totalTokens: data.totalTokens,
      byProvider: data.byProvider,
    }))
    .sort((a, b) => a.hourStart.localeCompare(b.hourStart));

  return {
    costUsd,
    uncachedInputTokens,
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    records,
    sessions: summary.distinctSessions,
    providers,
    models,
    daily,
    hourly,
    costQuality: {
      providerReportedShare: qualityTokens > 0 ? providerReportedTokens / qualityTokens : 0,
      modelPricedShare: qualityTokens > 0 ? modelPricedTokens / qualityTokens : 0,
      unpricedShare: qualityTokens > 0 ? unpricedTokens / qualityTokens : 0,
      cacheSavingsUsd,
    },
  };
}
