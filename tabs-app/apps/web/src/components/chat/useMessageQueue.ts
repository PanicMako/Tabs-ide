import { useCallback, useState } from "react";
import * as DateTime from "effect/DateTime";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId, ThreadId } from "@tabs/contracts";
import { environmentApi } from "~/connection/environmentApiRegistry";
import {
  useMessageQueueStore,
  getThreadQueuedMessages,
  sendNextQueuedItem,
  retryQueuedMessage,
  type QueuedMessage,
} from "~/stores/messageQueueStore";
import { threadsAtom } from "~/state/threads";
import { newCommandId } from "~/lib/utils";
import { toastManager } from "../ui/toast";
import { showCustomConfirm } from "~/lib/customConfirm";
import type { UnifiedQueueItem } from "./MessageQueuePanel";
import type { MessageEdit } from "./MessageEditor";
import { overmindVisibleMessageText } from "@tabs/shared/overmind";
import { MessageId, type ChatAttachment } from "@tabs/contracts";
import { readFileAsDataUrl } from "~/components/ChatView.logic";

export interface MessageQueueOptions {
  activeThreadId?: ThreadId | null | undefined;
  environmentId?: EnvironmentId | null | undefined;
  onSendNow?: ((message: QueuedMessage) => void) | undefined;
  /**
   * Called after an empty thread, made only to hold its first queued message, was removed with
   * that message. The caller routes somewhere sensible, normally a fresh new thread. Without it
   * the thread is kept.
   */
  onThreadDiscarded?:
    | ((thread: { projectId: ProjectId; environmentId: EnvironmentId | null }) => void)
    | undefined;
}

