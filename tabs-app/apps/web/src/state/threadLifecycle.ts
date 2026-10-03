import { useSyncExternalStore } from "react";
import type { ThreadId } from "@tabs/contracts";

const STORAGE_KEY = "tabs.threadLifecycle.v1";

export interface ThreadLifecycleEntry {
  pinnedAt: string | null;
  settledAt: string | null;
  snoozedUntil: string | null;
  lastTransition?: {
    at: string;
    reason: string;
  };
}

type ThreadLifecycleState = Record<string, ThreadLifecycleEntry>;

const EMPTY_ENTRY: ThreadLifecycleEntry = {
  pinnedAt: null,
  settledAt: null,
  snoozedUntil: null,
};

let state: ThreadLifecycleState = readState();
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    state = readState();
    for (const listener of listeners) listener();
  });
}

function readState(): ThreadLifecycleState {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as ThreadLifecycleState) : {};
  } catch {
    return {};
  }
}

function publish(next: ThreadLifecycleState): void {
  state = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The in-memory state remains usable when persistence is unavailable.
  }
  for (const listener of listeners) listener();
}

function update(threadId: ThreadId, patch: Partial<ThreadLifecycleEntry>, reason: string): void {
  const current = state[threadId] ?? EMPTY_ENTRY;
  publish({
    ...state,
    [threadId]: {
      ...current,
      ...patch,
      lastTransition: { at: new Date().toISOString(), reason },
    },
  });
}

export const threadLifecycleActions = {
  pin(threadId: ThreadId): void {
    update(threadId, { pinnedAt: new Date().toISOString() }, "Pinned manually");
  },
  unpin(threadId: ThreadId): void {
    update(threadId, { pinnedAt: null }, "Unpinned manually");
  },
  settle(threadId: ThreadId): void {
    update(
      threadId,
      { settledAt: new Date().toISOString(), snoozedUntil: null },
      "Settled manually",
    );
  },
  unsettle(threadId: ThreadId): void {
    update(threadId, { settledAt: null }, "Returned to Unsettled manually");
  },
  snooze(threadId: ThreadId, snoozedUntil: string): void {
    update(threadId, { snoozedUntil, settledAt: null }, "Snoozed");
  },
  unsnooze(threadId: ThreadId): void {
    update(threadId, { snoozedUntil: null }, "Woke manually");
  },
  expireSnoozes(now = Date.now()): void {
    let changed = false;
    const next = { ...state };
    for (const [threadId, entry] of Object.entries(state)) {
      if (entry.snoozedUntil === null || Date.parse(entry.snoozedUntil) > now) continue;
      changed = true;
      next[threadId] = {
        ...entry,
        snoozedUntil: null,
        lastTransition: { at: new Date(now).toISOString(), reason: "Woke on schedule" },
      };
    }
    if (changed) publish(next);
  },
  activate(threadId: ThreadId): void {
    update(threadId, { settledAt: null, snoozedUntil: null }, "Returned to Unsettled: new message");
  },
};

export function useThreadLifecycle(): ThreadLifecycleState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => ({}),
  );
}

export function readThreadLifecycleSnapshot(): ThreadLifecycleState {
  return state;
}

export function lifecycleFor(
  lifecycle: ThreadLifecycleState,
  threadId: ThreadId,
): ThreadLifecycleEntry {
  return lifecycle[threadId] ?? EMPTY_ENTRY;
}

export function isSnoozed(
  entry: Pick<ThreadLifecycleEntry, "snoozedUntil"> | { snoozedUntil?: string | null },
  now = Date.now(),
): boolean {
  return typeof entry.snoozedUntil === "string" && Date.parse(entry.snoozedUntil) > now;
}

export function isSettled(
  entry: Pick<ThreadLifecycleEntry, "settledAt"> | { settledAt?: string | null },
  threadUpdatedAt: string,
): boolean {
  return (
    typeof entry.settledAt === "string" &&
    Date.parse(entry.settledAt) >= Date.parse(threadUpdatedAt)
  );
}
