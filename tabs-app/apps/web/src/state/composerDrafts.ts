import { useAtomValue } from "@effect/atom-react";
import { EnvironmentId, ProjectId, ThreadId } from "@tabs/contracts";
import { Atom } from "@tabs/client-runtime/state";
import { useMemo } from "react";

import {
  type ComposerThreadDraftState,
  type DraftThreadState,
  useComposerDraftStore,
} from "../composerDraftStore";
import { appAtomRegistry } from "./atomRegistry";

export interface ComposerDraftsState {
  readonly draftsByThreadId: Record<ThreadId, ComposerThreadDraftState>;
  readonly draftThreadsByThreadId: Record<ThreadId, DraftThreadState>;
}

const emptyDraft: ComposerThreadDraftState = {
  prompt: "",
  images: [],
  files: [],
  nonPersistedImageIds: [],
  persistedAttachments: [],
  terminalContexts: [],
  previewAnnotations: [],
  reviewComments: [],
  modelSelectionByProvider: {},
  activeProvider: null,
  runtimeMode: null,
  interactionMode: null,
};

export const composerDraftsAtom = Atom.make<ComposerDraftsState>({
  draftsByThreadId: {},
  draftThreadsByThreadId: {},
}).pipe(Atom.withLabel("tabs-composer-drafts"), Atom.keepAlive);

const SCOPE_SEPARATOR = "::";

export function scopedComposerThreadId(environmentId: EnvironmentId, threadId: ThreadId): ThreadId {
  return ThreadId.makeUnsafe(
    `${encodeURIComponent(environmentId)}${SCOPE_SEPARATOR}${encodeURIComponent(threadId)}`,
  );
}

export function scopedComposerProjectId(
  environmentId: EnvironmentId,
  projectId: ProjectId,
): ProjectId {
  return ProjectId.makeUnsafe(
    `${encodeURIComponent(environmentId)}${SCOPE_SEPARATOR}${encodeURIComponent(projectId)}`,
  );
}

function unscopedId(value: string): string {
  const separator = value.indexOf(SCOPE_SEPARATOR);
  if (separator < 0) return value;
  try {
    return decodeURIComponent(value.slice(separator + SCOPE_SEPARATOR.length));
  } catch {
    return value.slice(separator + SCOPE_SEPARATOR.length);
  }
}

function claimLegacyThread(environmentId: EnvironmentId, threadId: ThreadId): ThreadId {
  const scopedThreadId = scopedComposerThreadId(environmentId, threadId);
  const state = useComposerDraftStore.getState();
  if (
    state.draftsByThreadId[scopedThreadId] !== undefined ||
    state.draftThreadsByThreadId[scopedThreadId] !== undefined
  ) {
    return scopedThreadId;
  }
  const legacyDraft = state.draftsByThreadId[threadId];
  const legacyThread = state.draftThreadsByThreadId[threadId];
  if (!legacyDraft && !legacyThread) return scopedThreadId;
  const semanticProjectId = legacyThread?.projectId;
  const scopedProjectId = semanticProjectId
    ? scopedComposerProjectId(environmentId, semanticProjectId)
    : null;
  useComposerDraftStore.setState((current) => ({
    draftsByThreadId: legacyDraft
      ? { ...current.draftsByThreadId, [scopedThreadId]: legacyDraft }
      : current.draftsByThreadId,
    draftThreadsByThreadId: legacyThread
      ? {
          ...current.draftThreadsByThreadId,
          [scopedThreadId]: {
            ...legacyThread,
            ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
          },
        }
      : current.draftThreadsByThreadId,
    projectDraftThreadIdByProjectId:
      scopedProjectId && state.projectDraftThreadIdByProjectId[semanticProjectId!] === threadId
        ? {
            ...current.projectDraftThreadIdByProjectId,
            [scopedProjectId]: scopedThreadId,
          }
        : current.projectDraftThreadIdByProjectId,
  }));
  return scopedThreadId;
}

