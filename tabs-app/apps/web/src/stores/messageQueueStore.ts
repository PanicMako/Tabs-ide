import { ensureDraftThreadExists, type DraftThreadCreation } from "./ensureDraftThread";
import * as DateTime from "effect/DateTime";
import {
  type ChatAttachment,
  type CommandId,
  type EnvironmentId,
  MessageId,
  type RunId,
  type ThreadId,
  type UploadChatAttachment,
} from "@tabs/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { PersistedComposerImageAttachment } from "~/composerDraftStore";
import { createMemoryStorage } from "~/lib/storage";
import { isPrimaryEnvironment, getPrimaryEnvironmentId } from "~/connection/environmentApiRegistry";

export interface QueuedMessageAttachment {
  readonly id: string;
  readonly type?: "image" | "file" | undefined;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly dataUrl: string;
}

export type QueuedMessageIntakeStatus =
  | "pending_upload"
  | "intake_in_flight"
  | "cancellation_requested"
  | "cancellation_failed";

export interface PendingCancellation {
  readonly threadId: ThreadId;
  readonly messageId: string;
  readonly commandId?: CommandId | undefined;
  readonly runId?: RunId | undefined;
  readonly environmentId?: EnvironmentId | null | undefined;
  readonly requestedAt: string;
  readonly status: "requested" | "failed";
  readonly error?: string | undefined;
}

export function getCancellationKey(
  threadId: ThreadId,
  messageId: string,
  environmentId?: EnvironmentId | null,
): string {
  return `${environmentId ?? "primary"}:${threadId}:${messageId}`;
}

export function requestCancellation(
  threadId: ThreadId,
  messageId: string,
  environmentId?: EnvironmentId | null,
  commandId?: CommandId,
): PendingCancellation {
  const store = useMessageQueueStore.getState();
  const cancellation: PendingCancellation = {
    threadId,
    messageId,
    commandId,
    environmentId,
    requestedAt: new Date().toISOString(),
    status: "requested",
  };
  store.setPendingCancellation(cancellation);
  return cancellation;
}

export function hasPendingCancellation(
  threadId: ThreadId,
  messageId: string,
  environmentId?: EnvironmentId | null,
): boolean {
  const store = useMessageQueueStore.getState();
  const pending = store.pendingCancellations ?? {};
  if (environmentId) {
    const key = getCancellationKey(threadId, messageId, environmentId);
    if (pending[key]) return true;
  }
  return Object.values(pending).some((p) => p.threadId === threadId && p.messageId === messageId);
}

export interface QueuedMessage {
  readonly id: string;
  readonly threadId: ThreadId;
  readonly environmentId?: EnvironmentId | null | undefined;
  readonly text: string;
  readonly attachments?:
    | ReadonlyArray<QueuedMessageAttachment | PersistedComposerImageAttachment>
    | undefined;
  readonly dispatchError?: string | undefined;
  readonly files?:
    | ReadonlyArray<QueuedMessageAttachment | PersistedComposerImageAttachment>
    | undefined;
  readonly terminalContextIds?: ReadonlyArray<string> | undefined;
  readonly createdAt: string;
  readonly scheduledFor?: string | null | undefined;
  readonly modelSelection?: unknown | undefined;
  readonly threadCreation?: DraftThreadCreation | undefined;
  readonly dispatchMode?: "start_immediately" | "queue_after_active" | undefined;
  readonly intakeStatus?: QueuedMessageIntakeStatus | undefined;
  readonly cancellationError?: string | undefined;
}

export function isMessageReady(message: QueuedMessage, now: number = Date.now()): boolean {
  if (message.dispatchError || message.intakeStatus === "cancellation_requested") return false;
  if (!message.scheduledFor) return true;
  const time = Date.parse(message.scheduledFor);
  return Number.isFinite(time) && time <= now;
}

interface MessageQueueState {
  readonly queueByThread: Readonly<Record<string, ReadonlyArray<QueuedMessage>>>;
  readonly pendingCancellations?: Readonly<Record<string, PendingCancellation>> | undefined;
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
  setMessageError: (threadId: ThreadId, messageId: string, error: string) => void;
  setMessageCancellationError: (threadId: ThreadId, messageId: string, error: string) => void;
  setMessageIntakeStatus: (
    threadId: ThreadId,
    messageId: string,
    status: QueuedMessageIntakeStatus | undefined,
  ) => void;
  removeQueuedMessage: (threadId: ThreadId, messageId: string) => void;
  confirmCancellation: (
    threadId: ThreadId,
    messageId: string,
    environmentId?: EnvironmentId | null,
  ) => void;
  clearQueue: (threadId: ThreadId) => void;
  reorderQueue: (threadId: ThreadId, fromIndex: number, toIndex: number) => void;
  setPendingCancellation: (cancellation: PendingCancellation) => void;
  removePendingCancellation: (
    threadId: ThreadId,
    messageId: string,
    environmentId?: EnvironmentId | null,
  ) => void;
}

