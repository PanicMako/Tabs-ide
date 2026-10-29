import type { HostResourcesSnapshot, ResourceTelemetryProcess } from "@tabs/contracts";

export interface DockResourceSample {
  identity: string;
  sampledAt: number;
  cpuPercent: number | null;
  memoryBytes: number;
  memoryPercent: number | null;
  uptimeMs: number;
  processCount: number;
}

/** A preset owns its shell and descendants, not just the npm wrapper or listening PID. */
export function aggregateDockResources(
  processes: readonly ResourceTelemetryProcess[],
  rootPid: number,
  host: HostResourcesSnapshot | null,
  sampledAt: number,
): DockResourceSample | null {
  const byPid = new Map(processes.map((process) => [process.identity.pid, process]));
  const root = byPid.get(rootPid);
  if (!root) return null;
  const children = new Map<number, ResourceTelemetryProcess[]>();
  for (const process of processes) {
    const siblings = children.get(process.ppid) ?? [];
    siblings.push(process);
    children.set(process.ppid, siblings);
  }
  const visited = new Set<number>();
  const queue = [root];
  let cpu = 0;
  let memory = 0;
  while (queue.length) {
    const process = queue.pop()!;
    if (visited.has(process.identity.pid)) continue;
    visited.add(process.identity.pid);
    cpu += Math.max(0, process.cpuPercent);
    memory += process.residentBytes;
    for (const child of children.get(process.identity.pid) ?? []) {
      // A reused parent PID must not adopt an older, unrelated process.
      if (child.identity.startTimeMs >= process.identity.startTimeMs) queue.push(child);
    }
  }
  return {
    identity: `${rootPid}:${root.identity.startTimeMs}`,
    sampledAt,
    cpuPercent: host && host.cpuCount > 0 ? Math.min(100, cpu / host.cpuCount) : null,
    memoryBytes: memory,
    memoryPercent:
      host && host.totalMemoryBytes > 0 ? (memory / host.totalMemoryBytes) * 100 : null,
    uptimeMs: root.runTimeMs,
    processCount: visited.size,
  };
}

/** Keep timestamped samples, breaking the line for missing data and resetting on PID reuse. */
export function appendDockSample(
  history: readonly DockResourceSample[],
  sample: DockResourceSample,
): DockResourceSample[] {
  const previous = history.at(-1);
  const retained = previous?.identity === sample.identity ? history : [];
  if (previous?.identity === sample.identity && previous.sampledAt > sample.sampledAt)
    return [...retained];
  if (previous?.identity === sample.identity && previous.sampledAt === sample.sampledAt)
    return [...retained.slice(0, -1), sample];
  return [
    ...retained.filter((point) => point.sampledAt >= sample.sampledAt - 60_000),
    sample,
  ].slice(-120);
}

export function formatDockMemory(bytes: number) {
  return bytes >= 1_000_000_000
    ? `${(bytes / 1_000_000_000).toFixed(2)} GB`
    : `${(bytes / 1_000_000).toFixed(0)} MB`;
}
export function formatDockUptime(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
    : `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
