import { describe, expect, it } from "vitest";

import {
  cacheSavingsUsd,
  createOverrideRateTable,
  lookupRate,
  parseRateTable,
  priceUsage,
} from "./usagePricing.ts";

const totals = {
  uncachedInputTokens: 100,
  cachedInputTokens: 1_000,
  cacheCreationTokens: 10,
  outputTokens: 50,
  reasoningTokens: 0,
};

const millionTotals = {
  uncachedInputTokens: 1_000_000,
  cachedInputTokens: 1_000_000,
  cacheCreationTokens: 1_000_000,
  outputTokens: 1_000_000,
  reasoningTokens: 500_000,
};

describe("usage pricing", () => {
  it("does not collapse conflicting provider rates into a bare alias", () => {
    const table = parseRateTable({
      "provider-a/model": { input_cost_per_token: 1, output_cost_per_token: 5 },
      "provider-b/model": { input_cost_per_token: 2, output_cost_per_token: 10 },
    });

    expect(lookupRate(table, "model")).toBeNull();
    expect(lookupRate(table, "provider-a/model")?.inputCostPerToken).toBe(1);
  });

  it("uses the provider-reported total when available", () => {
    expect(priceUsage(new Map(), "unknown", totals, 2.5)).toEqual({
      costUsd: 2.5,
      costSource: "providerReported",
    });
  });

  it("calculates cached-token savings from the model rates", () => {
    const table = parseRateTable({
      model: {
        input_cost_per_token: 4e-6,
        output_cost_per_token: 20e-6,
        cache_read_input_token_cost: 0.4e-6,
        cache_creation_input_token_cost: 5e-6,
      },
    });

    expect(priceUsage(table, "model", totals, null).costUsd).toBeCloseTo(0.00185, 9);
    expect(cacheSavingsUsd(table, "model", totals)).toBeCloseTo(0.0036, 9);
  });

  it("uses custom token rates ahead of public and provider-reported costs", () => {
    const table = parseRateTable({
      "example-model": { input_cost_per_token: 1, output_cost_per_token: 5 },
    });
    const overrides = createOverrideRateTable({
      "example-model": {
        inputCostPerMillionTokens: 2,
        outputCostPerMillionTokens: 8,
        cacheReadCostPerMillionTokens: 0.5,
        cacheWriteCostPerMillionTokens: 3,
      },
    });

    for (const reportedCostUsd of [null, 99]) {
      expect(priceUsage(table, "example-model", millionTotals, reportedCostUsd, overrides)).toEqual(
        {
          costUsd: 13.5,
          costSource: "modelPriced",
        },
      );
    }
    expect(cacheSavingsUsd(table, "example-model", millionTotals, overrides)).toBe(1.5);
  });

  it("prices unknown models offline and uses input prices for omitted cache rates", () => {
    const table = parseRateTable({});
    const overrides = createOverrideRateTable({
      "example-model": { inputCostPerMillionTokens: 2, outputCostPerMillionTokens: 8 },
    });

    expect(priceUsage(table, "example-model", millionTotals, null, overrides)).toEqual({
      costUsd: 14,
      costSource: "modelPriced",
    });
    expect(cacheSavingsUsd(table, "example-model", millionTotals, overrides)).toBe(0);
  });

  it("preserves explicit zero rates and matches only the exact trimmed model ID", () => {
    const table = parseRateTable({});
    const overrides = createOverrideRateTable({
      " vendor/example-model[1m] ": {
        inputCostPerMillionTokens: 0,
        outputCostPerMillionTokens: 0,
      },
    });
    expect(priceUsage(table, " vendor/example-model[1m] ", millionTotals, 99, overrides)).toEqual({
      costUsd: 0,
      costSource: "modelPriced",
    });
    for (const model of [
      "example-model[1m]",
      "vendor/example-model",
      "vendor/Example-model[1m]",
      "other/example-model[1m]",
    ]) {
      expect(priceUsage(table, model, millionTotals, null, overrides).costSource).toBe("unpriced");
      expect(priceUsage(table, model, millionTotals, 99, overrides)).toEqual({
        costUsd: 99,
        costSource: "providerReported",
      });
    }
  });

  it("prices a bracketed context-tier variant at the base model's rate", () => {
    const table = parseRateTable({
      "claude-fable-5-1": {
        input_cost_per_token: 1e-5,
        output_cost_per_token: 5e-5,
        cache_read_input_token_cost: 2.5e-7,
      },
    });

    expect(lookupRate(table, "claude-fable-5-1[1m]")).toEqual(
      lookupRate(table, "claude-fable-5-1"),
    );
  });
});
