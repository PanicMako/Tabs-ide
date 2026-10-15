import { SegmentedControl } from "../../ui/segmented-control";
import "./usage.css";
import { useEffect, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  usageActiveSubTabAtom,
  usageSummaryStateAtom,
  providerUsageSnapshotsAtom,
  fetchUsageSummary,
  fetchProviderUsageSnapshots,
  refreshAllProviderUsage,
  initUsageListeners,
  type UsageSubTab,
} from "../../../state/usage";
import { appAtomRegistry } from "../../../state/atomRegistry";
import { UsageTab } from "./UsageTab";
import { LimitsTab } from "./LimitsTab";
import { Button } from "../../ui/button";
import { cn } from "../../../lib/utils";
import { SettingsSectionHeader } from "../SettingsLayout";
import { RefreshCwIcon } from "lucide-react";

export function UsageLimitsPage() {
  const activeSubTab = useAtomValue(usageActiveSubTabAtom);
  const summaryState = useAtomValue(usageSummaryStateAtom);
  const snapshotsState = useAtomValue(providerUsageSnapshotsAtom);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    initUsageListeners();
    void fetchUsageSummary();
    void fetchProviderUsageSnapshots();
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([fetchUsageSummary(undefined, { force: true }), refreshAllProviderUsage()]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const setSubTab = (tab: UsageSubTab) => {
    appAtomRegistry.set(usageActiveSubTabAtom, tab);
  };

  const isLoading = isRefreshing || summaryState.loading || snapshotsState.loading;

  const subTabControl = (
    <SegmentedControl
      value={activeSubTab}
      onValueChange={setSubTab}
      options={[
        { value: "usage", label: "Overview" },
        { value: "limits", label: "Provider limits" },
      ]}
      aria-label="Usage settings section"
      size="sm"
    />
  );

  return (
    <div className="usage-page space-y-5">
      <SettingsSectionHeader
        title="Usage & Limits"
        description="Your agent activity and reported provider quotas."
        actions={
          <Button
            onClick={handleRefresh}
            disabled={isLoading}
            variant="outline"
            size="sm"
            aria-label={isLoading ? "Refreshing usage and limits" : "Refresh usage and limits"}
          >
            <RefreshCwIcon className={cn("size-3.5 mr-1.5", isLoading && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      {/* Main Tab Content */}
      <div className="min-w-0">
        {activeSubTab === "usage" ? (
          <UsageTab subTabControl={subTabControl} />
        ) : (
          <LimitsTab subTabControl={subTabControl} />
        )}
      </div>
    </div>
  );
}
