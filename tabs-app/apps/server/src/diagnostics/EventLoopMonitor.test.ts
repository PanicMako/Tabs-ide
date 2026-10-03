import { describe, expect, it } from "vitest";

import {
  readEventLoopLag,
  readRuntimeMetrics,
  startEventLoopMonitor,
  stopEventLoopMonitor,
} from "./EventLoopMonitor.ts";

describe("EventLoopMonitor", () => {
  it("starts and reads event loop lag metrics", async () => {
    startEventLoopMonitor();
    // Allow a small delay for the event loop to record intervals
    await new Promise((resolve) => setTimeout(resolve, 50));

    const lag = readEventLoopLag();
    expect(typeof lag.minMs).toBe("number");
    expect(typeof lag.maxMs).toBe("number");
    expect(typeof lag.meanMs).toBe("number");
    expect(typeof lag.p50Ms).toBe("number");
    expect(typeof lag.p90Ms).toBe("number");
    expect(typeof lag.p99Ms).toBe("number");
    expect(lag.minMs).toBeGreaterThanOrEqual(0);
  });

  it("reads complete runtime metrics including memory and cpu", () => {
    const metrics = readRuntimeMetrics();
    expect(metrics.rssBytes).toBeGreaterThan(0);
    expect(metrics.heapUsedBytes).toBeGreaterThan(0);
    expect(metrics.heapTotalBytes).toBeGreaterThan(0);
    expect(metrics.cpuUserMicros).toBeGreaterThanOrEqual(0);
    expect(metrics.eventLoopLag).toBeDefined();
  });

  it("handles stop and restart gracefully", () => {
    stopEventLoopMonitor();
    const lagStopped = readEventLoopLag();
    expect(lagStopped.minMs).toBe(0);

    startEventLoopMonitor();
    const metrics = readRuntimeMetrics();
    expect(metrics.rssBytes).toBeGreaterThan(0);
  });
});
