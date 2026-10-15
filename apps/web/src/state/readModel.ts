import type {
  EnvironmentId,
  OrchestrationReadModel,
  OrchestrationV2ShellStreamItem,
  OrchestrationV2ThreadProjection,
} from "@tabs/contracts";
import { Atom } from "@tabs/client-runtime/state";

import {
  type AppState,
  applyShellStreamItem,
  applyThreadProjection,
  markThreadUnread,
  markThreadVisited,
  reorderProjects,
  setError,
  setThreadBranch,
  setProjectExpanded,
  syncServerReadModel,
  toggleProject,
  persistAppState,
  readPersistedAppState,
} from "./readModelTransitions";
import type { Project } from "../types";
import type { ThreadId } from "@tabs/contracts";
import { appAtomRegistry } from "./atomRegistry";

const EMPTY_APP_STATE: AppState = readPersistedAppState();

/**
 * Transitional renderer state. Stages 2–5 split this into domain-specific
 * atoms; keeping this snapshot atom now makes inbound WebSocket delivery
 * visible to atom consumers without breaking the existing Zustand readers.
 */
export const readModelStateAtom = Atom.make(EMPTY_APP_STATE).pipe(
  Atom.withLabel("tabs-read-model-state"),
  Atom.keepAlive,
);

export function applyShellStreamItemToAtoms(
  item: OrchestrationV2ShellStreamItem,
  environmentId?: EnvironmentId,
) {
  appAtomRegistry.update(readModelStateAtom, (state) => {
    const next = applyShellStreamItem(state, item, environmentId);
    persistAppState(next);
    return next;
  });
  if (item.kind === "thread.updated") {
    void import("../composerDraftStore").then(({ clearPromotedDraftThreads }) =>
      clearPromotedDraftThreads(new Set([item.thread.id]), environmentId),
    );
  }
}

export function applyThreadProjectionToAtoms(
  projection: OrchestrationV2ThreadProjection,
  environmentId?: EnvironmentId,
) {
  appAtomRegistry.update(readModelStateAtom, (state) => {
    const next = applyThreadProjection(state, projection, environmentId);
    persistAppState(next);
    return next;
  });
}

export function syncServerReadModelToAtoms(
  readModel: OrchestrationReadModel,
  environmentId?: EnvironmentId,
) {
  appAtomRegistry.update(readModelStateAtom, (state) => {
    const next = syncServerReadModel(state, readModel, environmentId);
    persistAppState(next);
    return next;
  });
}

export function removeEnvironmentReadModelFromAtoms(environmentId: EnvironmentId) {
  appAtomRegistry.update(readModelStateAtom, (state) => {
    const nextSnapshots = { ...state.environmentSnapshots };
    delete nextSnapshots[environmentId as string];
    const next = {
      ...state,
      projects: state.projects.filter((project) => project.environmentId !== environmentId),
      threads: state.threads.filter((thread) => thread.environmentId !== environmentId),
      environmentSnapshots: nextSnapshots,
    };
    persistAppState(next);
    return next;
  });
}

export function markThreadUnreadInAtoms(threadId: ThreadId, environmentId?: EnvironmentId) {
  appAtomRegistry.update(readModelStateAtom, (state) =>
    markThreadUnread(state, threadId, environmentId),
  );
}

export function markThreadVisitedInAtoms(
  threadId: ThreadId,
  visitedAt?: string,
  environmentId?: EnvironmentId,
) {
  appAtomRegistry.update(readModelStateAtom, (state) =>
    markThreadVisited(state, threadId, visitedAt, environmentId),
  );
}

export function setThreadErrorInAtoms(
  threadId: ThreadId,
  error: string | null,
  environmentId?: EnvironmentId,
) {
  appAtomRegistry.update(readModelStateAtom, (state) =>
    setError(state, threadId, error, environmentId),
  );
}

export function setThreadBranchInAtoms(
  threadId: ThreadId,
  branch: string | null,
  worktreePath: string | null,
  environmentId?: EnvironmentId,
) {
  appAtomRegistry.update(readModelStateAtom, (state) =>
    setThreadBranch(state, threadId, branch, worktreePath, environmentId),
  );
}

export function setProjectExpandedInAtoms(
  projectId: Project["id"],
  expanded: boolean,
  environmentId?: EnvironmentId,
) {
  appAtomRegistry.update(readModelStateAtom, (state) =>
    setProjectExpanded(state, projectId, expanded, environmentId),
  );
}

export function toggleProjectInAtoms(projectId: Project["id"], environmentId?: EnvironmentId) {
  appAtomRegistry.update(readModelStateAtom, (state) =>
    toggleProject(state, projectId, environmentId),
  );
}

export function reorderProjectsInAtoms(
  draggedProjectId: Project["id"],
  targetProjectId: Project["id"],
  draggedEnvironmentId?: EnvironmentId,
  targetEnvironmentId?: EnvironmentId,
) {
  appAtomRegistry.update(readModelStateAtom, (state) =>
    reorderProjects(
      state,
      draggedProjectId,
      targetProjectId,
      draggedEnvironmentId,
      targetEnvironmentId,
    ),
  );
}
