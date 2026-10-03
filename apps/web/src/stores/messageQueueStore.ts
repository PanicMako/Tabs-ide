import type { EnvironmentId, ThreadId } from "@tabs/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { PersistedComposerImageAttachment } from "~/composerDraftStore";
import { createMemoryStorage } from "~/lib/storage";

export interface QueuedMessage {
  readonly id: string;
  readonly threadId: ThreadId;
  readonly environmentId?: EnvironmentId | null | undefined;
  readonly text: string;
  readonly attachments?: ReadonlyArray<PersistedComposerImageAttachment> | undefined;
  readonly terminalContextIds?: ReadonlyArray<string> | undefined;
  readonly createdAt: string;
  readonly scheduledFor?: string | null | undefined;
}

export function isMessageReady(message: QueuedMessage, now: number = Date.now()): boolean {
  if (!message.scheduledFor) return true;
  const time = Date.parse(message.scheduledFor);
  return Number.isNaN(time) || time <= now;
}

interface MessageQueueState {
  readonly queueByThread: Readonly<Record<string, ReadonlyArray<QueuedMessage>>>;
  enqueueMessage: (message: QueuedMessage) => void;
  dequeueMessage: (threadId: ThreadId) => QueuedMessage | null;
  peekNextMessage: (threadId: ThreadId) => QueuedMessage | null;
  peekNextReadyMessage: (threadId: ThreadId, now?: number) => QueuedMessage | null;
  dequeueNextReadyMessage: (threadId: ThreadId, now?: number) => QueuedMessage | null;
  updateMessageSchedule: (
    threadId: ThreadId,
    messageId: string,
    scheduledFor: string | null,
  ) => void;
  removeQueuedMessage: (threadId: ThreadId, messageId: string) => void;
  clearQueue: (threadId: ThreadId) => void;
  reorderQueue: (threadId: ThreadId, fromIndex: number, toIndex: number) => void;
}

const safeStorage = typeof localStorage !== "undefined" ? localStorage : createMemoryStorage();

export const useMessageQueueStore = create<MessageQueueState>()(
  persist(
    (set, get) => ({
      queueByThread: {},

      enqueueMessage: (message) => {
        set((state) => {
          const current = state.queueByThread[message.threadId] ?? [];
          return {
            queueByThread: {
              ...state.queueByThread,
              [message.threadId]: [...current, message],
            },
          };
        });
      },

      dequeueMessage: (threadId) => {
        const current = get().queueByThread[threadId];
        if (!current || current.length === 0) return null;
        const [next, ...remaining] = current;
        set((state) => ({
          queueByThread: {
            ...state.queueByThread,
            [threadId]: remaining,
          },
        }));
        return next ?? null;
      },

      peekNextMessage: (threadId) => {
        const current = get().queueByThread[threadId];
        return current && current.length > 0 ? (current[0] ?? null) : null;
      },

      peekNextReadyMessage: (threadId, now = Date.now()) => {
        const current = get().queueByThread[threadId];
        if (!current || current.length === 0) return null;
        const ready = current.find((m) => isMessageReady(m, now));
        return ready ?? null;
      },

      dequeueNextReadyMessage: (threadId, now = Date.now()) => {
        const current = get().queueByThread[threadId];
        if (!current || current.length === 0) return null;
        const idx = current.findIndex((m) => isMessageReady(m, now));
        if (idx === -1) return null;
        const target = current[idx];
        const remaining = [...current.slice(0, idx), ...current.slice(idx + 1)];
        set((state) => ({
          queueByThread: {
            ...state.queueByThread,
            [threadId]: remaining,
          },
        }));
        return target ?? null;
      },

      updateMessageSchedule: (threadId, messageId, scheduledFor) => {
        set((state) => {
          const current = state.queueByThread[threadId] ?? [];
          return {
            queueByThread: {
              ...state.queueByThread,
              [threadId]: current.map((m) => (m.id === messageId ? { ...m, scheduledFor } : m)),
            },
          };
        });
      },

      removeQueuedMessage: (threadId, messageId) => {
        set((state) => {
          const current = state.queueByThread[threadId] ?? [];
          return {
            queueByThread: {
              ...state.queueByThread,
              [threadId]: current.filter((m) => m.id !== messageId),
            },
          };
        });
      },

      clearQueue: (threadId) => {
        set((state) => {
          const next = { ...state.queueByThread };
          delete next[threadId];
          return { queueByThread: next };
        });
      },

      reorderQueue: (threadId, fromIndex, toIndex) => {
        set((state) => {
          const current = [...(state.queueByThread[threadId] ?? [])];
          if (
            fromIndex < 0 ||
            fromIndex >= current.length ||
            toIndex < 0 ||
            toIndex >= current.length
          ) {
            return state;
          }
          const [moved] = current.splice(fromIndex, 1);
          if (!moved) return state;
          current.splice(toIndex, 0, moved);
          return {
            queueByThread: {
              ...state.queueByThread,
              [threadId]: current,
            },
          };
        });
      },
    }),
    {
      name: "tabs:message-queue:v1",
      storage: createJSONStorage(() => safeStorage),
    },
  ),
);

/** Helper to query queued messages for a specific thread */
export function getThreadQueuedMessages(
  queueByThread: Readonly<Record<string, ReadonlyArray<QueuedMessage>>>,
  threadId: ThreadId | null | undefined,
): ReadonlyArray<QueuedMessage> {
  if (!threadId) return [];
  return queueByThread[threadId] ?? [];
}
