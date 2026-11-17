import type { EnvironmentId, ThreadId } from "@tabs/contracts";
import { useAtomValue } from "@effect/atom-react";
import { MessageSquareMoreIcon } from "lucide-react";
import { useMemo } from "react";

import { threadsAtom } from "~/state/threads";
import { openSideChatTab } from "./useSideChat";

/** Thread details: the side chats asked about this thread, each reopening as a right-panel tab. */
export function WorkspaceSideChats(props: {
  readonly threadId: ThreadId;
  readonly environmentId?: string | undefined;
}) {
  const threads = useAtomValue(threadsAtom);
  const sideChats = useMemo(
    () =>
      threads
        .filter(
          (thread) =>
            thread.isSideChat === true &&
            thread.parentThreadId === props.threadId &&
            thread.archivedAt === null,
        )
        .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [threads, props.threadId],
  );
  if (sideChats.length === 0) return null;
  return (
    <section aria-label="Side chats" className="flex flex-col gap-0.5 px-2 py-1">
      <h3 className="px-2 text-[11px] font-medium text-muted-foreground">Side chats</h3>
      {sideChats.map((sideChat) => (
        <button
          key={sideChat.id}
          type="button"
          className="flex min-w-0 items-center gap-2 rounded-control px-2 py-1 text-left text-xs hover:bg-accent"
          onClick={() => openSideChatTab(props.environmentId, props.threadId, sideChat.id)}
        >
          <MessageSquareMoreIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{sideChat.title}</span>
        </button>
      ))}
    </section>
  );
}
