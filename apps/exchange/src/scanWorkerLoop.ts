import { setTimeout as delay } from "node:timers/promises";

/** One bounded scan at a time. Shutdown drains the current scan before returning. */
export async function runScanWorkerLoop(options: {
  readonly signal: AbortSignal;
  readonly scan: () => Promise<boolean>;
  readonly heartbeat: (completed: boolean) => Promise<void>;
  readonly report: (error: unknown) => void;
  readonly idleMs?: number;
  readonly retryMs?: number;
  readonly heartbeatMs?: number;
}): Promise<void> {
  let heartbeatPending: Promise<void> | undefined;
  const heartbeat = async (completed = false) => {
    if (heartbeatPending) {
      await heartbeatPending;
      if (!completed) return;
    }
    heartbeatPending = options
      .heartbeat(completed)
      .catch(options.report)
      .finally(() => {
        heartbeatPending = undefined;
      });
    return heartbeatPending;
  };
  await heartbeat();
  const timer = setInterval(() => {
    void heartbeat();
  }, options.heartbeatMs ?? 5_000);
  timer.unref();
  const pause = async (ms: number) => {
    try {
      await delay(ms, undefined, { signal: options.signal });
    } catch (error) {
      if (!options.signal.aborted) throw error;
    }
  };
  try {
    while (!options.signal.aborted) {
      try {
        if (await options.scan()) await heartbeat(true);
        else await pause(options.idleMs ?? 3_000);
      } catch (error) {
        options.report(error);
        await pause(options.retryMs ?? 5_000);
      }
    }
  } finally {
    clearInterval(timer);
    await heartbeatPending;
  }
}
