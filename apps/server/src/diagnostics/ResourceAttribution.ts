import type { ResourceAttributionEntry, ResourceAttributionSnapshot } from "@tabs/contracts";
import * as DateTime from "effect/DateTime";

export interface ResourceAttributionRecord {
  readonly component: string;
  readonly operation: string;
  readonly logicalReadBytes?: number;
  readonly logicalWriteBytes?: number;
  readonly count?: number;
  readonly durationMs?: number;
}

const MAX_ENTRIES = 500;
const entries = new Map<string, ResourceAttributionEntry>();

function key(component: string, operation: string): string {
  return `${component}\u0000${operation}`;
}

function pruneIfNecessary(): void {
  if (entries.size < MAX_ENTRIES) return;
  // Sort entries by total volume/activity ascending and remove the bottom 10%
  const sorted = [...entries.entries()].sort(([, a], [, b]) => {
    const scoreA = (a.logicalWriteBytes ?? 0) + (a.logicalReadBytes ?? 0) + (a.count ?? 0) * 1024;
    const scoreB = (b.logicalWriteBytes ?? 0) + (b.logicalReadBytes ?? 0) + (b.count ?? 0) * 1024;
    return scoreA - scoreB;
  });
  const toRemove = Math.max(1, Math.floor(MAX_ENTRIES * 0.1));
  for (let i = 0; i < toRemove; i++) {
    const item = sorted[i];
    if (item) entries.delete(item[0]);
  }
}

export function recordResourceAttribution(input: ResourceAttributionRecord): void {
  const entryKey = key(input.component, input.operation);
  const existing = entries.get(entryKey);

  if (!existing && entries.size >= MAX_ENTRIES) {
    pruneIfNecessary();
  }

  entries.set(entryKey, {
    component: input.component,
    operation: input.operation,
    logicalReadBytes:
      (existing?.logicalReadBytes ?? 0) + Math.max(0, Math.round(input.logicalReadBytes ?? 0)),
    logicalWriteBytes:
      (existing?.logicalWriteBytes ?? 0) + Math.max(0, Math.round(input.logicalWriteBytes ?? 0)),
    count: (existing?.count ?? 0) + Math.max(0, Math.round(input.count ?? 1)),
    durationMs: (existing?.durationMs ?? 0) + Math.max(0, Math.round(input.durationMs ?? 0)),
  });
}

export function recordRpcAttribution(operation: string, durationMs: number): void {
  recordResourceAttribution({
    component: "rpc",
    operation,
    count: 1,
    durationMs: Math.max(0, Math.round(durationMs)),
  });
}

export function recordIoAttribution(
  component: string,
  operation: string,
  logicalReadBytes: number,
  logicalWriteBytes: number,
  durationMs?: number,
): void {
  recordResourceAttribution({
    component,
    operation,
    logicalReadBytes,
    logicalWriteBytes,
    count: 1,
    durationMs: durationMs !== undefined ? Math.max(0, Math.round(durationMs)) : 0,
  });
}

export function readResourceAttributionSnapshot(): ResourceAttributionSnapshot {
  return {
    readAt: DateTime.nowUnsafe(),
    entries: [...entries.values()].sort((a, b) => b.logicalWriteBytes - a.logicalWriteBytes),
  };
}

export function resetResourceAttribution(): void {
  entries.clear();
}