export function initializeComposerDraftsState() {
  appAtomRegistry.set(composerDraftsAtom, {
    draftsByThreadId: useComposerDraftStore.getState().draftsByThreadId,
    draftThreadsByThreadId: useComposerDraftStore.getState().draftThreadsByThreadId,
  });

  useComposerDraftStore.subscribe((state) => {
    appAtomRegistry.set(composerDraftsAtom, {
      draftsByThreadId: state.draftsByThreadId,
      draftThreadsByThreadId: state.draftThreadsByThreadId,
    });
  });
}

export function useComposerDraft(
  threadId: ThreadId,
  environmentId?: EnvironmentId | null,
): ComposerThreadDraftState {
  return useAtomValue(
    composerDraftsAtom,
    (state) =>
      (environmentId
        ? state.draftsByThreadId[scopedComposerThreadId(environmentId, threadId)]
        : undefined) ??
      state.draftsByThreadId[threadId] ??
      emptyDraft,
  );
}

export function useDraftThread(
  threadId: ThreadId | null,
  environmentId?: EnvironmentId | null,
): DraftThreadState | null {
  const draft = useAtomValue(composerDraftsAtom, (state) => {
    if (!threadId) return null;
    return (
      (environmentId
        ? state.draftThreadsByThreadId[scopedComposerThreadId(environmentId, threadId)]
        : undefined) ??
      state.draftThreadsByThreadId[threadId] ??
      null
    );
  });
  return useMemo(
    () =>
      draft ? { ...draft, projectId: ProjectId.makeUnsafe(unscopedId(draft.projectId)) } : null,
    [draft],
  );
}

