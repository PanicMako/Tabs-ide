// Worker-thread entry for session search (bundled beside the server like claudeHistoryWorker).
// Nothing runs on import outside a worker thread.
import { isMainThread, parentPort, workerData } from "node:worker_threads";

import { SessionSearchEngine } from "./sessionSearch/engine.ts";
import { hostEngine } from "./sessionSearch/workerHost.ts";
import type { WorkerInit, WorkerMessage } from "./sessionSearch/workerProtocol.ts";

async function main(port: NonNullable<typeof parentPort>) {
  const init = workerData as WorkerInit;
  const engine = await SessionSearchEngine.open({
    ...init,
    onStatus: (status) => port.postMessage({ kind: "status", status } satisfies WorkerMessage),
  });
  hostEngine(engine, {
    postMessage: (message) => port.postMessage(message),
    on: (event, listener) => port.on(event, listener),
  });
  port.postMessage({ kind: "ready" } satisfies WorkerMessage);
  // First open indexes in the background; the UI shows `indexing` until it finishes.
  engine.reindex(false);
}

if (!isMainThread && parentPort) void main(parentPort);
