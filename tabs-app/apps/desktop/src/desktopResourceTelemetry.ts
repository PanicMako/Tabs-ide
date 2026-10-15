import {
  DesktopHostTelemetrySnapshot,
  DesktopElectronProcessType,
  type HostPowerSnapshot,
} from "@tabs/contracts";
import { Option, Schema } from "effect";
import type { ProcessMetric } from "electron";
import type { Writable } from "node:stream";

const encode = Schema.encodeSync(DesktopHostTelemetrySnapshot);
const knownType = Schema.is(DesktopElectronProcessType);
export function makeDesktopResourceSnapshot(
  metrics: readonly ProcessMetric[],
  power: HostPowerSnapshot,
  electronPid: number,
  sequence: number,
) {
  return encode({
    version: 1,
    type: "desktopTelemetry",
    sequence,
    electronPid,
    sampledAtUnixMs: Date.now(),
    power,
    speedLimitPercent: Option.none(),
    electronProcesses: metrics.map((metric) => ({
      pid: metric.pid,
      creationTimeMs: Math.max(0, Math.floor(metric.creationTime)),
      type: knownType(metric.type) ? metric.type : "Unknown",
      ...(metric.name ? { name: metric.name } : {}),
      ...(metric.serviceName ? { serviceName: metric.serviceName } : {}),
      cpuPercent: metric.cpu.percentCPUUsage,
      ...(metric.cpu.cumulativeCPUUsage === undefined
        ? {}
        : { cumulativeCpuSeconds: metric.cpu.cumulativeCPUUsage }),
      idleWakeupsPerSecond: metric.cpu.idleWakeupsPerSecond,
      workingSetBytes: Math.max(0, Math.round(metric.memory.workingSetSize * 1024)),
      peakWorkingSetBytes: Math.max(0, Math.round(metric.memory.peakWorkingSetSize * 1024)),
    })),
  });
}

/** Private main-to-backend pipe; frames never contain browser URLs or credentials. */
export function publishDesktopResources(
  stream: Writable,
  metrics: () => ProcessMetric[],
  power: () => HostPowerSnapshot,
  electronPid: number,
) {
  let sequence = 0;
  let stopped = false;
  const sample = () => {
    if (stopped || stream.destroyed || stream.writableNeedDrain) return;
    try {
      stream.write(
        JSON.stringify(makeDesktopResourceSnapshot(metrics(), power(), electronPid, sequence++)) +
          "\n",
      );
    } catch (error) {
      console.error("[desktop-resources] Could not publish metrics", error);
    }
  };
  stream.write(JSON.stringify({ version: 1, type: "desktopTelemetryHello", electronPid }) + "\n");
  sample();
  const timer = setInterval(sample, 5000);
  timer.unref();
  const stop = () => {
    stopped = true;
    clearInterval(timer);
  };
  stream.once("error", stop);
  stream.once("close", stop);
  return () => {
    stop();
    stream.off("error", stop);
    stream.off("close", stop);
  };
}
