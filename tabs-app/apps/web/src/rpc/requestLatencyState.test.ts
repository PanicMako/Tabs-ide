import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SLOW_RPC_THRESHOLD_MS,
  acknowledgeRpcRequest,
  getSlowRpcRequests,
  resetRpcLatencyStateForTests,
  trackRpcRequest,
} from "./requestLatencyState";

describe("RPC latency tracking", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    resetRpcLatencyStateForTests();
    vi.useRealTimers();
  });

  it("reports an unacknowledged request only after the threshold", () => {
    trackRpcRequest("1", "server.getConfig");
    vi.advanceTimersByTime(SLOW_RPC_THRESHOLD_MS - 1);
    expect(getSlowRpcRequests()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(getSlowRpcRequests().map((request) => request.method)).toEqual(["server.getConfig"]);
  });

  it("removes requests that eventually acknowledge", () => {
    trackRpcRequest("1", "server.getConfig");
    vi.advanceTimersByTime(SLOW_RPC_THRESHOLD_MS);
    acknowledgeRpcRequest("1");
    expect(getSlowRpcRequests()).toEqual([]);
  });

  it("tracks phase when request exceeds threshold", () => {
    trackRpcRequest("activity", "server.reportClientActivity", () => "transport-queued");
    vi.advanceTimersByTime(SLOW_RPC_THRESHOLD_MS);
    expect(getSlowRpcRequests()).toEqual([
      {
        requestId: "activity",
        method: "server.reportClientActivity",
        startedAt: expect.any(Number),
        thresholdMs: SLOW_RPC_THRESHOLD_MS,
        phase: "transport-queued",
      },
    ]);
  });
});
