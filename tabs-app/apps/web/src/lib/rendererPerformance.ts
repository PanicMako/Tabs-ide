export interface SlowRendererInteraction {
  readonly id: string;
  readonly event: string;
  readonly occurredAt: number;
  readonly durationMs: number;
  readonly inputDelayMs: number;
  readonly processingMs: number;
  readonly presentationDelayMs: number;
}

export interface RendererLongTask {
  readonly id: string;
  readonly occurredAt: number;
  readonly durationMs: number;
}

export interface RendererPerformanceSnapshot {
  readonly supported: boolean | null;
  readonly interactions: ReadonlyArray<SlowRendererInteraction>;
  readonly longTasks: ReadonlyArray<RendererLongTask>;
}

const MAX_RECORDED_ENTRIES = 40;
const INTERACTION_THRESHOLD_MS = 80;
const LONG_TASK_THRESHOLD_MS = 50;

let snapshot: RendererPerformanceSnapshot = {
  supported: null,
  interactions: [],
  longTasks: [],
};
let observers: PerformanceObserver[] = [];
let startCount = 0;
const listeners = new Set<() => void>();

export function subscribeToRendererPerformance(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRendererPerformanceSnapshot(): RendererPerformanceSnapshot {
  return snapshot;
}

export function clearRendererPerformanceSamples(): void {
  snapshot = { ...snapshot, interactions: [], longTasks: [] };
  notifyListeners();
}

export function startRendererPerformanceCapture(): () => void {
  if (typeof PerformanceObserver === "undefined") {
    snapshot = { ...snapshot, supported: false };
    notifyListeners();
    return () => undefined;
  }

  startCount += 1;
  if (startCount === 1) {
    startObservers();
  }

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    startCount = Math.max(0, startCount - 1);
    if (startCount === 0) {
      for (const observer of observers) observer.disconnect();
      observers = [];
    }
  };
}

function startObservers(): void {
  const supportedEntryTypes = PerformanceObserver.supportedEntryTypes ?? [];
  const nextObservers: PerformanceObserver[] = [];
  const now = () => (typeof performance === "undefined" ? Date.now() : performance.now());

  if (supportedEntryTypes.includes("event")) {
    try {
      const observer = new PerformanceObserver((list) => {
        const currentTime = now();
        const nextInteractions = [...snapshot.interactions];
        for (const entry of list.getEntries()) {
          const event = entry as PerformanceEventTiming;
          if (event.duration < INTERACTION_THRESHOLD_MS) continue;

          const inputDelayMs = Math.max(0, event.processingStart - event.startTime);
          const processingMs = Math.max(0, event.processingEnd - event.processingStart);
          const interactionId =
            (event as PerformanceEventTiming & { interactionId?: number }).interactionId ?? 0;
          const id =
            interactionId > 0 ? `interaction-${interactionId}` : `event-${event.startTime}`;
          const record: SlowRendererInteraction = {
            id,
            event: event.name,
            occurredAt: Date.now() - Math.max(0, currentTime - event.startTime),
            durationMs: event.duration,
            inputDelayMs,
            processingMs,
            presentationDelayMs: Math.max(0, event.duration - inputDelayMs - processingMs),
          };
          const existingIndex = nextInteractions.findIndex((item) => item.id === id);
          if (existingIndex >= 0) {
            const existing = nextInteractions[existingIndex];
            if (existing && existing.durationMs >= record.durationMs) continue;
            nextInteractions.splice(existingIndex, 1);
          }
          nextInteractions.push(record);
        }

        if (
          nextInteractions.length !== snapshot.interactions.length ||
          nextInteractions.some((item, index) => item !== snapshot.interactions[index])
        ) {
          snapshot = {
            ...snapshot,
            interactions: nextInteractions.slice(-MAX_RECORDED_ENTRIES),
          };
          notifyListeners();
        }
      });
      observer.observe({
        type: "event",
        buffered: true,
        durationThreshold: INTERACTION_THRESHOLD_MS,
      } as PerformanceObserverInit);
      nextObservers.push(observer);
    } catch {
      // Some Electron/Chromium versions expose the entry type but reject observe options.
    }
  }

  if (supportedEntryTypes.includes("longtask")) {
    try {
      const observer = new PerformanceObserver((list) => {
        const currentTime = now();
        const nextTasks = [...snapshot.longTasks];
        for (const entry of list.getEntries()) {
          if (entry.duration < LONG_TASK_THRESHOLD_MS) continue;
          nextTasks.push({
            id: `task-${entry.startTime}`,
            occurredAt: Date.now() - Math.max(0, currentTime - entry.startTime),
            durationMs: entry.duration,
          });
        }
        if (nextTasks.length !== snapshot.longTasks.length) {
          snapshot = { ...snapshot, longTasks: nextTasks.slice(-MAX_RECORDED_ENTRIES) };
          notifyListeners();
        }
      });
      observer.observe({ type: "longtask", buffered: true });
      nextObservers.push(observer);
    } catch {
      // Long-task observation is optional; event timing can still be available.
    }
  }

  observers = nextObservers;
  snapshot = { ...snapshot, supported: nextObservers.length > 0 };
  notifyListeners();
}

function notifyListeners(): void {
  for (const listener of listeners) listener();
}
