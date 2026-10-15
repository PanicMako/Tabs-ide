import { expect, it } from "vitest";
import { makeTestServerProvider } from "./test/serverProviderFixture";
import { providerUsageSnapshots } from "./providerUsageSnapshots";

it("uses real provider quota windows and preserves instance identity", () => {
  const provider = makeTestServerProvider({
    usageLimits: {
      checkedAt: "2026-10-14T12:00:00.000Z",
      windows: [
        {
          id: "primary",
          kind: "session",
          label: "Session",
          usedPercent: 37,
          windowDurationMins: 300,
        },
      ],
    },
  });
  expect(providerUsageSnapshots([provider])[0]).toMatchObject({
    providerInstanceId: provider.instanceId,
    status: "ok",
    limits: [{ window: "Session", usedPercent: 37, windowDurationMins: 300 }],
  });
});
it("does not fabricate quota for unsupported providers or expose disabled instances", () => {
  const disabled = makeTestServerProvider({ enabled: false });
  const unknown = makeTestServerProvider({ usageLimits: undefined });
  expect(providerUsageSnapshots([disabled, unknown])).toHaveLength(1);
  expect(providerUsageSnapshots([unknown])[0]).toMatchObject({
    status: "quota-unavailable",
    limits: [],
  });
});

it("does not call an empty account quota a reported limit", () => {
  const provider = makeTestServerProvider({
    usageLimits: { checkedAt: "2026-10-14T12:00:00.000Z", windows: [] },
  });
  expect(providerUsageSnapshots([provider])[0]?.status).toBe("quota-unavailable");
});
