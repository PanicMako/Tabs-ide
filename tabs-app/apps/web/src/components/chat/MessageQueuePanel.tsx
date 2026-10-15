import {
  ArrowDownIcon,
  ArrowUpIcon,
  SendIcon,
  Trash2Icon,
  InfoIcon,
  ChevronDownIcon,
  CalendarClockIcon,
  ZapIcon,
} from "lucide-react";
import { memo, useCallback, useState } from "react";
import * as DateTime from "effect/DateTime";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@tabs/contracts";
import type { RunId } from "@tabs/contracts";
import { environmentApi } from "~/connection/environmentApiRegistry";
import {
  useMessageQueueStore,
  getThreadQueuedMessages,
  sendNextQueuedItem,
  retryQueuedMessage,
  type QueuedMessage,
  type QueuedMessageIntakeStatus,
} from "~/stores/messageQueueStore";
import { threadsAtom } from "~/state/threads";
import { formatRelativeTime } from "~/timestampFormat";
import { cn, newCommandId } from "~/lib/utils";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Dialog, DialogTrigger, DialogPopup, DialogTitle } from "../ui/dialog";
import { CompanionEmpty } from "../agents/companion/CompanionChrome";
import { showCustomConfirm } from "~/lib/customConfirm";
import { SchedulePicker } from "../ui/SchedulePicker";

if (typeof window !== "undefined") {
  (window as any).__tabsMessageQueueStore = useMessageQueueStore;
}

export interface UnifiedQueueItem {
  readonly id: string;
  readonly runId?: RunId | undefined;
  readonly userMessageId: string;
  readonly text: string;
  readonly scheduledFor?: string | null | undefined;
  readonly attachments?: ReadonlyArray<any> | undefined;
  readonly files?: ReadonlyArray<any> | undefined;
  readonly dispatchError?: string | undefined;
  readonly intakeStatus?: QueuedMessageIntakeStatus | undefined;
  readonly cancellationError?: string | undefined;
  readonly isServerAuthoritative: boolean;
  readonly queuePosition?: number | null | undefined;
  readonly queueHeld?: boolean | undefined;
  readonly createdAt: string;
}

export interface MessageQueuePanelProps {
  activeThreadId?: ThreadId | null | undefined;
  environmentId?: EnvironmentId | null | undefined;
  onSendNow?: ((message: QueuedMessage) => void) | undefined;
  className?: string | undefined;
}