const safeStorage = typeof localStorage !== "undefined" ? localStorage : createMemoryStorage();

export const useMessageQueueStore = create<MessageQueueState>()(
  persist(
    (set, get) => ({
      queueByThread: {},
      pendingCancellations: {},

      enqueueMessage: (message) => {
        const current = get().queueByThread;
        if ((current[message.threadId] ?? []).some((entry) => entry.id === message.id)) return;
        const queueByThread = {
          ...current,
          [message.threadId]: [...(current[message.threadId] ?? []), message],
        };
        // Persist before changing memory: quota failures must leave the composer untouched.
        safeStorage.setItem(
          "tabs:message-queue:v1",
          JSON.stringify({
            state: { queueByThread, pendingCancellations: get().pendingCancellations },
            version: 0,
          }),
        );
        set({ queueByThread });
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
              [threadId]: current.map((m) =>
                m.id === messageId ? { ...m, scheduledFor, dispatchError: undefined } : m,
              ),
            },
          };
        });
      },

      setMessageError: (threadId, messageId, error) =>
        set((state) => ({
          queueByThread: {
            ...state.queueByThread,
            [threadId]: (state.queueByThread[threadId] ?? []).map((message) =>
              message.id === messageId
                ? {
                    ...message,
                    dispatchError: error || undefined,
                    intakeStatus: error ? undefined : message.intakeStatus,
                  }
                : message,
            ),
          },
        })),

      setMessageCancellationError: (threadId, messageId, error) =>
        set((state) => ({
          queueByThread: {
            ...state.queueByThread,
            [threadId]: (state.queueByThread[threadId] ?? []).map((message) =>
              message.id === messageId
                ? {
                    ...message,
                    intakeStatus: "cancellation_failed" as const,
                    cancellationError: error,
                  }
                : message,
            ),
          },
        })),

      setMessageIntakeStatus: (threadId, messageId, status) =>
        set((state) => ({
          queueByThread: {
            ...state.queueByThread,
            [threadId]: (state.queueByThread[threadId] ?? []).map((message) =>
              message.id === messageId
                ? {
                    ...message,
                    intakeStatus: status,
                    cancellationError:
                      status === "cancellation_requested" ? undefined : message.cancellationError,
                  }
                : message,
            ),
          },
        })),

      removeQueuedMessage: (threadId, messageId) => {
        const inFlight = inFlightDispatchIds.has(messageId);
        if (inFlight) {
          // Intake dispatch is currently in flight: retain cancellation intent until server outcome is resolved!
          cancellationRequestedIds.add(messageId);
          set((state) => {
            const current = state.queueByThread[threadId] ?? [];
            const msg = current.find((m) => m.id === messageId);
            const key = getCancellationKey(threadId, messageId, msg?.environmentId);
            const pending = {
              ...state.pendingCancellations,
              [key]: {
                threadId,
                messageId,
                environmentId: msg?.environmentId,
                requestedAt: new Date().toISOString(),
                status: "requested" as const,
              },
            };
            return {
              queueByThread: {
                ...state.queueByThread,
                [threadId]: current.map((m) =>
                  m.id === messageId
                    ? {
                        ...m,
                        intakeStatus: "cancellation_requested" as const,
                        cancellationError: undefined,
                      }
                    : m,
                ),
              },
              pendingCancellations: pending,
            };
          });
          return;
        }

        // If upload is in flight (before dispatch), abort it
        cancelInFlightSync(messageId);
        cancellationRequestedIds.delete(messageId);
        set((state) => {
          const current = state.queueByThread[threadId] ?? [];
          const msg = current.find((m) => m.id === messageId);
          const key = getCancellationKey(threadId, messageId, msg?.environmentId);
          const nextPending = { ...state.pendingCancellations };
          delete nextPending[key];
          return {
            queueByThread: {
              ...state.queueByThread,
              [threadId]: current.filter((m) => m.id !== messageId),
            },
            pendingCancellations: nextPending,
          };
        });
      },

      confirmCancellation: (
        threadId: ThreadId,
        messageId: string,
        environmentId?: EnvironmentId | null,
      ) => {
        cancelInFlightSync(messageId);
        cancellationRequestedIds.delete(messageId);
        set((state) => {
          const current = state.queueByThread[threadId] ?? [];
          const nextPending = { ...state.pendingCancellations };
          for (const key of Object.keys(nextPending)) {
            if (key.endsWith(`:${threadId}:${messageId}`)) {
              delete nextPending[key];
            }
          }
          return {
            queueByThread: {
              ...state.queueByThread,
              [threadId]: current.filter((m) => m.id !== messageId),
            },
            pendingCancellations: nextPending,
          };
        });
      },

      clearQueue: (threadId) => {
        const current = get().queueByThread[threadId] ?? [];
        for (const msg of current) {
          get().removeQueuedMessage(threadId, msg.id);
        }
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

      setPendingCancellation: (cancellation) => {
        set((state) => {
          const key = getCancellationKey(
            cancellation.threadId,
            cancellation.messageId,
            cancellation.environmentId,
          );
          return {
            pendingCancellations: {
              ...state.pendingCancellations,
              [key]: cancellation,
            },
          };
        });
      },

      removePendingCancellation: (threadId, messageId, environmentId) => {
        set((state) => {
          const key = getCancellationKey(threadId, messageId, environmentId);
          const nextPending = { ...state.pendingCancellations };
          delete nextPending[key];
          return { pendingCancellations: nextPending };
        });
      },
    }),
    {
      name: "tabs:message-queue:v1",
      storage: createJSONStorage(() => safeStorage),
    },
  ),
);

