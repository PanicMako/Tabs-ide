import { UsageLimitsSection } from "../usage/UsageLimits";

/** What is left of each provider's subscription limits, laid out to fit the card. */
export function WorkspaceUsagePane() {
  return (
    <div className="min-w-0">
      <UsageLimitsSection compact />
    </div>
  );
}