export const MessageQueuePanel = memo(function MessageQueuePanel({
  activeThreadId,
  environmentId,
  onSendNow,
  className,
}: MessageQueuePanelProps) {
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
  }, [activeThreadId, clearQueue, environmentId, queuedItems]);

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
    [activeThreadId, environmentId, inFlightActionIds, removeQueuedMessage],
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

  return (
    <div
      className={cn(
        "companion-queue flex h-full min-h-0 flex-col bg-background text-foreground",
        className,
      )}
    >
      <div className="companion-toolbar queue-toolbar" data-testid="queue-toolbar">
        <span className="queue-toolbar-label">When ready</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="How queued messages send"
              />
            }
          >
            <InfoIcon size={14} />
          </TooltipTrigger>
          <TooltipPopup>
            Messages send in order when the agent is idle and the composer is empty. Scheduled
            messages wait until their time arrives. Send next moves a message to the front and
            removes its schedule.
          </TooltipPopup>
        </Tooltip>
        {queuedItems.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto size-7 text-muted-foreground hover:text-destructive"
            aria-label="Clear queue"
            title="Clear queue"
            data-testid="queue-clear-button"
            onClick={() => void handleClear()}
          >
            <Trash2Icon size={14} />
          </Button>
        )}
      </div>

      {/* Main List Area */}
      {queuedItems.length === 0 ? (
        <CompanionEmpty kind="queue" title="What’s next?">
          Queue a follow-up from the composer. It will send when the agent is ready.
        </CompanionEmpty>
      ) : (
        <div className="queue-messages">
          {queuedItems.map((item, index) => {
            const { value: timeVal, suffix: timeSuffix } = formatRelativeTime(item.createdAt);
            const isFirst = index === 0;
            const isLast = index === queuedItems.length - 1;

            const isScheduled = Boolean(item.scheduledFor);
            const scheduledDate = item.scheduledFor ? new Date(item.scheduledFor) : null;
            const expanded = expandedId === item.id;
            const normalized = item.text.trim().replace(/\s+/g, " ");
            const snippet =
              normalized.length > 120
                ? `${normalized.slice(0, 117)}…`
                : normalized || "Attached follow-up";

            return (
              <article
                key={item.id}
                className="queue-message"
                data-testid="queue-item"
                data-run-id={item.runId ?? ""}
              >
                <div className="queue-message-meta">
                  <span className="queue-position">{String(index + 1).padStart(2, "0")}</span>
                  <span>{isFirst ? "Next" : "In line"}</span>
                  <time dateTime={item.createdAt}>
                    {timeVal} {timeSuffix ?? ""}
                  </time>
                  {item.isServerAuthoritative && (
                    <span className="text-[10px] text-muted-foreground ml-auto font-mono">
                      server
                    </span>
                  )}
                  {item.intakeStatus === "cancellation_requested" && (
                    <span
                      className="text-[11px] text-amber-500 font-medium ml-2"
                      data-testid="queue-cancelling-badge"
                    >
                      Cancelling...
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="queue-message-heading"
                  aria-label={`Preview queued message: ${snippet}`}
                  aria-expanded={expanded}
                  onClick={() => setExpandedId(expanded ? null : item.id)}
                >
                  <span className="queue-message-title">{snippet}</span>
                  <ChevronDownIcon
                    size={14}
                    className={expanded ? "rotate-180 shrink-0" : "shrink-0"}
                    aria-hidden="true"
                  />
                </button>
                {expanded && <p className="queue-message-text">{item.text}</p>}

                {item.dispatchError && (
                  <p
                    role="alert"
                    className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive"
                  >
                    {item.dispatchError}
                  </p>
                )}
                {item.intakeStatus === "cancellation_failed" && (
                  <p
                    role="alert"
                    data-testid="queue-cancellation-error"
                    className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive"
                  >
                    Cancellation failed:{" "}
                    {item.cancellationError || "Unable to cancel queued run on server."}
                  </p>
                )}
                {(item.files?.length ?? 0) > 0 && (
                  <div className="stash-files">
                    {item.files!.map((file) => (
                      <span key={file.id}>{file.name}</span>
                    ))}
                  </div>
                )}
                {/* Attachments preview */}
                {item.attachments && item.attachments.length > 0 && (
                  <div className="stash-images">
                    {item.attachments.map((image: any) => (
                      <figure key={image.id}>
                        <img src={image.previewUrl || image.dataUrl || ""} alt={image.name} />
                        <figcaption title={image.name}>{image.name}</figcaption>
                      </figure>
                    ))}
                  </div>
                )}

                {/* Dispatch Trigger Bar */}
                <div className="queue-message-controls">
                  <Dialog
                    open={schedulingMsgId === item.id}
                    onOpenChange={(open) => setSchedulingMsgId(open ? item.id : null)}
                  >
                    <DialogTrigger
                      render={
                        <button
                          type="button"
                          className="queue-schedule"
                          aria-label={`Schedule queued message ${index + 1}`}
                          data-testid={`queue-schedule-button-${index + 1}`}
                        >
                          {isScheduled ? (
                            <>
                              <CalendarClockIcon className="size-3" />
                              <span>
                                {scheduledDate?.toLocaleDateString([], {
                                  weekday: "short",
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                              </span>
                            </>
                          ) : (
                            <>
                              <ZapIcon className="size-3" />
                              <span>When ready</span>
                            </>
                          )}
                        </button>
                      }
                    />
                    <DialogPopup
                      showCloseButton={false}
                      bottomStickOnMobile={false}
                      className="max-w-[620px] overflow-auto"
                    >
                      <DialogTitle className="sr-only">Schedule message</DialogTitle>
                      <SchedulePicker
                        value={scheduledDate ?? undefined}
                        onConfirm={(date) => handleUpdateSchedule(item, date)}
                        onCancel={() => setSchedulingMsgId(null)}
                      />
                    </DialogPopup>
                  </Dialog>

                  {isScheduled && (
                    <button
                      type="button"
                      onClick={() => handleUpdateSchedule(item, null)}
                      className="text-[10px] text-muted-foreground hover:text-foreground underline cursor-pointer ml-1"
                    >
                      Clear time
                    </button>
                  )}
                  <div className="queue-reorder">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Move queued message ${index + 1} up`}
                      data-testid={`queue-move-up-button-${index + 1}`}
                      disabled={isFirst || !activeThreadId || inFlightActionIds.has(item.id)}
                      onClick={() => void handleReorder(index, index - 1)}
                    >
                      <ArrowUpIcon size={13} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Move queued message ${index + 1} down`}
                      data-testid={`queue-move-down-button-${index + 1}`}
                      disabled={isLast || !activeThreadId || inFlightActionIds.has(item.id)}
                      onClick={() => void handleReorder(index, index + 1)}
                    >
                      <ArrowDownIcon size={13} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete queued message ${index + 1}`}
                      data-testid={`queue-delete-button-${index + 1}`}
                      disabled={
                        inFlightActionIds.has(item.id) ||
                        item.intakeStatus === "cancellation_requested"
                      }
                      onClick={() => void handleDelete(item)}
                    >
                      <Trash2Icon size={13} />
                    </Button>
                  </div>
                  {/* Manual Send Next / Retry */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid={
                      item.dispatchError ? "queue-retry-button" : "queue-send-next-button"
                    }
                    aria-label={
                      item.dispatchError
                        ? `Retry sending queued message ${index + 1}`
                        : `Send queued message ${index + 1} next`
                    }
                    disabled={
                      inFlightActionIds.has(item.id) ||
                      item.intakeStatus === "cancellation_requested"
                    }
                    onClick={async () => {
                      if (item.dispatchError) {
                        await handleRetry(item);
                      } else {
                        await handleSendNext(item);
                      }
                      if (onSendNow) {
                        onSendNow({
                          id: item.userMessageId,
                          threadId: activeThreadId!,
                          environmentId,
                          text: item.text,
                          createdAt: item.createdAt,
                          attachments: item.attachments as any,
                          files: item.files as any,
                        });
                      }
                    }}
                    className="h-6 gap-1 px-2 text-[11px] font-medium text-foreground hover:bg-accent cursor-pointer disabled:opacity-50"
                  >
                    <SendIcon className="size-3 text-foreground" />
                    <span>{item.dispatchError ? "Retry" : "Send next"}</span>
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
});