if (typeof window !== "undefined") {
  (window as any).__tabsMessageQueueStore = useMessageQueueStore;
}

/** Helper to query queued messages for a specific thread */
export function getThreadQueuedMessages(
  queueByThread: Readonly<Record<string, ReadonlyArray<QueuedMessage>>>,
  threadId: ThreadId | null | undefined,
): ReadonlyArray<QueuedMessage> {
  if (!threadId) return [];
  return queueByThread[threadId] ?? [];
}

const inFlightSyncIds = new Set<string>();
const inFlightSyncKeys = new Set<string>();
const syncCompletions = new Map<string, Promise<void>>();
const inFlightControllers = new Map<string, AbortController>();
const inFlightUploadControllers = new Map<string, AbortController>();
const inFlightDispatchIds = new Set<string>();
const cancellationRequestedIds = new Set<string>();

export function isDispatchInFlight(messageId: string): boolean {
  return inFlightDispatchIds.has(messageId);
}

export function isCancellationRequested(messageId: string): boolean {
  return cancellationRequestedIds.has(messageId);
}

export function cancelInFlightSync(messageId: string): void {
  const controller = inFlightControllers.get(messageId);
  if (controller) {
    controller.abort();
    inFlightControllers.delete(messageId);
  }
  const uploadCtrl = inFlightUploadControllers.get(messageId);
  if (uploadCtrl) {
    uploadCtrl.abort();
    inFlightUploadControllers.delete(messageId);
  }
}

/**
 * Resolves the unambiguous owning environment of a queued message.
 * Untagged legacy entries are strictly owned by the established primary environment.
 * If ownership cannot be safely resolved, returns null.
 */
export function resolveEntryOwningEnvironment(
  msg: QueuedMessage,
): { owningEnvironmentId: EnvironmentId | undefined; isPrimary: boolean } | null {
  if (msg.environmentId === null || msg.environmentId === undefined) {
    // Legacy untagged entries belong strictly to the primary environment
    const primaryId = getPrimaryEnvironmentId();
    return {
      owningEnvironmentId: (primaryId ?? undefined) as EnvironmentId | undefined,
      isPrimary: true,
    };
  }
  if (typeof msg.environmentId === "string" && msg.environmentId.trim() !== "") {
    const isPrimary = isPrimaryEnvironment(msg.environmentId);
    return {
      owningEnvironmentId: msg.environmentId,
      isPrimary,
    };
  }
  return null;
}

const inFlightReconciliations = new Set<string>();

/**
 * Reconciles a pending cancellation with authoritative server state.
 * Resolves runId from atoms projection, getThreadProjection query, or reconcileIntake,
 * issues queued-run.cancel (or run.interrupt if running), and confirms cancellation only
 * upon verified terminal outcome.
 */
