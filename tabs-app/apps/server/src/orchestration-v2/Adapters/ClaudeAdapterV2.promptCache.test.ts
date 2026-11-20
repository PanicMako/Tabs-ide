import { describe, expect, it } from "vitest";
import * as DateTime from "effect/DateTime";
import { claudePromptCacheTtlMs, claudeProviderTurnTokenUsage } from "./ClaudeAdapterV2.ts";

describe("claudePromptCacheTtlMs", () => {
  it("reads the lifetime from what the request cached", () => {
    expect(
      claudePromptCacheTtlMs({ ephemeral_1h_input_tokens: 10, ephemeral_5m_input_tokens: 0 }),
    ).toBe(60 * 60_000);
    expect(
      claudePromptCacheTtlMs({ ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 10 }),
    ).toBe(5 * 60_000);
    expect(
      claudePromptCacheTtlMs({ ephemeral_1h_input_tokens: 5, ephemeral_5m_input_tokens: 5 }),
    ).toBe(60 * 60_000);
  });
  it("is unknown when nothing was cached, as with a request served wholly from cache", () => {
    expect(
      claudePromptCacheTtlMs({ ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 }),
    ).toBeUndefined();
    expect(claudePromptCacheTtlMs(null)).toBeUndefined();
    expect(claudePromptCacheTtlMs(undefined)).toBeUndefined();
  });
});

describe("claudeProviderTurnTokenUsage cache expiry", () => {
  const model = { instanceId: "claudeAgent", model: "claude-sonnet-4-5" } as never;
  const at = DateTime.makeUnsafe("2026-01-01T12:00:00.000Z");
  const usage = {
    input_tokens: 10,
    cache_creation_input_tokens: 100,
    cache_read_input_tokens: 5,
    output_tokens: 20,
    cache_creation: { ephemeral_1h_input_tokens: 100, ephemeral_5m_input_tokens: 0 },
  };
  it("dates the expiry from the request time", () => {
    const result = claudeProviderTurnTokenUsage(usage, model, "2026-01-01T12:00:05.000Z", at);
    expect(result.usedTokens).toBe(135);
    expect(result.promptCacheTtlMs).toBe(60 * 60_000);
    expect(result.promptCacheExpiresAt).toBe("2026-01-01T13:00:00.000Z");
  });
  it("leaves the expiry out when it cannot be known", () => {
    const noCache = claudeProviderTurnTokenUsage(
      { ...usage, cache_creation: null },
      model,
      "2026-01-01T12:00:05.000Z",
      at,
    );
    expect("promptCacheExpiresAt" in noCache).toBe(false);
    const noTime = claudeProviderTurnTokenUsage(usage, model, "2026-01-01T12:00:05.000Z");
    expect("promptCacheExpiresAt" in noTime).toBe(false);
  });
});