/** Everything the queue does, without any of how it looks. Each queue layout renders from this. */
export function useMessageQueue({
  activeThreadId,
  environmentId,
  onSendNow,
  onThreadDiscarded,
}: MessageQueueOptions) {
  const queueByThread = useMessageQueueStore((state) => state.queueByThread);
  const removeQueuedMessage = useMessageQueueStore((state) => state.removeQueuedMessage);
  const clearQueue = useMessageQueueStore((state) => state.clearQueue);
  const reorderQueue = useMessageQueueStore((state) => state.reorderQueue);
  const updateMessageSchedule = useMessageQueueStore((state) => state.updateMessageSchedule);

  const threads = useAtomValue(threadsAtom);
  const currentThread = threads.find(
    (t) =>
      t.id === activeThreadId && (environmentId === undefined || t.environmentId === environmentId),
  );
  const serverQueuedRuns = currentThread?.queuedRuns ?? [];
  const localQueuedMessages = getThreadQueuedMessages(queueByThread, activeThreadId);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [schedulingMsgId, setSchedulingMsgId] = useState<string | null>(null);
  const [inFlightActionIds, setInFlightActionIds] = useState<Set<string>>(() => new Set());

  const serverUserMessageIds = new Set(serverQueuedRuns.map((r) => r.userMessageId));

  const serverItems: UnifiedQueueItem[] = serverQueuedRuns.map((r) => ({
    id: r.id,
    runId: r.id,
    userMessageId: r.userMessageId,
    text: r.text,
    scheduledFor: r.scheduledFor,
    attachments: r.attachments,
    isServerAuthoritative: true,
    queuePosition: r.queuePosition,
    queueHeld: r.queueHeld,
    createdAt: r.createdAt,
  }));

  const localPendingItems: UnifiedQueueItem[] = localQueuedMessages
    .filter((m) => {
      if (serverUserMessageIds.has(m.id as any)) return false;
      if (environmentId !== undefined && m.environmentId && m.environmentId !== environmentId) {
        return false;
      }
      return true;
    })
    .map((m) => ({
      id: m.id,
      runId: undefined,
      userMessageId: m.id,
      text: m.text,
      scheduledFor: m.scheduledFor,
      attachments: m.attachments,
      files: m.files,
      dispatchError: m.dispatchError,
      intakeStatus: m.intakeStatus,
      cancellationError: m.cancellationError,
      isServerAuthoritative: false,
      createdAt: m.createdAt,
    }));

  const queuedItems: UnifiedQueueItem[] = [...serverItems, ...localPendingItems];

  /**
   * Queuing or scheduling the first message of a new thread has to create the thread so the
   * server can hold the run. If that message is then removed and nothing was ever sent, the
   * thread is an empty shell: remove it and return to a fresh new thread, as if it never existed.
   */
  const discardThreadIfNeverStarted = useCallback(
    async (remaining: number) => {
      if (!activeThreadId || !currentThread || !onThreadDiscarded || remaining > 0) return;
      if (currentThread.messages.length > 0 || currentThread.latestTurn != null) return;
      const { projectId } = currentThread;
      const owner = currentThread.environmentId ?? environmentId;
      try {
        const api = await environmentApi(owner);
        await api.orchestration.dispatchCommand({
          type: "thread.delete",
          commandId: newCommandId(),
          threadId: activeThreadId,
        });
      } catch {
        // The thread stays; it shows the new-thread welcome and can still be used.
        return;
      }
      onThreadDiscarded({ projectId, environmentId: owner ?? null });
    },
    [activeThreadId, currentThread, environmentId, onThreadDiscarded],
  );

  const handleClear = useCallback(async () => {
    if (!activeThreadId) return;
    if (!(await showCustomConfirm("Remove every queued message in this thread?"))) return;
    const serverRuns = queuedItems.filter((i) => i.isServerAuthoritative && i.runId);
    clearQueue(activeThreadId);
    if (serverRuns.length > 0 && environmentId !== undefined) {
      try {
        const api = await environmentApi(environmentId);
        await Promise.all(
          serverRuns.map((item) =>
            api.orchestration.dispatchCommand({
              type: "queued-run.cancel",
              commandId: newCommandId(),
              threadId: activeThreadId,
              runId: item.runId!,
            }),
          ),
        );
        toastManager.add({
          type: "info",
          title: "Queue cleared",
          description: "Removed all queued messages for this thread.",
        });
        await discardThreadIfNeverStarted(0);
      } catch (err) {
        toastManager.add({
          type: "error",
          title: "Failed to clear queued runs",
          description: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      toastManager.add({
        type: "info",
        title: "Queue cleared",
        description: "Removed all queued messages for this thread.",
      });
    }
  }, [activeThreadId, clearQueue, discardThreadIfNeverStarted, environmentId, queuedItems]);

  const handleDelete = useCallback(
    async (item: UnifiedQueueItem) => {
      if (!activeThreadId) return;
      if (inFlightActionIds.has(item.id)) return;
      if (item.intakeStatus === "cancellation_requested") return;

      if (item.isServerAuthoritative && item.runId) {
        setInFlightActionIds((prev) => new Set(prev).add(item.id));
        try {
          const api = await environmentApi(environmentId);
          await api.orchestration.dispatchCommand({
            type: "queued-run.cancel",
            commandId: newCommandId(),
            threadId: activeThreadId,
            runId: item.runId,
          });
          toastManager.add({
            type: "info",
            title: "Queued run cancelled",
          });
          await discardThreadIfNeverStarted(
            queuedItems.filter((queued) => queued.id !== item.id).length,
          );
        } catch (err) {
          toastManager.add({
            type: "error",
            title: "Failed to cancel queued run",
            description: err instanceof Error ? err.message : String(err),
          });
        } finally {
          setInFlightActionIds((prev) => {
            const next = new Set(prev);
            next.delete(item.id);
            return next;
          });
        }
      } else {
        removeQueuedMessage(activeThreadId, item.userMessageId);
        toastManager.add({
          type: "info",
          title: "Message removed from queue",
        });
      }
    },
    [
      activeThreadId,
      discardThreadIfNeverStarted,
      environmentId,
      inFlightActionIds,
      queuedItems,
      removeQueuedMessage,
    ],
  );

  const handleSendNext = useCallback(
    async (item: UnifiedQueueItem) => {
      if (!activeThreadId) return;
      if (inFlightActionIds.has(item.id)) return;

      setInFlightActionIds((prev) => new Set(prev).add(item.id));
      try {
        const api = await environmentApi(environmentId);
        await sendNextQueuedItem(
          activeThreadId,
          {
            userMessageId: item.userMessageId,
            runId: item.runId,
            isServerAuthoritative: item.isServerAuthoritative,
            text: item.text,
            attachments: item.attachments,
            environmentId,
          },
          api,
          serverQueuedRuns,
        );
        toastManager.add({
          type: "success",
          title: "Moved to front of queue",
          description: "Schedule cleared. Will send next when the agent is ready.",
        });
        return true;
      } catch (err) {
        toastManager.add({
          type: "error",
          title: "Failed to send next",
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setInFlightActionIds((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      }
    },
    [activeThreadId, environmentId, inFlightActionIds, serverQueuedRuns],
  );

  const handleRetry = useCallback(
    async (item: UnifiedQueueItem) => {
      if (!activeThreadId) return;
      if (inFlightActionIds.has(item.id)) return;

      setInFlightActionIds((prev) => new Set(prev).add(item.id));
      try {
        const api = await environmentApi(environmentId);
        const success = await retryQueuedMessage(activeThreadId, item.userMessageId, api);
        if (success) {
          toastManager.add({
            type: "success",
            title: "Queued message retried",
          });
          return true;
        }
      } catch (err) {
        toastManager.add({
          type: "error",
          title: "Failed to retry queued message",
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setInFlightActionIds((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      }
    },
    [activeThreadId, environmentId, inFlightActionIds],
  );

  const handleUpdateSchedule = useCallback(
    async (item: UnifiedQueueItem, date: Date | null) => {
      if (!activeThreadId) return;
      setSchedulingMsgId(null);
      if (item.isServerAuthoritative && item.runId) {
        try {
          const api = await environmentApi(environmentId);
          await api.orchestration.dispatchCommand({
            type: "queued-run.edit",
            commandId: newCommandId(),
            threadId: activeThreadId,
            runId: item.runId,
            text: item.text,
            scheduledFor: date ? DateTime.makeUnsafe(date) : null,
          });
          toastManager.add({
            type: "success",
            title: date ? "Schedule updated" : "Schedule removed",
            description: date
              ? `Will dispatch on ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
              : "Will send when the agent is idle and the composer is empty.",
          });
        } catch (err) {
          toastManager.add({
            type: "error",
            title: "Failed to update schedule",
            description: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        updateMessageSchedule(activeThreadId, item.userMessageId, date ? date.toISOString() : null);
        toastManager.add({
          type: "success",
          title: date ? "Schedule updated" : "Schedule removed",
          description: date
            ? `Will dispatch on ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
            : "Will send when the agent is idle and the composer is empty.",
        });
      }
    },
    [activeThreadId, environmentId, updateMessageSchedule],
  );

  const handleReorder = useCallback(
    async (fromIndex: number, toIndex: number) => {
      if (!activeThreadId) return;
      const target = queuedItems[fromIndex];
      if (!target) return;
      if (target.isServerAuthoritative && target.runId) {
        const reordered = [...queuedItems];
        const [moved] = reordered.splice(fromIndex, 1);
        if (moved) {
          reordered.splice(toIndex, 0, moved);
          const nextTarget = reordered[toIndex + 1];
          try {
            const api = await environmentApi(environmentId);
            await api.orchestration.dispatchCommand({
              type: "queued-run.reorder",
              commandId: newCommandId(),
              threadId: activeThreadId,
              runId: target.runId,
              beforeRunId: nextTarget?.runId ?? null,
            });
          } catch (err) {
            toastManager.add({
              type: "error",
              title: "Failed to reorder queued runs",
              description: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } else {
        reorderQueue(activeThreadId, fromIndex, toIndex);
      }
    },
    [activeThreadId, environmentId, queuedItems, reorderQueue],
  );

  const updateMessageContent = useMessageQueueStore((state) => state.updateMessageContent);
  /**
   * Edits a waiting message's text and images. The server keeps its run, so the message keeps
   * its place and its time. A message still being handed to the server cannot change.
   */
  const handleEdit = useCallback(
    async (item: UnifiedQueueItem, edit: MessageEdit) => {
      if (!activeThreadId) return false;
      // Hidden instructions around the visible text stay where they were.
      const visible = overmindVisibleMessageText(item.text);
      const text =
        visible && visible !== item.text && item.text.includes(visible)
          ? item.text.replace(visible, edit.text)
          : edit.text;
      try {
        const added = await Promise.all(
          edit.addedImages.map(async (file) => ({
            id: `queue-image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            type: "image" as const,
            name: file.name || "image",
            mimeType: file.type || "image/png",
            sizeBytes: Math.max(1, file.size),
            dataUrl: await readFileAsDataUrl(file),
          })),
        );
        const kept = edit.keptImageIds.flatMap((id) =>
          (item.attachments ?? []).filter((attachment: { id?: string }) => attachment.id === id),
        );
        if (item.isServerAuthoritative && item.runId) {
          const api = await environmentApi(environmentId);
          let staged: ReadonlyArray<ChatAttachment> = [];
          if (added.length) {
            if (!api.assets?.persistChatAttachments)
              throw new Error("Adding images to a waiting message is unavailable here.");
            staged = (
              await api.assets.persistChatAttachments({
                threadId: activeThreadId,
                messageId: MessageId.makeUnsafe(item.userMessageId),
                attachments: added,
              })
            ).attachments;
          }
          await api.orchestration.dispatchCommand({
            type: "queued-run.edit",
            commandId: newCommandId(),
            threadId: activeThreadId,
            runId: item.runId,
            text,
            attachments: [...(kept as ChatAttachment[]), ...staged],
          });
        } else {
          updateMessageContent(activeThreadId, item.userMessageId, {
            text,
            attachments: [...(kept as typeof added), ...added],
          });
        }
        toastManager.add({ type: "success", title: "Message updated" });
        return true;
      } catch (err) {
        toastManager.add({
          type: "error",
          title: "Could not update the message",
          description: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    },
    [activeThreadId, environmentId, updateMessageContent],
  );

  /** Send next, or retry a message that failed to dispatch. */
  const sendOrRetry = useCallback(
    async (item: UnifiedQueueItem) => {
      const succeeded = item.dispatchError ? await handleRetry(item) : await handleSendNext(item);
      if (succeeded && onSendNow && activeThreadId)
        onSendNow({
          id: item.userMessageId,
          threadId: activeThreadId,
          environmentId,
          text: item.text,
          createdAt: item.createdAt,
          attachments: item.attachments as any,
          files: item.files as any,
        });
    },
    [activeThreadId, environmentId, handleRetry, handleSendNext, onSendNow],
  );

  return {
    activeThreadId,
    queuedItems,
    expandedId,
    setExpandedId,
    editingId,
    setEditingId,
    edit: handleEdit,
    schedulingMsgId,
    setSchedulingMsgId,
    inFlightActionIds,
    clear: handleClear,
    remove: handleDelete,
    sendOrRetry,
    updateSchedule: handleUpdateSchedule,
    reorder: handleReorder,
  };
}

export type MessageQueueController = ReturnType<typeof useMessageQueue>;
