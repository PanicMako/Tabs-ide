import * as Path from "node:path";
import { Worker } from "node:worker_threads";

// oxlint-disable unicorn/require-post-message-target-origin -- Node worker_threads has no target origin.

const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_INPUT_BYTES = 64 * 1024;

export interface LogicSpikeOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/** Disposable runtime probe. It is not yet an extension execution API. */
export function runExtensionLogicSpike(
  source: string,
  argument: unknown,
  options: LogicSpikeOptions = {},
): Promise<unknown> {
  return runInDisposableLogicWorker(
    Path.join(__dirname, "extensionLogicWorker.js"),
    source,
    argument,
    options,
  );
}

/** Worker file is supplied only by trusted host code, never a package manifest. */
export function runInDisposableLogicWorker(
  workerFile: string,
  source: string,
  argument: unknown,
  options: LogicSpikeOptions = {},
): Promise<unknown> {
  if (typeof source !== "string" || Buffer.byteLength(source) > MAX_SOURCE_BYTES) {
    return Promise.reject(new Error("Extension logic source exceeds its size limit."));
  }
  let input: string;
  try {
    input = JSON.stringify(argument);
  } catch {
    return Promise.reject(new Error("Extension logic input is not JSON serializable."));
  }
  if (typeof input !== "string" || Buffer.byteLength(input) > MAX_INPUT_BYTES) {
    return Promise.reject(new Error("Extension logic input exceeds its size limit."));
  }
  const timeoutMs = options.timeoutMs ?? 3_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 5_000) {
    return Promise.reject(new Error("Invalid extension logic deadline."));
  }
  if (options.signal?.aborted) return Promise.reject(new Error("Extension logic cancelled."));

  return new Promise((resolve, reject) => {
    const worker = new Worker(workerFile, {
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
    });
    let settled = false;
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      options.signal?.removeEventListener("abort", cancel);
      void worker.terminate();
      if (error) reject(error);
      else resolve(value);
    };
    const cancel = () => finish(new Error("Extension logic cancelled."));
    const watchdog = setTimeout(
      () => finish(new Error("Extension logic deadline exceeded.")),
      timeoutMs,
    );
    worker.once("message", (message: unknown) => {
      if (!message || typeof message !== "object") {
        finish(new Error("Extension logic worker returned an invalid response."));
        return;
      }
      const result = message as { ok?: unknown; value?: unknown; error?: unknown };
      if (result.ok === true) finish(undefined, result.value);
      else
        finish(
          new Error(typeof result.error === "string" ? result.error : "Extension logic failed."),
        );
    });
    worker.once("error", (error) => finish(error));
    worker.once("exit", (code) => {
      if (!settled) finish(new Error(`Extension logic worker exited (${code}).`));
    });
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
    else worker.postMessage({ source, input, timeoutMs });
  });
}
