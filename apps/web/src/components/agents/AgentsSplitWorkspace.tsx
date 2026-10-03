import { EnvironmentId, ThreadId, type ProjectId } from "@tabs/contracts";
import { useAtomValue } from "@effect/atom-react";
import { Columns2Icon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import ChatView from "../ChatView";
import { threadsAtom, threadsHydratedAtom, projectsAtom } from "../../state/threads";
import { useWorkspaceActiveProjectId } from "../../state/workspaceShell";
import {
  agentsLayoutActions,
  clampSplitRatioForWidth,
  computeDropSide,
  DEFAULT_SPLIT_RATIO,
  MIN_SPLIT_WORKSPACE_WIDTH,
  projectUiStateKey,
  useAgentsLayoutStore,
} from "../../state/agentsLayout";
import {
  clearActiveAgentDrag,
  getActiveAgentDrag,
  isAgentThreadDragEvent,
  parseAgentThreadDrag,
  useAgentDragSafetyCleanup,
  useActiveAgentDrag,
  validateAgentDragPayload,
} from "./agentDragPayload";
import { AgentsSplitDropOverlay } from "./AgentsSplitDropOverlay";
import { AgentsSplitResizer } from "./AgentsSplitResizer";
import { useComposerDraftStore } from "../../composerDraftStore";

export interface AgentsSplitWorkspaceProps {
  environmentId: EnvironmentId;
  routeThreadId: ThreadId;
  diffOpen: boolean;
  onOpenDiff: () => void;
  onCloseDiff: () => void;
  onDiffThreadChange?: (threadId: ThreadId | null) => void;
}

function unscopedDraftId(storedId: string, environmentPrefix: string): string {
  if (!storedId.startsWith(environmentPrefix)) return storedId;
  try {
    return decodeURIComponent(storedId.slice(environmentPrefix.length));
  } catch {
    return storedId.slice(environmentPrefix.length);
  }
}

export function AgentsSplitWorkspace({
  environmentId,
  routeThreadId,
  diffOpen,
  onOpenDiff,
  onCloseDiff,
  onDiffThreadChange,
}: AgentsSplitWorkspaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const activeProjectId = useWorkspaceActiveProjectId();
  const threads = useAtomValue(threadsAtom);
  const threadsHydrated = useAtomValue(threadsHydratedAtom);
  const projects = useAtomValue(projectsAtom);
  const draftThreads = useComposerDraftStore((s) => s.draftThreadsByThreadId);
  useAgentDragSafetyCleanup();

  const activeProject = useMemo(() => {
    if (activeProjectId) {
      const p = projects.find((proj) => proj.id === activeProjectId);
      if (p) return p;
    }
    if (routeThreadId) {
      const t = threads.find(
        (thread) => thread.id === routeThreadId && thread.environmentId === environmentId,
      );
      if (t?.projectId) {
        return projects.find((proj) => proj.id === t.projectId) ?? null;
      }
    }
    return null;
  }, [activeProjectId, environmentId, projects, routeThreadId, threads]);

  const projectKey = useMemo(() => {
    return projectUiStateKey(
      environmentId,
      activeProject?.id ?? (activeProjectId as ProjectId) ?? "default",
    );
  }, [environmentId, activeProject?.id, activeProjectId]);

  const availableProjectThreadIds = useMemo(() => {
    const ids = new Set<ThreadId>();
    for (const t of threads) {
      if (
        t.environmentId === environmentId &&
        (!activeProject || t.projectId === activeProject.id)
      ) {
        ids.add(t.id);
      }
    }
    // Include active draft threads for this project/environment
    const environmentPrefix = `${encodeURIComponent(environmentId)}::`;
    for (const [storedDraftId, draft] of Object.entries(draftThreads)) {
      const storedProjectId = String(draft.projectId);
      const projectMatches =
        !activeProject ||
        storedProjectId === activeProject.id ||
        (storedProjectId.startsWith(environmentPrefix) &&
          unscopedDraftId(storedProjectId, environmentPrefix) === activeProject.id);
      if (projectMatches) {
        const threadId = unscopedDraftId(storedDraftId, environmentPrefix);
        ids.add(ThreadId.makeUnsafe(threadId));
      }
    }
    // Always include current route thread
    if (routeThreadId) {
      ids.add(routeThreadId);
    }
    return ids;
  }, [threads, environmentId, activeProject, draftThreads, routeThreadId]);

  // Reconcile layout on mount / changes
  useEffect(() => {
    if (!threadsHydrated) return;
    agentsLayoutActions.reconcile(projectKey, availableProjectThreadIds, routeThreadId);
  }, [threadsHydrated, projectKey, availableProjectThreadIds, routeThreadId]);

  const rawLayout = useAgentsLayoutStore((s) => s.layoutsByProjectKey[projectKey]);
  const layout = useMemo(() => {
    if (!rawLayout || rawLayout.paneThreadIds.length === 0) {
      return {
        paneThreadIds: [routeThreadId],
        activeThreadId: routeThreadId,
        splitRatio: DEFAULT_SPLIT_RATIO,
        maximizedThreadId: null,
      };
    }
    return rawLayout;
  }, [rawLayout, routeThreadId]);

  // Screen width observer for narrow layout fallback (< 600px)
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry?.contentRect) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const isNarrow = containerWidth === null || containerWidth < MIN_SPLIT_WORKSPACE_WIDTH;

  // Active drag overlay state
  const activeDrag = useActiveAgentDrag();
  const [dropPreviewSide, setDropPreviewSide] = useState<"left" | "right" | null>(null);
  const [announcement, setAnnouncement] = useState<string>("");

  useEffect(() => {
    if (!activeDrag) setDropPreviewSide(null);
  }, [activeDrag]);

  // Diff request tracking: which pane requested the diff
  const [diffRequestThreadId, setDiffRequestThreadId] = useState<ThreadId | null>(() =>
    diffOpen ? routeThreadId : null,
  );

  useEffect(() => {
    if (!diffOpen) {
      setDiffRequestThreadId(null);
      onDiffThreadChange?.(null);
      return;
    }
    if (!diffRequestThreadId) {
      setDiffRequestThreadId(routeThreadId);
      onDiffThreadChange?.(routeThreadId);
    }
  }, [diffOpen, diffRequestThreadId, onDiffThreadChange, routeThreadId]);

  const activatePane = useCallback(
    (threadId: ThreadId) => {
      if (layout.activeThreadId === threadId) return;

      // Close diff if active pane changes and it wasn't the diff requester
      if (diffOpen && diffRequestThreadId && diffRequestThreadId !== threadId) {
        onCloseDiff();
        setDiffRequestThreadId(null);
        onDiffThreadChange?.(null);
      }

      agentsLayoutActions.setActivePane(projectKey, threadId);
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId },
        replace: true,
      });
    },
    [
      diffOpen,
      diffRequestThreadId,
      environmentId,
      layout.activeThreadId,
      navigate,
      onCloseDiff,
      onDiffThreadChange,
      projectKey,
    ],
  );

  const handleToggleDiffForPane = useCallback(
    (paneThreadId: ThreadId) => {
      if (diffOpen) {
        if (diffRequestThreadId === paneThreadId) {
          onCloseDiff();
          setDiffRequestThreadId(null);
          onDiffThreadChange?.(null);
          return;
        }
      }
      setDiffRequestThreadId(paneThreadId);
      onDiffThreadChange?.(paneThreadId);
      onOpenDiff();
    },
    [diffOpen, diffRequestThreadId, onCloseDiff, onDiffThreadChange, onOpenDiff],
  );

  const handleClosePane = useCallback(
    (threadId: ThreadId) => {
      const thread = threads.find((t) => t.id === threadId);
      const title = thread?.title ?? "Thread";

      if (diffOpen && diffRequestThreadId === threadId) {
        onCloseDiff();
        setDiffRequestThreadId(null);
        onDiffThreadChange?.(null);
      }

      agentsLayoutActions.closePane(projectKey, threadId);

      const remaining = layout.paneThreadIds.filter((id) => id !== threadId);
      if (remaining.length > 0 && remaining[0]) {
        const nextActive = remaining[0];
        void navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId, threadId: nextActive },
          replace: true,
        });
      }

      setAnnouncement(`Closed ${title}`);
    },
    [
      diffOpen,
      diffRequestThreadId,
      environmentId,
      layout.paneThreadIds,
      navigate,
      onCloseDiff,
      onDiffThreadChange,
      projectKey,
      threads,
    ],
  );

  // Drag handlers over container
  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!isAgentThreadDragEvent(event)) return;
      const drag = getActiveAgentDrag();
      if (!drag) return;
      if (
        drag.environmentId !== environmentId ||
        (activeProject && drag.projectId !== activeProject.id)
      ) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "move";

      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const side = computeDropSide(event.clientX, rect);
      setDropPreviewSide(side);
    },
    [activeProject, environmentId],
  );

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const related = event.relatedTarget;
    if (related && containerRef.current?.contains(related as Node)) {
      return;
    }
    setDropPreviewSide(null);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!isAgentThreadDragEvent(event)) return;
      event.preventDefault();
      setDropPreviewSide(null);

      const raw = event.dataTransfer.getData("application/x-tabs-agent-thread");
      const parsed = parseAgentThreadDrag(raw) ?? getActiveAgentDrag();
      const validated = validateAgentDragPayload(parsed, environmentId, activeProject?.id);

      clearActiveAgentDrag();

      if (!validated) return;

      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const side = computeDropSide(event.clientX, rect);

      const changed = agentsLayoutActions.splitDrop(projectKey, validated.threadId, side);
      if (changed) {
        const thread = threads.find((t) => t.id === validated.threadId);
        const title = thread?.title ?? "Thread";
        setAnnouncement(`Split workspace with ${title} on the ${side}`);
        void navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId, threadId: validated.threadId },
          replace: true,
        });
      }
    },
    [activeProject?.id, environmentId, navigate, projectKey, threads],
  );

  // Avoid Alt+Left/Right because those are conventional browser history shortcuts.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (layout.paneThreadIds.length < 2) return;
      if (event.altKey && event.key === "[") {
        event.preventDefault();
        const first = layout.paneThreadIds[0];
        if (first) activatePane(first);
      } else if (event.altKey && event.key === "]") {
        event.preventDefault();
        const second = layout.paneThreadIds[1];
        if (second) activatePane(second);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activatePane, layout.paneThreadIds]);

  const isSplitActive = layout.paneThreadIds.length >= 2;
  const isMaximized = layout.maximizedThreadId !== null;

  const leftPaneId = layout.paneThreadIds[0] ?? routeThreadId;
  const rightPaneId = layout.paneThreadIds[1] ?? null;

  const leftThread = threads.find((t) => t.id === leftPaneId);
  const rightThread = rightPaneId ? threads.find((t) => t.id === rightPaneId) : null;

  const effectiveSplitRatio = clampSplitRatioForWidth(
    layout.splitRatio,
    containerWidth ?? MIN_SPLIT_WORKSPACE_WIDTH,
  );
  const leftRatio = effectiveSplitRatio;
  const rightRatio = 1 - effectiveSplitRatio;

  // Dragged thread info for preview
  const draggedThread = activeDrag ? threads.find((t) => t.id === activeDrag.threadId) : null;
  const isReorder = Boolean(
    activeDrag && layout.paneThreadIds.includes(activeDrag.threadId) && isSplitActive,
  );

  // ── Render Case 1: Single Pane (Default, exact preservation) ──
  if (!isSplitActive) {
    const singleThreadId = layout.activeThreadId ?? routeThreadId;
    return (
      <div
        ref={containerRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden overscroll-y-none bg-background text-foreground"
      >
        <span role="status" aria-live="polite" className="sr-only">
          {announcement}
        </span>
        <ChatView
          key={`${environmentId}:${singleThreadId}`}
          environmentId={environmentId}
          threadId={singleThreadId}
          isActivePane={true}
          diffOpen={diffOpen}
          onToggleDiff={() => handleToggleDiffForPane(singleThreadId)}
        />
        {dropPreviewSide && (
          <AgentsSplitDropOverlay
            side={dropPreviewSide}
            isReorder={false}
            threadTitle={draggedThread?.title}
          />
        )}
      </div>
    );
  }

  // ── Render Case 2: Maximized Pane ──
  if (isMaximized && layout.maximizedThreadId) {
    const maxThreadId = layout.maximizedThreadId;
    return (
      <div
        ref={containerRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden overscroll-y-none bg-background text-foreground"
      >
        <span role="status" aria-live="polite" className="sr-only">
          {announcement}
        </span>
        <ChatView
          key={`${environmentId}:${maxThreadId}`}
          environmentId={environmentId}
          threadId={maxThreadId}
          isActivePane={true}
          isSplitActive={true}
          isMaximized={true}
          onToggleMaximize={() => agentsLayoutActions.toggleMaximize(projectKey, maxThreadId)}
          onClosePane={() => handleClosePane(maxThreadId)}
          diffOpen={diffOpen && diffRequestThreadId === maxThreadId}
          onToggleDiff={() => handleToggleDiffForPane(maxThreadId)}
        />
        {dropPreviewSide && (
          <AgentsSplitDropOverlay
            side={dropPreviewSide}
            isReorder={isReorder}
            threadTitle={draggedThread?.title}
          />
        )}
      </div>
    );
  }

  // ── Render Case 3: Narrow window fallback (< 768px) ──
  if (isNarrow) {
    const activePaneId = layout.activeThreadId ?? leftPaneId;
    const secondaryPaneId = activePaneId === leftPaneId ? rightPaneId : leftPaneId;
    const activeThread = threads.find((t) => t.id === activePaneId);
    const secondaryThread = secondaryPaneId ? threads.find((t) => t.id === secondaryPaneId) : null;

    return (
      <div
        ref={containerRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden overscroll-y-none bg-background text-foreground"
      >
        <span role="status" aria-live="polite" className="sr-only">
          {announcement}
        </span>
        {/* Sleek banner switching between the split threads on narrow screen */}
        <div className="flex h-10 min-w-0 shrink-0 items-center gap-2 border-b border-border/60 bg-muted/30 px-2.5 backdrop-blur-sm">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Columns2Icon className="size-3.5 text-muted-foreground shrink-0" />
            <span className="truncate text-xs font-semibold text-foreground">
              {activeThread?.title ?? "Active thread"}
            </span>
          </div>
          <div className="flex min-w-0 max-w-[60%] shrink items-center gap-1.5">
            {secondaryThread ? (
              <button
                type="button"
                onClick={() => activatePane(secondaryThread.id)}
                aria-label={`Switch to ${secondaryThread.title}`}
                className="flex min-w-0 items-center gap-1 rounded-md border border-border/60 bg-accent/40 px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
              >
                <span className="shrink-0">Switch to</span>
                <span className="truncate">{secondaryThread.title}</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => handleClosePane(secondaryPaneId ?? activePaneId)}
              className="rounded-md p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition-colors"
              aria-label="Unsplit workspace"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        </div>
        <div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden h-full">
          <ChatView
            key={`${environmentId}:${activePaneId}`}
            environmentId={environmentId}
            threadId={activePaneId}
            isActivePane={true}
            isSplitActive={false}
            diffOpen={diffOpen && diffRequestThreadId === activePaneId}
            onToggleDiff={() => handleToggleDiffForPane(activePaneId)}
          />
        </div>
        {dropPreviewSide && (
          <AgentsSplitDropOverlay
            side={dropPreviewSide}
            isReorder={isReorder}
            threadTitle={draggedThread?.title}
          />
        )}
      </div>
    );
  }

  // ── Render Case 4: Dual Pane Side-by-Side Split Workspace ──
  const isLeftActive = layout.activeThreadId === leftPaneId;
  const isRightActive = rightPaneId ? layout.activeThreadId === rightPaneId : false;

  return (
    <div
      ref={containerRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden overscroll-y-none bg-background text-foreground"
    >
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>

      {/* ── Left Pane ── */}
      <section
        aria-label={`Thread pane: ${leftThread?.title ?? "Left thread"}`}
        onPointerDownCapture={() => activatePane(leftPaneId)}
        onFocusCapture={() => activatePane(leftPaneId)}
        style={{ flex: `${leftRatio} 1 0%` }}
        className="group/pane flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
      >
        <ChatView
          key={`${environmentId}:${leftPaneId}`}
          environmentId={environmentId}
          threadId={leftPaneId}
          isActivePane={isLeftActive}
          isSplitActive={true}
          isMaximized={false}
          onToggleMaximize={() => agentsLayoutActions.toggleMaximize(projectKey, leftPaneId)}
          onClosePane={() => handleClosePane(leftPaneId)}
          onActivatePane={() => activatePane(leftPaneId)}
          diffOpen={diffOpen && diffRequestThreadId === leftPaneId}
          onToggleDiff={() => handleToggleDiffForPane(leftPaneId)}
        />
      </section>

      {/* ── Center Draggable Resizer ── */}
      <AgentsSplitResizer
        containerRef={containerRef}
        splitRatio={effectiveSplitRatio}
        onSplitRatioChange={(newRatio) => agentsLayoutActions.setSplitRatio(projectKey, newRatio)}
      />

      {/* ── Right Pane ── */}
      {rightPaneId ? (
        <section
          aria-label={`Thread pane: ${rightThread?.title ?? "Right thread"}`}
          onPointerDownCapture={() => activatePane(rightPaneId)}
          onFocusCapture={() => activatePane(rightPaneId)}
          style={{ flex: `${rightRatio} 1 0%` }}
          className="group/pane flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
        >
          <ChatView
            key={`${environmentId}:${rightPaneId}`}
            environmentId={environmentId}
            threadId={rightPaneId}
            isActivePane={isRightActive}
            isSplitActive={true}
            isMaximized={false}
            onToggleMaximize={() => agentsLayoutActions.toggleMaximize(projectKey, rightPaneId)}
            onClosePane={() => handleClosePane(rightPaneId)}
            onActivatePane={() => activatePane(rightPaneId)}
            diffOpen={diffOpen && diffRequestThreadId === rightPaneId}
            onToggleDiff={() => handleToggleDiffForPane(rightPaneId)}
          />
        </section>
      ) : null}

      {/* ── Drop Preview Overlay ── */}
      {dropPreviewSide && (
        <AgentsSplitDropOverlay
          side={dropPreviewSide}
          isReorder={isReorder}
          threadTitle={draggedThread?.title}
        />
      )}
    </div>
  );
}
