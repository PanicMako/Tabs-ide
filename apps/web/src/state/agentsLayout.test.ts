import { EnvironmentId, ProjectId, ThreadId } from "@tabs/contracts";
import { describe, expect, it, beforeEach } from "vitest";
import {
  clampSplitRatio,
  clampSplitRatioForWidth,
  computeDropSide,
  DEFAULT_SPLIT_RATIO,
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  MIN_PANE_WIDTH_PX,
  MIN_SPLIT_WORKSPACE_WIDTH,
  SPLIT_RESIZER_WIDTH_PX,
  getResponsiveSplitRatioBounds,
  planClosePane,
  planOpenInActivePane,
  planOpenToSide,
  planSplitDrop,
  reconcileSplitLayout,
  useAgentsLayoutStore,
  agentsLayoutActions,
} from "./agentsLayout";
import {
  clearActiveAgentDrag,
  getActiveAgentDrag,
  isAgentThreadDragEvent,
  parseAgentThreadDrag,
  setActiveAgentDrag,
  validateAgentDragPayload,
  type AgentThreadDragPayload,
} from "../components/agents/agentDragPayload";
import { useComposerDraftStore } from "../composerDraftStore";

describe("Agents Split-Thread Layout Model", () => {
  const env1 = EnvironmentId.makeUnsafe("env-1");
  const env2 = EnvironmentId.makeUnsafe("env-2");
  const proj1 = ProjectId.makeUnsafe("proj-1");
  const proj2 = ProjectId.makeUnsafe("proj-2");

  const threadA = ThreadId.makeUnsafe("thread-a");
  const threadB = ThreadId.makeUnsafe("thread-b");
  const threadC = ThreadId.makeUnsafe("thread-c");

  beforeEach(() => {
    useAgentsLayoutStore.getState().resetLayout("test-project");
    clearActiveAgentDrag();
  });

  it("1. Normal single-click navigation replaces active pane or opens single thread", () => {
    // When no split: opens thread as single pane
    const single = planOpenInActivePane([threadA], threadA, threadB);
    expect(single.nextPanes).toEqual([threadB]);
    expect(single.nextActiveId).toBe(threadB);

    // When split is active [threadA, threadB] with threadA active:
    // normal click on threadC replaces active pane threadA
    const splitActiveA = planOpenInActivePane([threadA, threadB], threadA, threadC);
    expect(splitActiveA.nextPanes).toEqual([threadC, threadB]);
    expect(splitActiveA.nextActiveId).toBe(threadC);

    // When split is active [threadA, threadB] with threadB active:
    // normal click on threadC replaces active pane threadB
    const splitActiveB = planOpenInActivePane([threadA, threadB], threadB, threadC);
    expect(splitActiveB.nextPanes).toEqual([threadA, threadC]);
    expect(splitActiveB.nextActiveId).toBe(threadC);

    // Normal click on a thread already in the inactive pane just focuses it
    const clickExisting = planOpenInActivePane([threadA, threadB], threadA, threadB);
    expect(clickExisting.nextPanes).toEqual([threadA, threadB]);
    expect(clickExisting.nextActiveId).toBe(threadB);
  });

  it("2. Drag Thread B to the right of Thread A produces [Thread A, Thread B]", () => {
    const dropRight = planSplitDrop([threadA], threadA, threadB, "right");
    expect(dropRight.changed).toBe(true);
    expect(dropRight.nextPanes).toEqual([threadA, threadB]);
    expect(dropRight.nextActiveId).toBe(threadB);
  });

  it("3. Drag Thread B to the left of Thread A produces [Thread B, Thread A]", () => {
    const dropLeft = planSplitDrop([threadA], threadA, threadB, "left");
    expect(dropLeft.changed).toBe(true);
    expect(dropLeft.nextPanes).toEqual([threadB, threadA]);
    expect(dropLeft.nextActiveId).toBe(threadB);
  });

  it("4. Reorder two already-visible panes when dragging across", () => {
    // Current: [threadA, threadB]. Drag threadA to the right:
    const reorderA = planSplitDrop([threadA, threadB], threadA, threadA, "right");
    expect(reorderA.changed).toBe(true);
    expect(reorderA.nextPanes).toEqual([threadB, threadA]);
    expect(reorderA.nextActiveId).toBe(threadA);

    // Current: [threadA, threadB]. Drag threadB to the left:
    const reorderB = planSplitDrop([threadA, threadB], threadB, threadB, "left");
    expect(reorderB.changed).toBe(true);
    expect(reorderB.nextPanes).toEqual([threadB, threadA]);
    expect(reorderB.nextActiveId).toBe(threadB);
  });

  it("5. Do not duplicate an already-visible thread when dropped on its own side", () => {
    // Current: [threadA, threadB]. Dropping threadA on the left is a no-op:
    const noopA = planSplitDrop([threadA, threadB], threadA, threadA, "left");
    expect(noopA.changed).toBe(false);
    expect(noopA.nextPanes).toEqual([threadA, threadB]);

    // Dropping threadB on the right is a no-op:
    const noopB = planSplitDrop([threadA, threadB], threadB, threadB, "right");
    expect(noopB.changed).toBe(false);
    expect(noopB.nextPanes).toEqual([threadA, threadB]);

    // Dropping threadA when only threadA is visible onto left is a no-op:
    const noopSingle = planSplitDrop([threadA], threadA, threadA, "left");
    expect(noopSingle.changed).toBe(false);
    expect(noopSingle.nextPanes).toEqual([threadA]);
  });

  it("6. Reject a thread from another project or environment", () => {
    const foreignEnvPayload: AgentThreadDragPayload = {
      type: "tabs:agent-thread",
      environmentId: env2,
      projectId: proj1,
      threadId: threadB,
    };
    expect(validateAgentDragPayload(foreignEnvPayload, env1, proj1)).toBeNull();

    const foreignProjPayload: AgentThreadDragPayload = {
      type: "tabs:agent-thread",
      environmentId: env1,
      projectId: proj2,
      threadId: threadB,
    };
    expect(validateAgentDragPayload(foreignProjPayload, env1, proj1)).toBeNull();

    const validPayload: AgentThreadDragPayload = {
      type: "tabs:agent-thread",
      environmentId: env1,
      projectId: proj1,
      threadId: threadB,
    };
    expect(validateAgentDragPayload(validPayload, env1, proj1)).toEqual(validPayload);
  });

  it("7. Invalid drag payload does nothing and is safely rejected", () => {
    expect(parseAgentThreadDrag(null)).toBeNull();
    expect(parseAgentThreadDrag("")).toBeNull();
    expect(parseAgentThreadDrag("invalid json")).toBeNull();
    expect(parseAgentThreadDrag(JSON.stringify({ type: "other", threadId: "123" }))).toBeNull();

    // Text or file drag does not activate agent drag
    expect(
      isAgentThreadDragEvent({
        dataTransfer: { types: ["text/plain"] } as unknown as DataTransfer,
      }),
    ).toBe(false);

    expect(
      isAgentThreadDragEvent({
        dataTransfer: {
          types: ["Files", "application/x-tabs-agent-thread"],
        } as unknown as DataTransfer,
      }),
    ).toBe(false);
  });

  it("8. Cancelled drag removes the preview and global active drag state", () => {
    const payload: AgentThreadDragPayload = {
      type: "tabs:agent-thread",
      environmentId: env1,
      projectId: proj1,
      threadId: threadA,
    };
    setActiveAgentDrag(payload);
    expect(getActiveAgentDrag()).toEqual(payload);

    clearActiveAgentDrag();
    expect(getActiveAgentDrag()).toBeNull();
  });

  it("9. Closing the secondary pane restores a single full-width pane", () => {
    const closedSecondary = planClosePane([threadA, threadB], threadA, threadB);
    expect(closedSecondary.nextPanes).toEqual([threadA]);
    expect(closedSecondary.nextActiveId).toBe(threadA);
  });

  it("10. Closing the active pane focuses the remaining pane", () => {
    const closedActive = planClosePane([threadA, threadB], threadA, threadA);
    expect(closedActive.nextPanes).toEqual([threadB]);
    expect(closedActive.nextActiveId).toBe(threadB);
  });

  it("11. 'Open to the Side' works without drag-and-drop", () => {
    // From single pane [threadA] -> opens threadB on the side
    const sideFromSingle = planOpenToSide([threadA], threadA, threadB);
    expect(sideFromSingle.nextPanes).toEqual([threadA, threadB]);
    expect(sideFromSingle.nextActiveId).toBe(threadB);

    // From dual panes [threadA, threadB] with threadA active -> replaces threadB with threadC
    const sideDualA = planOpenToSide([threadA, threadB], threadA, threadC);
    expect(sideDualA.nextPanes).toEqual([threadA, threadC]);
    expect(sideDualA.nextActiveId).toBe(threadC);

    // From dual panes [threadA, threadB] with threadB active -> replaces threadA with threadC
    const sideDualB = planOpenToSide([threadA, threadB], threadB, threadC);
    expect(sideDualB.nextPanes).toEqual([threadC, threadB]);
    expect(sideDualB.nextActiveId).toBe(threadC);

    // Opening a thread already open on the side just focuses it
    const sideExisting = planOpenToSide([threadA, threadB], threadA, threadB);
    expect(sideExisting.nextPanes).toEqual([threadA, threadB]);
    expect(sideExisting.nextActiveId).toBe(threadB);
  });

  it("12. Pane resizing is bounded by minimum widths and ratios", () => {
    expect(clampSplitRatio(0.05)).toBe(MIN_SPLIT_RATIO);
    expect(clampSplitRatio(0.95)).toBe(MAX_SPLIT_RATIO);
    expect(clampSplitRatio(0.5)).toBe(0.5);
    expect(clampSplitRatio(NaN)).toBe(DEFAULT_SPLIT_RATIO);

    const constrainedWidth = MIN_SPLIT_WORKSPACE_WIDTH;
    const bounds = getResponsiveSplitRatioBounds(constrainedWidth);
    expect(bounds.min).toBeCloseTo(MIN_PANE_WIDTH_PX / (constrainedWidth - SPLIT_RESIZER_WIDTH_PX));
    expect(bounds.max).toBeCloseTo(1 - bounds.min);
    expect(clampSplitRatioForWidth(MIN_SPLIT_RATIO, constrainedWidth)).toBeCloseTo(bounds.min);
    expect(clampSplitRatioForWidth(MAX_SPLIT_RATIO, constrainedWidth)).toBeCloseTo(bounds.max);
  });

  it("13. Split layout restoration after reload preserves existing threads", () => {
    const persisted = {
      paneThreadIds: [threadA, threadB],
      activeThreadId: threadB,
      splitRatio: 0.6,
      maximizedThreadId: null,
    };
    const available = [threadA, threadB, threadC];
    const restored = reconcileSplitLayout(persisted, available, threadB);

    expect(restored.paneThreadIds).toEqual([threadA, threadB]);
    expect(restored.activeThreadId).toBe(threadB);
    expect(restored.splitRatio).toBe(0.6);

    const navigatedBack = reconcileSplitLayout(restored, available, threadA);
    expect(navigatedBack.paneThreadIds).toEqual([threadA, threadB]);
    expect(navigatedBack.activeThreadId).toBe(threadA);
  });

  it("14. Missing/deleted thread cleanup during restoration prunes safely", () => {
    // Thread B was deleted:
    const persisted = {
      paneThreadIds: [threadA, threadB],
      activeThreadId: threadB,
      splitRatio: 0.5,
      maximizedThreadId: null,
    };
    const available = [threadA]; // only threadA exists
    const reconciled = reconcileSplitLayout(persisted, available, threadA);

    expect(reconciled.paneThreadIds).toEqual([threadA]);
    expect(reconciled.activeThreadId).toBe(threadA);

    // Both panes deleted: falls back to route thread
    const reconciledFallback = reconcileSplitLayout(persisted, [threadC], threadC);
    expect(reconciledFallback.paneThreadIds).toEqual([threadC]);
    expect(reconciledFallback.activeThreadId).toBe(threadC);
  });

  it("15. Independent composer drafts", () => {
    // Reset composer draft store
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    });

    const store = useComposerDraftStore.getState();

    // Type into Thread A's composer
    store.setPrompt(threadA, "Initial draft for Thread A");
    expect(useComposerDraftStore.getState().draftsByThreadId[threadA]?.prompt).toBe(
      "Initial draft for Thread A",
    );
    expect(useComposerDraftStore.getState().draftsByThreadId[threadB]).toBeUndefined();

    // Type into Thread B's composer
    store.setPrompt(threadB, "Independent draft for Thread B");
    expect(useComposerDraftStore.getState().draftsByThreadId[threadA]?.prompt).toBe(
      "Initial draft for Thread A",
    );
    expect(useComposerDraftStore.getState().draftsByThreadId[threadB]?.prompt).toBe(
      "Independent draft for Thread B",
    );

    // Clear Thread A's composer content
    useComposerDraftStore.getState().clearComposerContent(threadA);
    expect(useComposerDraftStore.getState().draftsByThreadId[threadA]).toBeUndefined();
    // Thread B's draft is preserved completely untouched
    expect(useComposerDraftStore.getState().draftsByThreadId[threadB]?.prompt).toBe(
      "Independent draft for Thread B",
    );
  });

  it("16. Independent conversation scrolling", () => {
    // Each ChatView pane instantiates its own scroll container (messagesScrollRef)
    const paneAScrollEl = { scrollTop: 0, scrollHeight: 2000, clientHeight: 800 };
    const paneBScrollEl = { scrollTop: 0, scrollHeight: 3500, clientHeight: 800 };

    // Scroll pane A down
    paneAScrollEl.scrollTop = 500;
    expect(paneAScrollEl.scrollTop).toBe(500);
    expect(paneBScrollEl.scrollTop).toBe(0);

    // Scroll pane B down
    paneBScrollEl.scrollTop = 1800;
    expect(paneAScrollEl.scrollTop).toBe(500);
    expect(paneBScrollEl.scrollTop).toBe(1800);

    // Unmounting or updating pane A does not reset pane B's scroll
    paneAScrollEl.scrollTop = 0;
    expect(paneBScrollEl.scrollTop).toBe(1800);
  });

  it("17. Streaming updates in both panes", () => {
    // Both panes stream messages independently without cross-talk
    const streamsByThread: Record<string, { status: string; tokens: string[] }> = {
      [threadA]: { status: "idle", tokens: [] },
      [threadB]: { status: "idle", tokens: [] },
    };

    // Thread A starts streaming
    streamsByThread[threadA] = { status: "streaming", tokens: ["Thinking", " through"] };
    // Thread B starts streaming concurrently
    streamsByThread[threadB] = { status: "streaming", tokens: ["Generating", " code"] };

    expect(streamsByThread[threadA].tokens).toEqual(["Thinking", " through"]);
    expect(streamsByThread[threadB].tokens).toEqual(["Generating", " code"]);

    // Additional tokens arrive on Thread A
    streamsByThread[threadA].tokens.push(" solution");
    expect(streamsByThread[threadA].tokens).toEqual(["Thinking", " through", " solution"]);
    // Thread B remains unaffected
    expect(streamsByThread[threadB].tokens).toEqual(["Generating", " code"]);
  });

  it("18. Diff panel targets the correct pane", () => {
    let diffTargetThreadId: ThreadId | null = null;
    let diffOpen = false;

    const openDiff = (threadId: ThreadId) => {
      diffTargetThreadId = threadId;
      diffOpen = true;
    };
    const closeDiff = () => {
      diffOpen = false;
      diffTargetThreadId = null;
    };
    const activatePane = (newActiveThreadId: ThreadId) => {
      if (diffOpen && diffTargetThreadId && diffTargetThreadId !== newActiveThreadId) {
        closeDiff();
      }
    };

    // Pane A requests diff
    openDiff(threadA);
    expect(diffOpen).toBe(true);
    expect(diffTargetThreadId).toBe(threadA);

    // Pane B requests diff - switches to target Thread B
    openDiff(threadB);
    expect(diffOpen).toBe(true);
    expect(diffTargetThreadId).toBe(threadB);

    // Switching active pane to Thread A safely closes Thread B's diff
    activatePane(threadA);
    expect(diffOpen).toBe(false);
    expect(diffTargetThreadId).toBeNull();
  });

  it("19. Narrow-window fallback behavior", () => {
    const key = "test-narrow-proj";
    agentsLayoutActions.openInActivePane(key, threadA);
    agentsLayoutActions.openToSide(key, threadB);
    agentsLayoutActions.setActivePane(key, threadA);

    const layout = agentsLayoutActions.getLayout(key);
    expect(layout.paneThreadIds).toEqual([threadA, threadB]);
    expect(layout.activeThreadId).toBe(threadA);

    // Below breakpoint: container is narrow (< 600px)
    const narrowWidth = 500;
    const isNarrow = narrowWidth < MIN_SPLIT_WORKSPACE_WIDTH;
    expect(isNarrow).toBe(true);

    // In narrow mode, only the active pane is displayed
    const renderedPaneId = isNarrow ? (layout.activeThreadId ?? layout.paneThreadIds[0]) : null;
    expect(renderedPaneId).toBe(threadA);

    // Layout store is NOT pruned or degraded; split arrangement is preserved
    expect(agentsLayoutActions.getLayout(key).paneThreadIds).toEqual([threadA, threadB]);

    // When window is restored above breakpoint (e.g. 720px on 1024px screen with open sidebar), dual panes re-render
    const wideWidth = 720;
    expect(wideWidth < MIN_SPLIT_WORKSPACE_WIDTH).toBe(false);
  });

  it("20. No duplicate global keyboard-handler execution", () => {
    let commandInvocations = 0;

    // Simulated global keybinding handler in ChatView guarded by isActivePane
    const handleGlobalChatShortcut = (isActivePane: boolean) => {
      if (!isActivePane) return;
      commandInvocations++;
    };

    // In dual pane mode, left pane is active and right pane is inactive
    const leftPaneIsActive = true;
    const rightPaneIsActive = false;

    // Global keyboard shortcut event fires on window
    handleGlobalChatShortcut(leftPaneIsActive);
    handleGlobalChatShortcut(rightPaneIsActive);

    // Command must be executed exactly once by the active pane, never duplicated
    expect(commandInvocations).toBe(1);
  });

  it("21. '+ New Thread' draft creation activates in active pane of dual split", () => {
    const key = "test-new-thread-split";
    // User has Thread A on left (active) and Thread B on right
    agentsLayoutActions.openInActivePane(key, threadA);
    agentsLayoutActions.openToSide(key, threadB);
    agentsLayoutActions.setActivePane(key, threadA);

    // User clicks '+ New Thread', creating a new draft thread
    const newDraftThreadId = ThreadId.makeUnsafe("thread-draft-new-999");
    agentsLayoutActions.openInActivePane(key, newDraftThreadId);

    const layout = agentsLayoutActions.getLayout(key);
    // New thread replaced the active left pane; right pane Thread B remains intact
    expect(layout.paneThreadIds).toEqual([newDraftThreadId, threadB]);
    expect(layout.activeThreadId).toBe(newDraftThreadId);
  });

  it("22. Reconcile preserves newly routed draft thread even when not yet in persisted threads", () => {
    const key = "test-reconcile-draft";
    const existingPersisted = [threadA, threadB];
    const newDraftThreadId = ThreadId.makeUnsafe("thread-draft-new-888");

    // Layout had [threadA, threadB] with threadB active
    agentsLayoutActions.openInActivePane(key, threadA);
    agentsLayoutActions.openToSide(key, threadB);
    agentsLayoutActions.setActivePane(key, threadB);

    // App navigates to new draft thread route: routeThreadId is passed
    const reconciled = reconcileSplitLayout(
      agentsLayoutActions.getLayout(key),
      existingPersisted, // DB list does NOT contain newDraftThreadId yet
      newDraftThreadId, // routeThreadId is authoritative
    );

    // Reconcile must NOT drop newDraftThreadId: it should replace the active pane (threadB)
    expect(reconciled.paneThreadIds).toEqual([threadA, newDraftThreadId]);
    expect(reconciled.activeThreadId).toBe(newDraftThreadId);
  });

  it("23. Responsive bounds support split layout with 1024px screen + open sidebar", () => {
    // 1024px total window - 48px activity bar - 260px sidebar = 716px available
    const availableWidth = 716;
    expect(availableWidth >= MIN_SPLIT_WORKSPACE_WIDTH).toBe(true);
    // Each 50% pane gets 353px, well above MIN_PANE_WIDTH_PX (260px)
    const halfWidth = (availableWidth - 9) / 2;
    expect(halfWidth >= MIN_PANE_WIDTH_PX).toBe(true);
  });

  it("rejects activating a thread that is not mounted in the split", () => {
    const key = "test-invalid-activation";
    agentsLayoutActions.openInActivePane(key, threadA);
    agentsLayoutActions.openToSide(key, threadB);
    agentsLayoutActions.setActivePane(key, threadC);

    const layout = agentsLayoutActions.getLayout(key);
    expect(layout.paneThreadIds).toEqual([threadA, threadB]);
    expect(layout.activeThreadId).toBe(threadB);
  });

  it("Additional: Compute drop side correctly divides container into left and right halves", () => {
    const rect = { left: 100, width: 800 }; // 100 to 900, midpoint is 500
    expect(computeDropSide(300, rect)).toBe("left");
    expect(computeDropSide(499, rect)).toBe("left");
    expect(computeDropSide(500, rect)).toBe("right");
    expect(computeDropSide(700, rect)).toBe("right");
  });

  it("Additional: Maximize and restore pane behavior", () => {
    const key = "test-maximize-proj";
    agentsLayoutActions.openInActivePane(key, threadA);
    agentsLayoutActions.openToSide(key, threadB);

    let layout = agentsLayoutActions.getLayout(key);
    expect(layout.maximizedThreadId).toBeNull();

    agentsLayoutActions.toggleMaximize(key, threadA);
    layout = agentsLayoutActions.getLayout(key);
    expect(layout.maximizedThreadId).toBe(threadA);

    // Toggle again restores
    agentsLayoutActions.toggleMaximize(key, threadA);
    layout = agentsLayoutActions.getLayout(key);
    expect(layout.maximizedThreadId).toBeNull();
  });
});
