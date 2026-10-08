import "../../index.css";
import type { ResourceTelemetrySnapshot } from "@tabs/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { DiagnosticsOverview } from "./DiagnosticsOverview";

it("shows unavailable metrics instead of fabricated system figures", async () => {
  const view = await render(
    <div style={{ width: 340 }}>
      <DiagnosticsOverview snapshot={null} onNavigateTab={() => {}} />
    </div>,
  );
  try {
    const region = page.getByRole("region", { name: "Measured Tabs resources" });
    expect(region.element().textContent).toContain("Waiting for a resource sample");
    expect(region.element().textContent).not.toContain("healthy");
    expect(region.element().scrollWidth).toBeLessThanOrEqual(340);
    await expect
      .element(page.getByRole("button", { name: "Inspect Tabs CPU" }))
      .toHaveTextContent("Unavailable");
  } finally {
    await view.unmount();
  }
});
it("uses actual measured values, including multi-core CPU, and opens their detail pages", async () => {
  const aggregate = {
    processCount: 4,
    currentCpuPercent: 125.5,
    cpuTimeMs: 0,
    currentRssBytes: 1048576,
    peakRssBytes: 1048576,
    ioReadBytes: 0,
    ioWriteBytes: 0,
    ioReadBytesPerSecond: 10,
    ioWriteBytesPerSecond: 20,
    processStarts: 0,
    processExits: 0,
  };
  const now = DateTime.nowUnsafe();
  const source = {
    status: "healthy" as const,
    lastSampleAt: Option.some(now),
    lastError: Option.none<string>(),
  };
  const snapshot: ResourceTelemetrySnapshot = {
    readAt: now,
    sampleIntervalMs: 5000,
    processes: [],
    groups: { allT3: aggregate, backend: aggregate, electron: aggregate, monitor: aggregate },
    power: {
      source: "unknown",
      idle: "unknown",
      idleSeconds: null,
      locked: "unknown",
      suspended: false,
      onBattery: "unknown",
      lowPowerMode: "unknown",
      thermalState: "unknown",
      stale: false,
      updatedAt: now,
    },
    speedLimitPercent: Option.none(),
    attribution: { readAt: now, entries: [] },
    health: {
      native: source,
      desktop: source,
      sidecarVersion: Option.none(),
      sidecarPid: Option.none(),
      restartCount: 0,
      collectionDurationMicros: 0,
      scannedProcessCount: 4,
      retainedProcessCount: 4,
      inaccessibleProcessCount: 0,
    },
  };
  const navigate = vi.fn();
  const view = await render(<DiagnosticsOverview snapshot={snapshot} onNavigateTab={navigate} />);
  try {
    await expect
      .element(page.getByRole("button", { name: "Inspect Tabs CPU" }))
      .toHaveTextContent("125.5%");
    await expect
      .element(page.getByRole("button", { name: "Inspect Process memory" }))
      .toHaveTextContent("1.00 MB");
    await page.getByRole("button", { name: "Inspect Processes" }).click();
    expect(navigate).toHaveBeenCalledWith("process-tree");
  } finally {
    await view.unmount();
  }
});
