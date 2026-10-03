import { ThreadId } from "@tabs/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { projectUiStateKey } from "./scopedStateStore";
import { createMemoryStorage } from "../lib/storage";

export const AGENTS_SPLIT_STORAGE_KEY = "tabs:agents-split-layout:v1";

export const DEFAULT_SPLIT_RATIO = 0.5;
export const MIN_SPLIT_RATIO = 0.25;
export const MAX_SPLIT_RATIO = 0.75;
export const MIN_PANE_WIDTH_PX = 260;
export const SPLIT_RESIZER_WIDTH_PX = 8;
export const MIN_SPLIT_WORKSPACE_WIDTH = MIN_PANE_WIDTH_PX * 2 + SPLIT_RESIZER_WIDTH_PX;

export interface AgentsSplitLayout {
  readonly paneThreadIds: ReadonlyArray<ThreadId>;
  readonly activeThreadId: ThreadId | null;
  readonly splitRatio: number;
  readonly maximizedThreadId: ThreadId | null;
}

export function createDefaultSplitLayout(initialThreadId?: ThreadId | null): AgentsSplitLayout {
  return {
    paneThreadIds: initialThreadId ? [initialThreadId] : [],
    activeThreadId: initialThreadId ?? null,
    splitRatio: DEFAULT_SPLIT_RATIO,
    maximizedThreadId: null,
  };
}

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_SPLIT_RATIO;
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, Math.round(ratio * 1000) / 1000));
}

export function getResponsiveSplitRatioBounds(
  workspaceWidth: number,
  minimumPaneWidth = MIN_PANE_WIDTH_PX,
  resizerWidth = SPLIT_RESIZER_WIDTH_PX,
): { min: number; max: number } {
  const availableWidth = workspaceWidth - resizerWidth;
  if (!Number.isFinite(availableWidth) || availableWidth < minimumPaneWidth * 2) {
    return { min: DEFAULT_SPLIT_RATIO, max: DEFAULT_SPLIT_RATIO };
  }

  const minimumRatio = minimumPaneWidth / availableWidth;
  return {
    min: Math.max(MIN_SPLIT_RATIO, minimumRatio),
    max: Math.min(MAX_SPLIT_RATIO, 1 - minimumRatio),
  };
}

export function clampSplitRatioForWidth(ratio: number, workspaceWidth: number): number {
  const normalizedRatio = clampSplitRatio(ratio);
  const bounds = getResponsiveSplitRatioBounds(workspaceWidth);
  return Math.min(bounds.max, Math.max(bounds.min, normalizedRatio));
}

/**
 * Pure helper to reconcile restored layout against currently existing project threads.
 * Prunes missing, deleted, or archived threads safely.
 */
export function reconcileSplitLayout(
  layout: AgentsSplitLayout | undefined,
  availableThreadIds: ReadonlySet<ThreadId> | ReadonlyArray<ThreadId>,
  routeThreadId?: ThreadId | null,
): AgentsSplitLayout {
  const availableSet =
    availableThreadIds instanceof Set ? new Set(availableThreadIds) : new Set(availableThreadIds);

  // If routeThreadId is provided and non-empty, ensure it is considered valid
  // (e.g. newly created draft threads that have not yet persisted messages to DB)
  if (routeThreadId && routeThreadId.length > 0) {
    availableSet.add(routeThreadId);
  }

  const rawPanes = layout?.paneThreadIds ?? [];
  // Keep only existing threads, max 2 panes
  const validPanes = rawPanes.filter((id) => availableSet.has(id)).slice(0, 2);

  // If routeThreadId is provided, make sure it's present
  let resolvedPanes = [...validPanes];
  if (routeThreadId && availableSet.has(routeThreadId)) {
    if (resolvedPanes.length === 0) {
      resolvedPanes = [routeThreadId];
    } else if (!resolvedPanes.includes(routeThreadId)) {
      // If layout had 2 panes neither matching routeThreadId, replace active or primary pane
      if (layout?.activeThreadId && resolvedPanes.includes(layout.activeThreadId)) {
        const activeIdx = resolvedPanes.indexOf(layout.activeThreadId);
        resolvedPanes[activeIdx] = routeThreadId;
      } else {
        resolvedPanes[0] = routeThreadId;
      }
    }
  }

  const activeId =
    routeThreadId && resolvedPanes.includes(routeThreadId)
      ? routeThreadId
      : layout?.activeThreadId && resolvedPanes.includes(layout.activeThreadId)
        ? layout.activeThreadId
        : (resolvedPanes[0] ?? null);

  let maximizedId = layout?.maximizedThreadId ?? null;
  if (maximizedId && !resolvedPanes.includes(maximizedId)) {
    maximizedId = null;
  }

  return {
    paneThreadIds: resolvedPanes,
    activeThreadId: activeId,
    splitRatio: clampSplitRatio(layout?.splitRatio ?? DEFAULT_SPLIT_RATIO),
    maximizedThreadId: maximizedId,
  };
}

