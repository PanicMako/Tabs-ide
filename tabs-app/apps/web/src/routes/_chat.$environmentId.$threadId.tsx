import { appAtomRegistry } from "../state/atomRegistry";
import { readModelStateAtom } from "../state/readModel";
import { environmentApi } from "../connection/environmentApiRegistry";
import { applyThreadProjectionToAtoms } from "../state/readModel";
import { EnvironmentId, ThreadId } from "@tabs/contracts";
import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { AgentsSplitWorkspace } from "../components/agents/AgentsSplitWorkspace";
import { RightPanelTabs } from "../components/RightPanelTabs";
import { composerDraftsAtom, scopedComposerThreadId } from "../state/composerDrafts";
import { threadsAtom, threadsHydratedAtom } from "../state/threads";
import { useAtomValue } from "@effect/atom-react";
import {
  type DiffRouteSearch,
  parseDiffRouteSearch,
  stripDiffSearchParams,
} from "../diffRouteSearch";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { Sheet, SheetPopup } from "../components/ui/sheet";
import { Sidebar, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";

const DIFF_INLINE_LAYOUT_MEDIA_QUERY = "(max-width: 1180px)";
const DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_diff_sidebar_width";
const DIFF_INLINE_DEFAULT_WIDTH = "clamp(28rem,48vw,44rem)";
const DIFF_INLINE_SIDEBAR_MIN_WIDTH = 26 * 16;
const COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX = 208;

const DiffPanelSheet = (props: {
  children: ReactNode;
  diffOpen: boolean;
  onCloseDiff: () => void;
}) => {
  const maximized = useRightPanelStore((state) => state.maximized);
  return (
    <Sheet
      open={props.diffOpen}
      onOpenChange={(open) => {
        if (!open) {
          if (maximized) {
            useRightPanelStore.getState().setMaximized(false);
            return;
          }
          props.onCloseDiff();
        }
      }}
    >
      <SheetPopup
        side="right"
        showCloseButton={false}
        keepMounted
        className={maximized ? "w-screen max-w-none p-0" : "w-[min(88vw,820px)] max-w-[820px] p-0"}
      >
        {props.children}
      </SheetPopup>
    </Sheet>
  );
};

import { useRightPanelStore } from "~/stores/rightPanelStore";

const DiffPanelInlineSidebar = (props: {
  panelOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
  renderPanelContent: boolean;
  threadId?: ThreadId;
  environmentId?: EnvironmentId;
}) => {
  const maximized = useRightPanelStore((state) => state.maximized);
  const { panelOpen, onClose, onOpen, renderPanelContent, threadId, environmentId } = props;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onOpen();
        return;
      }
      onClose();
    },
    [onClose, onOpen],
  );

  useEffect(() => {
    if (!panelOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        if (useRightPanelStore.getState().maximized) {
          e.preventDefault();
          useRightPanelStore.getState().setMaximized(false);
          return;
        }
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [panelOpen, onClose]);

  const shouldAcceptInlineSidebarWidth = useCallback(
    ({ nextWidth, wrapper }: { nextWidth: number; wrapper: HTMLElement }) => {
      const composerForm = document.querySelector<HTMLElement>("[data-chat-composer-form='true']");
      if (!composerForm) return true;
      const composerViewport = composerForm.parentElement;
      if (!composerViewport) return true;
      const previousSidebarWidth = wrapper.style.getPropertyValue("--sidebar-width");
      wrapper.style.setProperty("--sidebar-width", `${nextWidth}px`);

      const viewportStyle = window.getComputedStyle(composerViewport);
      const viewportPaddingLeft = Number.parseFloat(viewportStyle.paddingLeft) || 0;
      const viewportPaddingRight = Number.parseFloat(viewportStyle.paddingRight) || 0;
      const viewportContentWidth = Math.max(
        0,
        composerViewport.clientWidth - viewportPaddingLeft - viewportPaddingRight,
      );
      const formRect = composerForm.getBoundingClientRect();
      const composerFooter = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-footer='true']",
      );
      const composerRightActions = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-actions='right']",
      );
      const composerRightActionsWidth = composerRightActions?.getBoundingClientRect().width ?? 0;
      const composerFooterGap = composerFooter
        ? Number.parseFloat(window.getComputedStyle(composerFooter).columnGap) ||
          Number.parseFloat(window.getComputedStyle(composerFooter).gap) ||
          0
        : 0;
      const _minimumComposerWidth =
        COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX + composerRightActionsWidth + composerFooterGap;
      const availableLeftControlsWidth =
        formRect.width - composerRightActionsWidth - composerFooterGap;
      const willFit =
        viewportContentWidth >= 280 &&
        availableLeftControlsWidth >= COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX;

      if (!willFit) {
        wrapper.style.setProperty("--sidebar-width", previousSidebarWidth);
        return false;
      }

      return true;
    },
    [],
  );

  return (
    <SidebarProvider
      defaultOpen={true}
      open={panelOpen}
      onOpenChange={onOpenChange}
      className={
        maximized
          ? "companion-expanded relative min-h-0 min-w-0 flex-1 bg-transparent"
          : "w-auto min-h-0 flex-none bg-transparent"
      }
      style={{ "--sidebar-width": DIFF_INLINE_DEFAULT_WIDTH } as React.CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border bg-card text-foreground z-30 shadow-2xl"
        resizable={
          maximized
            ? false
            : {
                minWidth: DIFF_INLINE_SIDEBAR_MIN_WIDTH,
                shouldAcceptWidth: shouldAcceptInlineSidebarWidth,
                storageKey: DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
              }
        }
      >
        {renderPanelContent ? (
          <RightPanelTabs
            visible={panelOpen}
            mode="sidebar"
            threadId={threadId}
            environmentId={environmentId}
            onClose={onClose}
          />
        ) : null}
        {!maximized && <SidebarRail />}
      </Sidebar>
    </SidebarProvider>
  );
};

