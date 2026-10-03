import { useAtomValue } from "@effect/atom-react";
import type { ProjectId, ThreadId } from "@tabs/contracts";
import type { ProjectWorkspaceSettings as ProjectWorkspaceSettingsType } from "@tabs/contracts/settings";
import { Atom } from "@tabs/client-runtime/state";

import {
  createDefaultProjectWorkspaceSettings,
  resolveProjectTools,
  type WorkspaceShellPersistedState,
  useWorkspaceShellStore,
} from "../workspaceShellStore";
import { appAtomRegistry } from "./atomRegistry";

export const workspaceShellAtom = Atom.make<WorkspaceShellPersistedState>(
  useWorkspaceShellStore.getInitialState(),
).pipe(Atom.withLabel("tabs-workspace-shell"), Atom.keepAlive);

export function initializeWorkspaceShellState() {
  appAtomRegistry.set(workspaceShellAtom, useWorkspaceShellStore.getState());

  useWorkspaceShellStore.subscribe((state) => {
    appAtomRegistry.set(workspaceShellAtom, {
      session: state.session,
      projectSettingsByProjectId: state.projectSettingsByProjectId,
      browserStateByProjectId: state.browserStateByProjectId,
      browserStateBySessionKey: state.browserStateBySessionKey,
      browserUrlBySessionKey: state.browserUrlBySessionKey,
      codeStateByProjectId: state.codeStateByProjectId,
      codeChromeStateByProjectId: state.codeChromeStateByProjectId,
      gitStateByProjectId: state.gitStateByProjectId,
      serverStateByProjectId: state.serverStateByProjectId,
    });
  });
}

export function useWorkspaceShellState() {
  return useAtomValue(workspaceShellAtom);
}

export function useWorkspaceActiveProjectId(): ProjectId | null {
  return useAtomValue(workspaceShellAtom, (state) => state.session.activeProjectId);
}

export function useRememberedThreadId(projectId: ProjectId | null): ThreadId | null {
  return useAtomValue(workspaceShellAtom, (state) =>
    projectId ? (state.session.rememberedThreadIdByProjectId[projectId] ?? null) : null,
  );
}

export function useProjectWorkspaceSettings(
  projectId: ProjectId | null,
): ProjectWorkspaceSettingsType | null {
  return useAtomValue(workspaceShellAtom, (state) =>
    projectId
      ? (state.projectSettingsByProjectId[projectId] ?? createDefaultProjectWorkspaceSettings())
      : createDefaultProjectWorkspaceSettings(),
  );
}

export function useResolvedProjectTools(projectId: ProjectId | null) {
  return useAtomValue(workspaceShellAtom, (state) =>
    resolveProjectTools(
      projectId
        ? (state.projectSettingsByProjectId[projectId] ?? createDefaultProjectWorkspaceSettings())
        : createDefaultProjectWorkspaceSettings(),
    ),
  );
}

export const workspaceShellActions = {
  syncProjects: (
    ...args: Parameters<ReturnType<typeof useWorkspaceShellStore.getState>["syncProjects"]>
  ) => useWorkspaceShellStore.getState().syncProjects(...args),
  openProject: (
    ...args: Parameters<ReturnType<typeof useWorkspaceShellStore.getState>["openProject"]>
  ) => useWorkspaceShellStore.getState().openProject(...args),
  openProjectSurface: (
    ...args: Parameters<ReturnType<typeof useWorkspaceShellStore.getState>["openProjectSurface"]>
  ) => useWorkspaceShellStore.getState().openProjectSurface(...args),
  closeProject: (
    ...args: Parameters<ReturnType<typeof useWorkspaceShellStore.getState>["closeProject"]>
  ) => useWorkspaceShellStore.getState().closeProject(...args),
  setActiveProject: (
    ...args: Parameters<ReturnType<typeof useWorkspaceShellStore.getState>["setActiveProject"]>
  ) => useWorkspaceShellStore.getState().setActiveProject(...args),
  setActiveTool: (
    ...args: Parameters<ReturnType<typeof useWorkspaceShellStore.getState>["setActiveTool"]>
  ) => useWorkspaceShellStore.getState().setActiveTool(...args),
  setCodeFocusedPath: (
    ...args: Parameters<ReturnType<typeof useWorkspaceShellStore.getState>["setCodeFocusedPath"]>
  ) => useWorkspaceShellStore.getState().setCodeFocusedPath(...args),
  setCodeChromeState: (
    ...args: Parameters<ReturnType<typeof useWorkspaceShellStore.getState>["setCodeChromeState"]>
  ) => useWorkspaceShellStore.getState().setCodeChromeState(...args),
  rememberThread: (
    ...args: Parameters<ReturnType<typeof useWorkspaceShellStore.getState>["rememberThread"]>
  ) => useWorkspaceShellStore.getState().rememberThread(...args),
  upsertProjectSettings: (
    ...args: Parameters<ReturnType<typeof useWorkspaceShellStore.getState>["upsertProjectSettings"]>
  ) => useWorkspaceShellStore.getState().upsertProjectSettings(...args),
  openPendingTab: (
    ...args: Parameters<ReturnType<typeof useWorkspaceShellStore.getState>["openPendingTab"]>
  ) => useWorkspaceShellStore.getState().openPendingTab(...args),
  resolvePendingTab: (
    ...args: Parameters<ReturnType<typeof useWorkspaceShellStore.getState>["resolvePendingTab"]>
  ) => useWorkspaceShellStore.getState().resolvePendingTab(...args),
  closePendingTab: (
    ...args: Parameters<ReturnType<typeof useWorkspaceShellStore.getState>["closePendingTab"]>
  ) => useWorkspaceShellStore.getState().closePendingTab(...args),
  setSideChatOpen: (
    ...args: Parameters<ReturnType<typeof useWorkspaceShellStore.getState>["setSideChatOpen"]>
  ) => useWorkspaceShellStore.getState().setSideChatOpen(...args),
  setSideChatThread: (
    ...args: Parameters<ReturnType<typeof useWorkspaceShellStore.getState>["setSideChatThread"]>
  ) => useWorkspaceShellStore.getState().setSideChatThread(...args),
  setGitSelectedPath: (
    ...args: Parameters<ReturnType<typeof useWorkspaceShellStore.getState>["setGitSelectedPath"]>
  ) => useWorkspaceShellStore.getState().setGitSelectedPath(...args),
  setGitSelectedCommit: (
    ...args: Parameters<ReturnType<typeof useWorkspaceShellStore.getState>["setGitSelectedCommit"]>
  ) => useWorkspaceShellStore.getState().setGitSelectedCommit(...args),
  setBrowserCurrentUrl: (
    ...args: Parameters<ReturnType<typeof useWorkspaceShellStore.getState>["setBrowserCurrentUrl"]>
  ) => useWorkspaceShellStore.getState().setBrowserCurrentUrl(...args),
  setBrowserSessionUrl: (
    ...args: Parameters<ReturnType<typeof useWorkspaceShellStore.getState>["setBrowserSessionUrl"]>
  ) => useWorkspaceShellStore.getState().setBrowserSessionUrl(...args),
  setBrowserViewport: (
    ...args: Parameters<ReturnType<typeof useWorkspaceShellStore.getState>["setBrowserViewport"]>
  ) => useWorkspaceShellStore.getState().setBrowserViewport(...args),
  setBrowserChromeExpanded: (
    ...args: Parameters<
      ReturnType<typeof useWorkspaceShellStore.getState>["setBrowserChromeExpanded"]
    >
  ) => useWorkspaceShellStore.getState().setBrowserChromeExpanded(...args),
};
