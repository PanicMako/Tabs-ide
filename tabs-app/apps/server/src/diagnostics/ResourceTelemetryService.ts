import type {
  HostPowerSnapshot,
  ResourceTelemetryAggregate,
  ResourceTelemetryGroups,
  ResourceTelemetryHealth,
  ResourceTelemetryHistory,
  ResourceTelemetryHistoryBucket,
  ResourceTelemetryHistoryInput,
  ResourceTelemetryProcess,
  ResourceTelemetryProcessCategory,
  ResourceTelemetryProcessSummary,
  ResourceTelemetryRetryResult,
  ResourceTelemetrySnapshot,
} from "@tabs/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import {
  readResourceAttributionSnapshot,
  recordResourceAttribution,
} from "./ResourceAttribution.ts";
import { readEventLoopLag } from "./EventLoopMonitor.ts";
import { type ProcessRow, readSystemProcessRows } from "./ProcessEnumerator.ts";

interface HistoricalSample {
  readonly sampleAt: DateTime.Utc;
  readonly processes: readonly ResourceTelemetryProcess[];
  readonly groups: ResourceTelemetryGroups;
}

const historicalSamples: HistoricalSample[] = [];
const MAX_SAMPLE_RETENTION_MS = 60 * 60 * 1_000; // 1 hour

function resolveIncludedRows(rows: readonly ProcessRow[]): {
  readonly includedRows: readonly ProcessRow[];
  readonly rootPid: number;
} {
  const serverRow = rows.find((r) => r.pid === process.pid);
  const parentPid = serverRow?.ppid ?? process.ppid;
  const parentRow = rows.find((r) => r.pid === parentPid);

  const isParentDesktop = parentRow && /\b(electron|tabs)\b/iu.test(parentRow.command);
  const rootPid = isParentDesktop ? parentPid : process.pid;

  const included = new Set([rootPid, process.pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (included.has(row.ppid) && !included.has(row.pid)) {
        included.add(row.pid);
        changed = true;
      }
    }
  }

  return {
    includedRows: rows.filter((row) => included.has(row.pid)),
    rootPid,
  };
}

