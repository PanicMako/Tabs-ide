import { memo, useCallback, useEffect, useRef } from "react";
import type { EnvironmentId, ThreadId } from "@tabs/contracts";
import { useActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import {
  EMPTY_COMPANION_WORKSPACE,
  useCompanionSurfaceStore,
} from "~/stores/companionSurfaceStore";
import { showCustomConfirm } from "~/lib/customConfirm";
import { isElectron } from "~/env";
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
import { CompanionDevicePanel, closeDeviceTab } from "./device/DevicePanel";
import { CompanionPRPanel } from "./agents/companion/CompanionPRPanel";
import type { DiffPanelMode } from "./DiffPanelShell";
import {
  isNativeBrowserRecordingActive,
  stopNativeBrowserRecording,
} from "./NativePreviewAutomationHost";
import { CompanionDiffPanel } from "./agents/companion/CompanionDiffPanel";
import { CompanionDesignShell } from "./agents/companion/designs/CompanionDesignShell";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import SideChatPane from "./chat/SideChatPane";
import {
  deleteSideChatThread,
  isUnusedSideChat,
  readSideChatSettings,
  sideChatDisabledReason,
  startSideChat,
} from "./chat/useSideChat";
import { serverConfigAtom } from "~/state/settings";
import { toastManager } from "./ui/toast";

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
  // Read only: ChatView already keeps the config fresh, and a bare panel must not fetch it.
  const serverConfig = useAtomValue(serverConfigAtom);
  // T3's rule: a side chat forks an existing thread, so a draft, a side chat and a subagent get none.
  const sideChatReason = sideChatDisabledReason({
    parent: serverThread,
    capable:
      serverConfig === null ? undefined : serverConfig.environment.capabilities.sideChats === true,
  });
  const disabledSurfaces = sideChatReason === null ? undefined : { sidechat: sideChatReason };

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
    // A side chat tab exists only for a thread that was forked; there is nothing to open blank.
    else if (activeTab === "sidechat") setChoosing(true);
    else store.open(scope, activeTab);
  }, [active?.kind, activeTab, choosing, scope, workspace.tabs, setActiveTab, setChoosing]);

  const handleSelectTab = useCallback(
    (tab: RightPanelTab) => {
      if (tab === "sidechat") {
        if (sideChatReason !== null) {
          toastManager.add({
            type: "info",
            title: "Side chat unavailable",
            description: sideChatReason,
          });
          return;
        }
        // Starting one forks the thread, so it opens as a tab once the fork reached this client.
        const parentThreadId = threadId ?? null;
        const resolvedEnvironmentId = environmentId ?? target?.environmentId ?? undefined;
        void startSideChat({
          environmentId: resolvedEnvironmentId,
          parentThreadId,
          settings: readSideChatSettings(scope),
          onError: (description) =>
            toastManager.add({ type: "error", title: "Could not start a side chat", description }),
        });
        return;
      }
      useCompanionSurfaceStore.getState().open(scope, tab);
      setActiveTab(tab);
      setChoosing(false);
    },
    [
      scope,
      setActiveTab,
      setChoosing,
      threadId,
      environmentId,
      target?.environmentId,
      sideChatReason,
    ],
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
    if (tab?.kind === "sidechat" && tab.sideChatThreadId) {
      // Closing a side chat nobody wrote in deletes it; a used one stays, listed in thread details.
      const sideChat = threads.find((item) => item.id === tab.sideChatThreadId);
      const owner = environmentId ?? target?.environmentId;
      if (owner && sideChat && isUnusedSideChat(sideChat)) {
        void deleteSideChatThread(owner, sideChat.id).catch(() => undefined);
      }
    }
    if (tab?.kind === "device")
      void closeDeviceTab(environmentId ?? target?.environmentId, tab, threadId);
    useCompanionSurfaceStore.getState().close(scope, id);
    // Closing a tab stays with its kind: the next browser page, the next terminal. When the last
    // one of that kind closes, the panel goes home rather than jumping to an unrelated surface.
    const next = useCompanionSurfaceStore.getState().workspaces[scope];
    const sibling =
      tab && tab.id === workspace.activeId
        ? next?.tabs.find((item) => item.kind === tab.kind)
        : next?.tabs.find((item) => item.id === next.activeId);
    if (sibling) {
      useCompanionSurfaceStore.getState().activate(scope, sibling.id);
      setActiveTab(sibling.kind);
      setChoosing(false);
    } else setChoosing(true);
  };

  const handleFocusKind = (kind: RightPanelTab) => {
    const existing =
      workspace.tabs.find((tab) => tab.kind === kind && tab.id === workspace.activeId) ??
      workspace.tabs.find((tab) => tab.kind === kind);
    if (existing) handleSelectInstance(existing.id);
    else handleSelectTab(kind);
  };
  const counts = { stash: stashes.length, queue: totalQueuedCount };

  const body = !active ? null : active.kind === "diff" ? (
    <CompanionDiffPanel threadId={threadId} />
  ) : active.kind === "browser" ? (
    visible ? (
      <CompanionBrowserPanel key={active.id} surface={active} scope={scope} threadId={threadId} />
    ) : null
  ) : active.kind === "device" ? (
    <CompanionDevicePanel
      key={active.id}
      surface={active}
      scope={scope}
      threadId={threadId}
      environmentId={environmentId ?? target?.environmentId}
      visible={visible}
    />
  ) : active.kind === "files" ? (
    <CompanionFilesPanel key={active.id} surface={active} scope={scope} threadId={threadId} />
  ) : active.kind === "terminal" ? (
    <CompanionTerminalPanel threadId={threadId} />
  ) : active.kind === "pr" ? (
    <CompanionPRPanel key={threadId} threadId={threadId} />
  ) : active.kind === "sidechat" ? (
    threadId && (environmentId ?? target?.environmentId) && active.sideChatThreadId ? (
      <SideChatPane
        key={active.id}
        environmentId={(environmentId ?? target?.environmentId)!}
        parentThreadId={threadId}
        threadId={active.sideChatThreadId as ThreadId}
        onDeleted={() => {
          void handleCloseInstance(active.id);
        }}
      />
    ) : null
  ) : active.kind === "stash" ? (
    <div className="companion-workspace">
      <PromptStashPanel
        variant="ledger"
        activeThreadId={threadId}
        currentEnvironmentId={environmentId}
        onLoadedIntoComposer={onClose}
      />
    </div>
  ) : (
    <div className="companion-workspace">
      <CompanionQueueSurface threadId={threadId} environmentId={environmentId} />
    </div>
  );

  return (
    <div
      data-companion-design="grouped"
      className="companion-frame flex h-full min-w-0 flex-col bg-background text-foreground"
    >
      <CompanionDesignShell
        instances={workspace.tabs}
        activeId={workspace.activeId}
        choosing={choosing}
        counts={counts}
        disabledSurfaces={disabledSurfaces}
        dragRegion={shouldUseDragRegion}
        maximized={maximized}
        projectName={target?.projectName}
        onToggleMaximized={() => setMaximized(!maximized)}
        onClosePanel={onClose}
        onOpen={handleSelectTab}
        onFocusKind={handleFocusKind}
        onSelectInstance={handleSelectInstance}
        onRenameInstance={(id, title) =>
          useCompanionSurfaceStore.getState().update(scope, id, { title })
        }
        onCloseInstance={(id) => {
          void handleCloseInstance(id);
        }}
        onChooserChange={setChoosing}
        body={body}
      />
    </div>
  );
});

/** The queue surface. Removing the only message of a thread that never started returns to a
 * fresh new thread, so this is the one surface that needs the router. */
function CompanionQueueSurface({
  threadId,
  environmentId,
}: {
  threadId?: ThreadId | null | undefined;
  environmentId?: EnvironmentId | null | undefined;
}) {
  const { handleNewThread } = useHandleNewThread();
  return (
    <MessageQueuePanel
      variant="ledger"
      activeThreadId={threadId}
      environmentId={environmentId}
      onThreadDiscarded={({ projectId, environmentId: owner }) => {
        void handleNewThread(projectId, owner ? { environmentId: owner } : undefined);
      }}
    />
  );
}
