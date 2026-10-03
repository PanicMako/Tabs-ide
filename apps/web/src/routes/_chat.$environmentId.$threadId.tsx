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
  return (
    <Sheet
      open={props.diffOpen}
      onOpenChange={(open) => {
        if (!open) {
          props.onCloseDiff();
        }
      }}
    >
      <SheetPopup
        side="right"
        showCloseButton={false}
        keepMounted
        className="w-[min(88vw,820px)] max-w-[820px] p-0"
      >
        {props.children}
      </SheetPopup>
    </Sheet>
  );
};

const DiffPanelInlineSidebar = (props: {
  diffOpen: boolean;
  onCloseDiff: () => void;
  onOpenDiff: () => void;
  renderDiffContent: boolean;
  threadId?: ThreadId;
  environmentId?: EnvironmentId;
}) => {
  const { diffOpen, onCloseDiff, onOpenDiff, renderDiffContent, threadId, environmentId } = props;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onOpenDiff();
        return;
      }
      onCloseDiff();
    },
    [onCloseDiff, onOpenDiff],
  );

  useEffect(() => {
    if (!diffOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseDiff();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [diffOpen, onCloseDiff]);

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
      const minimumComposerWidth =
        COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX + composerRightActionsWidth + composerFooterGap;
      const hasComposerOverflow = composerForm.scrollWidth > composerForm.clientWidth + 0.5;
      const overflowsViewport = formRect.width > viewportContentWidth + 0.5;
      const violatesMinimumComposerWidth = composerForm.clientWidth + 0.5 < minimumComposerWidth;

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
    <>
      {diffOpen && (
        <div
          role="presentation"
          aria-hidden="true"
          onClick={onCloseDiff}
          className="fixed inset-0 z-20 bg-background/20 dark:bg-black/40 backdrop-blur-sm transition-opacity duration-200 animate-in fade-in cursor-pointer"
        />
      )}
      <SidebarProvider
        defaultOpen={false}
        open={diffOpen}
        onOpenChange={onOpenChange}
        className="w-auto min-h-0 flex-none bg-transparent"
        style={{ "--sidebar-width": DIFF_INLINE_DEFAULT_WIDTH } as React.CSSProperties}
      >
        <Sidebar
          side="right"
          collapsible="offcanvas"
          className="border-l border-border bg-card text-foreground z-30 shadow-2xl"
          resizable={{
            minWidth: DIFF_INLINE_SIDEBAR_MIN_WIDTH,
            shouldAcceptWidth: shouldAcceptInlineSidebarWidth,
            storageKey: DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
          }}
        >
          {renderDiffContent ? (
            <RightPanelTabs
              mode="sidebar"
              threadId={threadId}
              environmentId={environmentId}
              onClose={onCloseDiff}
            />
          ) : null}
          <SidebarRail />
        </Sidebar>
      </SidebarProvider>
    </>
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
  const shouldUseDiffSheet = useMediaQuery(DIFF_INLINE_LAYOUT_MEDIA_QUERY);
  // TanStack Router keeps active route components mounted across param-only navigations
  // unless remountDeps are configured, so this stays warm across thread switches.
  const [hasOpenedDiff, setHasOpenedDiff] = useState(diffOpen);
  const [diffTargetThreadId, setDiffTargetThreadId] = useState<ThreadId | null>(null);
  const activeDiffThreadId = diffTargetThreadId ?? threadId;

  const closeDiff = useCallback(() => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId },
      search: { diff: undefined },
    });
  }, [environmentId, navigate, threadId]);
  const openDiff = useCallback(() => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId },
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1" };
      },
    });
  }, [environmentId, navigate, threadId]);

  useEffect(() => {
    if (diffOpen) {
      setHasOpenedDiff(true);
    }
  }, [diffOpen]);

  useEffect(() => {
    if (!threadsHydrated) {
      return;
    }

    if (!routeThreadExists) {
      void navigate({ to: "/", replace: true });
      return;
    }
  }, [navigate, routeThreadExists, threadsHydrated, threadId]);

  if (!threadsHydrated || !routeThreadExists) {
    return null;
  }

  const shouldRenderDiffContent = diffOpen || hasOpenedDiff;

  if (!shouldUseDiffSheet) {
    return (
      <>
        <AgentsSplitWorkspace
          environmentId={environmentId}
          routeThreadId={threadId}
          diffOpen={diffOpen}
          onOpenDiff={openDiff}
          onCloseDiff={closeDiff}
          onDiffThreadChange={setDiffTargetThreadId}
        />
        <DiffPanelInlineSidebar
          diffOpen={diffOpen}
          onCloseDiff={closeDiff}
          onOpenDiff={openDiff}
          renderDiffContent={shouldRenderDiffContent}
          threadId={activeDiffThreadId}
          environmentId={environmentId}
        />
      </>
    );
  }

  return (
    <>
      <AgentsSplitWorkspace
        environmentId={environmentId}
        routeThreadId={threadId}
        diffOpen={diffOpen}
        onOpenDiff={openDiff}
        onCloseDiff={closeDiff}
        onDiffThreadChange={setDiffTargetThreadId}
      />
      <DiffPanelSheet diffOpen={diffOpen} onCloseDiff={closeDiff}>
        {shouldRenderDiffContent ? (
          <RightPanelTabs
            mode="sheet"
            threadId={activeDiffThreadId}
            environmentId={environmentId}
            onClose={closeDiff}
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
