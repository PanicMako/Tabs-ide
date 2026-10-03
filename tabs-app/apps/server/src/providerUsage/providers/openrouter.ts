// Purpose: Read OpenRouter account credits through the documented credits API.

import { getProviderSecret } from "../../provider/ProviderSecretStore.ts";
import { credentialFingerprint } from "../credentials.ts";
import { fetchJson, isAuthFailureStatus } from "../http.ts";
import {
  asFiniteNumber,
  asRecord,
  buildSnapshot,
  errorSnapshot,
  formatUsd,
  needsAuthSnapshot,
} from "../parse.ts";
import type { ProviderUsageContext, ProviderUsageFetcher } from "../types.ts";

const SOURCE = "openrouter-credits";
const CREDITS_URL = "https://openrouter.ai/api/v1/credits";

async function resolveOpenRouterApiKey(ctx: ProviderUsageContext): Promise<string | null> {
  const fromEnvironment = ctx.env.OPENROUTER_API_KEY?.trim();
  if (fromEnvironment) return fromEnvironment;
  return getProviderSecret("openrouter.api-key");
}

export function parseOpenRouterCredits(payload: unknown, nowMs: number) {
  const data = asRecord(asRecord(payload)?.data);
  const total = asFiniteNumber(data?.total_credits);
  const used = asFiniteNumber(data?.total_usage);
  if (total === undefined || used === undefined) {
    return errorSnapshot(
      "openrouter",
      nowMs,
      SOURCE,
      "OpenRouter returned an unexpected credits response.",
    );
  }
  const remaining = Math.max(0, total - used);
  const usedPercent = total > 0 ? Math.max(0, Math.min(100, (used / total) * 100)) : undefined;
  return buildSnapshot({
    provider: "openrouter",
    nowMs,
    source: SOURCE,
    planName: "Credits",
    limits: usedPercent === undefined ? [] : [{ window: "Purchased credits", usedPercent }],
    usageLines: [
      { label: "Remaining", value: formatUsd(remaining) },
      { label: "Used", value: `${formatUsd(used)} of ${formatUsd(total)}` },
    ],
    detail: "Credits reported by OpenRouter for the configured account key.",
  });
}

export const openRouterUsageFetcher: ProviderUsageFetcher = {
  provider: "openrouter",
  async cacheKey(ctx) {
    const key = await resolveOpenRouterApiKey(ctx);
    return key ? credentialFingerprint(key) : `${ctx.homeDir}:none`;
  },
  async fetch(ctx) {
    const key = await resolveOpenRouterApiKey(ctx);
    if (!key) {
      return needsAuthSnapshot(
        "openrouter",
        ctx.nowMs,
        SOURCE,
        "Add an OpenRouter API key in Settings → Providers to read account credits.",
      );
    }
    const response = await fetchJson({
      service: "provider-usage-openrouter",
      url: CREDITS_URL,
      allowedOrigins: [new URL(CREDITS_URL).origin],
      headers: { Authorization: `Bearer ${key}` },
    });
    if (isAuthFailureStatus(response.status)) {
      return needsAuthSnapshot("openrouter", ctx.nowMs, SOURCE, "The OpenRouter key was rejected.");
    }
    if (!response.ok) {
      return errorSnapshot(
        "openrouter",
        ctx.nowMs,
        SOURCE,
        `OpenRouter credits request failed (${response.status || "network error"}).`,
      );
    }
    return parseOpenRouterCredits(response.json, ctx.nowMs);
  },
};
