// FILE: providerUsage/registry.ts
// Purpose: Map each supported provider kind to its live usage fetcher.

import { antigravityUsageFetcher } from "./providers/antigravity";
import { claudeUsageFetcher } from "./providers/claude";
import { codexUsageFetcher } from "./providers/codex";
import { cursorUsageFetcher } from "./providers/cursor";
import { copilotUsageFetcher } from "./providers/copilot";
import { grokUsageFetcher } from "./providers/grok";
import { geminiUsageFetcher } from "./providers/gemini";
import { droidUsageFetcher, kiloUsageFetcher, piUsageFetcher } from "./providers/localCredential";
import { opencodeUsageFetcher } from "./providers/opencode";
import { openRouterUsageFetcher } from "./providers/openrouter";
import type { ProviderUsageFetcher } from "./types";

export const PROVIDER_USAGE_FETCHERS: Record<string, ProviderUsageFetcher> = {
  codex: codexUsageFetcher,
  claudeAgent: claudeUsageFetcher,
  claude: claudeUsageFetcher,
  cursor: cursorUsageFetcher,
  copilot: copilotUsageFetcher,
  antigravity: antigravityUsageFetcher,
  gemini: geminiUsageFetcher,
  openrouter: openRouterUsageFetcher,
  grok: grokUsageFetcher,
  droid: droidUsageFetcher,
  kilo: kiloUsageFetcher,
  opencode: opencodeUsageFetcher,
  pi: piUsageFetcher,
};