export const composerDraftActions = {
  setStickyModelSelection: (
    ...args: Parameters<
      ReturnType<typeof useComposerDraftStore.getState>["setStickyModelSelection"]
    >
  ) => useComposerDraftStore.getState().setStickyModelSelection(...args),
  setPrompt: (
    ...args: Parameters<ReturnType<typeof useComposerDraftStore.getState>["setPrompt"]>
  ) => useComposerDraftStore.getState().setPrompt(...args),
  setModelSelection: (
    ...args: Parameters<ReturnType<typeof useComposerDraftStore.getState>["setModelSelection"]>
  ) => useComposerDraftStore.getState().setModelSelection(...args),
  setRuntimeMode: (
    ...args: Parameters<ReturnType<typeof useComposerDraftStore.getState>["setRuntimeMode"]>
  ) => useComposerDraftStore.getState().setRuntimeMode(...args),
  setInteractionMode: (
    ...args: Parameters<ReturnType<typeof useComposerDraftStore.getState>["setInteractionMode"]>
  ) => useComposerDraftStore.getState().setInteractionMode(...args),
  addImage: (...args: Parameters<ReturnType<typeof useComposerDraftStore.getState>["addImage"]>) =>
    useComposerDraftStore.getState().addImage(...args),
  addImages: (
    ...args: Parameters<ReturnType<typeof useComposerDraftStore.getState>["addImages"]>
  ) => useComposerDraftStore.getState().addImages(...args),
  removeImage: (
    ...args: Parameters<ReturnType<typeof useComposerDraftStore.getState>["removeImage"]>
  ) => useComposerDraftStore.getState().removeImage(...args),
  addFiles: (...args: Parameters<ReturnType<typeof useComposerDraftStore.getState>["addFiles"]>) =>
    useComposerDraftStore.getState().addFiles(...args),
  removeFile: (
    ...args: Parameters<ReturnType<typeof useComposerDraftStore.getState>["removeFile"]>
  ) => useComposerDraftStore.getState().removeFile(...args),
  insertTerminalContext: (
    ...args: Parameters<ReturnType<typeof useComposerDraftStore.getState>["insertTerminalContext"]>
  ) => useComposerDraftStore.getState().insertTerminalContext(...args),
  addTerminalContexts: (
    ...args: Parameters<ReturnType<typeof useComposerDraftStore.getState>["addTerminalContexts"]>
  ) => useComposerDraftStore.getState().addTerminalContexts(...args),
  removeTerminalContext: (
    ...args: Parameters<ReturnType<typeof useComposerDraftStore.getState>["removeTerminalContext"]>
  ) => useComposerDraftStore.getState().removeTerminalContext(...args),
  setTerminalContexts: (
    ...args: Parameters<ReturnType<typeof useComposerDraftStore.getState>["setTerminalContexts"]>
  ) => useComposerDraftStore.getState().setTerminalContexts(...args),
  addPreviewAnnotation: (
    ...args: Parameters<ReturnType<typeof useComposerDraftStore.getState>["addPreviewAnnotation"]>
  ) => useComposerDraftStore.getState().addPreviewAnnotation(...args),
  setPreviewAnnotations: (
    ...args: Parameters<ReturnType<typeof useComposerDraftStore.getState>["setPreviewAnnotations"]>
  ) => useComposerDraftStore.getState().setPreviewAnnotations(...args),
  removePreviewAnnotation: (
    ...args: Parameters<
      ReturnType<typeof useComposerDraftStore.getState>["removePreviewAnnotation"]
    >
  ) => useComposerDraftStore.getState().removePreviewAnnotation(...args),
  addReviewComment: (
    ...args: Parameters<ReturnType<typeof useComposerDraftStore.getState>["addReviewComment"]>
  ) => useComposerDraftStore.getState().addReviewComment(...args),
  setReviewComments: (
    ...args: Parameters<ReturnType<typeof useComposerDraftStore.getState>["setReviewComments"]>
  ) => useComposerDraftStore.getState().setReviewComments(...args),
  removeReviewComment: (
    ...args: Parameters<ReturnType<typeof useComposerDraftStore.getState>["removeReviewComment"]>
  ) => useComposerDraftStore.getState().removeReviewComment(...args),
  clearPersistedAttachments: (
    ...args: Parameters<
      ReturnType<typeof useComposerDraftStore.getState>["clearPersistedAttachments"]
    >
  ) => useComposerDraftStore.getState().clearPersistedAttachments(...args),
  syncPersistedAttachments: (
    ...args: Parameters<
      ReturnType<typeof useComposerDraftStore.getState>["syncPersistedAttachments"]
    >
  ) => useComposerDraftStore.getState().syncPersistedAttachments(...args),
  clearComposerContent: (
    ...args: Parameters<ReturnType<typeof useComposerDraftStore.getState>["clearComposerContent"]>
  ) => useComposerDraftStore.getState().clearComposerContent(...args),
  setDraftThreadContext: (
    ...args: Parameters<ReturnType<typeof useComposerDraftStore.getState>["setDraftThreadContext"]>
  ) => useComposerDraftStore.getState().setDraftThreadContext(...args),
  getDraftThreadByProjectId: (
    ...args: Parameters<
      ReturnType<typeof useComposerDraftStore.getState>["getDraftThreadByProjectId"]
    >
  ) => useComposerDraftStore.getState().getDraftThreadByProjectId(...args),
  getDraftThread: (
    ...args: Parameters<ReturnType<typeof useComposerDraftStore.getState>["getDraftThread"]>
  ) => useComposerDraftStore.getState().getDraftThread(...args),
  setProjectDraftThreadId: (
    ...args: Parameters<
      ReturnType<typeof useComposerDraftStore.getState>["setProjectDraftThreadId"]
    >
  ) => useComposerDraftStore.getState().setProjectDraftThreadId(...args),
  clearProjectDraftThreadId: (
    ...args: Parameters<
      ReturnType<typeof useComposerDraftStore.getState>["clearProjectDraftThreadId"]
    >
  ) => useComposerDraftStore.getState().clearProjectDraftThreadId(...args),
  clearProjectDraftThreadById: (
    ...args: Parameters<
      ReturnType<typeof useComposerDraftStore.getState>["clearProjectDraftThreadById"]
    >
  ) => useComposerDraftStore.getState().clearProjectDraftThreadById(...args),
  clearDraftThread: (
    ...args: Parameters<ReturnType<typeof useComposerDraftStore.getState>["clearDraftThread"]>
  ) => useComposerDraftStore.getState().clearDraftThread(...args),
  setProviderModelOptions: (
    ...args: Parameters<
      ReturnType<typeof useComposerDraftStore.getState>["setProviderModelOptions"]
    >
  ) => useComposerDraftStore.getState().setProviderModelOptions(...args),
  applyStickyState: (
    ...args: Parameters<ReturnType<typeof useComposerDraftStore.getState>["applyStickyState"]>
  ) => useComposerDraftStore.getState().applyStickyState(...args),
};

