// The session-search engine: owns the SQLite store and the background index pass. It is
// transport-agnostic so it can be exercised in-process by tests; production hosts it in a
// worker thread (see sessionSearchWorker.ts) so none of this touches the server event loop.
import type {
  SessionSearchAgent,
  SessionSearchPreviewInput,
  SessionSearchPreviewResult,
  SessionSearchQueryInput,
  SessionSearchQueryResult,
  SessionSearchStatus,
} from "@tabs/contracts";

import type { SessionSearchRoots } from "./discovery.ts";
import { buildPreview } from "./preview.ts";
import { runIndexPass } from "./indexer.ts";
import { openSqlDatabase } from "./sqliteAdapter.ts";
import { SessionSearchStore, type StoredSession } from "./store.ts";

export interface EngineOptions {
  readonly dbPath: string;
  readonly roots: SessionSearchRoots;
  readonly now?: () => number;
  readonly onStatus?: (status: SessionSearchStatus) => void;
}

export class SessionSearchEngine {
  private indexing = false;
  private rerun = false;
  private pending = 0;
  private error: string | null = null;
  private disposed = false;
  private lastIndexedAt: number | null;
  private currentPass: Promise<void> = Promise.resolve();

  private readonly store: SessionSearchStore;
  private readonly options: EngineOptions;

  private constructor(store: SessionSearchStore, options: EngineOptions) {
    this.store = store;
    this.options = options;
    const last = store.getMeta("lastIndexedAt");
    this.lastIndexedAt = last === null ? null : Number(last);
  }

  static async open(options: EngineOptions): Promise<SessionSearchEngine> {
    const db = await openSqlDatabase(options.dbPath);
    return new SessionSearchEngine(SessionSearchStore.open(db), options);
  }

  status(): SessionSearchStatus {
    const counts = this.store.counts();
    return {
      state: this.error ? "error" : this.indexing ? "indexing" : "idle",
      sessions: counts.sessions,
      messages: counts.messages,
      byAgent: counts.byAgent,
      pending: this.pending,
      lastIndexedAt: this.lastIndexedAt,
      error: this.error,
    };
  }

  query(input: SessionSearchQueryInput): SessionSearchQueryResult {
    const startedAt = performance.now();
    const hits = this.store.query(input, this.options.now?.() ?? Date.now());
    return { hits, indexing: this.indexing, elapsedMs: Math.round(performance.now() - startedAt) };
  }

  getSession(agent: SessionSearchAgent, sessionId: string): StoredSession | null {
    return this.store.getSession(agent, sessionId);
  }

  preview(input: SessionSearchPreviewInput): SessionSearchPreviewResult {
    return buildPreview(this.store.getMessages(input.agent, input.sessionId), input.query);
  }

  /** Starts (or queues) an index pass and returns immediately. */
  reindex(full = false): void {
    if (this.disposed) return;
    if (full) this.store.clear();
    if (this.indexing) {
      this.rerun = true;
      return;
    }
    this.currentPass = this.runPasses();
  }

  /** Resolves when no pass is running; for tests and orderly shutdown. */
  whenIdle(): Promise<void> {
    return this.currentPass;
  }

  private emit() {
    this.options.onStatus?.(this.status());
  }

  private async runPasses(): Promise<void> {
    this.indexing = true;
    this.error = null;
    this.emit();
    try {
      do {
        this.rerun = false;
        await runIndexPass({
          store: this.store,
          roots: this.options.roots,
          shouldAbort: () => this.disposed,
          onProgress: ({ pending }) => {
            this.pending = pending;
            this.emit();
          },
        });
      } while (this.rerun && !this.disposed);
      this.lastIndexedAt = Date.now();
      if (!this.disposed) this.store.setMeta("lastIndexedAt", String(this.lastIndexedAt));
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      this.indexing = false;
      this.pending = 0;
      if (!this.disposed) this.emit();
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.currentPass;
    this.store.close();
  }
}
