// Adapted from T3 Code (https://github.com/pingdotgg/t3code), Copyright (c) 2026 T3 Tools Inc., MIT.
import type { EnvironmentId, ThreadId } from "@tabs/contracts";
import { useAtomValue } from "@effect/atom-react";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";

import { environmentApi } from "~/connection/environmentApiRegistry";
import { showCustomConfirm } from "~/lib/customConfirm";
import { newCommandId } from "~/lib/utils";
import { threadsAtom } from "~/state/threads";
import ChatView from "../ChatView";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { bringBackBlockedReason, deleteSideChatThread, isUnusedSideChat } from "./useSideChat";

/** A side chat tab: its title, Bring back and Delete, over the side chat's own chat. */
export default function SideChatPane(props: {
  readonly environmentId: EnvironmentId;
  readonly parentThreadId: ThreadId;
  readonly threadId: ThreadId;
  readonly onDeleted: () => void;
}) {
  const { environmentId, parentThreadId, threadId } = props;
  const threads = useAtomValue(threadsAtom);
  const sideChat = threads.find((thread) => thread.id === threadId);
  const parent = threads.find((thread) => thread.id === parentThreadId);
  const [bringingBack, setBringingBack] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const parentIdle =
    parent === undefined || (parent.activeRunId == null && (parent.queuedRuns?.length ?? 0) === 0);
  const sideChatHasReply = sideChat?.latestTurn?.completedAt != null;
  const blocked = bringBackBlockedReason({ parentIdle, sideChatHasReply });
  const used = sideChat !== undefined && !isUnusedSideChat(sideChat);

  const bringBack = async () => {
    if (blocked !== null || bringingBack) return;
    setBringingBack(true);
    try {
      const api = await environmentApi(environmentId);
      await api.orchestration.dispatchCommand({
        type: "thread.merge_back",
        commandId: newCommandId(),
        sourceThreadId: threadId,
        targetThreadId: parentThreadId,
        sourcePoint: { type: "latest_stable" },
        createdBy: "user",
        creationSource: "web",
      });
      toastManager.add({
        type: "success",
        title: "Brought back",
        description: "The main thread gets this side chat with your next message there.",
      });
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Could not bring back the side chat",
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setBringingBack(false);
    }
  };

  const deleteSideChat = async () => {
    if (deleting) return;
    if (
      !(await showCustomConfirm(
        `Delete side chat "${sideChat?.title ?? "Side chat"}"? This permanently clears its conversation history.`,
      ))
    )
      return;
    setDeleting(true);
    try {
      await deleteSideChatThread(environmentId, threadId);
      props.onDeleted();
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Could not delete the side chat",
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div data-side-chat-pane={threadId} className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border pr-1 pl-3">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {sideChat?.title ?? "Side chat"}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="xs"
                aria-disabled={blocked !== null || bringingBack || undefined}
                onClick={() => void bringBack()}
              >
                Bring back
              </Button>
            }
          />
          <TooltipPopup side="bottom">
            {blocked ?? "Adds this side chat to the main thread's next message."}
          </TooltipPopup>
        </Tooltip>
        {used && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Delete side chat"
            disabled={deleting}
            onClick={() => void deleteSideChat()}
          >
            <Trash2Icon />
          </Button>
        )}
      </div>
      {sideChat === undefined ? (
        <p className="p-3 text-xs text-muted-foreground">This side chat was deleted.</p>
      ) : (
        <ChatView compact environmentId={environmentId} threadId={threadId} />
      )}
    </div>
  );
}
