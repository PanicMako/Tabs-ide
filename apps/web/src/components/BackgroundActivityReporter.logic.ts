import { ThreadId, type BackgroundScope, type ClientActivityReportInput } from "@tabs/contracts";

export const CLIENT_ID_KEY = "tabs-background-client-id";
export const DEBOUNCE_MS = 250;
export const INTERACTION_WINDOW_MS = 60_000;
export const REPORT_INTERVAL_MS = 30_000;
export const LEASE_TTL_MS = 45_000;

export function getOrCreateClientId(storage: Pick<Storage, "getItem" | "setItem">): string {
  try {
    const existing = storage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    storage.setItem(CLIENT_ID_KEY, created);
    return created;
  } catch {
    return "ephemeral-client-id";
  }
}

export function wasRecentlyInteracted(lastInteractionMs: number, nowMs: number): boolean {
  return lastInteractionMs <= nowMs && nowMs - lastInteractionMs < INTERACTION_WINDOW_MS;
}

export function resolveCurrentScopes(pathname: string): BackgroundScope[] {
  const scopes: BackgroundScope[] = [{ type: "server-config" }, { type: "provider-status" }];
  const segments = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  const threadId =
    segments[0] === "chat"
      ? segments[1]
      : segments.length === 2
        ? segments[1]
        : segments.length === 1 &&
            !["settings", "usage", "welcome", "connect", "pair"].includes(segments[0]!)
          ? segments[0]
          : undefined;
  if (threadId) {
    scopes.push({ type: "thread", threadId: ThreadId.make(threadId) });
  }
  return scopes;
}

export interface ActivityReporterQueueOptions {
  readonly sendReport: (report: ClientActivityReportInput) => Promise<unknown>;
  readonly getReportInput: (recentlyInteracted: boolean) => ClientActivityReportInput;
  readonly debounceMs?: number;
}

export interface ActivityReporterQueue {
  readonly requestReport: (immediate?: boolean) => void;
  readonly recordInteraction: (nowMs?: number) => void;
  readonly dispose: () => void;
  readonly isInFlight: () => boolean;
  readonly isPending: () => boolean;
}

export function createActivityReporterQueue(
  options: ActivityReporterQueueOptions,
): ActivityReporterQueue {
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  let inFlight = false;
  let pending = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let lastInteractionMs = Date.now();

  const executeReport = async () => {
    if (disposed) return;
    if (inFlight) {
      pending = true;
      return;
    }
    inFlight = true;
    const now = Date.now();
    const recently = wasRecentlyInteracted(lastInteractionMs, now);
    const input = options.getReportInput(recently);
    try {
      await options.sendReport(input);
    } catch {
      // Swallowed - background heartbeat
    } finally {
      inFlight = false;
      if (pending && !disposed) {
        pending = false;
        requestReport(true);
      }
    }
  };

  const requestReport = (immediate = false) => {
    if (disposed) return;
    if (inFlight) {
      pending = true;
      return;
    }
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (immediate) {
      void executeReport();
    } else {
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void executeReport();
      }, debounceMs);
    }
  };

  const recordInteraction = (nowMs = Date.now()) => {
    const wasRecent = wasRecentlyInteracted(lastInteractionMs, nowMs);
    lastInteractionMs = nowMs;
    if (!wasRecent) {
      requestReport();
    }
  };

  const dispose = () => {
    disposed = true;
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  return {
    requestReport,
    recordInteraction,
    dispose,
    isInFlight: () => inFlight,
    isPending: () => pending,
  };
}
