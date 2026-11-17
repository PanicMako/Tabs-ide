import { UsageLimitsSection } from "../usage/UsageLimits";
import { useWorkspaceUsagePins } from "./workspaceActionsState";

/** What is left of each provider's subscription limits, laid out to fit the card. */
export function WorkspaceUsagePane({ workspaceKey }: { readonly workspaceKey: string }) {
  const [pinned, togglePinned] = useWorkspaceUsagePins(workspaceKey);
  return (
    <div className="min-w-0">
      <UsageLimitsSection compact pinnedDrivers={pinned} onTogglePinned={togglePinned} />
    </div>
  );
}