/**
 * Pure helper for drop placement calculation:
 * Returns the destination side based on pointer position relative to container bounds.
 */
export function computeDropSide(
  pointerX: number,
  containerRect: { left: number; width: number },
): "left" | "right" {
  const midpoint = containerRect.left + containerRect.width / 2;
  return pointerX < midpoint ? "left" : "right";
}

/**
 * Pure helper for planning the result of dropping a thread onto the split workspace.
 */
export function planSplitDrop(
  currentPanes: ReadonlyArray<ThreadId>,
  activePaneId: ThreadId | null,
  droppedThreadId: ThreadId,
  side: "left" | "right",
): { nextPanes: ReadonlyArray<ThreadId>; nextActiveId: ThreadId; changed: boolean } {
  if (currentPanes.length === 0) {
    return {
      nextPanes: [droppedThreadId],
      nextActiveId: droppedThreadId,
      changed: true,
    };
  }

  if (currentPanes.length === 1) {
    const primary = currentPanes[0]!;
    if (primary === droppedThreadId) {
      return {
        nextPanes: currentPanes,
        nextActiveId: primary,
        changed: false,
      };
    }
    const nextPanes = side === "left" ? [droppedThreadId, primary] : [primary, droppedThreadId];
    return {
      nextPanes,
      nextActiveId: droppedThreadId,
      changed: true,
    };
  }

  // Two panes already visible: [pane0, pane1]
  const [pane0, pane1] = [currentPanes[0]!, currentPanes[1]!];

  // Dropping an already visible thread:
  if (droppedThreadId === pane0) {
    if (side === "left") {
      // Already on left half
      return {
        nextPanes: currentPanes,
        nextActiveId: pane0,
        changed: false,
      };
    }
    // Reorder: swap left and right
    return {
      nextPanes: [pane1, pane0],
      nextActiveId: pane0,
      changed: true,
    };
  }

  if (droppedThreadId === pane1) {
    if (side === "right") {
      // Already on right half
      return {
        nextPanes: currentPanes,
        nextActiveId: pane1,
        changed: false,
      };
    }
    // Reorder: swap left and right
    return {
      nextPanes: [pane1, pane0],
      nextActiveId: pane1,
      changed: true,
    };
  }

  // Dropping a third thread: replace the pane on the target side
  const nextPanes = side === "left" ? [droppedThreadId, pane1] : [pane0, droppedThreadId];
  return {
    nextPanes,
    nextActiveId: droppedThreadId,
    changed: true,
  };
}

/**
 * Pure helper for "Open to the Side":
 * Opens thread into secondary pane (or replaces secondary if already split).
 */
export function planOpenToSide(
  currentPanes: ReadonlyArray<ThreadId>,
  activePaneId: ThreadId | null,
  threadId: ThreadId,
): { nextPanes: ReadonlyArray<ThreadId>; nextActiveId: ThreadId } {
  if (currentPanes.length === 0) {
    return { nextPanes: [threadId], nextActiveId: threadId };
  }

  if (currentPanes.length === 1) {
    const primary = currentPanes[0]!;
    if (primary === threadId) {
      return { nextPanes: currentPanes, nextActiveId: primary };
    }
    return { nextPanes: [primary, threadId], nextActiveId: threadId };
  }

  // 2 panes: [pane0, pane1]
  const [pane0, pane1] = [currentPanes[0]!, currentPanes[1]!];
  if (pane0 === threadId) {
    return { nextPanes: currentPanes, nextActiveId: pane0 };
  }
  if (pane1 === threadId) {
    return { nextPanes: currentPanes, nextActiveId: pane1 };
  }

  // Replace whichever pane is NOT active (or replace right pane if active is pane0)
  if (activePaneId === pane1) {
    return { nextPanes: [threadId, pane1], nextActiveId: threadId };
  }
  return { nextPanes: [pane0, threadId], nextActiveId: threadId };
}

/**
 * Pure helper for normal single click:
 * Opens thread in the active pane.
 */
