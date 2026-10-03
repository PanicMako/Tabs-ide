import { useSyncExternalStore } from "react";

export const SLOW_RPC_THRESHOLD_MS = 15_000;
export const LONG_RUNNING_RPC_THRESHOLD_MS = 120_000;
const MAX_TRACKED_REQUESTS = 256;

export interface SlowRpcRequest {
  readonly requestId: string;
  readonly method: string;
  readonly startedAt: number;
  readonly thresholdMs: number;
  readonly phase?: "transport-queued" | "in-flight";
}

const longRunningMethods = new Set([
  "server.updateProvider",
  "server.refreshProviders",
  "server.updateServer",
]);
const pending = new Map<string, ReturnType<typeof setTimeout>>();
let slowRequests: ReadonlyArray<SlowRpcRequest> = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function trackRpcRequest(
  requestId: string,
  method: string,
  getPhase?: () => "transport-queued" | "in-flight",
): void {
  if (method.includes("subscribe") || method.startsWith("pullRequests.")) return;
  acknowledgeRpcRequest(requestId);
  while (pending.size >= MAX_TRACKED_REQUESTS) {
    const oldest = pending.keys().next().value;
    if (typeof oldest !== "string") break;
    acknowledgeRpcRequest(oldest);
  }
  const thresholdMs = longRunningMethods.has(method)
    ? LONG_RUNNING_RPC_THRESHOLD_MS
    : SLOW_RPC_THRESHOLD_MS;
  const startedAt = Date.now();
  pending.set(
    requestId,
    setTimeout(() => {
      pending.delete(requestId);
      const phase = getPhase ? getPhase() : undefined;
      slowRequests = [
        ...slowRequests,
        { requestId, method, startedAt, thresholdMs, ...(phase ? { phase } : {}) },
      ].slice(-MAX_TRACKED_REQUESTS);
      console.warn(
        `[RPC Latency] Request ${method} (${requestId}) waiting longer than ${Math.round(thresholdMs / 1000)}s`,
        { phase, startedAt },
      );
      emit();
    }, thresholdMs),
  );
}

export function acknowledgeRpcRequest(requestId: string): void {
  const timer = pending.get(requestId);
  if (timer) clearTimeout(timer);
  pending.delete(requestId);
  if (!slowRequests.some((request) => request.requestId === requestId)) return;
  slowRequests = slowRequests.filter((request) => request.requestId !== requestId);
  emit();
}

export function getSlowRpcRequests(): ReadonlyArray<SlowRpcRequest> {
  return slowRequests;
}

export function subscribeToSlowRpcRequests(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSlowRpcRequests(): ReadonlyArray<SlowRpcRequest> {
  return useSyncExternalStore(subscribeToSlowRpcRequests, getSlowRpcRequests, getSlowRpcRequests);
}

export function resetRpcLatencyStateForTests(): void {
  for (const timer of pending.values()) clearTimeout(timer);
  pending.clear();
  slowRequests = [];
  emit();
}
