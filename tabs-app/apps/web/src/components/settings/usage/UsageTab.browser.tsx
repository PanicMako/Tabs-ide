import "../../../index.css";
import type { UsageSummary, UsageDay } from "@tabs/contracts";
import { USAGE_CONTRACT_VERSION } from "@tabs/contracts";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  AppAtomRegistryProvider,
  appAtomRegistry,
  resetAppAtomRegistryForTests,
} from "../../../state/atomRegistry";
import {
  setUsageChartStyle,
  usageSummaryStateAtom,
  usageTimeWindowAtom,
} from "../../../state/usage";
import { UsageTab } from "./UsageTab";

function seed() {
  resetAppAtomRegistryForTests();
  setUsageChartStyle("bars");
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
    await expect.element(page.getByText("unknown-model", { exact: true })).toBeVisible();
    await page.getByRole("radio", { name: "API cost", exact: true }).click();
    await expect
      .element(page.getByRole("button", { name: "Set prices for unknown-model", exact: true }))
      .toBeVisible();
    await expect.element(page.getByText("—", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Uncached input", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^Codex \d/ }).click();
    await expect
      .element(page.getByRole("button", { name: /^Codex \d/, pressed: true }))
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Codex Clear provider" })).toBeVisible();
  } finally {
    await view.unmount();
  }
});
it("uses hourly periods, previews a scrubbed hour, and stays within a narrow width", async () => {
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
    const strip = page.getByRole("slider", { name: "Hourly token usage across 24 intervals" });
    await expect.element(strip).toBeVisible();
    await strip.element().focus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(strip).toHaveAttribute("aria-valuenow", "23");
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
    await expect.element(page.getByRole("region", { name: "Usage overview" })).toBeVisible();
  } finally {
    await view.unmount();
  }
});
it("switches the activity chart between bars and remembered lines", async () => {
  seed();
  const view = await render(
    <AppAtomRegistryProvider>
      <UsageTab />
    </AppAtomRegistryProvider>,
  );
  try {
    const plot = page.getByRole("slider");
    await expect.element(plot).toHaveAttribute("data-style", "bars");
    await page.getByRole("radio", { name: "Lines" }).click();
    await expect.element(plot).toHaveAttribute("data-style", "lines");
    expect(localStorage.getItem("tabs:usage-chart-style")).toBe("lines");
  } finally {
    await view.unmount();
    localStorage.removeItem("tabs:usage-chart-style");
  }
});
it("settles bars and lines fully visible under Strict Mode's double mount", async () => {
  seed();
  appAtomRegistry.set(usageTimeWindowAtom, "24h");
  const view = await render(
    <StrictMode>
      <AppAtomRegistryProvider>
        <UsageTab />
      </AppAtomRegistryProvider>
    </StrictMode>,
  );
  try {
    const stack = () =>
      document.querySelector<HTMLElement>(".usage-strip-stack[data-morph-height='100%']");
    await vi.waitFor(() => expect(stack()?.style.height).toBe("100%"));
    await page.getByRole("radio", { name: "Lines" }).click();
    await vi.waitFor(() => {
      const svg = document.querySelector<SVGSVGElement>(".usage-lines svg");
      expect(svg && getComputedStyle(svg).clipPath).toBe("none");
      const curve = document.querySelector<SVGPathElement>(".usage-lines-curve");
      expect(curve?.getAttribute("d")).toBe(curve?.dataset.d);
    });
    await page.getByRole("radio", { name: "API cost", exact: true }).click();
    await vi.waitFor(() => {
      const curve = document.querySelector<SVGPathElement>(".usage-lines-curve");
      expect(curve?.getAttribute("d")).toBe(curve?.dataset.d);
    });
  } finally {
    await view.unmount();
  }
});
