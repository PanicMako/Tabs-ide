import {
  ArrowDownIcon,
  ArrowUpIcon,
  ClockIcon,
  PlayIcon,
  SendIcon,
  Trash2Icon,
  ListOrderedIcon,
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
import { ScrollArea } from "../ui/scroll-area";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Popover, PopoverTrigger, PopoverPopup } from "../ui/popover";
import { AppleTimePicker } from "../ui/AppleTimePicker";

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

  const [schedulingMsgId, setSchedulingMsgId] = useState<string | null>(null);

  const queuedMessages = getThreadQueuedMessages(queueByThread, activeThreadId);

  const handleClear = useCallback(() => {
    if (!activeThreadId) return;
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
        title: date ? "Schedule updated" : "Scheduled removed",
        description: date
          ? `Will dispatch on ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
          : "Will dispatch automatically on turn completion.",
      });
    },
    [activeThreadId, updateMessageSchedule],
  );

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-background text-foreground", className)}>
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/60 p-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <ListOrderedIcon className="size-4 text-foreground" />
          <span>Message Queue</span>
          <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-mono tabular-nums text-muted-foreground">
            {queuedMessages.length}
          </span>
        </div>
        {queuedMessages.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive"
          >
            <Trash2Icon className="mr-1 size-3" />
            Clear queue
          </Button>
        )}
      </div>

      {/* Helper notice */}
      <div className="bg-muted/30 px-3 py-2 border-b border-border/40 text-[11px] text-muted-foreground leading-relaxed">
        <span className="font-medium text-foreground">Auto-dispatch:</span> Messages queued here
        execute in order. Messages with a scheduled time wait until their scheduled time arrives.
      </div>

      {/* Main List Area */}
      {queuedMessages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-xs text-muted-foreground">
          <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground/70">
            <ClockIcon className="size-6" />
          </div>
          <p className="font-medium text-foreground">No messages in queue</p>
          <p className="mt-1 max-w-xs text-[11px] text-muted-foreground/80 leading-relaxed">
            While the agent is working, write your follow-up message in the composer and click{" "}
            <span className="font-semibold text-foreground">Queue</span> or schedule it for a
            specific time.
          </p>
        </div>
      ) : (
        <ScrollArea className="flex-1 overflow-y-auto p-2">
          <div className="space-y-2">
            {queuedMessages.map((msg, index) => {
              const { value: timeVal, suffix: timeSuffix } = formatRelativeTime(msg.createdAt);
              const isFirst = index === 0;
              const isLast = index === queuedMessages.length - 1;

              const isScheduled = Boolean(msg.scheduledFor);
              const scheduledDate = msg.scheduledFor ? new Date(msg.scheduledFor) : null;
              const isPastScheduled = scheduledDate && scheduledDate.getTime() <= Date.now();

              return (
                <div
                  key={msg.id}
                  className="group relative flex flex-col gap-2 rounded-lg border border-border/70 bg-card/60 p-3 shadow-2xs transition-colors hover:border-border"
                >
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <div className="flex items-center gap-1.5 font-semibold text-foreground">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-foreground">
                        #{index + 1}
                      </span>
                      <span>{isFirst ? "Up Next" : `Queue Position ${index + 1}`}</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <span>
                        {timeVal} {timeSuffix ?? ""}
                      </span>

                      {/* Reorder Buttons */}
                      <div className="flex items-center ml-1 opacity-80 group-hover:opacity-100">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={isFirst || !activeThreadId}
                          onClick={() =>
                            activeThreadId && reorderQueue(activeThreadId, index, index - 1)
                          }
                          className="size-5 text-muted-foreground disabled:opacity-20 cursor-pointer"
                          title="Move up"
                        >
                          <ArrowUpIcon className="size-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={isLast || !activeThreadId}
                          onClick={() =>
                            activeThreadId && reorderQueue(activeThreadId, index, index + 1)
                          }
                          className="size-5 text-muted-foreground disabled:opacity-20 cursor-pointer"
                          title="Move down"
                        >
                          <ArrowDownIcon className="size-3" />
                        </Button>
                      </div>

                      {/* Delete */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(msg.id)}
                        className="size-5 text-muted-foreground hover:text-destructive ml-0.5 cursor-pointer"
                        title="Delete from queue"
                      >
                        <Trash2Icon className="size-3" />
                      </Button>
                    </div>
                  </div>

                  {/* Message Preview */}
                  <div className="rounded-md bg-muted/40 p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap select-text text-foreground">
                    {msg.text}
                  </div>

                  {/* Attachments preview */}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex items-center gap-1.5 pt-1">
                      {msg.attachments.map((att) => (
                        <img
                          key={att.id}
                          src={att.dataUrl}
                          alt={att.name}
                          className="size-8 rounded border border-border/80 object-cover"
                        />
                      ))}
                      <span className="text-[10px] text-muted-foreground">
                        {msg.attachments.length} attachment{msg.attachments.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  )}

                  {/* Dispatch Trigger Bar */}
                  <div className="flex items-center justify-between pt-1 text-[11px]">
                    <div className="flex items-center gap-1">
                      <Popover
                        open={schedulingMsgId === msg.id}
                        onOpenChange={(open) => setSchedulingMsgId(open ? msg.id : null)}
                        modal
                      >
                        <PopoverTrigger
                          render={
                            <button
                              type="button"
                              className={cn(
                                "flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer",
                                isScheduled
                                  ? isPastScheduled
                                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                    : "bg-primary/10 text-foreground hover:bg-primary/20"
                                  : "bg-muted/70 text-muted-foreground hover:text-foreground",
                              )}
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
                                  <span>Next turn</span>
                                </>
                              )}
                            </button>
                          }
                        />
                        <PopoverPopup
                          align="start"
                          side="top"
                          hasBackdrop
                          className="p-0 border-none bg-transparent shadow-none"
                        >
                          <AppleTimePicker
                            value={scheduledDate ?? undefined}
                            onConfirm={(date) => handleUpdateSchedule(msg.id, date)}
                            onCancel={() => setSchedulingMsgId(null)}
                          />
                        </PopoverPopup>
                      </Popover>

                      {isScheduled && (
                        <button
                          type="button"
                          onClick={() => handleUpdateSchedule(msg.id, null)}
                          className="text-[10px] text-muted-foreground hover:text-foreground underline cursor-pointer ml-1"
                        >
                          Clear time
                        </button>
                      )}
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
                        <span>Dispatch Now</span>
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
});
