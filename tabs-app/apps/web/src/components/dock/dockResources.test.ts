import { describe, expect, it } from "vitest";
import type { HostResourcesSnapshot, ResourceTelemetryProcess } from "@tabs/contracts";
import {
  aggregateDockResources,
  appendDockSample,
  formatDockMemory,
  formatDockUptime,
} from "./dockResources";

const host: HostResourcesSnapshot = {
  sampledAt: 0,
  cpuUtilization: null,
  cpuCount: 8,
  totalMemoryBytes: 16_000_000_000,
  availableMemoryBytes: 8_000_000_000,
};
function process(
  pid: number,
  ppid: number,
  cpuPercent: number,
  residentBytes: number,
  startTimeMs = 1000,
) {
  return {
    identity: { pid, startTimeMs },
    ppid,
    cpuPercent,
    residentBytes,
    runTimeMs: 65_000,
  } as ResourceTelemetryProcess;
}
describe("Dock process ownership", () => {
  it("includes shell, npm and workers, excluding sibling services and older reparented processes", () => {
    const sample = aggregateDockResources(
      [
        process(10, 1, 0, 10_000_000),
        process(11, 10, 100, 100_000_000),
        process(12, 11, 300, 300_000_000),
        process(20, 1, 400, 5_000_000_000),
        process(21, 10, 800, 1_000_000_000, 500),
      ],
      10,
      host,
      5000,
    )!;
    expect(sample.cpuPercent).toBe(50);
    expect(sample.memoryBytes).toBe(410_000_000);
    expect(sample.memoryPercent).toBeCloseTo(2.5625);
    expect(sample.processCount).toBe(3);
    expect(sample.uptimeMs).toBe(65_000);
  });
  it("handles missing roots, cycles, and unknown host capacity without inventing percentages", () => {
    expect(aggregateDockResources([], 10, host, 0)).toBeNull();
    const sample = aggregateDockResources(
      [process(10, 11, 0, 100), process(11, 10, 0, 200)],
      10,
      null,
      0,
    )!;
    expect(sample.processCount).toBe(2);
    expect(sample.memoryBytes).toBe(300);
    expect(sample.cpuPercent).toBeNull();
    expect(sample.memoryPercent).toBeNull();
    expect(aggregateDockResources([process(10, 1, 0, 0)], 10, host, 0)?.cpuPercent).toBe(0);
  });
  it("resets history when a PID is reused, replaces duplicate samples and bounds retention by time", () => {
    const first = aggregateDockResources([process(10, 1, 8, 100)], 10, host, 1000)!;
    const next = { ...first, sampledAt: 2000 };
    expect(appendDockSample([first], next)).toEqual([first, next]);
    expect(appendDockSample([first, next], { ...next, cpuPercent: 2 })).toHaveLength(2);
    expect(appendDockSample([first, next], { ...next, sampledAt: 63_000 })).toHaveLength(1);
    expect(appendDockSample([first], { ...next, identity: "10:3000" })).toEqual([
      { ...next, identity: "10:3000" },
    ]);
    expect(appendDockSample([next], first)).toEqual([next]);
  });
  it("formats process memory and long session durations with units", () => {
    expect(formatDockMemory(429_000_000)).toBe("429 MB");
    expect(formatDockMemory(1_500_000_000)).toBe("1.50 GB");
    expect(formatDockUptime(65_000)).toBe("1:05");
    expect(formatDockUptime(3_661_000)).toBe("1:01:01");
  });
});
