import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { HostPowerSnapshot } from "./background.ts";

export const ResourceTelemetryIoSemantics = Schema.Literals([
  "storage",
  "logical",
  "all-io",
  "unavailable",
]);
export type ResourceTelemetryIoSemantics = typeof ResourceTelemetryIoSemantics.Type;

export const ResourceTelemetryProcessCategory = Schema.Literals([
  "server",
  "server-child",
  "provider-root",
  "terminal-root",
  "electron-main",
  "electron-renderer",
  "electron-gpu",
  "electron-utility",
  "resource-monitor",
  "unknown-t3",
]);
export type ResourceTelemetryProcessCategory = typeof ResourceTelemetryProcessCategory.Type;

export const ResourceTelemetrySourceStatus = Schema.Literals([
  "starting",
  "healthy",
  "degraded",
  "unavailable",
  "stopped",
]);
export type ResourceTelemetrySourceStatus = typeof ResourceTelemetrySourceStatus.Type;

export const ResourceTelemetryProcessIdentity = Schema.Struct({
  pid: PositiveInt,
  startTimeMs: NonNegativeInt,
});
export type ResourceTelemetryProcessIdentity = typeof ResourceTelemetryProcessIdentity.Type;

export const DesktopElectronProcessType = Schema.Literals([
  "Browser",
  "Tab",
  "Utility",
  "Zygote",
  "Sandbox helper",
  "GPU",
  "Pepper Plugin",
  "Pepper Plugin Broker",
  "Unknown",
]);
export type DesktopElectronProcessType = typeof DesktopElectronProcessType.Type;

export const ResourceTelemetryProcess = Schema.Struct({
  identity: ResourceTelemetryProcessIdentity,
  ppid: NonNegativeInt,
  childPids: Schema.Array(PositiveInt),
  depth: NonNegativeInt,
  name: Schema.String,
  command: Schema.String,
  status: Schema.String,
  category: ResourceTelemetryProcessCategory,
  electronType: Schema.optionalKey(DesktopElectronProcessType),
  electronServiceName: Schema.optionalKey(Schema.String),
  cpuPercent: Schema.Number,
  cpuTimeMs: NonNegativeInt,
  residentBytes: NonNegativeInt,
  peakResidentBytes: NonNegativeInt,
  virtualBytes: NonNegativeInt,
  ioReadBytes: NonNegativeInt,
  ioWriteBytes: NonNegativeInt,
  ioReadBytesPerSecond: Schema.Number,
  ioWriteBytesPerSecond: Schema.Number,
  ioSemantics: ResourceTelemetryIoSemantics,
  idleWakeupsPerSecond: Schema.optionalKey(Schema.Number),
  runTimeMs: NonNegativeInt,
  firstSeenAt: Schema.DateTimeUtc,
  lastSeenAt: Schema.DateTimeUtc,
});
export type ResourceTelemetryProcess = typeof ResourceTelemetryProcess.Type;

export const ResourceTelemetryAggregate = Schema.Struct({
  processCount: NonNegativeInt,
  currentCpuPercent: Schema.Number,
  cpuTimeMs: NonNegativeInt,
  currentRssBytes: NonNegativeInt,
  peakRssBytes: NonNegativeInt,
  ioReadBytes: NonNegativeInt,
  ioWriteBytes: NonNegativeInt,
  ioReadBytesPerSecond: Schema.Number,
  ioWriteBytesPerSecond: Schema.Number,
  processStarts: NonNegativeInt,
  processExits: NonNegativeInt,
});
export type ResourceTelemetryAggregate = typeof ResourceTelemetryAggregate.Type;

export const ResourceTelemetryGroups = Schema.Struct({
  backend: ResourceTelemetryAggregate,
  electron: ResourceTelemetryAggregate,
  monitor: ResourceTelemetryAggregate,
  allT3: ResourceTelemetryAggregate,
});
export type ResourceTelemetryGroups = typeof ResourceTelemetryGroups.Type;

export const ResourceTelemetrySourceHealth = Schema.Struct({
  status: ResourceTelemetrySourceStatus,
  lastSampleAt: Schema.Option(Schema.DateTimeUtc),
  lastError: Schema.Option(TrimmedNonEmptyString),
});
export type ResourceTelemetrySourceHealth = typeof ResourceTelemetrySourceHealth.Type;

