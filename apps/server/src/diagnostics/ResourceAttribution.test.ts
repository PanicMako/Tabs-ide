import { beforeEach, describe, expect, it } from "vitest";

import {
  readResourceAttributionSnapshot,
  recordIoAttribution,
  recordResourceAttribution,
  recordRpcAttribution,
  resetResourceAttribution,
} from "./ResourceAttribution.ts";

describe("ResourceAttribution", () => {
  beforeEach(() => {
    resetResourceAttribution();
  });

  it("records and aggregates component attribution records", () => {
    recordResourceAttribution({
      component: "test-component",
      operation: "read",
      logicalReadBytes: 100,
      count: 1,
      durationMs: 10,
    });
    recordResourceAttribution({
      component: "test-component",
      operation: "read",
      logicalReadBytes: 200,
      count: 2,
      durationMs: 15,
    });

    const snapshot = readResourceAttributionSnapshot();
    expect(snapshot.entries.length).toBe(1);
    expect(snapshot.entries[0]).toMatchObject({
      component: "test-component",
      operation: "read",
      logicalReadBytes: 300,
      count: 3,
      durationMs: 25,
    });
  });

  it("records RPC attribution records via helper", () => {
    recordRpcAttribution("server.getDiagnostics", 42);
    const snapshot = readResourceAttributionSnapshot();
    expect(snapshot.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: "rpc",
          operation: "server.getDiagnostics",
          count: 1,
          durationMs: 42,
        }),
      ]),
    );
  });

  it("records IO attribution via helper", () => {
    recordIoAttribution("storage", "writeLog", 500, 1024, 8);
    const snapshot = readResourceAttributionSnapshot();
    expect(snapshot.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: "storage",
          operation: "writeLog",
          logicalReadBytes: 500,
          logicalWriteBytes: 1024,
          count: 1,
          durationMs: 8,
        }),
      ]),
    );
  });

  it("bounds maximum entries and prunes lowest activity", () => {
    // Fill beyond 500 entries
    for (let i = 0; i < 550; i++) {
      recordResourceAttribution({
        component: `comp-${i}`,
        operation: `op-${i}`,
        logicalReadBytes: i,
        logicalWriteBytes: i,
        count: 1,
      });
    }

    const snapshot = readResourceAttributionSnapshot();
    expect(snapshot.entries.length).toBeLessThanOrEqual(500);
  });
});
