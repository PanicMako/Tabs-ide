// Main-thread handle to the session-search worker. Spawns lazily on first request, keeps the
// index fresh in the background while it is being used, and shuts the worker down when idle so
// an unused feature costs nothing. All index work happens in the worker thread.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import type {
  SessionSearchPreviewInput,
  SessionSearchPreviewResult,
  SessionSearchQueryInput,
  SessionSearchQueryResult,
  SessionSearchStatus,
} from "@tabs/contracts";
import type { SessionSearchAgent } from "@tabs/contracts";

import type { StoredSession } from "./store.ts";
import type { WorkerInit, WorkerMessage, WorkerRequest, WorkerResult } from "./workerProtocol.ts";

export const REFRESH_INTERVAL_MS = 5 * 60_000;
export const IDLE_SHUTDOWN_MS = 30 * 60_000;
const REQUEST_TIMEOUT_MS = 20_000;

/** Minimal worker surface so tests can substitute an in-process fake. */
export interface WorkerHandle {
  postMessage: (message: WorkerRequest) => void;
  on: {
    (event: "message", listener: (message: WorkerMessage) => void): unknown;
    (event: "error", listener: (error: Error) => void): unknown;
    (event: "exit", listener: (code: number) => void): unknown;
  };
  terminate: () => Promise<unknown>;
  unref?: () => void;
}

export type WorkerFactory = (init: WorkerInit) => WorkerHandle;

/** The worker is bundled as a sibling `.mjs`; from source it lives one directory up as `.ts`. */
export function resolveWorkerUrl(base: string = import.meta.url): URL {
  const candidates = [
    "./sessionSearchWorker.mjs",
    "../sessionSearchWorker.ts",
    "../sessionSearchWorker.mjs",
  ].map((relative) => new URL(relative, base));
  return candidates.find((url) => existsSync(fileURLToPath(url))) ?? candidates[0]!;
}

export const defaultWorkerFactory: WorkerFactory = (init) =>
  new Worker(resolveWorkerUrl(), { workerData: init }) as unknown as WorkerHandle;

type RequestBody = WorkerRequest extends infer R
  ? R extends { readonly id: number }
    ? Omit<R, "id">
    : never
  : never;

interface Pending {
  resolve: (value: WorkerResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class SessionSearchWorkerClient {
  private worker: WorkerHandle | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private lastUse = 0;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly init: WorkerInit,
    private readonly factory: WorkerFactory = defaultWorkerFactory,
    private readonly now: () => number = Date.now,
  ) {}

  private ensureWorker(): WorkerHandle {
    if (this.worker) return this.worker;
    const worker = this.factory(this.init);
    worker.unref?.();
    worker.on("message", (message) => this.onMessage(message));
    worker.on("error", (error) => this.fail(worker, error));
    worker.on("exit", () => this.fail(worker, new Error("Session search worker exited.")));
    this.worker = worker;
    this.refreshTimer = setInterval(() => this.tick(), REFRESH_INTERVAL_MS);
    this.refreshTimer.unref?.();
    return worker;
  }

  private tick() {
    if (this.now() - this.lastUse > IDLE_SHUTDOWN_MS) {
      void this.shutdown();
      return;
    }
    void this.request({ op: "reindex", full: false }).catch(() => undefined);
  }

  private onMessage(message: WorkerMessage) {
    if (message.kind !== "response") return;
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.result);
    else entry.reject(new Error(message.error));
  }

  private fail(worker: WorkerHandle, error: Error) {
    if (this.worker !== worker) return;
    this.worker = null;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }

  private request(body: RequestBody): Promise<WorkerResult> {
    this.lastUse = this.now();
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<WorkerResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Session search timed out."));
      }, REQUEST_TIMEOUT_MS);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ ...body, id } as WorkerRequest);
    });
  }

  query(input: SessionSearchQueryInput) {
    return this.request({ op: "query", input }) as Promise<SessionSearchQueryResult>;
  }

  preview(input: SessionSearchPreviewInput) {
    return this.request({ op: "preview", input }) as Promise<SessionSearchPreviewResult>;
  }

  status() {
    return this.request({ op: "status" }) as Promise<SessionSearchStatus>;
  }

  reindex(full: boolean) {
    return this.request({ op: "reindex", full }) as Promise<SessionSearchStatus>;
  }

  getSession(agent: SessionSearchAgent, sessionId: string) {
    return this.request({ op: "getSession", agent, sessionId }) as Promise<StoredSession | null>;
  }

  async shutdown() {
    const worker = this.worker;
    if (!worker) return;
    this.fail(worker, new Error("Session search stopped."));
    await worker.terminate();
  }
}
