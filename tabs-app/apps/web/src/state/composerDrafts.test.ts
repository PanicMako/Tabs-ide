import { beforeEach, describe, expect, it } from "vitest";
import { EnvironmentId, ProjectId, ThreadId } from "@tabs/contracts";

import { clearPromotedDraftThreads, useComposerDraftStore } from "../composerDraftStore";
import {
  createScopedComposerDraftActions,
  scopedComposerProjectId,
  scopedComposerThreadId,
} from "./composerDrafts";

const environmentA = EnvironmentId.makeUnsafe("environment-a");
const environmentB = EnvironmentId.makeUnsafe("environment-b");
const projectId = ProjectId.makeUnsafe("same-project");
const threadId = ThreadId.makeUnsafe("same-thread");

beforeEach(() => {
  useComposerDraftStore.setState({
    draftsByThreadId: {},
    draftThreadsByThreadId: {},
    projectDraftThreadIdByProjectId: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
  });
});

describe("scoped composer drafts", () => {
  it("isolates identical project and thread ids while returning semantic ids", () => {
    const actionsA = createScopedComposerDraftActions(environmentA);
    const actionsB = createScopedComposerDraftActions(environmentB);

    actionsA.setProjectDraftThreadId(projectId, threadId);
    actionsB.setProjectDraftThreadId(projectId, threadId);
    actionsA.setPrompt(threadId, "draft from A");
    actionsB.setPrompt(threadId, "draft from B");

    const state = useComposerDraftStore.getState();
    expect(state.draftsByThreadId[scopedComposerThreadId(environmentA, threadId)]?.prompt).toBe(
      "draft from A",
    );
    expect(state.draftsByThreadId[scopedComposerThreadId(environmentB, threadId)]?.prompt).toBe(
      "draft from B",
    );
    expect(
      state.projectDraftThreadIdByProjectId[scopedComposerProjectId(environmentA, projectId)],
    ).toBe(scopedComposerThreadId(environmentA, threadId));
    expect(actionsA.getDraftThreadByProjectId(projectId)).toMatchObject({
      projectId,
      threadId,
    });
  });

  it("claims a legacy unscoped draft without changing its semantic lookup", () => {
    useComposerDraftStore.getState().setProjectDraftThreadId(projectId, threadId);
    useComposerDraftStore.getState().setPrompt(threadId, "legacy draft");

    const actions = createScopedComposerDraftActions(environmentA);
    expect(actions.getDraftThread(threadId)?.projectId).toBe(projectId);
    actions.setPrompt(threadId, "migrated draft");

    expect(
      useComposerDraftStore.getState().draftsByThreadId[
        scopedComposerThreadId(environmentA, threadId)
      ]?.prompt,
    ).toBe("migrated draft");
  });

  it("clears promoted drafts only in the environment that produced the snapshot", () => {
    const actionsA = createScopedComposerDraftActions(environmentA);
    const actionsB = createScopedComposerDraftActions(environmentB);
    actionsA.setProjectDraftThreadId(projectId, threadId);
    actionsB.setProjectDraftThreadId(projectId, threadId);

    clearPromotedDraftThreads(new Set([threadId]), environmentA);

    const state = useComposerDraftStore.getState();
    expect(
      state.draftThreadsByThreadId[scopedComposerThreadId(environmentA, threadId)],
    ).toBeUndefined();
    expect(
      state.draftThreadsByThreadId[scopedComposerThreadId(environmentB, threadId)],
    ).toBeDefined();
  });
});
