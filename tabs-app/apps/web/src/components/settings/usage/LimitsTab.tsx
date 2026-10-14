import { useAtomValue } from "@effect/atom-react";
import { providerUsageSnapshotsAtom } from "../../../state/usage";
import { ProviderQuotaCard } from "./ProviderQuotaCard";
import { UsageLimitsSection } from "../../usage/UsageLimits";
import { UsageProviderSettings } from "../UsageProviderSettings";
import { PageLoadingState } from "../../PageLoadingState";
import "./usage.css";

export function LimitsTab() {
  const state = useAtomValue(providerUsageSnapshotsAtom);
  const snapshots = state.data ?? [];
  const reported = snapshots.filter((snapshot) => snapshot.status === "ok");
  const unavailable = snapshots.filter((snapshot) => snapshot.status !== "ok");

  return (
    <div className="usage-dashboard">
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
            <ProviderQuotaCard key={snapshot.provider} snapshot={snapshot} />
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
              <ProviderQuotaCard key={snapshot.provider} snapshot={snapshot} />
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
