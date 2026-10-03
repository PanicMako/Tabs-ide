// FILE: providerUsage/providers/copilot.ts
// Purpose: Read account-scoped GitHub Copilot quota through the official SDK runtime.

import { CopilotClient } from "@github/copilot-sdk";
import { buildCopilotEnvironment } from "../../provider/acp/CopilotAcpSupport.ts";
import { getCopilotToken } from "../../provider/CopilotCredentialStore.ts";
import { buildSnapshot, errorSnapshot, needsAuthSnapshot } from "../parse.ts";
import type { ProviderUsageFetcher } from "../types.ts";

interface CopilotQuotaResult {
  readonly quotaSnapshots: Record<
    string,
    | {
        readonly isUnlimitedEntitlement: boolean;
        readonly entitlementRequests: number;
        readonly usedRequests: number;
        readonly remainingPercentage: number;
        readonly overage: number;
        readonly resetDate?: string;
        readonly usageAllowedWithExhaustedQuota?: boolean;
        readonly overageAllowedWithExhaustedQuota?: boolean;
      }
    | undefined
  >;
}

export function buildCopilotQuotaSnapshot(quota: CopilotQuotaResult, nowMs: number) {
  const entries = Object.entries(quota.quotaSnapshots).filter(
    (entry): entry is [string, NonNullable<(typeof entry)[1]>] => Boolean(entry[1]),
  );
  return buildSnapshot({
    provider: "copilot",
    nowMs,
    source: "copilot.account.getQuota",
    limits: entries.map(([name, snapshot]) => ({
      window: name,
      usedPercent: snapshot.isUnlimitedEntitlement
        ? 0
        : Math.max(0, Math.min(100, 100 - snapshot.remainingPercentage)),
      ...(snapshot.resetDate ? { resetsAt: snapshot.resetDate } : {}),
    })),
    usageLines: entries.map(([name, snapshot]) => ({
      label: name.replaceAll("_", " "),
      value: snapshot.isUnlimitedEntitlement
        ? "Unlimited"
        : `${snapshot.usedRequests} of ${snapshot.entitlementRequests} used`,
      ...(snapshot.overage > 0 ? { subtitle: `${snapshot.overage} additional usage` } : {}),
    })),
    detail: "Quota reported by the authenticated GitHub Copilot account.",
  });
}

export const copilotUsageFetcher: ProviderUsageFetcher = {
  provider: "copilot",
  async cacheKey(ctx) {
    const token = await getCopilotToken();
    return token ? `token:${token.length}:${token.slice(-4)}` : `${ctx.homeDir}:copilot-account`;
  },
  async fetch(ctx) {
    const token = await getCopilotToken();
    const client = new CopilotClient({
      env: buildCopilotEnvironment(undefined, ctx.env, token),
      ...(token ? { gitHubToken: token } : {}),
      logLevel: "none",
    });
    try {
      await client.start();
      const quota = await client.rpc.account.getQuota(token ? { gitHubToken: token } : {});
      return buildCopilotQuotaSnapshot(quota, ctx.nowMs);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      return /unauthorized|not logged in|authentication/iu.test(detail)
        ? needsAuthSnapshot("copilot", ctx.nowMs, "copilot.account.getQuota", detail)
        : errorSnapshot("copilot", ctx.nowMs, "copilot.account.getQuota", detail);
    } finally {
      await client.stop().catch(() => []);
    }
  },
};
