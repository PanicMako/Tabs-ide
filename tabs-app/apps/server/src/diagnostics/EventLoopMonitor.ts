import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";

export interface EventLoopLagMetrics {
  readonly minMs: number;
  readonly maxMs: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p90Ms: number;
  readonly p99Ms: number;
}

export interface RuntimeMetrics {
  readonly rssBytes: number;
  readonly heapUsedBytes: number;
  readonly heapTotalBytes: number;
  readonly externalBytes: number;
  readonly arrayBuffersBytes: number;
  readonly cpuUserMicros: number;
  readonly cpuSystemMicros: number;
  readonly eventLoopLag: EventLoopLagMetrics;
}

let histogram: IntervalHistogram | null = null;

export function startEventLoopMonitor(resolutionMs = 20): void {
  if (histogram) return;
  try {
    histogram = monitorEventLoopDelay({ resolution: resolutionMs });
    histogram.enable();
  } catch {
    // If monitorEventLoopDelay is unsupported in running environment
    histogram = null;
  }
}

export function stopEventLoopMonitor(): void {
  if (histogram) {
    try {
      histogram.disable();
    } catch {
      // ignore
    }
    histogram = null;
  }
}

export function readEventLoopLag(): EventLoopLagMetrics {
  if (!histogram) {
    return { minMs: 0, maxMs: 0, meanMs: 0, p50Ms: 0, p90Ms: 0, p99Ms: 0 };
  }
  const toMs = (nanos: number): number => {
    if (!Number.isFinite(nanos) || nanos < 0) return 0;
    return Math.round((nanos / 1_000_000) * 100) / 100;
  };

  const minMs = toMs(histogram.min);
  const maxMs = toMs(histogram.max);
  const meanMs = toMs(histogram.mean);
  const p50Ms = toMs(histogram.percentile(50));
  const p90Ms = toMs(histogram.percentile(90));
  const p99Ms = toMs(histogram.percentile(99));

  try {
    histogram.reset();
  } catch {
    // ignore
  }

  return { minMs, maxMs, meanMs, p50Ms, p90Ms, p99Ms };
}

export function readRuntimeMetrics(): RuntimeMetrics {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  const eventLoopLag = readEventLoopLag();

  return {
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
    heapTotalBytes: mem.heapTotal,
    externalBytes: mem.external,
    arrayBuffersBytes: mem.arrayBuffers ?? 0,
    cpuUserMicros: cpu.user,
    cpuSystemMicros: cpu.system,
    eventLoopLag,
  };
}

// Auto-start on load
startEventLoopMonitor();
