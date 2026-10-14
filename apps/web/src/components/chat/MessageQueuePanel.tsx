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
import type { ThreadId } from "@tabs/contracts";
import {
  useMessageQueueStore,
  getThreadQueuedMessages,
  type QueuedMessage,
} from "~/stores/messageQueueStore";
import { formatRelativeTime } from "~/timestampFormat";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Dialog, DialogTrigger, DialogPopup, DialogTitle } from "../ui/dialog";
import { CompanionEmpty } from "../agents/companion/CompanionChrome";
import { showCustomConfirm } from "~/lib/customConfirm";
import { SchedulePicker } from "../ui/SchedulePicker";

export interface MessageQueuePanelProps {
  activeThreadId?: ThreadId | null | undefined;
  onSendNow?: ((message: QueuedMessage) => void) | undefined;
  className?: string | undefined;
}

export const MessageQueuePanel = memo(function MessageQueuePanel({
  activeThreadId,
  onSendNow,
  className,
}: MessageQueuePanelProps) {
  const queueByThread = useMessageQueueStore((state) => state.queueByThread);
  const removeQueuedMessage = useMessageQueueStore((state) => state.removeQueuedMessage);
  const clearQueue = useMessageQueueStore((state) => state.clearQueue);
  const reorderQueue = useMessageQueueStore((state) => state.reorderQueue);
  const updateMessageSchedule = useMessageQueueStore((state) => state.updateMessageSchedule);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [schedulingMsgId, setSchedulingMsgId] = useState<string | null>(null);

  const queuedMessages = getThreadQueuedMessages(queueByThread, activeThreadId);

  const handleClear = useCallback(async () => {
    if (!activeThreadId) return;
    if (!(await showCustomConfirm("Remove every queued message in this thread?"))) return;
    clearQueue(activeThreadId);
    toastManager.add({
      type: "info",
      title: "Queue cleared",
      description: "Removed all queued messages for this thread.",
    });
  }, [activeThreadId, clearQueue]);

  const handleDelete = useCallback(
    (msgId: string) => {
      if (!activeThreadId) return;
      removeQueuedMessage(activeThreadId, msgId);
      toastManager.add({
        type: "info",
        title: "Message removed from queue",
      });
    },
    [activeThreadId, removeQueuedMessage],
  );

  const handleUpdateSchedule = useCallback(
    (msgId: string, date: Date | null) => {
      if (!activeThreadId) return;
      updateMessageSchedule(activeThreadId, msgId, date ? date.toISOString() : null);
      setSchedulingMsgId(null);
      toastManager.add({
        type: "success",
        title: date ? "Schedule updated" : "Schedule removed",
        description: date
          ? `Will dispatch on ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
          : "Will send when the agent is idle and the composer is empty.",
      });
    },
    [activeThreadId, updateMessageSchedule],
  );

  return (
    <div
      className={cn(
        "companion-queue flex h-full min-h-0 flex-col bg-background text-foreground",
        className,
      )}
    >
      <div className="companion-toolbar queue-toolbar">
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
        {queuedMessages.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto size-7 text-muted-foreground hover:text-destructive"
            aria-label="Clear queue"
            title="Clear queue"
            onClick={() => void handleClear()}
          >
            <Trash2Icon size={14} />
          </Button>
        )}
      </div>

      {/* Main List Area */}
      {queuedMessages.length === 0 ? (
        <CompanionEmpty kind="queue" title="What’s next?">
          Queue a follow-up from the composer. It will send when the agent is ready.
        </CompanionEmpty>
      ) : (
        <div className="queue-messages">
          {queuedMessages.map((msg, index) => {
            const { value: timeVal, suffix: timeSuffix } = formatRelativeTime(msg.createdAt);
            const isFirst = index === 0;
            const isLast = index === queuedMessages.length - 1;

            const isScheduled = Boolean(msg.scheduledFor);
            const scheduledDate = msg.scheduledFor ? new Date(msg.scheduledFor) : null;
            const expanded = expandedId === msg.id;
            const normalized = msg.text.trim().replace(/\s+/g, " ");
            const snippet =
              normalized.length > 120
                ? `${normalized.slice(0, 117)}…`
                : normalized || "Attached follow-up";

            return (
              <article key={msg.id} className="queue-message">
                <div className="queue-message-meta">
                  <span className="queue-position">{String(index + 1).padStart(2, "0")}</span>
                  <span>{isFirst ? "Next" : "In line"}</span>
                  <time dateTime={msg.createdAt}>
                    {timeVal} {timeSuffix ?? ""}
                  </time>
                </div>
                <button
                  type="button"
                  className="queue-message-heading"
                  aria-label={`Preview queued message: ${snippet}`}
                  aria-expanded={expanded}
                  onClick={() => setExpandedId(expanded ? null : msg.id)}
                >
                  <span className="queue-message-title">{snippet}</span>
                  <ChevronDownIcon
                    size={14}
                    className={expanded ? "rotate-180 shrink-0" : "shrink-0"}
                    aria-hidden="true"
                  />
                </button>
                {expanded && <p className="queue-message-text">{msg.text}</p>}

                {msg.dispatchError && (
                  <p
                    role="alert"
                    className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive"
                  >
                    {msg.dispatchError}
                  </p>
                )}
                {(msg.files?.length ?? 0) > 0 && (
                  <div className="stash-files">
                    {msg.files!.map((file) => (
                      <span key={file.id}>{file.name}</span>
                    ))}
                  </div>
                )}
                {/* Attachments preview */}
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="stash-images">
                    {msg.attachments.map((image) => (
                      <figure key={image.id}>
                        <img src={image.dataUrl} alt={image.name} />
                        <figcaption title={image.name}>{image.name}</figcaption>
                      </figure>
                    ))}
                  </div>
                )}

                {/* Dispatch Trigger Bar */}
                <div className="queue-message-controls">
                  <Dialog
                    open={schedulingMsgId === msg.id}
                    onOpenChange={(open) => setSchedulingMsgId(open ? msg.id : null)}
                  >
                    <DialogTrigger
                      render={
                        <button
                          type="button"
                          className="queue-schedule"
                          aria-label={`Schedule queued message ${index + 1}`}
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
                        onConfirm={(date) => handleUpdateSchedule(msg.id, date)}
                        onCancel={() => setSchedulingMsgId(null)}
                      />
                    </DialogPopup>
                  </Dialog>

                  {isScheduled && (
                    <button
                      type="button"
                      onClick={() => handleUpdateSchedule(msg.id, null)}
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
                      disabled={isFirst || !activeThreadId}
                      onClick={() =>
                        activeThreadId && reorderQueue(activeThreadId, index, index - 1)
                      }
                    >
                      <ArrowUpIcon size={13} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Move queued message ${index + 1} down`}
                      disabled={isLast || !activeThreadId}
                      onClick={() =>
                        activeThreadId && reorderQueue(activeThreadId, index, index + 1)
                      }
                    >
                      <ArrowDownIcon size={13} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete queued message ${index + 1}`}
                      onClick={() => handleDelete(msg.id)}
                    >
                      <Trash2Icon size={13} />
                    </Button>
                  </div>
                  {/* Manual Send Now */}
                  {onSendNow && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onSendNow(msg)}
                      className="h-6 gap-1 px-2 text-[11px] font-medium text-foreground hover:bg-accent cursor-pointer"
                    >
                      <SendIcon className="size-3 text-foreground" />
                      <span>{msg.dispatchError ? "Retry" : "Send next"}</span>
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
});
