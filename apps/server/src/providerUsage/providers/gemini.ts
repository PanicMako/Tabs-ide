// Purpose: Explain Gemini API quota visibility without pretending an API-key quota endpoint exists.

import { getProviderSecret } from "../../provider/ProviderSecretStore.ts";
import { credentialFingerprint } from "../credentials.ts";
import { unsupportedSnapshot } from "../parse.ts";
import type { ProviderUsageContext, ProviderUsageFetcher } from "../types.ts";

const SOURCE = "gemini-ai-studio";

async function resolveGeminiApiKey(ctx: ProviderUsageContext): Promise<string | null> {
  const fromEnvironment = ctx.env.GEMINI_API_KEY?.trim() || ctx.env.GOOGLE_API_KEY?.trim();
  if (fromEnvironment) return fromEnvironment;
  return getProviderSecret("gemini.api-key");
}

export const geminiUsageFetcher: ProviderUsageFetcher = {
  provider: "gemini",
  async cacheKey(ctx) {
    const key = await resolveGeminiApiKey(ctx);
    return key ? credentialFingerprint(key) : `${ctx.homeDir}:none`;
  },
  async fetch(ctx) {
    const key = await resolveGeminiApiKey(ctx);
    return unsupportedSnapshot(
      "gemini",
      ctx.nowMs,
      SOURCE,
      key
        ? "Google does not expose current Gemini API quota consumption through an API-key endpoint. View project limits and usage in Google AI Studio."
        : "Configure a Gemini API key for requests. Google exposes current project limits and usage in Google AI Studio, not through an API-key quota endpoint.",
    );
  },
};
