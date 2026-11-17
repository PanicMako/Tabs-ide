import { useRef } from "react";
import { useStaggerIn } from "../agents/companion/designs/motion";
import { overmindVisibleMessageText } from "@tabs/shared/overmind";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarClockIcon,
  RotateCwIcon,
  CornerDownLeftIcon,
  PencilIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { Dialog, DialogPopup, DialogTitle, DialogTrigger } from "../ui/dialog";
import { SchedulePicker } from "../ui/SchedulePicker";
import { CompanionEmpty } from "../agents/companion/CompanionChrome";
import type { UnifiedQueueItem } from "./MessageQueuePanel";
import type { MessageQueueController } from "./useMessageQueue";
import { RowThumbs } from "./StashLayouts";
import { MessageEditor } from "./MessageEditor";

function textOf(item: UnifiedQueueItem) {
  const visible = overmindVisibleMessageText(item.text);
  const flat = visible.trim().replace(/\s+/g, " ");
  return { visible, snippet: flat || "Attached follow-up" };
}

function scheduleLabel(item: UnifiedQueueItem, short = false) {
  if (!item.scheduledFor) return short ? "When ready" : "When the agent is ready";
  return new Date(item.scheduledFor).toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function busy(queue: MessageQueueController, item: UnifiedQueueItem) {
  return queue.inFlightActionIds.has(item.id) || item.intakeStatus === "cancellation_requested";
}

/** Opens the shared schedule picker for one message. */
function ScheduleButton({
  queue,
  item,
  index,
  compact = false,
}: {
  queue: MessageQueueController;
  item: UnifiedQueueItem;
  index: number;
  compact?: boolean;
}) {
  return (
    <Dialog
      open={queue.schedulingMsgId === item.id}
      onOpenChange={(open) => queue.setSchedulingMsgId(open ? item.id : null)}
    >
      <DialogTrigger
        render={
          <button
            type="button"
            className={cn("ql-when", item.scheduledFor && "ql-when-set")}
            aria-label={`Schedule queued message ${index + 1}`}
            title={item.scheduledFor ? "Change the time" : "Pick a time to send"}
          >
            {item.scheduledFor ? (
              <CalendarClockIcon aria-hidden="true" size={12} />
            ) : (
              <ZapIcon aria-hidden="true" size={12} />
            )}
            <span>{scheduleLabel(item, compact)}</span>
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
          value={item.scheduledFor ? new Date(item.scheduledFor) : undefined}
          onConfirm={(date) => queue.updateSchedule(item, date)}
          onCancel={() => queue.setSchedulingMsgId(null)}
        />
      </DialogPopup>
    </Dialog>
  );
}

function Problems({ item }: { item: UnifiedQueueItem }) {
  return (
    <>
      {item.dispatchError && (
        <p role="alert" className="ql-problem">
          {item.dispatchError}
        </p>
      )}
      {item.intakeStatus === "cancellation_failed" && (
        <p role="alert" className="ql-problem">
          Cancellation failed: {item.cancellationError || "Unable to cancel queued run on server."}
        </p>
      )}
      {item.intakeStatus === "cancellation_requested" && (
        <p role="status" className="ql-note">
          Cancelling…
        </p>
      )}
    </>
  );
}

function RowActions({
  queue,
  item,
  index,
  send = true,
}: {
  queue: MessageQueueController;
  item: UnifiedQueueItem;
  index: number;
  send?: boolean;
}) {
  const last = index === queue.queuedItems.length - 1;
  const locked = busy(queue, item);
  return (
    <div className="ql-actions">
      {send && (
        <button
          type="button"
          className="cd-icon"
          aria-label={
            item.dispatchError
              ? `Retry sending queued message ${index + 1}`
              : `Send queued message ${index + 1} next`
          }
          title={item.dispatchError ? "Retry" : "Send next"}
          disabled={locked}
          onClick={() => void queue.sendOrRetry(item)}
        >
          {item.dispatchError ? (
            <RotateCwIcon aria-hidden="true" size={13} />
          ) : (
            <CornerDownLeftIcon aria-hidden="true" size={13} />
          )}
        </button>
      )}
      <button
        type="button"
        className="cd-icon"
        aria-label={`Edit queued message ${index + 1}`}
        aria-pressed={queue.editingId === item.id}
        title={
          !item.isServerAuthoritative && !item.dispatchError
            ? "Still reaching the server. Edit in a moment."
            : "Edit text and images"
        }
        disabled={locked || (!item.isServerAuthoritative && !item.dispatchError)}
        onClick={() => queue.setEditingId(queue.editingId === item.id ? null : item.id)}
      >
        <PencilIcon aria-hidden="true" size={13} />
      </button>
      <button
        type="button"
        className="cd-icon"
        aria-label={`Move queued message ${index + 1} up`}
        title="Move up"
        disabled={index === 0 || !queue.activeThreadId || locked}
        onClick={() => void queue.reorder(index, index - 1)}
      >
        <ArrowUpIcon aria-hidden="true" size={13} />
      </button>
      <button
        type="button"
        className="cd-icon"
        aria-label={`Move queued message ${index + 1} down`}
        title="Move down"
        disabled={last || !queue.activeThreadId || locked}
        onClick={() => void queue.reorder(index, index + 1)}
      >
        <ArrowDownIcon aria-hidden="true" size={13} />
      </button>
      <button
        type="button"
        className="cd-icon sl-danger"
        aria-label={`Delete queued message ${index + 1}`}
        title="Remove"
        disabled={locked}
        onClick={() => void queue.remove(item)}
      >
        <Trash2Icon aria-hidden="true" size={13} />
      </button>
    </div>
  );
}

function ExpandableText({
  queue,
  item,
  className,
}: {
  queue: MessageQueueController;
  item: UnifiedQueueItem;
  className: string;
}) {
  const { visible, snippet } = textOf(item);
  const open = queue.expandedId === item.id;
  return (
    <button
      type="button"
      className={className}
      data-open={open}
      aria-expanded={open}
      aria-label={`${open ? "Collapse" : "Read"} queued message: ${snippet.slice(0, 80)}`}
      onClick={() => queue.setExpandedId(open ? null : item.id)}
    >
      {open ? visible : snippet}
    </button>
  );
}

/** Ledger. Dense rows with the order, the message and its time side by side. */
function LedgerView({ queue }: { queue: MessageQueueController }) {
  return (
    <div className="ql-ledger" role="table" aria-label="Queued messages">
      <div className="ql-ledger-head" role="row">
        <span role="columnheader">#</span>
        <span role="columnheader">Message</span>
        <span role="columnheader">Sends</span>
        <span role="columnheader">
          <span className="sr-only">Actions</span>
        </span>
      </div>
      {queue.queuedItems.map((item, index) => (
        <div key={item.id} className="ql-ledger-row" role="row" data-first={index === 0}>
          <span role="cell" className="ql-index">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div role="cell" className="ql-ledger-cell">
            <RowThumbs
              images={(item.attachments ?? []).map((image: any) => ({
                id: image.id,
                name: image.name,
                src: image.previewUrl || image.dataUrl || "",
              }))}
            />
            <ExpandableText queue={queue} item={item} className="ql-ledger-text" />
          </div>
          <span role="cell">
            <ScheduleButton queue={queue} item={item} index={index} compact />
          </span>
          <span role="cell">
            <RowActions queue={queue} item={item} index={index} />
          </span>
          {queue.editingId === item.id ? (
            <div className="ql-ledger-extra" role="cell">
              <MessageEditor
                label={`Queued message ${index + 1}`}
                initialText={textOf(item).visible}
                images={(item.attachments ?? []).map((image: any) => ({
                  id: image.id,
                  name: image.name,
                  src: image.previewUrl || image.dataUrl || image.url || "",
                }))}
                onSave={(edit) => queue.edit(item, edit)}
                onCancel={() => queue.setEditingId(null)}
              />
            </div>
          ) : item.dispatchError || item.intakeStatus?.startsWith("cancellation") ? (
            <div className="ql-ledger-extra" role="cell">
              <Problems item={item} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** The side panel's queue: what sends when, as one ledger row per message. */
export function QueueLedgerView({
  queue,
  className,
}: {
  queue: MessageQueueController;
  className?: string | undefined;
}) {
  const root = useRef<HTMLDivElement>(null);
  useStaggerIn(root, ".ql-ledger-row", "mount", { y: 8 });
  return (
    <div ref={root} className={cn("companion-queue ql-root", className)}>
      <div className="sl-toolbar">
        <p className="ql-rule">
          {queue.queuedItems.length
            ? `${queue.queuedItems.length} waiting · sends in order when the agent is idle and the composer is empty`
            : "Sends in order when the agent is idle"}
        </p>
        {queue.queuedItems.length > 0 && (
          <button
            type="button"
            className="cd-icon sl-danger"
            aria-label="Clear queue"
            title="Clear queue"
            onClick={() => void queue.clear()}
          >
            <Trash2Icon aria-hidden="true" size={14} />
          </button>
        )}
      </div>
      {queue.queuedItems.length === 0 ? (
        <CompanionEmpty kind="queue" title="Nothing waiting">
          Queue a follow-up from the composer. It sends when the agent is ready.
        </CompanionEmpty>
      ) : (
        <LedgerView queue={queue} />
      )}
    </div>
  );
}