function ChatThreadRouteView() {
  const threadsHydrated = useAtomValue(threadsHydratedAtom);
  const navigate = useNavigate();
  const threadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.threadId),
  });
  const environmentId = Route.useParams({
    select: (params) => EnvironmentId.makeUnsafe(params.environmentId),
  });
  const search = Route.useSearch();
  const threadExists = useAtomValue(threadsAtom, (threads) =>
    threads.some((thread) => thread.id === threadId && thread.environmentId === environmentId),
  );
  const draftThreadExists = useAtomValue(
    composerDraftsAtom,
    (state) =>
      Object.hasOwn(
        state.draftThreadsByThreadId,
        scopedComposerThreadId(environmentId, threadId),
      ) || Object.hasOwn(state.draftThreadsByThreadId, threadId),
  );
  const routeThreadExists = threadExists || draftThreadExists;
  const diffOpen = search.diff === "1";
  const maximized = useRightPanelStore((state) => state.maximized);
  useEffect(() => {
    useRightPanelStore.getState().setMaximized(false);
  }, [threadId]);
  const rightPanelStoreIsOpen = useRightPanelStore((s) => s.isOpen);
  const isRightPanelOpen = diffOpen || rightPanelStoreIsOpen;
  const shouldUseDiffSheet = useMediaQuery(DIFF_INLINE_LAYOUT_MEDIA_QUERY);
  // TanStack Router keeps active route components mounted across param-only navigations
  // unless remountDeps are configured, so this stays warm across thread switches.
  const [hasOpenedPanel, setHasOpenedPanel] = useState(isRightPanelOpen);
  const [diffTargetThreadId, setDiffTargetThreadId] = useState<ThreadId | null>(null);
  const activeDiffThreadId = diffTargetThreadId ?? threadId;

  const closeDiff = useCallback(() => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId },
      search: { diff: undefined },
    });
  }, [environmentId, navigate, threadId]);

  const closePanel = useCallback(() => {
    if (diffOpen) {
      closeDiff();
    }
    useRightPanelStore.getState().closePanel();
  }, [closeDiff, diffOpen]);

  const openDiff = useCallback(() => {
    useRightPanelStore.getState().setActiveTab("diff");
    useRightPanelStore.getState().setIsOpen(true);
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId },
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1" };
      },
    });
  }, [environmentId, navigate, threadId]);

  const toggleRightPanel = useCallback(() => {
    if (isRightPanelOpen) {
      closePanel();
    } else {
      useRightPanelStore.getState().openPanel();
    }
  }, [closePanel, isRightPanelOpen]);

  useEffect(() => {
    if (isRightPanelOpen) {
      setHasOpenedPanel(true);
    }
  }, [isRightPanelOpen]);

  const [hydrationAttempt, setHydrationAttempt] = useState(0);
  const [hydrationError, setHydrationError] = useState<{ key: string; message: string } | null>(
    null,
  );
  const hydrationKey = JSON.stringify([environmentId, threadId]);
  useEffect(() => {
    if (!threadsHydrated || routeThreadExists) return;
    let cancelled = false;
    const startedAtSequence =
      appAtomRegistry.get(readModelStateAtom).environmentSnapshots?.[environmentId]
        ?.snapshotSequence ?? 0;
    setHydrationError(null);
    void environmentApi(environmentId)
      .then((api) => api.orchestration.getThreadProjection({ threadId }))
      .then((projection) => {
        if (cancelled) return;
        const changedAt =
          appAtomRegistry.get(readModelStateAtom).environmentSnapshots?.[environmentId]
            ?.olderSettled?.changes[`thread:${threadId}`] ?? 0;
        if (changedAt > startedAtSequence) {
          setHydrationAttempt((value) => value + 1);
          return;
        }
        applyThreadProjectionToAtoms(projection, environmentId);
      })
      .catch((cause) => {
        if (!cancelled)
          setHydrationError({
            key: hydrationKey,
            message: cause instanceof Error ? cause.message : String(cause),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [environmentId, threadId, threadsHydrated, routeThreadExists, hydrationAttempt, hydrationKey]);

  if (!threadsHydrated || !routeThreadExists) {
    const error = hydrationError?.key === hydrationKey ? hydrationError.message : null;
    return (
      <div
        className="flex flex-1 items-center justify-center p-6 text-sm"
        role={error ? "alert" : "status"}
      >
        {error ? (
          <div>
            <p>Could not load this conversation: {error}</p>
            <button type="button" onClick={() => setHydrationAttempt((value) => value + 1)}>
              Retry
            </button>
            <button type="button" onClick={() => void navigate({ to: "/" })}>
              Back to tasks
            </button>
          </div>
        ) : (
          "Loading conversation…"
        )}
      </div>
    );
  }

  const shouldRenderPanelContent = isRightPanelOpen || hasOpenedPanel;

  if (!shouldUseDiffSheet) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
        <div className={maximized && isRightPanelOpen ? "hidden" : "flex min-h-0 min-w-0 flex-1"}>
          <AgentsSplitWorkspace
            environmentId={environmentId}
            routeThreadId={threadId}
            diffOpen={diffOpen}
            rightPanelOpen={isRightPanelOpen}
            onOpenDiff={openDiff}
            onCloseDiff={closePanel}
            onToggleRightPanel={toggleRightPanel}
            onDiffThreadChange={setDiffTargetThreadId}
          />
        </div>
        <DiffPanelInlineSidebar
          panelOpen={isRightPanelOpen}
          onClose={closePanel}
          onOpen={toggleRightPanel}
          renderPanelContent={shouldRenderPanelContent}
          threadId={activeDiffThreadId}
          environmentId={environmentId}
        />
      </div>
    );
  }

  return (
    <>
      <AgentsSplitWorkspace
        environmentId={environmentId}
        routeThreadId={threadId}
        diffOpen={diffOpen}
        rightPanelOpen={isRightPanelOpen}
        onOpenDiff={openDiff}
        onCloseDiff={closePanel}
        onToggleRightPanel={toggleRightPanel}
        onDiffThreadChange={setDiffTargetThreadId}
      />
      <DiffPanelSheet diffOpen={isRightPanelOpen} onCloseDiff={closePanel}>
        {shouldRenderPanelContent ? (
          <RightPanelTabs
            visible={isRightPanelOpen}
            mode="sheet"
            threadId={activeDiffThreadId}
            environmentId={environmentId}
            onClose={closePanel}
          />
        ) : null}
      </DiffPanelSheet>
    </>
  );
}

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<DiffRouteSearch>(["diff"])],
  },
  component: ChatThreadRouteView,
});