export const ResourceTelemetryHealth = Schema.Struct({
  native: ResourceTelemetrySourceHealth,
  desktop: ResourceTelemetrySourceHealth,
  sidecarVersion: Schema.Option(TrimmedNonEmptyString),
  sidecarPid: Schema.Option(PositiveInt),
  restartCount: NonNegativeInt,
  collectionDurationMicros: NonNegativeInt,
  scannedProcessCount: NonNegativeInt,
  retainedProcessCount: NonNegativeInt,
  inaccessibleProcessCount: NonNegativeInt,
});
export type ResourceTelemetryHealth = typeof ResourceTelemetryHealth.Type;

export const ResourceAttributionEntry = Schema.Struct({
  component: TrimmedNonEmptyString,
  operation: TrimmedNonEmptyString,
  logicalReadBytes: NonNegativeInt,
  logicalWriteBytes: NonNegativeInt,
  count: NonNegativeInt,
  durationMs: NonNegativeInt,
});
export type ResourceAttributionEntry = typeof ResourceAttributionEntry.Type;

export const ResourceAttributionSnapshot = Schema.Struct({
  readAt: Schema.DateTimeUtc,
  entries: Schema.Array(ResourceAttributionEntry),
});
export type ResourceAttributionSnapshot = typeof ResourceAttributionSnapshot.Type;

export const ResourceTelemetrySnapshot = Schema.Struct({
  readAt: Schema.DateTimeUtc,
  sampleIntervalMs: NonNegativeInt,
  processes: Schema.Array(ResourceTelemetryProcess),
  groups: ResourceTelemetryGroups,
  power: HostPowerSnapshot,
  speedLimitPercent: Schema.Option(Schema.Number),
  attribution: ResourceAttributionSnapshot,
  health: ResourceTelemetryHealth,
});
export type ResourceTelemetrySnapshot = typeof ResourceTelemetrySnapshot.Type;

export const ResourceTelemetryHistoryInput = Schema.Struct({
  windowMs: NonNegativeInt,
  bucketMs: NonNegativeInt,
});
export type ResourceTelemetryHistoryInput = typeof ResourceTelemetryHistoryInput.Type;

export const ResourceTelemetryHistoryBucket = Schema.Struct({
  startedAt: Schema.DateTimeUtc,
  endedAt: Schema.DateTimeUtc,
  avgCpuPercent: Schema.Number,
  maxCpuPercent: Schema.Number,
  maxRssBytes: NonNegativeInt,
  ioReadBytes: NonNegativeInt,
  ioWriteBytes: NonNegativeInt,
  maxProcessCount: NonNegativeInt,
});
export type ResourceTelemetryHistoryBucket = typeof ResourceTelemetryHistoryBucket.Type;

export const ResourceTelemetryProcessSummary = Schema.Struct({
  identity: ResourceTelemetryProcessIdentity,
  ppid: NonNegativeInt,
  depth: NonNegativeInt,
  name: Schema.String,
  command: Schema.String,
  category: ResourceTelemetryProcessCategory,
  firstSeenAt: Schema.DateTimeUtc,
  lastSeenAt: Schema.DateTimeUtc,
  currentCpuPercent: Schema.Number,
  avgCpuPercent: Schema.Number,
  maxCpuPercent: Schema.Number,
  cpuTimeMs: NonNegativeInt,
  currentRssBytes: NonNegativeInt,
  peakRssBytes: NonNegativeInt,
  ioReadBytes: NonNegativeInt,
  ioWriteBytes: NonNegativeInt,
  ioSemantics: ResourceTelemetryIoSemantics,
  sampleCount: NonNegativeInt,
});
export type ResourceTelemetryProcessSummary = typeof ResourceTelemetryProcessSummary.Type;

export const ResourceTelemetryHistory = Schema.Struct({
  readAt: Schema.DateTimeUtc,
  windowMs: NonNegativeInt,
  bucketMs: NonNegativeInt,
  sampleIntervalMs: NonNegativeInt,
  retainedSampleCount: NonNegativeInt,
  buckets: Schema.Array(ResourceTelemetryHistoryBucket),
  topProcesses: Schema.Array(ResourceTelemetryProcessSummary),
  health: ResourceTelemetryHealth,
});
export type ResourceTelemetryHistory = typeof ResourceTelemetryHistory.Type;

export const ResourceTelemetryRetryResult = Schema.Struct({
  accepted: Schema.Boolean,
  snapshot: ResourceTelemetrySnapshot,
});
export type ResourceTelemetryRetryResult = typeof ResourceTelemetryRetryResult.Type;
