import { BookmarkIcon, Columns2Icon, FileDiffIcon, ListOrderedIcon, XIcon } from "lucide-react";
import { memo, useCallback } from "react";
import type { EnvironmentId, ThreadId } from "@tabs/contracts";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { usePromptStashStore } from "~/promptStashStore";
import { useMessageQueueStore, getThreadQueuedMessages } from "~/stores/messageQueueStore";
import { useRightPanelStore, type RightPanelTab } from "~/stores/rightPanelStore";
import { PromptStashPanel } from "./chat/PromptStashPanel";
import { MessageQueuePanel } from "./chat/MessageQueuePanel";
import { Button } from "./ui/button";
import type { DiffPanelMode } from "./DiffPanelShell";
import { lazy, Suspense } from "react";
import { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";
import { DiffPanelHeaderSkeleton, DiffPanelLoadingState, DiffPanelShell } from "./DiffPanelShell";

const DiffPanel = lazy(() => import("./DiffPanel"));

export interface RightPanelTabsProps {
  mode: DiffPanelMode;
  threadId?: ThreadId | null | undefined;
  environmentId?: EnvironmentId | null | undefined;
  onClose: () => void;
}

export const RightPanelTabs = memo(function RightPanelTabs({
  mode,
  threadId,
  environmentId,
  onClose,
}: RightPanelTabsProps) {
  const activeTab = useRightPanelStore((state) => state.activeTab);
  const setActiveTab = useRightPanelStore((state) => state.setActiveTab);

  const stashes = usePromptStashStore((state) => state.entries);
  const queueByThread = useMessageQueueStore((state) => state.queueByThread);
  const queuedMessages = getThreadQueuedMessages(queueByThread, threadId);

  const shouldUseDragRegion = isElectron && mode !== "sheet";

  const handleSelectTab = useCallback(
    (tab: RightPanelTab) => {
      setActiveTab(tab);
    },
    [setActiveTab],
  );

  return (
    <div className="flex h-full min-w-0 flex-col bg-background text-foreground">
      {/* Top Level Surface Switcher Header */}
      <div
        className={cn(
          "flex shrink-0 items-center justify-between border-b border-border/70 bg-muted/20 px-3 py-1.5",
          shouldUseDragRegion ? "drag-region h-[46px]" : "h-11",
        )}
      >
        {/* Tab switcher buttons */}
        <div
          className="tabs-segmented flex items-center [-webkit-app-region:no-drag]"
          role="tablist"
          aria-label="Side panel views"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            const tabs = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="tab"]'),
            ];
            const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
            if (current < 0 || tabs.length === 0) return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabs.length - 1
                  : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
            tabs[next]?.focus();
            tabs[next]?.click();
          }}
        >
          {/* Diffs tab */}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "diff"}
            tabIndex={activeTab === "diff" ? 0 : -1}
            onClick={() => handleSelectTab("diff")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all duration-150 cursor-pointer select-none",
              activeTab === "diff"
                ? "bg-accent text-accent-foreground shadow-2xs"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <FileDiffIcon className="size-3.5" />
            <span>Diffs</span>
          </button>

          {/* Stash tab */}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "stash"}
            tabIndex={activeTab === "stash" ? 0 : -1}
            onClick={() => handleSelectTab("stash")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all duration-150 cursor-pointer select-none",
              activeTab === "stash"
                ? "bg-accent text-accent-foreground shadow-2xs"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <BookmarkIcon className="size-3.5 text-primary" />
            <span>Stash</span>
            {stashes.length > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.2 text-[10px] font-mono tabular-nums leading-none",
                  activeTab === "stash"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {stashes.length}
              </span>
            )}
          </button>

          {/* Queue tab */}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "queue"}
            tabIndex={activeTab === "queue" ? 0 : -1}
            onClick={() => handleSelectTab("queue")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all duration-150 cursor-pointer select-none",
              activeTab === "queue"
                ? "bg-accent text-accent-foreground shadow-2xs"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <ListOrderedIcon className="size-3.5 text-sky-500" />
            <span>Queue</span>
            {queuedMessages.length > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.2 text-[10px] font-mono tabular-nums leading-none",
                  activeTab === "queue"
                    ? "bg-sky-500 text-white"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {queuedMessages.length}
              </span>
            )}
          </button>
        </div>

        {/* Global right panel close button */}
        <div className="flex items-center gap-1 [-webkit-app-region:no-drag]">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close side panel"
            title="Close side panel"
            className="inline-flex size-6 items-center justify-center rounded-md border border-border/70 bg-background/90 text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Surface Body */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === "diff" ? (
          <DiffWorkerPoolProvider>
            <Suspense
              fallback={
                <DiffPanelShell mode={mode} header={<DiffPanelHeaderSkeleton />}>
                  <DiffPanelLoadingState label="Loading diff viewer..." />
                </DiffPanelShell>
              }
            >
              <DiffPanel mode={mode} />
            </Suspense>
          </DiffWorkerPoolProvider>
        ) : activeTab === "stash" ? (
          <PromptStashPanel
            activeThreadId={threadId}
            currentEnvironmentId={environmentId}
            onLoadedIntoComposer={onClose}
          />
        ) : (
          <MessageQueuePanel activeThreadId={threadId} />
        )}
      </div>
    </div>
  );
});
