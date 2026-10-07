import { memo, useCallback } from "react";
import type { EnvironmentId, ThreadId } from "@tabs/contracts";
import { isElectron } from "~/env";
import { SurfaceTabs, SurfaceChooser } from "./agents/companion/SurfaceTabs";
import { usePromptStashStore } from "~/promptStashStore";
import { useMessageQueueStore, getThreadQueuedMessages } from "~/stores/messageQueueStore";
import { useRightPanelStore, type RightPanelTab } from "~/stores/rightPanelStore";
import { PromptStashPanel } from "./chat/PromptStashPanel";
import { MessageQueuePanel } from "./chat/MessageQueuePanel";
import { CompanionBrowserPanel } from "./agents/companion/CompanionBrowserPanel";
import { CompanionFilesPanel } from "./agents/companion/CompanionFilesPanel";
import { CompanionTerminalPanel } from "./agents/companion/CompanionTerminalPanel";
import { CompanionPRPanel } from "./agents/companion/CompanionPRPanel";
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
  const maximized = useRightPanelStore((state) => state.maximized);
  const setMaximized = useRightPanelStore((state) => state.setMaximized);
  const choosing = useRightPanelStore((state) => state.choosingSurface);
  const setChoosing = useRightPanelStore((state) => state.setChoosingSurface);
  const activeTab = useRightPanelStore((state) => state.activeTab);
  const setActiveTab = useRightPanelStore((state) => state.setActiveTab);

  const stashes = usePromptStashStore((state) => state.entries);
  const queueByThread = useMessageQueueStore((state) => state.queueByThread);
  const queuedMessages = getThreadQueuedMessages(queueByThread, threadId);

  const shouldUseDragRegion = isElectron && mode !== "sheet";

  const handleSelectTab = useCallback(
    (tab: RightPanelTab) => {
      setChoosing(false);
      setActiveTab(tab);
    },
    [setActiveTab, setChoosing],
  );

  return (
    <div className="companion-frame flex h-full min-w-0 flex-col bg-background text-foreground">
      <SurfaceTabs
        maximized={maximized}
        onToggleMaximized={() => setMaximized(!maximized)}
        choosing={choosing}
        activeTab={activeTab}
        onSelect={handleSelectTab}
        onClosePanel={onClose}
        dragRegion={shouldUseDragRegion}
        counts={{ stash: stashes.length, queue: queuedMessages.length }}
        onChooserChange={setChoosing}
      />

      {/* Surface Body */}
      <div
        id="companion-surface-body"
        role={choosing ? undefined : "tabpanel"}
        aria-labelledby={choosing ? undefined : `surface-tab-${activeTab}`}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {choosing ? (
          <SurfaceChooser onSelect={handleSelectTab} />
        ) : activeTab === "diff" ? (
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
        ) : activeTab === "browser" ? (
          <CompanionBrowserPanel threadId={threadId} />
        ) : activeTab === "files" ? (
          <CompanionFilesPanel key={threadId} threadId={threadId} />
        ) : activeTab === "terminal" ? (
          <CompanionTerminalPanel threadId={threadId} />
        ) : activeTab === "pr" ? (
          <CompanionPRPanel key={threadId} threadId={threadId} />
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
