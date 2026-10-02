import { setTimeout as wait } from "node:timers/promises";
import { submissionLifecycle } from "@tabs/shared/extensionSubmission";

export async function watchSubmission(
  read: (signal: AbortSignal) => Promise<unknown>,
  update: (value: unknown) => void,
  signal: AbortSignal,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  const intervalMs = options.intervalMs ?? 5000;
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([signal, deadline]);
  let previous = "";
  try {
    for (;;) {
      combined.throwIfAborted();
      const value = await read(combined);
      const lifecycle = submissionLifecycle(value);
      if (lifecycle.code === "unknown")
        throw new Error("Registry returned an unknown submission state.");
      const changed = JSON.stringify(value);
      if (changed !== previous) {
        update({ ...(value as object), lifecycle });
        previous = changed;
      }
      if (lifecycle.terminal) return;
      await wait(intervalMs, undefined, { signal: combined });
    }
  } catch (error) {
    if (deadline.aborted && !signal.aborted)
      throw new Error(
        "Watch deadline reached; publication may still be pending. Run status again to reconnect. This is not a rejection.",
      );
    throw error;
  }
}
