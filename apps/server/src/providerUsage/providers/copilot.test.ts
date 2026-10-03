import { describe, expect, it } from "vitest";

import { buildCopilotQuotaSnapshot } from "./copilot.ts";

describe("buildCopilotQuotaSnapshot", () => {
  it("maps premium-interaction entitlement and remaining quota", () => {
    const snapshot = buildCopilotQuotaSnapshot(
      {
        quotaSnapshots: {
          premium_interactions: {
            isUnlimitedEntitlement: false,
            entitlementRequests: 300,
            usedRequests: 75,
            usageAllowedWithExhaustedQuota: false,
            remainingPercentage: 75,
            overage: 0,
            overageAllowedWithExhaustedQuota: false,
            resetDate: "2026-09-01T00:00:00Z",
          },
        },
      },
      Date.parse("2026-08-25T00:00:00Z"),
    );

    expect(snapshot.limits).toEqual([
      {
        window: "premium_interactions",
        usedPercent: 25,
        resetsAt: "2026-09-01T00:00:00Z",
      },
    ]);
    expect(snapshot.usageLines[0]?.value).toBe("75 of 300 used");
  });
});