export function planOpenInActivePane(
  currentPanes: ReadonlyArray<ThreadId>,
  activePaneId: ThreadId | null,
  threadId: ThreadId,
): { nextPanes: ReadonlyArray<ThreadId>; nextActiveId: ThreadId } {
  if (currentPanes.length <= 1) {
    return { nextPanes: [threadId], nextActiveId: threadId };
  }

  // 2 panes
  const [pane0, pane1] = [currentPanes[0]!, currentPanes[1]!];
  if (pane0 === threadId) {
    return { nextPanes: currentPanes, nextActiveId: pane0 };
  }
  if (pane1 === threadId) {
    return { nextPanes: currentPanes, nextActiveId: pane1 };
  }

  // Replace active pane
  if (activePaneId === pane1) {
    return { nextPanes: [pane0, threadId], nextActiveId: threadId };
  }
  return { nextPanes: [threadId, pane1], nextActiveId: threadId };
}

/**
 * Pure helper for closing a pane:
 * Leaves remaining pane at full width and focuses it.
 */
export function planClosePane(
  currentPanes: ReadonlyArray<ThreadId>,
  activePaneId: ThreadId | null,
  closingThreadId: ThreadId,
): { nextPanes: ReadonlyArray<ThreadId>; nextActiveId: ThreadId | null } {
  const remaining = currentPanes.filter((id) => id !== closingThreadId);
  if (remaining.length === 0) {
    return { nextPanes: [], nextActiveId: null };
  }
  const nextActive =
    activePaneId && remaining.includes(activePaneId) ? activePaneId : (remaining[0] ?? null);
  return {
    nextPanes: remaining,
    nextActiveId: nextActive,
  };
}

export interface AgentsLayoutStoreState {
  layoutsByProjectKey: Record<string, AgentsSplitLayout>;

  getLayout: (projectKey: string) => AgentsSplitLayout;
  reconcile: (
    projectKey: string,
    availableThreadIds: ReadonlySet<ThreadId> | ReadonlyArray<ThreadId>,
    routeThreadId?: ThreadId | null,
  ) => AgentsSplitLayout;
  openInActivePane: (projectKey: string, threadId: ThreadId) => void;
  openToSide: (projectKey: string, threadId: ThreadId) => void;
  splitDrop: (projectKey: string, droppedThreadId: ThreadId, side: "left" | "right") => boolean;
  closePane: (projectKey: string, threadId: ThreadId) => void;
  setActivePane: (projectKey: string, threadId: ThreadId) => void;
  setSplitRatio: (projectKey: string, ratio: number) => void;
  toggleMaximize: (projectKey: string, threadId: ThreadId) => void;
  resetLayout: (projectKey: string) => void;
}

