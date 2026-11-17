import type { ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import { providerUsageSnapshotsAtom } from "../../../state/usage";
import { ProviderQuotaCard } from "./ProviderQuotaCard";
import { UsageLimitsSection } from "../../usage/UsageLimits";
import { UsageProviderSettings } from "../UsageProviderSettings";
import { PageLoadingState } from "../../PageLoadingState";
import "./usage.css";

export function LimitsTab({ subTabControl }: { subTabControl?: ReactNode } = {}) {
  const state = useAtomValue(providerUsageSnapshotsAtom);
  const snapshots = state.data ?? [];
  const reported = snapshots.filter((snapshot) => snapshot.status === "ok");
  const unavailable = snapshots.filter((snapshot) => snapshot.status !== "ok");

  // Count snapshots per provider driver so we can label "Antigravity 1" / "Antigravity 2" etc.
  const providerCounts = new Map<string, number>();
  for (const snapshot of snapshots) {
    providerCounts.set(snapshot.provider, (providerCounts.get(snapshot.provider) ?? 0) + 1);
  }
  // Assign ordinals in render order (1-based, per driver).
  const ordinalCounters = new Map<string, number>();
  const nextOrdinal = (provider: string): number => {
    const n = (ordinalCounters.get(provider) ?? 0) + 1;
    ordinalCounters.set(provider, n);
    return n;
  };

  return (
    <div className="usage-dashboard">
      {subTabControl ? <div className="usage-toolbar">{subTabControl}</div> : null}
      <div className="usage-section-heading">
        <h3>Provider limits</h3>
        <span>{reported.length} reporting</span>
      </div>
      <p className="usage-notice">
        Quotas come from your providers. Missing data does not mean unlimited usage.
      </p>
      {state.error ? (
        <p role="alert" className="usage-notice">
          Could not refresh limits. {state.error}
        </p>
      ) : null}
      {state.loading && snapshots.length === 0 ? (
        <PageLoadingState compact className="h-48" label="Checking provider limits" />
      ) : reported.length > 0 ? (
        <div className="usage-quota-grid">
          {reported.map((snapshot) => (
            <ProviderQuotaCard
              key={snapshot.providerInstanceId ?? snapshot.provider}
              snapshot={snapshot}
              accountOrdinal={nextOrdinal(snapshot.provider)}
              accountCount={providerCounts.get(snapshot.provider)}
            />
          ))}
        </div>
      ) : (
        <div className="usage-empty">
          <h3>No quota data reported</h3>
          <p>Check provider connections or add a usage hub below.</p>
        </div>
      )}
      <details className="usage-details">
        <summary>
          Pooled quota details <span>Across connected accounts</span>
        </summary>
        <div className="pt-4">
          <UsageLimitsSection />
        </div>
      </details>
      {unavailable.length > 0 ? (
        <details className="usage-details">
          <summary>
            Unavailable providers <span>{unavailable.length}</span>
          </summary>
          <div className="usage-quota-grid">
            {unavailable.map((snapshot) => (
              <ProviderQuotaCard
                key={snapshot.providerInstanceId ?? snapshot.provider}
                snapshot={snapshot}
                accountOrdinal={nextOrdinal(snapshot.provider)}
                accountCount={providerCounts.get(snapshot.provider)}
              />
            ))}
          </div>
        </details>
      ) : null}
      <details className="usage-details">
        <summary>
          Usage connections <span>Manage quota hubs</span>
        </summary>
        <div className="pt-4">
          <UsageProviderSettings />
        </div>
      </details>
    </div>
  );
}
