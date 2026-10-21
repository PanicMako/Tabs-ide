import { memo, useCallback, useEffect, useRef } from "react";
import type { EnvironmentId, ThreadId } from "@tabs/contracts";
import { useActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import {
  EMPTY_COMPANION_WORKSPACE,
  useCompanionSurfaceStore,
} from "~/stores/companionSurfaceStore";
import { showCustomConfirm } from "~/lib/customConfirm";
import { isElectron } from "~/env";
import { SurfaceTabs, SurfaceChooser } from "./agents/companion/SurfaceTabs";
import { useAtomValue } from "@effect/atom-react";
import { threadsAtom } from "~/state/threads";
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
import {
  isNativeBrowserRecordingActive,
  stopNativeBrowserRecording,
} from "./NativePreviewAutomationHost";
import { CompanionDiffPanel } from "./agents/companion/CompanionDiffPanel";

export interface RightPanelTabsProps {
  mode: DiffPanelMode;
  threadId?: ThreadId | null | undefined;
  environmentId?: EnvironmentId | null | undefined;
  onClose: () => void;
  visible?: boolean;
}

export const RightPanelTabs = memo(function RightPanelTabs({
  mode,
  threadId,
  environmentId,
  onClose,
  visible = true,
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
  const threads = useAtomValue(threadsAtom);
  const serverThread = threads.find((t) => t.id === threadId);
  const serverQueuedCount = serverThread?.queuedRuns?.length ?? 0;
  const serverMessageIds = new Set(serverThread?.queuedRuns?.map((r) => r.userMessageId));
  const pendingLocalCount = queuedMessages.filter((m) => !serverMessageIds.has(m.id as any)).length;
  const totalQueuedCount = serverQueuedCount + pendingLocalCount;

  const shouldUseDragRegion = isElectron && mode !== "sheet";

  const target = useActiveProjectTarget(threadId);
  const scope = `${environmentId ?? target?.environmentId ?? "local"}:${threadId ?? target?.projectId ?? "projectless"}`;
  const workspace = useCompanionSurfaceStore(
    (state) => state.workspaces[scope] ?? EMPTY_COMPANION_WORKSPACE,
  );
  const active = workspace.tabs.find((tab) => tab.id === workspace.activeId);
  const previousScope = useRef(scope);
  useEffect(() => {
    if (previousScope.current !== scope) {
      previousScope.current = scope;
      if (active) {
        setActiveTab(active.kind);
        return;
      }
    }
    if (choosing || active?.kind === activeTab) return;
    const store = useCompanionSurfaceStore.getState();
    const existing = workspace.tabs.find((tab) => tab.kind === activeTab);
    if (existing) store.activate(scope, existing.id);
    else store.open(scope, activeTab);
  }, [active?.kind, activeTab, choosing, scope, workspace.tabs, setActiveTab]);

  const handleSelectTab = useCallback(
    (tab: RightPanelTab) => {
      useCompanionSurfaceStore.getState().open(scope, tab);
      setActiveTab(tab);
      setChoosing(false);
    },
    [scope, setActiveTab, setChoosing],
  );
  const handleSelectInstance = (id: string) => {
    const tab = workspace.tabs.find((item) => item.id === id);
    if (!tab) return;
    useCompanionSurfaceStore.getState().activate(scope, id);
    setActiveTab(tab.kind);
    setChoosing(false);
  };
  const handleCloseInstance = async (id: string) => {
    const tab = workspace.tabs.find((item) => item.id === id);
    if (
      tab?.draftContents !== undefined &&
      !(await showCustomConfirm("Discard this file's unsaved changes?"))
    )
      return;
    if (tab?.kind === "browser" && target && window.desktopBridge) {
      const sessionId = `agents-surface-${id}`;
      if (isNativeBrowserRecordingActive(target.projectId, sessionId)) {
        if (
          !(await showCustomConfirm("Stop and save the recording before closing this browser tab?"))
        )
          return;
        try {
          await stopNativeBrowserRecording(window.desktopBridge, target.projectId, sessionId);
        } catch {
          return;
        }
      }
      void window.desktopBridge
        .destroyBrowserSession?.({ projectId: target.projectId, sessionId })
        .catch(() => undefined);
    }
    useCompanionSurfaceStore.getState().close(scope, id);
    const next = useCompanionSurfaceStore.getState().workspaces[scope];
    const selected = next?.tabs.find((item) => item.id === next.activeId);
    if (selected) setActiveTab(selected.kind);
    else setChoosing(true);
    if (selected) {
      requestAnimationFrame(() => document.getElementById(`surface-tab-${selected.id}`)?.focus());
    }
  };

  return (
    <div className="companion-frame flex h-full min-w-0 flex-col bg-background text-foreground">
      <SurfaceTabs
        instances={workspace.tabs}
        activeInstanceId={workspace.activeId}
        onSelectInstance={handleSelectInstance}
        onCloseInstance={(id) => {
          void handleCloseInstance(id);
        }}
        maximized={maximized}
        onToggleMaximized={() => setMaximized(!maximized)}
        choosing={choosing}
        activeTab={activeTab}
        onSelect={handleSelectTab}
        onClosePanel={onClose}
        dragRegion={shouldUseDragRegion}
        counts={{ stash: stashes.length, queue: totalQueuedCount }}
        onChooserChange={setChoosing}
      />

      {/* Surface Body */}
      <div
        id="companion-surface-body"
        role={choosing ? undefined : "tabpanel"}
        aria-labelledby={choosing ? undefined : `surface-tab-${active?.id}`}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {choosing ? (
          <SurfaceChooser onSelect={handleSelectTab} />
        ) : !active ? null : active.kind === "diff" ? (
          <CompanionDiffPanel threadId={threadId} />
        ) : active.kind === "browser" ? (
          visible ? (
            <CompanionBrowserPanel
              key={active.id}
              surface={active}
              scope={scope}
              threadId={threadId}
            />
          ) : null
        ) : active.kind === "files" ? (
          <CompanionFilesPanel key={active.id} surface={active} scope={scope} threadId={threadId} />
        ) : active.kind === "terminal" ? (
          <CompanionTerminalPanel threadId={threadId} />
        ) : active.kind === "pr" ? (
          <CompanionPRPanel key={threadId} threadId={threadId} />
        ) : active.kind === "stash" ? (
          <div className="companion-workspace">
            <PromptStashPanel
              activeThreadId={threadId}
              currentEnvironmentId={environmentId}
              onLoadedIntoComposer={onClose}
            />
          </div>
        ) : (
          <div className="companion-workspace">
            <MessageQueuePanel activeThreadId={threadId} environmentId={environmentId} />
          </div>
        )}
      </div>
    </div>
  );
});