export const useAgentsLayoutStore = create<AgentsLayoutStoreState>()(
  persist(
    (set, get) => ({
      layoutsByProjectKey: {},

      getLayout: (projectKey: string) => {
        return get().layoutsByProjectKey[projectKey] ?? createDefaultSplitLayout();
      },

      reconcile: (projectKey, availableThreadIds, routeThreadId) => {
        const current = get().layoutsByProjectKey[projectKey];
        const reconciled = reconcileSplitLayout(current, availableThreadIds, routeThreadId);
        set((state) => ({
          layoutsByProjectKey: {
            ...state.layoutsByProjectKey,
            [projectKey]: reconciled,
          },
        }));
        return reconciled;
      },

      openInActivePane: (projectKey, threadId) => {
        set((state) => {
          const current = state.layoutsByProjectKey[projectKey] ?? createDefaultSplitLayout();
          const { nextPanes, nextActiveId } = planOpenInActivePane(
            current.paneThreadIds,
            current.activeThreadId,
            threadId,
          );
          return {
            layoutsByProjectKey: {
              ...state.layoutsByProjectKey,
              [projectKey]: {
                ...current,
                paneThreadIds: nextPanes,
                activeThreadId: nextActiveId,
                maximizedThreadId: null,
              },
            },
          };
        });
      },

      openToSide: (projectKey, threadId) => {
        set((state) => {
          const current = state.layoutsByProjectKey[projectKey] ?? createDefaultSplitLayout();
          const { nextPanes, nextActiveId } = planOpenToSide(
            current.paneThreadIds,
            current.activeThreadId,
            threadId,
          );
          return {
            layoutsByProjectKey: {
              ...state.layoutsByProjectKey,
              [projectKey]: {
                ...current,
                paneThreadIds: nextPanes,
                activeThreadId: nextActiveId,
                maximizedThreadId: null,
              },
            },
          };
        });
      },

      splitDrop: (projectKey, droppedThreadId, side) => {
        let didChange = false;
        set((state) => {
          const current = state.layoutsByProjectKey[projectKey] ?? createDefaultSplitLayout();
          const { nextPanes, nextActiveId, changed } = planSplitDrop(
            current.paneThreadIds,
            current.activeThreadId,
            droppedThreadId,
            side,
          );
          didChange = changed;
          if (!changed) return state;
          return {
            layoutsByProjectKey: {
              ...state.layoutsByProjectKey,
              [projectKey]: {
                ...current,
                paneThreadIds: nextPanes,
                activeThreadId: nextActiveId,
                maximizedThreadId: null,
              },
            },
          };
        });
        return didChange;
      },

      closePane: (projectKey, threadId) => {
        set((state) => {
          const current = state.layoutsByProjectKey[projectKey] ?? createDefaultSplitLayout();
          const { nextPanes, nextActiveId } = planClosePane(
            current.paneThreadIds,
            current.activeThreadId,
            threadId,
          );
          return {
            layoutsByProjectKey: {
              ...state.layoutsByProjectKey,
              [projectKey]: {
                ...current,
                paneThreadIds: nextPanes,
                activeThreadId: nextActiveId,
                maximizedThreadId: null,
              },
            },
          };
        });
      },

      setActivePane: (projectKey, threadId) => {
        set((state) => {
          const current = state.layoutsByProjectKey[projectKey] ?? createDefaultSplitLayout();
          if (current.activeThreadId === threadId || !current.paneThreadIds.includes(threadId)) {
            return state;
          }
          return {
            layoutsByProjectKey: {
              ...state.layoutsByProjectKey,
              [projectKey]: {
                ...current,
                activeThreadId: threadId,
              },
            },
          };
        });
      },

      setSplitRatio: (projectKey, ratio) => {
        set((state) => {
          const current = state.layoutsByProjectKey[projectKey] ?? createDefaultSplitLayout();
          const clamped = clampSplitRatio(ratio);
          if (current.splitRatio === clamped) return state;
          return {
            layoutsByProjectKey: {
              ...state.layoutsByProjectKey,
              [projectKey]: {
                ...current,
                splitRatio: clamped,
              },
            },
          };
        });
      },

      toggleMaximize: (projectKey, threadId) => {
        set((state) => {
          const current = state.layoutsByProjectKey[projectKey] ?? createDefaultSplitLayout();
          const nextMaximized = current.maximizedThreadId === threadId ? null : threadId;
          return {
            layoutsByProjectKey: {
              ...state.layoutsByProjectKey,
              [projectKey]: {
                ...current,
                maximizedThreadId: nextMaximized,
              },
            },
          };
        });
      },

      resetLayout: (projectKey) => {
        set((state) => {
          const next = { ...state.layoutsByProjectKey };
          delete next[projectKey];
          return { layoutsByProjectKey: next };
        });
      },
    }),
    {
      name: AGENTS_SPLIT_STORAGE_KEY,
      storage: createJSONStorage(() =>
        typeof localStorage !== "undefined" ? localStorage : createMemoryStorage(),
      ),
      partialize: (state) => ({
        layoutsByProjectKey: state.layoutsByProjectKey,
      }),
    },
  ),
);

export const agentsLayoutActions = {
  getLayout: (projectKey: string) => useAgentsLayoutStore.getState().getLayout(projectKey),
  reconcile: (
    projectKey: string,
    availableThreadIds: ReadonlySet<ThreadId> | ReadonlyArray<ThreadId>,
    routeThreadId?: ThreadId | null,
  ) => useAgentsLayoutStore.getState().reconcile(projectKey, availableThreadIds, routeThreadId),
  openInActivePane: (projectKey: string, threadId: ThreadId) =>
    useAgentsLayoutStore.getState().openInActivePane(projectKey, threadId),
  openToSide: (projectKey: string, threadId: ThreadId) =>
    useAgentsLayoutStore.getState().openToSide(projectKey, threadId),
  splitDrop: (projectKey: string, droppedThreadId: ThreadId, side: "left" | "right") =>
    useAgentsLayoutStore.getState().splitDrop(projectKey, droppedThreadId, side),
  closePane: (projectKey: string, threadId: ThreadId) =>
    useAgentsLayoutStore.getState().closePane(projectKey, threadId),
  setActivePane: (projectKey: string, threadId: ThreadId) =>
    useAgentsLayoutStore.getState().setActivePane(projectKey, threadId),
  setSplitRatio: (projectKey: string, ratio: number) =>
    useAgentsLayoutStore.getState().setSplitRatio(projectKey, ratio),
  toggleMaximize: (projectKey: string, threadId: ThreadId) =>
    useAgentsLayoutStore.getState().toggleMaximize(projectKey, threadId),
  resetLayout: (projectKey: string) => useAgentsLayoutStore.getState().resetLayout(projectKey),
};

export { projectUiStateKey };