function claimLegacyProject(environmentId: EnvironmentId, projectId: ProjectId): ProjectId {
  const scopedProjectId = scopedComposerProjectId(environmentId, projectId);
  const state = useComposerDraftStore.getState();
  if (state.projectDraftThreadIdByProjectId[scopedProjectId]) return scopedProjectId;
  const legacyThreadId = state.projectDraftThreadIdByProjectId[projectId];
  if (legacyThreadId) claimLegacyThread(environmentId, legacyThreadId);
  return scopedProjectId;
}

const PROJECT_FIRST_ACTIONS = new Set(["getDraftThreadByProjectId", "clearProjectDraftThreadId"]);
const PROJECT_AND_THREAD_ACTIONS = new Set([
  "setProjectDraftThreadId",
  "clearProjectDraftThreadById",
]);
const PASSTHROUGH_ACTIONS = new Set(["setStickyModelSelection"]);

/**
 * Preserve semantic IDs at the UI boundary while isolating persisted composer state by
 * environment. Legacy unscoped entries are copied on first access so an upgrade does not discard
 * an in-progress draft; subsequent writes target only the scoped identity.
 */
export function createScopedComposerDraftActions(
  environmentId: EnvironmentId,
): typeof composerDraftActions {
  return new Proxy(composerDraftActions, {
    get(target, property, receiver) {
      const action = Reflect.get(target, property, receiver);
      if (typeof action !== "function" || typeof property !== "string") return action;
      if (PASSTHROUGH_ACTIONS.has(property)) return action;
      if (property === "getDraftThread") {
        return (threadId: ThreadId) => {
          const state = useComposerDraftStore.getState();
          const result =
            state.draftThreadsByThreadId[scopedComposerThreadId(environmentId, threadId)] ??
            state.draftThreadsByThreadId[threadId] ??
            null;
          return result
            ? { ...result, projectId: ProjectId.makeUnsafe(unscopedId(result.projectId)) }
            : null;
        };
      }
      if (property === "getDraftThreadByProjectId") {
        return (projectId: ProjectId) => {
          const state = useComposerDraftStore.getState();
          const scopedProjectId = scopedComposerProjectId(environmentId, projectId);
          const storedThreadId =
            state.projectDraftThreadIdByProjectId[scopedProjectId] ??
            state.projectDraftThreadIdByProjectId[projectId];
          if (!storedThreadId) return null;
          const result = state.draftThreadsByThreadId[storedThreadId];
          return result
            ? {
                ...result,
                threadId: ThreadId.makeUnsafe(unscopedId(storedThreadId)),
                projectId,
              }
            : null;
        };
      }
      return (...rawArgs: unknown[]) => {
        const args = [...rawArgs];
        if (PROJECT_FIRST_ACTIONS.has(property)) {
          const projectId = args[0] as ProjectId;
          const scopedProjectId = claimLegacyProject(environmentId, projectId);
          args[0] = scopedProjectId;
        } else if (PROJECT_AND_THREAD_ACTIONS.has(property)) {
          args[0] = claimLegacyProject(environmentId, args[0] as ProjectId);
          args[1] = claimLegacyThread(environmentId, args[1] as ThreadId);
        } else {
          const semanticThreadId = args[0] as ThreadId;
          const scopedThreadId = claimLegacyThread(environmentId, semanticThreadId);
          args[0] = scopedThreadId;
          if (property === "setDraftThreadContext") {
            const options = args[1] as { projectId?: ProjectId } | undefined;
            if (options?.projectId) {
              args[1] = {
                ...options,
                projectId: claimLegacyProject(environmentId, options.projectId),
              };
            }
          }
        }
        return action(...args);
      };
    },
  }) as typeof composerDraftActions;
}
