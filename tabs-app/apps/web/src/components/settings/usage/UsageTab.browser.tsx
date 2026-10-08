import "../../../index.css";
import type { UsageSummary, UsageDay } from "@tabs/contracts";
import { USAGE_CONTRACT_VERSION } from "@tabs/contracts";
import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  AppAtomRegistryProvider,
  appAtomRegistry,
  resetAppAtomRegistryForTests,
} from "../../../state/atomRegistry";
import { usageSummaryStateAtom, usageTimeWindowAtom } from "../../../state/usage";
import { UsageTab } from "./UsageTab";

function seed() {
  resetAppAtomRegistryForTests();
  const data: UsageSummary = {
    contractVersion: USAGE_CONTRACT_VERSION,
    readAt: "2026-10-08T12:00:00.000Z",
    timeZone: "UTC",
    sinceDay: "2026-10-08" as UsageDay,
    untilDay: "2026-10-08" as UsageDay,
    buckets: [
      {
        day: "2026-10-08" as UsageDay,
        hourStart: "2026-10-08T10:00:00.000Z",
        provider: "codex",
        model: "unknown-model",
        totals: {
          uncachedInputTokens: 100,
          cachedInputTokens: 200,
          cacheCreationTokens: 0,
          outputTokens: 50,
          reasoningTokens: 0,
        },
        costUsd: 0,
        cacheSavingsUsd: 0,
        costSource: "unpriced",
        records: 1,
        unpricedRecords: 1,
        sessions: 1,
      },
    ],
    sources: [
      {
        fingerprint: {
          hostId: "test",
          provider: "codex",
          resolvedHomePath: "/test",
          volumeId: "test",
        },
        status: "ok",
        scannedFiles: 1,
        skippedFiles: 0,
        malformedRecords: 0,
        distinctSessions: 1,
        message: null,
      },
    ],
    pricing: { status: "fresh", source: "litellm", fetchedAt: null, knownModels: 0 },
    scanDurationMs: 1,
  };
  appAtomRegistry.set(usageSummaryStateAtom, {
    data,
    loading: false,
    error: null,
    lastFetchedAt: Date.now(),
  });
}
afterEach(() => resetAppAtomRegistryForTests());

it("distinguishes unknown prices from zero cost and retains token details", async () => {
  seed();
  const view = await render(
    <AppAtomRegistryProvider>
      <UsageTab />
    </AppAtomRegistryProvider>,
  );
  try {
    await expect
      .element(page.getByRole("button", { name: "Set prices for unknown-model", exact: true }))
      .toBeVisible();
    await page.getByRole("radio", { name: "API cost", exact: true }).click();
    await expect.element(page.getByRole("cell", { name: "—", exact: true })).toBeVisible();
    await page.getByText("Token details", { exact: false }).click();
    await expect.element(page.getByText("Uncached input", { exact: true })).toBeVisible();
    await page.getByRole("radio", { name: "Providers", exact: true }).click();
    await expect
      .element(page.getByRole("columnheader", { name: "Provider", exact: true }))
      .toBeVisible();
  } finally {
    await view.unmount();
  }
});
it("uses hourly buckets and confines narrow table overflow to its scroll area", async () => {
  seed();
  appAtomRegistry.set(usageTimeWindowAtom, "24h");
  const view = await render(
    <AppAtomRegistryProvider>
      <div style={{ width: 360 }}>
        <UsageTab />
      </div>
    </AppAtomRegistryProvider>,
  );
  try {
    await expect
      .element(page.getByRole("img", { name: "Hourly token usage across 1 intervals" }))
      .toBeVisible();
    const dashboard = page.getByRole("region", { name: "Usage overview" }).element().parentElement!;
    expect(dashboard.scrollWidth).toBeLessThanOrEqual(360);
  } finally {
    await view.unmount();
  }
});
it("shows refresh failures alongside retained data", async () => {
  seed();
  appAtomRegistry.update(usageSummaryStateAtom, (state) => ({
    ...state,
    error: "Provider offline",
  }));
  const view = await render(
    <AppAtomRegistryProvider>
      <UsageTab />
    </AppAtomRegistryProvider>,
  );
  try {
    await expect.element(page.getByRole("alert")).toHaveTextContent("Provider offline");
  } finally {
    await view.unmount();
  }
});
