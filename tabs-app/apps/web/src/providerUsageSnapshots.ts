import type { ServerProvider, ServerListProviderUsageResult } from "@tabs/contracts";

/** Adapt authoritative V2 provider quotas for the existing limits page. */
export function providerUsageSnapshots(
  providers: readonly ServerProvider[],
  filter?: string,
): ServerListProviderUsageResult {
  return providers
    .filter((p) => p.enabled && (!filter || p.driver === filter))
    .map((p) => {
      const quota = p.usageLimits;
      const unavailable = quota?.unavailable;
      return {
        provider: p.driver === "claudeAgent" ? "claude" : p.driver,
        providerInstanceId: p.instanceId,
        updatedAt: quota?.checkedAt ?? p.checkedAt,
        source: "provider",
        status:
          quota && quota.windows.length > 0 && !unavailable
            ? "ok"
            : p.auth.status === "unauthenticated" || p.auth.status === "unknown"
              ? "needs-auth"
              : unavailable?.reason === "unsupported"
                ? "unsupported"
                : "quota-unavailable",
        detail:
          unavailable?.message ??
          (!quota || quota.windows.length === 0
            ? "This provider has not reported account quota data."
            : undefined),
        limits: (quota?.windows ?? []).map((w) => ({
          window: w.label,
          usedPercent: w.usedPercent,
          ...(w.resetsAt ? { resetsAt: w.resetsAt } : {}),
          ...(w.windowDurationMins === undefined
            ? {}
            : { windowDurationMins: w.windowDurationMins }),
        })),
        usageLines: [],
      };
    });
}
