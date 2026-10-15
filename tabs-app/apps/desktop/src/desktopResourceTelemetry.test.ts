import { DesktopHostTelemetrySnapshot, HostPowerSnapshot } from "@tabs/contracts";
import { DateTime, Schema } from "effect";
import { PassThrough } from "node:stream";
import type { ProcessMetric } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import { makeDesktopResourceSnapshot, publishDesktopResources } from "./desktopResourceTelemetry";
const power: HostPowerSnapshot = {
  source: "electron-main",
  idle: "false",
  idleSeconds: 0,
  locked: "false",
  suspended: false,
  onBattery: "false",
  lowPowerMode: "unknown",
  thermalState: "unknown",
  stale: false,
  updatedAt: DateTime.nowUnsafe(),
};
const metric = {
  pid: 42,
  creationTime: 1700000000000,
  type: "Browser",
  cpu: { percentCPUUsage: 12, cumulativeCPUUsage: 3, idleWakeupsPerSecond: 0 },
  memory: { workingSetSize: 100, peakWorkingSetSize: 200 },
} as ProcessMetric;
afterEach(() => vi.useRealTimers());
it("encodes real Electron metrics in the server telemetry protocol", () => {
  const snapshot = Schema.decodeUnknownSync(DesktopHostTelemetrySnapshot)(
    makeDesktopResourceSnapshot([metric], power, 42, 1),
  );
  expect(snapshot.electronProcesses[0]).toMatchObject({
    pid: 42,
    workingSetBytes: 102400,
    peakWorkingSetBytes: 204800,
    cpuPercent: 12,
  });
});
it("sends hello and samples, then stops on disposal", () => {
  vi.useFakeTimers();
  const pipe = new PassThrough();
  const frames: string[] = [];
  pipe.on("data", (data) => frames.push(String(data)));
  const stop = publishDesktopResources(
    pipe,
    () => [metric],
    () => power,
    42,
  );
  expect(JSON.parse(frames[0]!).type).toBe("desktopTelemetryHello");
  expect(JSON.parse(frames[1]!).type).toBe("desktopTelemetry");
  vi.advanceTimersByTime(5000);
  expect(frames).toHaveLength(3);
  stop();
  vi.advanceTimersByTime(10000);
  expect(frames).toHaveLength(3);
  pipe.destroy();
});