export async function reconcilePendingCancellation(
  pending: PendingCancellation,
  api: {
    orchestration: {
      dispatchCommand: (command: any) => Promise<any>;
      getThreadProjection?: (input: { threadId: ThreadId }) => Promise<any>;
      reconcileIntake?: (input: any) => Promise<any>;
    };
  },
  store = useMessageQueueStore.getState(),
): Promise<boolean> {
  const cancelKey = getCancellationKey(pending.threadId, pending.messageId, pending.environmentId);
  if (inFlightReconciliations.has(cancelKey)) {
    return false;
  }
  inFlightReconciliations.add(cancelKey);

  try {
    // 1. Authoritative server reconcileIntake if supported
    if (api.orchestration.reconcileIntake) {
      try {
        const result = await api.orchestration.reconcileIntake({
          threadId: pending.threadId,
          messageId: pending.messageId,
          commandId: pending.commandId,
          cancelIfFound: true,
        });

        if (
          result.outcome === "cancelled" ||
          result.outcome === "interrupted" ||
          result.outcome === "already_completed" ||
          result.outcome === "definitively_rejected"
        ) {
          store.confirmCancellation(pending.threadId, pending.messageId);
          return true;
        }

        // Unknown or in-progress outcome: RETAIN intent!
        store.setPendingCancellation({
          ...pending,
          status: "requested",
        });
        return false;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        store.setPendingCancellation({
          ...pending,
          status: "failed",
          error: errorMsg,
        });
        store.setMessageCancellationError(pending.threadId, pending.messageId, errorMsg);
        return false;
      }
    }

    // 2. Client fallback with strict identity matching
    let runId: RunId | undefined = pending.runId;
    let runStatus: string | undefined = runId ? "queued" : undefined;

    // A. Check projection from atoms with strict environment and userMessageId verification
    try {
      const { readModelStateAtom } = await import("~/state/readModel");
      const { appAtomRegistry } = await import("~/state/atomRegistry");
      const appState = appAtomRegistry.get(readModelStateAtom);
      const thread = appState.threads?.find(
        (t: any) =>
          t.id === pending.threadId &&
          (pending.environmentId === undefined ||
            pending.environmentId === null ||
            t.environmentId === pending.environmentId ||
            (!t.environmentId && pending.environmentId === "primary")),
      );
      const queuedRun = thread?.queuedRuns?.find((r: any) => r.userMessageId === pending.messageId);
      if (queuedRun) {
        runId = queuedRun.id;
        runStatus = "queued";
      } else if (thread?.activeRunId && thread?.activeRunUserMessageId === pending.messageId) {
        // STRICT: Never substitute arbitrary activeRunId! Only match if activeRunUserMessageId equals messageId!
        runId = thread.activeRunId;
        runStatus = "running";
      }
    } catch {}

    // B. Query server getThreadProjection with strict message matching
    if (!runId && api.orchestration.getThreadProjection) {
      try {
        const proj = await api.orchestration.getThreadProjection({ threadId: pending.threadId });
        const queued = proj?.queuedRuns?.find((r: any) => r.userMessageId === pending.messageId);
        const run = proj?.runs?.find((r: any) => r.userMessageId === pending.messageId);
        const matched = queued ? { id: queued.id, status: "queued" } : run;
        if (matched) {
          runId = matched.id;
          runStatus = matched.status;
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        store.setPendingCancellation({
          ...pending,
          status: "failed",
          error: errorMsg,
        });
        store.setMessageCancellationError(pending.threadId, pending.messageId, errorMsg);
        return false;
      }
    }

    if (!runId && (api.orchestration as any).getSnapshot) {
      try {
        const snap = await (api.orchestration as any).getSnapshot();
        const thread = snap?.threads?.find(
          (t: any) =>
            t.id === pending.threadId &&
            (pending.environmentId === undefined ||
              pending.environmentId === null ||
              t.environmentId === pending.environmentId ||
              (!t.environmentId && pending.environmentId === "primary")),
        );
        const queued = thread?.queuedRuns?.find((r: any) => r.userMessageId === pending.messageId);
        const run = thread?.runs?.find((r: any) => r.userMessageId === pending.messageId);
        const matched = queued ? { id: queued.id, status: "queued" } : run;
        if (matched) {
          runId = matched.id;
          runStatus = matched.status;
        } else if (thread?.activeRunId && thread?.activeRunUserMessageId === pending.messageId) {
          runId = thread.activeRunId;
          runStatus = "running";
        }
      } catch {}
    }

    if (runId) {
      try {
        if (runStatus === "running" || runStatus === "preparing") {
          await api.orchestration.dispatchCommand({
            type: "run.interrupt",
            commandId: `interrupt-${Date.now()}-${pending.messageId}`,
            threadId: pending.threadId,
            runId,
          });
        } else {
          await api.orchestration.dispatchCommand({
            type: "queued-run.cancel",
            commandId: `cancel-${Date.now()}-${pending.messageId}`,
            threadId: pending.threadId,
            runId,
          });
        }
        store.confirmCancellation(pending.threadId, pending.messageId);
        return true;
      } catch (cancelErr: unknown) {
        const errorMsg = cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
        store.setPendingCancellation({
          ...pending,
          status: "failed",
          error: errorMsg,
        });
        store.setMessageCancellationError(pending.threadId, pending.messageId, errorMsg);
        return false;
      }
    } else {
      // STRICT: Missing / empty projection is NOT proof of rejection!
      // Retain cancellation intent for reconnect / subsequent reconciliation!
      store.setPendingCancellation({
        ...pending,
        status: "requested",
      });
      return false;
    }
  } finally {
    inFlightReconciliations.delete(cancelKey);
  }
}

/**
 * Reconciles all unresolved pending cancellations against authoritative server state.
 */
export async function reconcileAllPendingCancellations(
  api: {
    orchestration: {
      dispatchCommand: (command: any) => Promise<any>;
      getThreadProjection?: (input: { threadId: ThreadId }) => Promise<any>;
      reconcileIntake?: (input: any) => Promise<any>;
    };
  },
  store = useMessageQueueStore.getState(),
  environmentId?: string,
): Promise<void> {
  const pendingMap = store.pendingCancellations ?? {};
  const pendingList = Object.values(pendingMap).filter(
    (p) =>
      p &&
      (p.status === "requested" || p.status === "failed") &&
      (environmentId === undefined ||
        (isPrimaryEnvironment(environmentId)
          ? isPrimaryEnvironment(p.environmentId ?? undefined)
          : p.environmentId === environmentId)),
  );
  if (pendingList.length === 0) return;

  await Promise.allSettled(
    pendingList.map((pending) => reconcilePendingCancellation(pending, api, store)),
  );
}

/**
 * Migrates local queued messages to the authoritative V2 server queue upon connection or enqueue.
 * Idempotently derives commandId from entry ID, uploads/claims attachments,
 * removes local entry only after server ACK, and preserves entries with errors on failure.
 * Every queue entry has an unambiguous owning environment. Secondary environments can NEVER
 * migrate an untagged legacy entry or an entry belonging to another environment.
 */
export async function migrateLocalQueueToServer(
  environmentId: EnvironmentId | null | undefined,
  api: {
    assets?: {
      persistChatAttachments: (input: {
        threadId: ThreadId;
        messageId: MessageId;
        attachments: ReadonlyArray<UploadChatAttachment>;
      }) => Promise<{ attachments: ReadonlyArray<ChatAttachment> }>;
    };
    orchestration: {
      dispatchCommand: (command: any) => Promise<any>;
      getThreadProjection?: (input: { threadId: ThreadId }) => Promise<any>;
      reconcileIntake?: (input: any) => Promise<any>;
    };
  },
  modelSelection?: unknown,
): Promise<{ migratedCount: number; failedCount: number }> {
  const store = useMessageQueueStore.getState();
  const queueByThread = store.queueByThread;
  let migratedCount = 0;
  let failedCount = 0;

  const callerIsPrimary = isPrimaryEnvironment(environmentId === null ? undefined : environmentId);

  // 1. Reconcile any existing pending cancellations for this environment
  const currentPending = { ...useMessageQueueStore.getState().pendingCancellations };
  for (const [, pending] of Object.entries(currentPending)) {
    const isPrimaryOwner = !pending.environmentId || isPrimaryEnvironment(pending.environmentId);
    if (callerIsPrimary !== isPrimaryOwner) {
      continue;
    }
    if (!callerIsPrimary && environmentId !== pending.environmentId) {
      continue;
    }
    await reconcilePendingCancellation(pending, api, store);
  }

  for (const [, messages] of Object.entries(queueByThread)) {
    for (const msg of messages) {
      const ownership = resolveEntryOwningEnvironment(msg);
      if (!ownership) {
        failedCount += 1;
        store.setMessageError(
          msg.threadId,
          msg.id,
          "Ownership of this queued message cannot be resolved safely; retained locally.",
        );
        continue;
      }

      // Enforce strict environment ownership:
      if (ownership.isPrimary) {
        // A secondary environment MUST NOT migrate an untagged legacy primary entry or explicit primary entry!
        if (!callerIsPrimary) {
          continue;
        }
        if (
          ownership.owningEnvironmentId &&
          environmentId &&
          ownership.owningEnvironmentId !== environmentId
        ) {
          continue;
        }
      } else {
        // A secondary entry belongs only to its specific secondary environment
        if (callerIsPrimary) {
          continue;
        }
        if (environmentId !== ownership.owningEnvironmentId) {
          continue;
        }
      }

      // Skip entries where cancellation was requested
      if (
        msg.intakeStatus === "cancellation_requested" ||
        cancellationRequestedIds.has(msg.id) ||
        Boolean(
          store.pendingCancellations?.[getCancellationKey(msg.threadId, msg.id, msg.environmentId)],
        )
      ) {
        continue;
      }

      const effectiveEnv =
        (ownership.isPrimary
          ? (getPrimaryEnvironmentId() ?? "primary")
          : ownership.owningEnvironmentId) ?? "primary";
      const syncKey = `${effectiveEnv}:${msg.id}`;

      if (inFlightSyncKeys.has(syncKey) || inFlightSyncIds.has(msg.id)) {
        await syncCompletions.get(msg.id);
        continue;
      }
      inFlightSyncKeys.add(syncKey);
      inFlightSyncIds.add(msg.id);
      let completeSync!: () => void;
      syncCompletions.set(
        msg.id,
        new Promise<void>((resolve) => {
          completeSync = resolve;
        }),
      );
      const controller = new AbortController();
      inFlightControllers.set(msg.id, controller);

      try {
        // Abort check: if entry was cancelled before we started processing
        const currentQueueBefore = store.queueByThread[msg.threadId] ?? [];
        if (
          controller.signal.aborted ||
          cancellationRequestedIds.has(msg.id) ||
          !currentQueueBefore.some((entry) => entry.id === msg.id)
        ) {
          continue;
        }

        let creation = msg.threadCreation;
        if (!creation) {
          const { useComposerDraftStore } = await import("~/composerDraftStore");
          const { scopedComposerThreadId, physicalComposerProjectId } =
            await import("~/state/composerDrafts");
          const drafts = useComposerDraftStore.getState();
          const scopedId = scopedComposerThreadId(effectiveEnv as EnvironmentId, msg.threadId);
          const draft =
            drafts.getDraftThread(scopedId) ??
            (callerIsPrimary ? drafts.getDraftThread(msg.threadId) : null);
          const composer =
            drafts.draftsByThreadId[scopedId] ??
            (callerIsPrimary ? drafts.draftsByThreadId[msg.threadId] : undefined);
          const selected =
            msg.modelSelection ??
            (composer?.activeProvider
              ? composer.modelSelectionByProvider[composer.activeProvider]
              : undefined) ??
            modelSelection;
          if (draft && selected)
            creation = {
              ...draft,
              projectId: physicalComposerProjectId(draft.projectId, effectiveEnv),
              modelSelection: selected as DraftThreadCreation["modelSelection"],
            };
        }
        if (creation) {
          const { physicalComposerProjectId } = await import("~/state/composerDrafts");
          creation = {
            ...creation,
            projectId: physicalComposerProjectId(creation.projectId, effectiveEnv),
          };
          await ensureDraftThreadExists(api.orchestration, msg.threadId, creation);
        }

        const imageAttachments: UploadChatAttachment[] = (msg.attachments ?? []).map((att) => ({
          id: att.id ? (att.id as any) : undefined,
          type: ((att as any).type ?? "image") as "image" | "file",
          name: att.name || "image",
          mimeType: att.mimeType || "image/png",
          sizeBytes: Math.max(1, att.sizeBytes || 1),
          dataUrl: att.dataUrl,
        }));

        const fileAttachments: UploadChatAttachment[] = (msg.files ?? []).map((file) => ({
          id: file.id ? (file.id as any) : undefined,
          type: ((file as any).type ?? "file") as "image" | "file",
          name: file.name || "file",
          mimeType: file.mimeType || "application/octet-stream",
          sizeBytes: Math.max(1, file.sizeBytes || 1),
          dataUrl: file.dataUrl,
        }));

        const uploadAttachments = [...imageAttachments, ...fileAttachments];
        let stagedAttachments: ReadonlyArray<ChatAttachment> = [];

        if (uploadAttachments.length > 0) {
          inFlightUploadControllers.set(msg.id, controller);
          try {
            if (!api.assets?.persistChatAttachments) {
              throw new Error(
                "Attachment upload is unavailable; attachments cannot be silently discarded.",
              );
            }
            const persistResult = await api.assets.persistChatAttachments({
              threadId: msg.threadId,
              messageId: MessageId.makeUnsafe(msg.id),
              attachments: uploadAttachments,
            });
            stagedAttachments = persistResult.attachments;
          } finally {
            inFlightUploadControllers.delete(msg.id);
          }
        }

        // Abort check: if cancelled during attachment upload, do not dispatch to server!
        const currentQueueAfterUpload = (
          useMessageQueueStore.getState().queueByThread[msg.threadId] ?? []
        ).some((entry) => entry.id === msg.id);
        if (
          controller.signal.aborted ||
          cancellationRequestedIds.has(msg.id) ||
          !currentQueueAfterUpload
        ) {
          continue;
        }

        const effectiveModelSelection =
          msg.modelSelection ?? creation?.modelSelection ?? modelSelection;

        inFlightDispatchIds.add(msg.id);
        let dispatchResult: any = null;
        let dispatchError: unknown = null;
        try {
          dispatchResult = await api.orchestration.dispatchCommand({
            type: "message.dispatch",
            createdBy: "user",
            creationSource: "web",
            commandId: `migrated-queue-${msg.id}`,
            threadId: msg.threadId,
            messageId: msg.id,
            text: msg.text,
            attachments: stagedAttachments,
            ...(msg.terminalContextIds && msg.terminalContextIds.length > 0
              ? { context: { terminalContextIds: msg.terminalContextIds } }
              : {}),
            scheduledFor: msg.scheduledFor ? DateTime.makeUnsafe(msg.scheduledFor) : undefined,
            dispatchMode: { type: msg.dispatchMode ?? "queue_after_active" },
            ...(effectiveModelSelection ? { modelSelection: effectiveModelSelection } : {}),
          });
        } catch (err: unknown) {
          dispatchError = err;
        } finally {
          inFlightDispatchIds.delete(msg.id);
        }

        const latestStore = useMessageQueueStore.getState();
        const wasCancelled =
          cancellationRequestedIds.has(msg.id) ||
          controller.signal.aborted ||
          (latestStore.queueByThread[msg.threadId] ?? []).find((e) => e.id === msg.id)
            ?.intakeStatus === "cancellation_requested" ||
          Boolean(
            latestStore.pendingCancellations?.[
              getCancellationKey(msg.threadId, msg.id, msg.environmentId)
            ],
          );

        if (wasCancelled) {
          const knownRunId = dispatchResult?.runId;
          latestStore.setPendingCancellation({
            threadId: msg.threadId,
            messageId: msg.id,
            commandId: `cmd-intake-${msg.id}` as CommandId,
            runId: knownRunId,
            environmentId: msg.environmentId,
            requestedAt: new Date().toISOString(),
            status: "requested",
            error:
              dispatchError instanceof Error
                ? dispatchError.message
                : dispatchError
                  ? String(dispatchError)
                  : undefined,
          });

          // Check if dispatchError was a definitive pre-commit rejection
          const isDefinitiveRejection =
            dispatchError &&
            typeof dispatchError === "object" &&
            ("_tag" in dispatchError
              ? dispatchError._tag === "OrchestratorCommandRejectedError" ||
                dispatchError._tag === "OrchestratorCommandPreviouslyRejectedError" ||
                dispatchError._tag === "OrchestratorCommandIdConflictError" ||
                dispatchError._tag === "OrchestratorSubagentThreadReadOnlyError"
              : false);

          if (isDefinitiveRejection) {
            latestStore.confirmCancellation(msg.threadId, msg.id);
          } else {
            // Reconcile with authoritative server state or strict fallback
            await reconcilePendingCancellation(
              {
                threadId: msg.threadId,
                messageId: msg.id,
                commandId: `cmd-intake-${msg.id}` as CommandId,
                runId: knownRunId,
                environmentId: msg.environmentId,
                requestedAt: new Date().toISOString(),
                status: "requested",
              },
              api,
              latestStore,
            );
          }
        } else {
          // Normal ACK path (no cancellation requested):
          if (dispatchError) {
            failedCount += 1;
            latestStore.setMessageError(
              msg.threadId,
              msg.id,
              dispatchError instanceof Error
                ? dispatchError.message
                : "Failed to migrate queued message to server.",
            );
          } else {
            latestStore.confirmCancellation(msg.threadId, msg.id);
            migratedCount += 1;
          }
        }
      } catch (err: unknown) {
        const stillInQueue = (
          useMessageQueueStore.getState().queueByThread[msg.threadId] ?? []
        ).some((entry) => entry.id === msg.id);
        if (!controller.signal.aborted && stillInQueue) {
          failedCount += 1;
          store.setMessageError(
            msg.threadId,
            msg.id,
            err instanceof Error ? err.message : "Failed to migrate queued message to server.",
          );
        }
      } finally {
        inFlightSyncKeys.delete(syncKey);
        inFlightSyncIds.delete(msg.id);
        inFlightControllers.delete(msg.id);
        syncCompletions.delete(msg.id);
        completeSync();
      }
    }
  }

  return { migratedCount, failedCount };
}

/**
 * Retries upload and intake for a failed queued message.
 * Reconciles uncertain prior acceptance before creating anything.
 */
export async function retryQueuedMessage(
  threadId: ThreadId,
  messageId: string,
  api: {
    assets?: {
      persistChatAttachments: (input: {
        threadId: ThreadId;
        messageId: MessageId;
        attachments: ReadonlyArray<UploadChatAttachment>;
      }) => Promise<{ attachments: ReadonlyArray<ChatAttachment> }>;
    };
    orchestration: {
      dispatchCommand: (command: any) => Promise<unknown>;
      getThreadProjection?: (input: { threadId: ThreadId }) => Promise<any>;
    };
  },
  modelSelection?: unknown,
): Promise<boolean> {
  const store = useMessageQueueStore.getState();
  const msg = (store.queueByThread[threadId] ?? []).find((m) => m.id === messageId);
  if (!msg) return false;

  // Clear previous error
  store.setMessageError(threadId, messageId, "");

  // Reconcile uncertain prior acceptance before creating anything
  if (api.orchestration.getThreadProjection) {
    try {
      const proj = await api.orchestration.getThreadProjection({ threadId });
      const existingRun = proj?.runs?.find((r: any) => r.userMessageId === messageId);
      if (existingRun) {
        // Message was already accepted by server! Remove local entry and return true
        store.confirmCancellation(threadId, messageId);
        return true;
      }
    } catch {}
  }

  // Attempt migration for this message
  const result = await migrateLocalQueueToServer(msg.environmentId, api, modelSelection);
  const stillHasError = (useMessageQueueStore.getState().queueByThread[threadId] ?? []).find(
    (m) => m.id === messageId,
  )?.dispatchError;
  return !stillHasError && result.migratedCount > 0;
}

/**
 * Handles Send next for either an authoritative server run or a local pending queue item.
 * For server runs:
 * 1. Move it ahead of other queued runs using queued-run.reorder (before first other run).
 * 2. Clear schedule deadline using queued-run.edit with scheduledFor: null (preserving text & attachments).
 * For local items:
 * Clears schedule, reorders locally, and initiates durable intake.
 */
export async function sendNextQueuedItem(
  threadId: ThreadId,
  item: {
    userMessageId: string;
    runId?: RunId | undefined;
    isServerAuthoritative: boolean;
    text: string;
    attachments?: ReadonlyArray<any> | undefined;
    environmentId?: EnvironmentId | null | undefined;
  },
  api: {
    orchestration: {
      dispatchCommand: (command: any) => Promise<unknown>;
    };
    assets?: any;
  },
  otherQueuedRuns?: ReadonlyArray<{ id: RunId }>,
): Promise<void> {
  if (item.isServerAuthoritative && item.runId) {
    // 1. Move it ahead of other queued runs using queued-run.reorder
    if (otherQueuedRuns && otherQueuedRuns.length > 0) {
      const otherRuns = otherQueuedRuns.filter((r) => r.id !== item.runId);
      if (otherRuns.length > 0) {
        const firstOther = otherRuns[0];
        await api.orchestration.dispatchCommand({
          type: "queued-run.reorder",
          commandId: `reorder-${Date.now()}-${item.runId}`,
          threadId,
          runId: item.runId,
          beforeRunId: firstOther ? firstOther.id : null,
        });
      }
    }

    // 2. Clear schedule deadline using queued-run.edit with scheduledFor: null
    // Preserve text and attachments; do not modify queue-hold
    await api.orchestration.dispatchCommand({
      type: "queued-run.edit",
      commandId: `edit-${Date.now()}-${item.runId}`,
      threadId,
      runId: item.runId,
      text: item.text,
      scheduledFor: null,
      ...(item.attachments !== undefined ? { attachments: item.attachments as any } : {}),
    });
  } else {
    // Local pending item
    const store = useMessageQueueStore.getState();
    store.updateMessageSchedule(threadId, item.userMessageId, null);
    const messages = store.queueByThread[threadId] ?? [];
    const idx = messages.findIndex((m) => m.id === item.userMessageId);
    if (idx > 0) {
      store.reorderQueue(threadId, idx, 0);
    }
    await migrateLocalQueueToServer(item.environmentId, api as any);
    const retained = (useMessageQueueStore.getState().queueByThread[threadId] ?? []).find(
      (message) => message.id === item.userMessageId,
    );
    if (retained) {
      throw new Error(
        retained.dispatchError ??
          "Message intake is still uncertain. Open Queue and retry this message to reconcile its delivery.",
      );
    }
  }
}

/**
 * Enqueues a message locally and immediately attempts durable server intake.
 * Retains retryable local data until server ACK.
 */
export async function enqueueAndSyncQueuedMessage(
  message: QueuedMessage,
  api: {
    assets?: {
      persistChatAttachments: (input: {
        threadId: ThreadId;
        messageId: MessageId;
        attachments: ReadonlyArray<UploadChatAttachment>;
      }) => Promise<{ attachments: ReadonlyArray<ChatAttachment> }>;
    };
    orchestration: {
      dispatchCommand: (command: any) => Promise<unknown>;
    };
  },
  modelSelection?: unknown,
): Promise<void> {
  const store = useMessageQueueStore.getState();
  store.enqueueMessage(message);
  await migrateLocalQueueToServer(message.environmentId, api, modelSelection);
}

if (typeof window !== "undefined") {
  (window as any).__tabsMessageQueueStore = useMessageQueueStore;
  (window as any).__tabsMigrateLocalQueueToServer = migrateLocalQueueToServer;
  (window as any).__tabsReconcilePendingCancellation = reconcilePendingCancellation;
  (window as any).__tabsReconcileAllPendingCancellations = reconcileAllPendingCancellations;
}
