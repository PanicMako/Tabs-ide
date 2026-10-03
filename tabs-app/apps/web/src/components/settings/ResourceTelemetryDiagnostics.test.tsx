import { describe, expect, it } from "vitest";
import * as DateTime from "effect/DateTime";
import {
  formatBytes,
  formatCpuTime,
  formatDurationMicros,
  formatSampleInterval,
  HISTORY_WINDOWS,
  safeIsoString,
} from "./ResourceTelemetryDiagnostics";
import {
  resourceHistoryBarHeight,
  resourceHistoryCpuScaleMax,
  visibleResourceTelemetryProcesses,
} from "./ResourceTelemetryDiagnostics.logic";
import type { ResourceTelemetryProcess } from "@tabs/contracts";

describe("ResourceTelemetry formatting and safety utilities", () => {
  it("safeIsoString handles null, undefined, invalid dates, raw ISO strings, numbers, and Dates", () => {
    expect(safeIsoString(null)).toBeNull();
    expect(safeIsoString(undefined)).toBeNull();
    expect(safeIsoString("not-a-date")).toBeNull();

    const iso = "2026-09-06T07:22:51.000Z";
    expect(safeIsoString(iso)).toBe(iso);

    const epochMs = 1788679554760;
    expect(safeIsoString(epochMs)).toBe(new Date(epochMs).toISOString());

    const date = new Date("2026-01-01T00:00:00.000Z");
    expect(safeIsoString(date)).toBe("2026-01-01T00:00:00.000Z");

    const dt = DateTime.fromDateUnsafe(new Date(epochMs));
    expect(safeIsoString(dt)).toBe(new Date(epochMs).toISOString());

    // Edge cases: NaN, Infinity, malformed objects
    expect(safeIsoString(NaN)).toBeNull();
    expect(safeIsoString(Infinity)).toBeNull();
    expect(safeIsoString({ epochMilliseconds: NaN })).toBeNull();
    expect(safeIsoString({ epochMilliseconds: "invalid" })).toBeNull();
    expect(safeIsoString({ epochMillis: NaN })).toBeNull();
    expect(safeIsoString({})).toBeNull();
    expect(safeIsoString({ toString: () => "not-a-date" })).toBeNull();
  });

  it("formatBytes formats B, KB, MB, GB, TB correctly", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1024)).toBe("1.00 KB");
    expect(formatBytes(1048576)).toBe("1.00 MB");
    expect(formatBytes(1073741824)).toBe("1.00 GB");
  });

  it("formatCpuTime formats seconds, minutes, and hours", () => {
    expect(formatCpuTime(5000)).toBe("5.00s");
    expect(formatCpuTime(75000)).toBe("1.25m");
    expect(formatCpuTime(7200000)).toBe("2.00h");
  });

  it("formatDurationMicros formats micros, ms, and seconds", () => {
    expect(formatDurationMicros(500)).toBe("500 µs");
    expect(formatDurationMicros(2500)).toBe("2.50 ms");
    expect(formatDurationMicros(3500000)).toBe("3.50 s");
  });

  it("formatSampleInterval formats sub-second and seconds", () => {
    expect(formatSampleInterval(500)).toBe("500 ms");
    expect(formatSampleInterval(5000)).toBe("5 seconds");
    expect(formatSampleInterval(1000)).toBe("1 second");
  });

  it("has valid history window configs", () => {
    expect(HISTORY_WINDOWS).toHaveLength(4);
    expect(HISTORY_WINDOWS.map((w) => w.label)).toEqual(["5m", "15m", "30m", "1h"]);
  });
});

describe("ResourceTelemetryDiagnostics logic", () => {
  it("computes resourceHistoryBarHeight correctly within bounds", () => {
    expect(resourceHistoryBarHeight({ value: 0, max: 100, minimumVisiblePercent: 2 })).toBe(0);
    expect(resourceHistoryBarHeight({ value: 50, max: 100, minimumVisiblePercent: 2 })).toBe(50);
    expect(resourceHistoryBarHeight({ value: 1, max: 100, minimumVisiblePercent: 2 })).toBe(2);
  });

  it("computes resourceHistoryCpuScaleMax correctly", () => {
    expect(resourceHistoryCpuScaleMax([])).toBe(1);
    expect(resourceHistoryCpuScaleMax([{ avgCpuPercent: 120 }, { avgCpuPercent: 80 }])).toBe(120);
  });

  it("filters collapsed children in visibleResourceTelemetryProcesses", () => {
    const p1: ResourceTelemetryProcess = {
      identity: { pid: 100, startTimeMs: 1000 },
      ppid: 0,
      childPids: [101],
      depth: 0,
      name: "root",
      command: "root",
      status: "running",
      category: "server",
      cpuPercent: 5,
      cpuTimeMs: 1000,
      residentBytes: 1024 * 1024,
      peakResidentBytes: 1024 * 1024,
      virtualBytes: 1024 * 1024,
      ioReadBytes: 0,
      ioWriteBytes: 0,
      ioReadBytesPerSecond: 0,
      ioWriteBytesPerSecond: 0,
      ioSemantics: "storage",
      runTimeMs: 1000,
      firstSeenAt: DateTime.fromDateUnsafe(new Date(0)),
      lastSeenAt: DateTime.fromDateUnsafe(new Date(1000)),
    };
    const p2: ResourceTelemetryProcess = {
      identity: { pid: 101, startTimeMs: 1001 },
      ppid: 100,
      childPids: [],
      depth: 1,
      name: "child",
      command: "child",
      status: "running",
      category: "server",
      cpuPercent: 2,
      cpuTimeMs: 500,
      residentBytes: 512 * 1024,
      peakResidentBytes: 512 * 1024,
      virtualBytes: 512 * 1024,
      ioReadBytes: 0,
      ioWriteBytes: 0,
      ioReadBytesPerSecond: 0,
      ioWriteBytesPerSecond: 0,
      ioSemantics: "storage",
      runTimeMs: 500,
      firstSeenAt: DateTime.fromDateUnsafe(new Date(0)),
      lastSeenAt: DateTime.fromDateUnsafe(new Date(500)),
    };

    const expanded = visibleResourceTelemetryProcesses([p1, p2], new Set());
    expect(expanded).toHaveLength(2);

    const collapsed = visibleResourceTelemetryProcesses([p1, p2], new Set(["100:1000"]));
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.identity.pid).toBe(100);
  });
});
