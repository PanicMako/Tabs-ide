import { useAtomValue } from "@effect/atom-react";
import { usePhysicalInputStore, type PhysicalInputEntry } from "~/lib/agentPhysicalInputStore";
import { OPEN_THREAD_EVENT } from "~/lib/agentControl";
import { threadsAtom } from "../../state/threads";

const ACTIVITY_LABEL: Record<PhysicalInputEntry["activity"], string> = {
  checking_foreground: "is checking a window",
  needs_foreground: "needs a window in front",
  foreground: "is using your mouse and keyboard",
};

/**
 * App-level notice that an agent is driving physical input or holds a foreground
 * window, whichever conversation is open. Neutral text only; clicking opens the
 * owning conversation.
 */
export function AgentPhysicalInputIndicator() {
  const entries = Object.values(usePhysicalInputStore((state) => state.entries));
  const threads = useAtomValue(threadsAtom);
  const entry = entries[0];
  if (!entry) return null;
  const thread = threads.find((candidate) => candidate.id === entry.location.threadId);
  const name = thread?.title?.trim() || "A conversation";
  const extra = entries.length > 1 ? ` (+${entries.length - 1} more)` : "";
  const text = `${name} ${ACTIVITY_LABEL[entry.activity]}${extra}`;
  return (
    <button
      type="button"
      role="status"
      aria-label={`${text}. Open conversation.`}
      title="Open this conversation"
      className="no-drag flex h-7 max-w-64 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-border/60 bg-muted/40 px-2 text-xs text-muted-foreground backdrop-blur hover:text-foreground"
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent(OPEN_THREAD_EVENT, {
            detail: {
              environmentId: entry.location.environmentId ?? "",
              threadId: entry.location.threadId,
            },
          }),
        )
      }
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      <span className="truncate">{text}</span>
    </button>
  );
}
