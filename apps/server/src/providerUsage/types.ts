// FILE: providerUsage/types.ts
// Purpose: Shared contract for the server-side live provider-usage fetchers.

import type { ServerProviderUsageSnapshot } from "@tabs/contracts";

export interface ProviderUsageContext {
  /** Resolved user home directory (ServerConfig.homeDir). */
  readonly homeDir: string;
  /** Process environment (lets fetchers honor CODEX_HOME, CLAUDE_CONFIG_DIR, etc.). */
  readonly env: NodeJS.ProcessEnv;
  /** Host platform; keychain reads only run on darwin. */
  readonly platform: NodeJS.Platform;
  /** Reference "now" in epoch ms, used for token-expiry checks (kept injectable for tests). */
  readonly nowMs: number;
  /** Claude CLI binary (settings.providers.claudeAgent.binaryPath); defaults to "claude". */
  readonly claudeBinaryPath?: string;
}

export interface ProviderUsageFetcher {
  readonly provider: string;
  readonly cacheKey?: (ctx: ProviderUsageContext) => Promise<string | null>;
  fetch(ctx: ProviderUsageContext): Promise<ServerProviderUsageSnapshot>;
}
