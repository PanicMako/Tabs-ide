import { describe, expect, it } from "vitest";

import {
  readResourceTelemetryHistory,
  readResourceTelemetrySnapshot,
  retryResourceTelemetry,
} from "./ResourceTelemetryService.ts";

describe("ResourceTelemetryService", () => {
  it("reads a full resource telemetry snapshot with groups and processes", async () => {
    const snapshot = await readResourceTelemetrySnapshot();
    expect(snapshot).toBeDefined();
    expect(snapshot.readAt).toBeDefined();
    expect(snapshot.processes.length).toBeGreaterThan(0);
    expect(snapshot.groups.allT3).toBeDefined();
    expect(snapshot.groups.backend).toBeDefined();
    expect(snapshot.groups.electron).toBeDefined();
    expect(snapshot.groups.monitor).toBeDefined();
    expect(snapshot.health).toBeDefined();

    // The current server process should be included in the process list
    const serverProc = snapshot.processes.find((p) => p.identity.pid === process.pid);
    expect(serverProc).toBeDefined();
    expect(serverProc?.category).toBe("server");
  });

  it("produces history buckets and top process summaries", async () => {
    const history = await readResourceTelemetryHistory({
      windowMs: 60_000,
      bucketMs: 10_000,
    });
    expect(history).toBeDefined();
    expect(history.buckets.length).toBe(6);
    expect(history.retainedSampleCount).toBeGreaterThan(0);
    expect(history.topProcesses.length).toBeGreaterThan(0);
  });

  it("retries telemetry and returns updated snapshot", async () => {
    const retryResult = await retryResourceTelemetry();
    expect(retryResult.accepted).toBe(true);
    expect(retryResult.snapshot).toBeDefined();
    expect(retryResult.snapshot.groups.allT3.currentRssBytes).toBeGreaterThan(0);
  });
});
