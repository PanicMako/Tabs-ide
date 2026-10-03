import { useMemo } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { ServerProviderUsageSnapshot } from "@tabs/contracts";
import { providerUsageSnapshotsAtom } from "../../../state/usage";
import { serverSettingsAtom } from "../../../state/settings";
import { ProviderQuotaCard } from "./ProviderQuotaCard";
import { UsageLimitsSection } from "../../usage/UsageLimits";
import { UsageProviderSettings } from "../UsageProviderSettings";
import { InfoIcon } from "lucide-react";
import { PageLoadingState } from "../../PageLoadingState";

const ALL_ACP_PROVIDERS = [
  "codex",
  "claudeAgent",
  "cursor",
  "copilot",
  "grok",
  "gemini",
  "opencode",
  "droid",
  "kilo",
  "antigravity",
  "openrouter",
] as const;

export function LimitsTab() {
  const snapshotsState = useAtomValue(providerUsageSnapshotsAtom);
  const serverSettings = useAtomValue(serverSettingsAtom);

  const snapshots = snapshotsState.data ?? [];
  const snapshotsByProvider = useMemo(() => {
    const map = new Map<string, ServerProviderUsageSnapshot>();
    for (const snap of snapshots) {
      map.set(snap.provider, snap);
    }
    return map;
  }, [snapshots]);

  // Providers list ordered by standard ACP list with connected providers prioritized
  const providerCards = useMemo(() => {
    const cards = ALL_ACP_PROVIDERS.map((provider) => {
      const existing = snapshotsByProvider.get(provider);
      const isEnabled = (serverSettings.providers as any)?.[provider]?.enabled !== false;

      if (existing) {
        return { snapshot: existing, isEnabled };
      }

      // Default fallback snapshot for unprobed / newly added provider
      const fallback: ServerProviderUsageSnapshot = {
        provider: provider as any,
        updatedAt: new Date().toISOString(),
        source: "local",
        status: "unsupported",
        planName: undefined,
        limits: [],
        usageLines: [],
        detail: "Live quota integration is not available for this provider.",
      };
      return { snapshot: fallback, isEnabled };
    });

    return [...cards].sort((a, b) => {
      const aConnected =
        a.snapshot.status === "ok" &&
        (a.snapshot.limits.length > 0 || a.snapshot.planName || a.snapshot.email);
      const bConnected =
        b.snapshot.status === "ok" &&
        (b.snapshot.limits.length > 0 || b.snapshot.planName || b.snapshot.email);
      if (aConnected && !bConnected) return -1;
      if (!aConnected && bConnected) return 1;

      const aAuth = a.snapshot.status !== "needs-auth" && a.snapshot.status !== "error";
      const bAuth = b.snapshot.status !== "needs-auth" && b.snapshot.status !== "error";
      if (aAuth && !bAuth) return -1;
      if (!aAuth && bAuth) return 1;

      if (a.isEnabled && !b.isEnabled) return -1;
      if (!a.isEnabled && b.isEnabled) return 1;

      return 0;
    });
  }, [snapshotsByProvider, serverSettings.providers]);

  return (
    <div className="space-y-8">
      {/* Live Pooled Provider Limits */}
      <UsageLimitsSection />

      {/* Hub Configuration */}
      <UsageProviderSettings />

      {/* Provider Quota Probes */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Local Provider Quota Probes</h3>
          <p className="text-xs text-muted-foreground">
            Direct quota and token probe snapshots detected from local CLI credentials.
          </p>
        </div>

        {snapshotsState.loading && snapshots.length === 0 ? (
          <PageLoadingState
            compact
            className="h-48"
            label="Fetching provider limits"
            detail="Checking live quota snapshots from your configured providers…"
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {providerCards.map(({ snapshot, isEnabled }) => (
              <ProviderQuotaCard
                key={snapshot.provider}
                snapshot={snapshot}
                isEnabled={isEnabled}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer Note */}
      <div className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-muted/30 p-4 text-xs text-muted-foreground backdrop-blur-sm">
        <InfoIcon className="mt-0.5 size-4 shrink-0 text-foreground" />
        <p className="leading-relaxed">
          Usage is read locally from each provider CLI&apos;s stored credentials and fetched
          directly from the provider. Short-lived tokens are refreshed through the provider&apos;s
          own CLI or official token endpoint.
        </p>
      </div>
    </div>
  );
}
