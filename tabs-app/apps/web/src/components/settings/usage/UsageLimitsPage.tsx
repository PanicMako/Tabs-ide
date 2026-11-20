import "./usage.css";
import { useEffect, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { RefreshCwIcon } from "lucide-react";
import {
  usageActiveSubTabAtom,
  usageSummaryStateAtom,
  fetchUsageSummary,
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
import { MotionEnter } from "../../ui/motion-enter";

const PAGES: ReadonlyArray<{ value: UsageSubTab; label: string; caption: string }> = [
  { value: "usage", label: "Usage", caption: "What your agents spent" },
  { value: "limits", label: "Limits", caption: "What your plans have left" },
];

export function UsageLimitsPage() {
  const activeSubTab = useAtomValue(usageActiveSubTabAtom);
  const summaryState = useAtomValue(usageSummaryStateAtom);
  const [refreshingLimits, setRefreshingLimits] = useState(false);

  // Subscribes to pushed quota updates and starts the first scan; both outlive the page.
  useEffect(() => {
    initUsageListeners();
    void fetchUsageSummary();
  }, []);

  const refreshing = activeSubTab === "usage" ? summaryState.loading : refreshingLimits;
  const handleRefresh = async () => {
    if (activeSubTab === "usage") {
      await fetchUsageSummary(undefined, { force: true });
      return;
    }
    setRefreshingLimits(true);
    try {
      await refreshAllProviderUsage();
    } finally {
      setRefreshingLimits(false);
    }
  };

  return (
    <div className="usage-page">
      <SettingsSectionHeader
        title="Usage & Limits"
        description="Where your tokens went, and how much of each plan is left."
        actions={
          <Button
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            variant="outline"
            size="sm"
            aria-label={
              activeSubTab === "usage"
                ? refreshing
                  ? "Refreshing usage"
                  : "Refresh usage"
                : refreshing
                  ? "Refreshing limits"
                  : "Refresh limits"
            }
          >
            <RefreshCwIcon className={cn("size-3.5", refreshing && "animate-spin")} aria-hidden />
            Refresh
          </Button>
        }
      />
      <nav className="usage-pages" role="tablist" aria-label="Usage settings section">
        {PAGES.map((page) => (
          <button
            key={page.value}
            type="button"
            role="tab"
            aria-selected={activeSubTab === page.value}
            onClick={() => appAtomRegistry.set(usageActiveSubTabAtom, page.value)}
          >
            <span>{page.label}</span>
            <small>{page.caption}</small>
          </button>
        ))}
      </nav>
      <MotionEnter key={activeSubTab} preset="panel" role="tabpanel" className="min-w-0">
        {activeSubTab === "usage" ? <UsageTab /> : <LimitsTab />}
      </MotionEnter>
    </div>
  );
}
