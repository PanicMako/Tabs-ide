import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const USAGE_CONTRACT_VERSION = 2;

export const UsageProviderKind = Schema.Literals([
  "codex",
  "claude",
  "cursor",
  "copilot",
  "grok",
  "antigravity",
  "droid",
  "kilo",
  "opencode",
  "openrouter",
]);
export type UsageProviderKind = typeof UsageProviderKind.Type;

export const IsoDateString = TrimmedNonEmptyString.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));
export type IsoDateString = typeof IsoDateString.Type;

export const UsageTimeWindow = Schema.Struct({
  sinceDay: IsoDateString,
  untilDay: IsoDateString,
  sinceTime: Schema.optional(Schema.String),
  untilTime: Schema.optional(Schema.String),
  timeZone: Schema.String,
});
export type UsageTimeWindow = typeof UsageTimeWindow.Type;

export const UsageSummaryInput = Schema.Struct({
  sinceDay: IsoDateString,
  untilDay: IsoDateString,
  sinceTime: Schema.optional(Schema.String),
  untilTime: Schema.optional(Schema.String),
  timeZone: Schema.String,
  forceRefresh: Schema.optional(Schema.Boolean),
});
export type UsageSummaryInput = typeof UsageSummaryInput.Type;

export interface UsageTokenTotals {
  readonly uncachedInputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
}

export const UsageCostSource = Schema.Literals(["providerReported", "modelPriced", "unpriced"]);
export type UsageCostSource = typeof UsageCostSource.Type;

export const UsageBucket = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  day: IsoDateString,
  hourStart: Schema.optional(Schema.String),
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  reasoningTokens: Schema.Number,
  cachedInputTokens: Schema.Number,
  cacheCreationTokens: Schema.Number,
  estimatedCostUsd: Schema.Number,
  cacheSavingsUsd: Schema.Number,
  costSource: UsageCostSource,
  pricedTokens: Schema.Number,
  unpricedTokens: Schema.Number,
  hasCustomPrice: Schema.Boolean,
  sessionCount: Schema.Number,
  turnCount: Schema.Number,
});
export type UsageBucket = typeof UsageBucket.Type;

export const UsageSource = Schema.Struct({
  provider: Schema.String,
  homePath: Schema.String,
  transcriptCount: Schema.Number,
  totalBytes: Schema.Number,
  lastModifiedMs: Schema.Number,
});
export type UsageSource = typeof UsageSource.Type;

export const UsagePricingStatus = Schema.Struct({
  status: Schema.Literals(["live", "cached", "unavailable"]),
  source: Schema.String,
  fetchedAt: Schema.NullOr(Schema.String),
  knownModels: Schema.Number,
});
export type UsagePricingStatus = typeof UsagePricingStatus.Type;

export const UsageSummary = Schema.Struct({
  contractVersion: Schema.Number,
  readAt: Schema.String,
  timeZone: Schema.String,
  sinceDay: IsoDateString,
  untilDay: IsoDateString,
  sinceTime: Schema.optional(Schema.String),
  untilTime: Schema.optional(Schema.String),
  buckets: Schema.Array(UsageBucket),
  distinctSessions: Schema.Number,
  sources: Schema.Array(UsageSource),
  pricing: UsagePricingStatus,
  scanDurationMs: Schema.Number,
});
export type UsageSummary = typeof UsageSummary.Type;

export class UsageReadError extends Schema.TaggedErrorClass<UsageReadError>()("UsageReadError", {
  message: Schema.String,
  detail: Schema.optional(Schema.String),
}) {}

// --- Live Limits / Quota Schemas (ported from synara) ---

export const ProviderUsageStatus = Schema.Literals([
  "ok",
  "needs-auth",
  "quota-unavailable",
  "unsupported",
  "error",
]);
export type ProviderUsageStatus = typeof ProviderUsageStatus.Type;

export const ServerProviderUsageLimit = Schema.Struct({
  window: Schema.String,
  usedPercent: Schema.optional(Schema.Number),
  resetsAt: Schema.optional(Schema.String),
  windowDurationMins: Schema.optional(Schema.Number),
});
export type ServerProviderUsageLimit = typeof ServerProviderUsageLimit.Type;

export const ServerProviderUsageLine = Schema.Struct({
  label: Schema.String,
  value: Schema.String,
  subtitle: Schema.optional(Schema.String),
});
export type ServerProviderUsageLine = typeof ServerProviderUsageLine.Type;

export const ServerProviderUsageWindowStats = Schema.Struct({
  label: Schema.Literals(["24h", "7d", "30d"]),
  tokens: Schema.Number,
  sessions: Schema.Number,
});
export type ServerProviderUsageWindowStats = typeof ServerProviderUsageWindowStats.Type;

export const ServerProviderUsageSnapshot = Schema.Struct({
  provider: Schema.String,
  providerInstanceId: Schema.optional(ProviderInstanceId),
  updatedAt: Schema.String,
  limits: Schema.Array(ServerProviderUsageLimit),
  usageLines: Schema.Array(ServerProviderUsageLine),
  windows: Schema.optional(Schema.Array(ServerProviderUsageWindowStats)),
  source: Schema.String,
  status: Schema.optional(ProviderUsageStatus),
  planName: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
  stale: Schema.optional(Schema.Boolean),
});
export type ServerProviderUsageSnapshot = typeof ServerProviderUsageSnapshot.Type;

export const ServerListProviderUsageInput = Schema.Struct({
  forceRefresh: Schema.optional(Schema.Boolean),
  provider: Schema.optional(Schema.String),
});
export type ServerListProviderUsageInput = typeof ServerListProviderUsageInput.Type;

export const ServerListProviderUsageResult = Schema.Array(ServerProviderUsageSnapshot);
export type ServerListProviderUsageResult = typeof ServerListProviderUsageResult.Type;
