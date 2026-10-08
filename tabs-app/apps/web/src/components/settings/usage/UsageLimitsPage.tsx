import { SegmentedControl } from "../../ui/segmented-control";
import "./usage.css";
import { useEffect, useMemo, useState } from "react";
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
import { getActiveFontCombo } from "../../../lib/themes";
import { useTheme } from "../../../hooks/useTheme";
import { RefreshCwIcon } from "lucide-react";

export function UsageLimitsPage() {
  const { fontPreferences } = useTheme();
  const activeFontCombo = useMemo(() => getActiveFontCombo(fontPreferences), [fontPreferences]);
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
      await Promise.all([fetchUsageSummary(), refreshAllProviderUsage()]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const setSubTab = (tab: UsageSubTab) => {
    appAtomRegistry.set(usageActiveSubTabAtom, tab);
  };

  const isLoading = isRefreshing || summaryState.loading || snapshotsState.loading;

  return (
    <div className="usage-page space-y-5">
      {/* Top Header */}
      <div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <h2
              className={cn(
                "text-[28px] font-bold leading-relaxed pb-1 text-foreground",
                activeFontCombo.sansClass,
              )}
              style={{ fontFamily: "var(--font-sans)", textTransform: "capitalize" }}
            >
              Usage & Limits
            </h2>
            <p className="text-sm text-muted-foreground">
              Your agent activity and reported provider quotas.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={handleRefresh}
              disabled={isLoading}
              variant="outline"
              size="sm"
              className="gap-1.5 shadow-xs border-border/80"
              aria-label={isLoading ? "Refreshing usage and limits" : "Refresh usage and limits"}
            >
              <RefreshCwIcon className={cn("size-3.5", isLoading && "animate-spin")} />
              <span>Refresh</span>
            </Button>
          </div>
        </div>

        {/* Decorative Divider Gradient matching neighboring settings pages */}
        <div
          className="h-[5px] w-full my-5 rounded-full dark:block hidden"
          style={{
            background: "linear-gradient(to right, rgba(255,255,255,0.25), transparent)",
          }}
        />
        <div
          className="h-[5px] w-full my-5 rounded-full dark:hidden block"
          style={{
            background: "linear-gradient(to right, rgba(0,0,0,0.12), transparent)",
          }}
        />
      </div>

      <SegmentedControl
        value={activeSubTab}
        onValueChange={setSubTab}
        options={[
          { value: "usage", label: "Overview" },
          { value: "limits", label: "Provider limits" },
        ]}
        aria-label="Usage settings section"
      />

      {/* Main Tab Content */}
      <div className="min-w-0">{activeSubTab === "usage" ? <UsageTab /> : <LimitsTab />}</div>
    </div>
  );
}
