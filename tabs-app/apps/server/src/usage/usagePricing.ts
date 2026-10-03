/** Model rate lookup and accurate cached-token cost arithmetic. */
import type { UsageModelPriceOverride, UsageTokenTotals } from "@tabs/contracts";

export interface ModelRate {
  readonly inputCostPerToken: number;
  readonly outputCostPerToken: number;
  readonly cacheReadCostPerToken: number;
  readonly cacheCreationCostPerToken: number;
}

export type RateTable = ReadonlyMap<string, ModelRate>;

export function createOverrideRateTable(
  overrides: Readonly<Record<string, UsageModelPriceOverride>>,
): RateTable {
  return new Map(
    Object.entries(overrides).map(([model, prices]) => [
      model.trim(),
      {
        inputCostPerToken: prices.inputCostPerMillionTokens / 1_000_000,
        outputCostPerToken: prices.outputCostPerMillionTokens / 1_000_000,
        cacheReadCostPerToken:
          (prices.cacheReadCostPerMillionTokens ?? prices.inputCostPerMillionTokens) / 1_000_000,
        cacheCreationCostPerToken:
          (prices.cacheWriteCostPerMillionTokens ?? prices.inputCostPerMillionTokens) / 1_000_000,
      },
    ]),
  );
}

interface LiteLlmEntry {
  readonly input_cost_per_token?: unknown;
  readonly output_cost_per_token?: unknown;
  readonly cache_read_input_token_cost?: unknown;
  readonly cache_creation_input_token_cost?: unknown;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeRateKey(model: string): string {
  return model.trim().toLowerCase();
}

function bareModelName(key: string): string {
  const slash = key.lastIndexOf("/");
  return slash === -1 ? key : key.slice(slash + 1);
}

function stripVariantSuffix(key: string): string {
  const bracket = key.indexOf("[");
  return bracket === -1 ? key : key.slice(0, bracket);
}

function sameRate(left: ModelRate, right: ModelRate): boolean {
  return (
    left.inputCostPerToken === right.inputCostPerToken &&
    left.outputCostPerToken === right.outputCostPerToken &&
    left.cacheReadCostPerToken === right.cacheReadCostPerToken &&
    left.cacheCreationCostPerToken === right.cacheCreationCostPerToken
  );
}

export function parseRateTable(document: unknown): RateTable {
  const table = new Map<string, ModelRate>();
  if (typeof document !== "object" || document === null) return table;

  for (const [name, raw] of Object.entries(document as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as LiteLlmEntry;
    const input = finiteNumber(entry.input_cost_per_token);
    const output = finiteNumber(entry.output_cost_per_token);
    if (input === null || output === null) continue;

    const key = normalizeRateKey(name);
    if (!key) continue;
    table.set(key, {
      inputCostPerToken: input,
      outputCostPerToken: output,
      cacheReadCostPerToken: finiteNumber(entry.cache_read_input_token_cost) ?? input,
      cacheCreationCostPerToken: finiteNumber(entry.cache_creation_input_token_cost) ?? input,
    });
  }

  const aliases = new Map<string, ModelRate | null>();
  for (const [key, rate] of table) {
    const alias = bareModelName(key);
    if (!alias || alias === key || table.has(alias)) continue;
    const existing = aliases.get(alias);
    if (existing === undefined) aliases.set(alias, rate);
    else if (existing !== null && !sameRate(existing, rate)) aliases.set(alias, null);
  }
  for (const [alias, rate] of aliases) {
    if (rate !== null) table.set(alias, rate);
  }

  return table;
}

export function normalizeModelName(model: string): string {
  return bareModelName(normalizeRateKey(model));
}

const UNPRICEABLE_MODELS = new Set([
  "<synthetic>",
  "synthetic",
  "opus",
  "sonnet",
  "haiku",
  "fable",
]);

export function lookupRate(table: RateTable, model: string): ModelRate | null {
  const key = stripVariantSuffix(normalizeRateKey(model));
  const bare = bareModelName(key);
  if (!bare || UNPRICEABLE_MODELS.has(bare)) return null;
  if (key.includes("/")) return table.get(key) ?? null;
  return table.get(key) ?? table.get(bare) ?? null;
}

export type UsageCostSource = "providerReported" | "modelPriced" | "unpriced";

export function priceUsage(
  table: RateTable,
  model: string,
  totals: UsageTokenTotals,
  reportedCostUsd: number | null,
  overrides?: RateTable,
): { readonly costUsd: number; readonly costSource: UsageCostSource } {
  const override = overrides?.get(model.trim());
  if (
    override === undefined &&
    reportedCostUsd !== null &&
    Number.isFinite(reportedCostUsd) &&
    reportedCostUsd >= 0
  ) {
    return { costUsd: reportedCostUsd, costSource: "providerReported" };
  }

  const rate = override ?? lookupRate(table, model);
  if (rate === null) return { costUsd: 0, costSource: "unpriced" };

  return {
    costUsd:
      totals.uncachedInputTokens * rate.inputCostPerToken +
      totals.cachedInputTokens * rate.cacheReadCostPerToken +
      totals.cacheCreationTokens * rate.cacheCreationCostPerToken +
      totals.outputTokens * rate.outputCostPerToken,
    costSource: "modelPriced",
  };
}

export function cacheSavingsUsd(
  table: RateTable,
  model: string,
  totals: UsageTokenTotals,
  overrides?: RateTable,
): number {
  const rate = overrides?.get(model.trim()) ?? lookupRate(table, model);
  if (rate === null) return 0;
  return Math.max(
    0,
    totals.cachedInputTokens * (rate.inputCostPerToken - rate.cacheReadCostPerToken),
  );
}