function categorizeProcess(
  row: ProcessRow,
  rootPid: number,
): { category: ResourceTelemetryProcessCategory; name: string } {
  const command = row.command.toLowerCase();
  const firstToken = row.command.trim().split(/\s+/)[0] ?? row.command;
  const baseName =
    firstToken
      .replace(/^['"]|['"]$/gu, "")
      .split(/[\\/]/u)
      .filter(Boolean)
      .at(-1) ?? firstToken;

  if (row.pid === process.pid) {
    return { category: "server", name: "Tabs Server" };
  }
  if (row.pid === rootPid && rootPid !== process.pid) {
    return { category: "electron-main", name: "Tabs Desktop (Electron Main)" };
  }
  if (/helper\s*\(renderer\)/iu.test(row.command) || /--type=renderer/iu.test(row.command)) {
    return { category: "electron-renderer", name: "Electron Renderer" };
  }
  if (/--type=gpu-process/iu.test(row.command) || /helper\s*\(gpu\)/iu.test(row.command)) {
    return { category: "electron-gpu", name: "Electron GPU" };
  }
  if (/--type=utility/iu.test(row.command)) {
    return { category: "electron-utility", name: "Electron Utility" };
  }
  if (/\b(codex|claude|gemini|copilot|cursor|droid|grok|opencode|amp)\b/iu.test(command)) {
    return { category: "provider-root", name: baseName };
  }
  if (/\b(git|gh|glab)\b/iu.test(command)) {
    return { category: "server-child", name: baseName };
  }
  if (/\b(chromium|chrome|playwright|puppeteer)\b/iu.test(command)) {
    return { category: "server-child", name: baseName };
  }
  if (/\b(zsh|bash|fish|pwsh|powershell|cmd\.exe|sh)\b/iu.test(command)) {
    return { category: "terminal-root", name: baseName };
  }
  return { category: "server-child", name: baseName };
}

function emptyAggregate(): ResourceTelemetryAggregate {
  return {
    processCount: 0,
    currentCpuPercent: 0,
    cpuTimeMs: 0,
    currentRssBytes: 0,
    peakRssBytes: 0,
    ioReadBytes: 0,
    ioWriteBytes: 0,
    ioReadBytesPerSecond: 0,
    ioWriteBytesPerSecond: 0,
    processStarts: 0,
    processExits: 0,
  };
}

function sumAggregate(
  aggregate: ResourceTelemetryAggregate,
  process: ResourceTelemetryProcess,
): ResourceTelemetryAggregate {
  return {
    processCount: aggregate.processCount + 1,
    currentCpuPercent: aggregate.currentCpuPercent + process.cpuPercent,
    cpuTimeMs: aggregate.cpuTimeMs + process.cpuTimeMs,
    currentRssBytes: aggregate.currentRssBytes + process.residentBytes,
    peakRssBytes: aggregate.peakRssBytes + process.peakResidentBytes,
    ioReadBytes: aggregate.ioReadBytes + process.ioReadBytes,
    ioWriteBytes: aggregate.ioWriteBytes + process.ioWriteBytes,
    ioReadBytesPerSecond: aggregate.ioReadBytesPerSecond + process.ioReadBytesPerSecond,
    ioWriteBytesPerSecond: aggregate.ioWriteBytesPerSecond + process.ioWriteBytesPerSecond,
    processStarts: aggregate.processStarts,
    processExits: aggregate.processExits,
  };
}

function computeGroups(processes: readonly ResourceTelemetryProcess[]): ResourceTelemetryGroups {
  let backend = emptyAggregate();
  let electron = emptyAggregate();
  let monitor = emptyAggregate();
  let allT3 = emptyAggregate();

  for (const proc of processes) {
    allT3 = sumAggregate(allT3, proc);
    if (
      proc.category === "server" ||
      proc.category === "server-child" ||
      proc.category === "provider-root" ||
      proc.category === "terminal-root"
    ) {
      backend = sumAggregate(backend, proc);
    } else if (
      proc.category === "electron-main" ||
      proc.category === "electron-renderer" ||
      proc.category === "electron-gpu" ||
      proc.category === "electron-utility"
    ) {
      electron = sumAggregate(electron, proc);
    } else if (proc.category === "resource-monitor") {
      monitor = sumAggregate(monitor, proc);
    } else {
      backend = sumAggregate(backend, proc);
    }
  }

  return { backend, electron, monitor, allT3 };
}

function fallbackHostPower(now: DateTime.Utc): HostPowerSnapshot {
  return {
    source: process.platform === "darwin" ? "node-macos-native" : "unknown",
    idle: "unknown",
    idleSeconds: null,
    locked: "unknown",
    suspended: false,
    onBattery: "unknown",
    lowPowerMode: "unknown",
    thermalState: "unknown",
    stale: true,
    updatedAt: now,
  };
}

export async function readResourceTelemetrySnapshot(
  hostPower?: HostPowerSnapshot,
): Promise<ResourceTelemetrySnapshot> {
  const startTime = Date.now();
  const readAt = DateTime.nowUnsafe();
  const power = hostPower ?? fallbackHostPower(readAt);

  try {
    const allRows = await readSystemProcessRows();
    const { includedRows, rootPid } = resolveIncludedRows(allRows);

    const children = new Map<number, number[]>();
    for (const row of includedRows) {
      children.set(row.ppid, [...(children.get(row.ppid) ?? []), row.pid]);
    }

    const depthOf = (row: ProcessRow) => {
      let depth = 0;
      let current = row;
      const seen = new Set<number>();
      while (current.pid !== rootPid && !seen.has(current.pid)) {
        seen.add(current.pid);
        const parent = includedRows.find((c) => c.pid === current.ppid);
        if (!parent) break;
        depth += 1;
        current = parent;
      }
      return depth;
    };

    const processes: ResourceTelemetryProcess[] = includedRows.map((row) => {
      const { category, name } = categorizeProcess(row, rootPid);
      const startTimeMs = Math.max(0, readAt.epochMilliseconds - row.elapsedSeconds * 1_000);
      const runTimeMs = row.elapsedSeconds * 1_000;
      const cpuTimeMs = Math.round(row.elapsedSeconds * (row.cpuPercent / 100) * 1_000);

      return {
        identity: {
          pid: row.pid,
          startTimeMs,
        },
        ppid: row.ppid,
        childPids: children.get(row.pid) ?? [],
        depth: depthOf(row),
        name,
        command: row.command,
        status: row.status,
        category,
        cpuPercent: row.cpuPercent,
        cpuTimeMs,
        residentBytes: row.rssBytes,
        peakResidentBytes: row.rssBytes,
        virtualBytes: row.rssBytes * 2,
        ioReadBytes: 0,
        ioWriteBytes: 0,
        ioReadBytesPerSecond: 0,
        ioWriteBytesPerSecond: 0,
        ioSemantics: "unavailable",
        runTimeMs,
        firstSeenAt: DateTime.makeUnsafe(startTimeMs),
        lastSeenAt: readAt,
      };
    });

    const groups = computeGroups(processes);

    // Speed limit percent based on thermal state if available
    let speedLimitPercent: number | null = null;
    if (power.thermalState === "nominal") speedLimitPercent = 100;
    else if (power.thermalState === "fair") speedLimitPercent = 85;
    else if (power.thermalState === "serious") speedLimitPercent = 65;
    else if (power.thermalState === "critical") speedLimitPercent = 40;

    const lag = readEventLoopLag();
    recordResourceAttribution({
      component: "server-runtime",
      operation: "event-loop-lag",
      count: 1,
      durationMs: Math.round(lag.meanMs),
    });

    const attribution = readResourceAttributionSnapshot();
    const collectionDurationMicros = (Date.now() - startTime) * 1_000;

    const health: ResourceTelemetryHealth = {
      native: {
        status: "healthy",
        lastSampleAt: Option.some(readAt),
        lastError: Option.none(),
      },
      desktop: {
        status: power.source !== "unknown" ? "healthy" : "unavailable",
        lastSampleAt: Option.some(power.updatedAt),
        lastError: Option.none(),
      },
      sidecarVersion: Option.some("tabs-telemetry-v1.3"),
      sidecarPid: Option.some(process.pid),
      restartCount: 0,
      collectionDurationMicros,
      scannedProcessCount: allRows.length,
      retainedProcessCount: processes.length,
      inaccessibleProcessCount: 0,
    };

    // Record historical sample
    historicalSamples.push({ sampleAt: readAt, processes, groups });
    const cutoff = readAt.epochMilliseconds - MAX_SAMPLE_RETENTION_MS;
    while (historicalSamples[0] && historicalSamples[0].sampleAt.epochMilliseconds < cutoff) {
      historicalSamples.shift();
    }

    return {
      readAt,
      sampleIntervalMs: 5_000,
      processes,
      groups,
      power,
      speedLimitPercent:
        speedLimitPercent === null ? Option.none() : Option.some(speedLimitPercent),
      attribution,
      health,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const attribution = readResourceAttributionSnapshot();
    const fallbackGroups: ResourceTelemetryGroups = {
      backend: emptyAggregate(),
      electron: emptyAggregate(),
      monitor: emptyAggregate(),
      allT3: emptyAggregate(),
    };
    return {
      readAt,
      sampleIntervalMs: 5_000,
      processes: [],
      groups: fallbackGroups,
      power,
      speedLimitPercent: Option.none(),
      attribution,
      health: {
        native: {
          status: "degraded",
          lastSampleAt: Option.some(readAt),
          lastError: Option.some(errorMessage),
        },
        desktop: {
          status: power.source !== "unknown" ? "healthy" : "unavailable",
          lastSampleAt: Option.some(power.updatedAt),
          lastError: Option.none(),
        },
        sidecarVersion: Option.some("tabs-telemetry-v1.3"),
        sidecarPid: Option.some(process.pid),
        restartCount: 0,
        collectionDurationMicros: (Date.now() - startTime) * 1_000,
        scannedProcessCount: 0,
        retainedProcessCount: 0,
        inaccessibleProcessCount: 0,
      },
    };
  }
}

export async function readResourceTelemetryHistory(
  input: ResourceTelemetryHistoryInput,
  hostPower?: HostPowerSnapshot,
): Promise<ResourceTelemetryHistory> {
  const readAt = DateTime.nowUnsafe();
  const windowMs = Math.max(1_000, input.windowMs);
  const bucketMs = Math.max(1_000, input.bucketMs);

  try {
    const currentSnapshot = await readResourceTelemetrySnapshot(hostPower);
    const retained = historicalSamples.filter(
      (sample) => sample.sampleAt.epochMilliseconds >= readAt.epochMilliseconds - windowMs,
    );

    // Group processes across retained samples
    const byProcess = new Map<
      string,
      Array<{ sampleAt: DateTime.Utc; process: ResourceTelemetryProcess }>
    >();

    for (const sample of retained) {
      for (const process of sample.processes) {
        const key = `${process.identity.pid}:${process.identity.startTimeMs}`;
        byProcess.set(key, [...(byProcess.get(key) ?? []), { sampleAt: sample.sampleAt, process }]);
      }
    }

    const topProcesses: ResourceTelemetryProcessSummary[] = [...byProcess.entries()]
      .map(([, observations]) => {
        const first = observations[0]!;
        const last = observations.at(-1)!;
        const avgCpu =
          observations.reduce((sum, item) => sum + item.process.cpuPercent, 0) /
          observations.length;
        const maxCpu = Math.max(...observations.map((item) => item.process.cpuPercent));
        const peakRss = Math.max(...observations.map((item) => item.process.residentBytes));

        return {
          identity: last.process.identity,
          ppid: last.process.ppid,
          depth: last.process.depth,
          name: last.process.name,
          command: last.process.command,
          category: last.process.category,
          firstSeenAt: first.sampleAt,
          lastSeenAt: last.sampleAt,
          currentCpuPercent: last.process.cpuPercent,
          avgCpuPercent: avgCpu,
          maxCpuPercent: maxCpu,
          cpuTimeMs: last.process.cpuTimeMs,
          currentRssBytes: last.process.residentBytes,
          peakRssBytes: peakRss,
          ioReadBytes: last.process.ioReadBytes,
          ioWriteBytes: last.process.ioWriteBytes,
          ioSemantics: last.process.ioSemantics,
          sampleCount: observations.length,
        };
      })
      .sort((a, b) => b.currentCpuPercent - a.currentCpuPercent);

    // Generate bucket timeseries
    const bucketCount = Math.max(1, Math.ceil(windowMs / bucketMs));
    const windowStartMs = readAt.epochMilliseconds - windowMs;
    const buckets: ResourceTelemetryHistoryBucket[] = [];

    for (let i = 0; i < bucketCount; i++) {
      const bucketStartMs = windowStartMs + i * bucketMs;
      const bucketEndMs = bucketStartMs + bucketMs;
      const bucketSamples = retained.filter(
        (s) =>
          s.sampleAt.epochMilliseconds >= bucketStartMs &&
          s.sampleAt.epochMilliseconds < bucketEndMs,
      );

      if (bucketSamples.length > 0) {
        const totalCpu = bucketSamples.reduce(
          (sum, s) => sum + s.groups.allT3.currentCpuPercent,
          0,
        );
        const maxCpu = Math.max(...bucketSamples.map((s) => s.groups.allT3.currentCpuPercent));
        const maxRss = Math.max(...bucketSamples.map((s) => s.groups.allT3.currentRssBytes));
        const maxProcs = Math.max(...bucketSamples.map((s) => s.processes.length));

        buckets.push({
          startedAt: DateTime.makeUnsafe(bucketStartMs),
          endedAt: DateTime.makeUnsafe(bucketEndMs),
          avgCpuPercent: totalCpu / bucketSamples.length,
          maxCpuPercent: maxCpu,
          maxRssBytes: maxRss,
          ioReadBytes: 0,
          ioWriteBytes: 0,
          maxProcessCount: maxProcs,
        });
      } else {
        buckets.push({
          startedAt: DateTime.makeUnsafe(bucketStartMs),
          endedAt: DateTime.makeUnsafe(bucketEndMs),
          avgCpuPercent: 0,
          maxCpuPercent: 0,
          maxRssBytes: 0,
          ioReadBytes: 0,
          ioWriteBytes: 0,
          maxProcessCount: 0,
        });
      }
    }

    return {
      readAt,
      windowMs,
      bucketMs,
      sampleIntervalMs: 5_000,
      retainedSampleCount: retained.length,
      buckets,
      topProcesses,
      health: currentSnapshot.health,
    };
  } catch (error) {
    const power = hostPower ?? fallbackHostPower(readAt);
    return {
      readAt,
      windowMs,
      bucketMs,
      sampleIntervalMs: 5_000,
      retainedSampleCount: 0,
      buckets: [],
      topProcesses: [],
      health: {
        native: {
          status: "degraded",
          lastSampleAt: Option.some(readAt),
          lastError: Option.some(error instanceof Error ? error.message : String(error)),
        },
        desktop: {
          status: power.source !== "unknown" ? "healthy" : "unavailable",
          lastSampleAt: Option.some(power.updatedAt),
          lastError: Option.none(),
        },
        sidecarVersion: Option.some("tabs-telemetry-v1.3"),
        sidecarPid: Option.some(process.pid),
        restartCount: 0,
        collectionDurationMicros: 0,
        scannedProcessCount: 0,
        retainedProcessCount: 0,
        inaccessibleProcessCount: 0,
      },
    };
  }
}

export async function retryResourceTelemetry(
  hostPower?: HostPowerSnapshot,
): Promise<ResourceTelemetryRetryResult> {
  const snapshot = await readResourceTelemetrySnapshot(hostPower);
  return {
    accepted: true,
    snapshot,
  };
}
