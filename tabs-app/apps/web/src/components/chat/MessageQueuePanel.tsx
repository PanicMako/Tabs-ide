import { overmindVisibleMessageText } from "@tabs/shared/overmind";
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
import { memo, useEffect, useRef } from "react";
import { onQueueShortcut } from "~/lib/queueShortcuts";
import type { EnvironmentId, ThreadId } from "@tabs/contracts";
import type { RunId } from "@tabs/contracts";
import {
  useMessageQueueStore,
  type QueuedMessage,
  type QueuedMessageIntakeStatus,
} from "~/stores/messageQueueStore";
import { formatRelativeTime } from "~/timestampFormat";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Dialog, DialogTrigger, DialogPopup, DialogTitle } from "../ui/dialog";
import { CompanionEmpty } from "../agents/companion/CompanionChrome";
import { SchedulePicker } from "../ui/SchedulePicker";
import { useMessageQueue, type MessageQueueOptions } from "./useMessageQueue";
import { QueueLedgerView } from "./QueueLayouts";

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
  onThreadDiscarded?: MessageQueueOptions["onThreadDiscarded"];
  /** "ledger" is the side panel's compact rows; without it the full panel shows. */
  variant?: "ledger" | undefined;
  className?: string | undefined;
}

export const MessageQueuePanel = memo(function MessageQueuePanel({
  activeThreadId,
  environmentId,
  onSendNow,
  onThreadDiscarded,
  variant,
  className,
}: MessageQueuePanelProps) {
  const queue = useMessageQueue({ activeThreadId, environmentId, onSendNow, onThreadDiscarded });
  const {
    queuedItems,
    expandedId,
    setExpandedId,
    schedulingMsgId,
    setSchedulingMsgId,
    inFlightActionIds,
    clear: handleClear,
    remove: handleDelete,
    updateSchedule: handleUpdateSchedule,
    reorder: handleReorder,
    sendOrRetry,
  } = queue;
  const latest = useRef({ queuedItems, sendOrRetry });
  latest.current = { queuedItems, sendOrRetry };
  useEffect(
    () =>
      onQueueShortcut((request) => {
        if (request.threadId !== activeThreadId) return false;
        const first = latest.current.queuedItems[0];
        if (!first) return true;
        if (request.action === "edit") {
          queue.setEditingId(first.id);
          setExpandedId(first.id);
        } else {
          void latest.current.sendOrRetry(first);
        }
        return true;
      }),
    // setEditingId and setExpandedId are stable; `latest` carries the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeThreadId],
  );
  if (variant === "ledger") return <QueueLedgerView queue={queue} className={className} />;

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
            const visibleText = overmindVisibleMessageText(item.text);
            const normalized = visibleText.trim().replace(/\s+/g, " ");
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
                {expanded && <p className="queue-message-text">{visibleText}</p>}

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
                    onClick={() => void sendOrRetry(item)}
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
