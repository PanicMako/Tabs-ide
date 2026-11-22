import type { Teammate, ThreadId } from "@tabs/contracts";
import { ArrowUpIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../ui/button";
import { askTeammate } from "./teammatesActions";

/**
 * "Ask <name>…": the primary action of the Teammates space. Enter sends the message into the
 * teammate's home chat and keeps you here; "Jump in" opens that chat when you want to follow it.
 */
export function TeammateAsk({
  teammate,
  busy,
  starters,
  draft,
  onDraftChange,
  onOpenChat,
}: {
  teammate: Pick<Teammate, "id" | "name">;
  /** A turn is already running: the message queues behind it. */
  busy: boolean;
  starters: ReadonlyArray<string>;
  draft: string;
  onDraftChange: (value: string) => void;
  onOpenChat: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<ThreadId | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const canSend = draft.trim().length > 0 && !sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    const threadId = await askTeammate(teammate.id as never, draft, { busy });
    setSending(false);
    if (threadId) {
      onDraftChange("");
      setSentTo(threadId);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="tm-ask">
        <textarea
          ref={field}
          rows={2}
          aria-label={`Ask ${teammate.name}`}
          className="tm-ask-input no-drag"
          placeholder={`Ask ${teammate.name}…`}
          value={draft}
          onChange={(event) => {
            onDraftChange(event.target.value);
            if (sentTo) setSentTo(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
          <span className="tm-meta">
            {busy
              ? `${teammate.name} is mid-thought, so this will queue.`
              : "Enter to send · Shift+Enter for a new line"}
          </span>
          <div className="flex items-center gap-1.5">
            <Button size="xs" variant="ghost" onClick={onOpenChat}>
              Open chat
            </Button>
            <Button
              size="icon-xs"
              aria-label={`Send to ${teammate.name}`}
              disabled={!canSend}
              onClick={() => void send()}
            >
              <ArrowUpIcon />
            </Button>
          </div>
        </div>
      </div>
      {sentTo ? (
        <div className="tm-supporting flex items-center gap-2" role="status">
          <span>Sent. {teammate.name} will answer in its chat.</span>
          <Button size="xs" variant="outline" onClick={onOpenChat}>
            Jump in
          </Button>
        </div>
      ) : draft.trim() === "" && starters.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" aria-label="Things to try">
          {starters.map((starter) => (
            <button
              key={starter}
              type="button"
              className="tm-chip no-drag"
              onClick={() => {
                onDraftChange(starter);
                field.current?.focus();
              }}
            >
              {starter}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
