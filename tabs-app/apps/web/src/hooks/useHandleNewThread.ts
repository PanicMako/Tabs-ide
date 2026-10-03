import {
  DEFAULT_RUNTIME_MODE,
  type EnvironmentId,
  type ProjectId,
  ThreadId,
} from "@tabs/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback } from "react";
import { type DraftThreadEnvMode, type DraftThreadState } from "../composerDraftStore";
import { composerDraftActions, useDraftThread } from "../state/composerDrafts";
import { projectsAtom, threadsAtom } from "../state/threads";
import { useWorkspaceActiveProjectId, workspaceShellActions } from "../state/workspaceShell";
import { useAtomValue } from "@effect/atom-react";
import { newThreadId } from "../lib/utils";

export function useHandleNewThread() {
  const projects = useAtomValue(projectsAtom);
  const threads = useAtomValue(threadsAtom);
  const navigate = useNavigate();
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const routeEnvironmentId = useParams({
    strict: false,
    select: (params) => (params.environmentId as EnvironmentId | undefined) ?? null,
  });
  const activeDraftThread = useDraftThread(routeThreadId);

  const activeThread = routeThreadId
    ? threads.find(
        (thread) => thread.id === routeThreadId && thread.environmentId === routeEnvironmentId,
      )
    : undefined;

  const handleNewThread = useCallback(
    (
      projectId: ProjectId,
      options?: {
        branch?: string | null;
        worktreePath?: string | null;
        envMode?: DraftThreadEnvMode;
        environmentId?: EnvironmentId | undefined;
        // When true, create/select the draft thread WITHOUT navigating the app to
        // its `/$threadId` route. The Code-tab side chat uses this so starting a
        // new chat there stays in the Code tab instead of being thrown into the
        // Agents tab (a thread route force-switches the active tool to "agents").
        skipNavigation?: boolean;
      },
    ): Promise<ThreadId | null> => {
      const {
        clearProjectDraftThreadId,
        getDraftThread,
        getDraftThreadByProjectId,
        applyStickyState,
        setDraftThreadContext,
        setProjectDraftThreadId,
      } = composerDraftActions;
      const projectEnvironmentId =
        options?.environmentId ??
        projects.find((project) => project.id === projectId)?.environmentId;
      const hasBranchOption = options?.branch !== undefined;
      const hasWorktreePathOption = options?.worktreePath !== undefined;
      const hasEnvModeOption = options?.envMode !== undefined;
      const storedDraftThread = getDraftThreadByProjectId(projectId);
      const latestActiveDraftThread: DraftThreadState | null = routeThreadId
        ? getDraftThread(routeThreadId)
        : null;
      if (storedDraftThread) {
        workspaceShellActions.rememberThread(projectId, storedDraftThread.threadId);
        return (async () => {
          if (hasBranchOption || hasWorktreePathOption || hasEnvModeOption) {
            setDraftThreadContext(storedDraftThread.threadId, {
              ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
              ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
              ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
            });
          }
          setProjectDraftThreadId(projectId, storedDraftThread.threadId);
          if (options?.skipNavigation || routeThreadId === storedDraftThread.threadId) {
            return storedDraftThread.threadId;
          }
          if (projectEnvironmentId) {
            await navigate({
              to: "/$environmentId/$threadId",
              params: {
                environmentId: projectEnvironmentId,
                threadId: storedDraftThread.threadId,
              },
            });
          }
          return storedDraftThread.threadId;
        })();
      }

      clearProjectDraftThreadId(projectId);

      if (
        latestActiveDraftThread &&
        routeThreadId &&
        latestActiveDraftThread.projectId === projectId
      ) {
        workspaceShellActions.rememberThread(projectId, routeThreadId);
        if (hasBranchOption || hasWorktreePathOption || hasEnvModeOption) {
          setDraftThreadContext(routeThreadId, {
            ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
            ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
            ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
          });
        }
        setProjectDraftThreadId(projectId, routeThreadId);
        return Promise.resolve(routeThreadId);
      }

      const threadId = newThreadId();
      workspaceShellActions.rememberThread(projectId, threadId);
      const createdAt = new Date().toISOString();
      return (async () => {
        setProjectDraftThreadId(projectId, threadId, {
          createdAt,
          branch: options?.branch ?? null,
          worktreePath: options?.worktreePath ?? null,
          envMode: options?.envMode ?? "local",
          runtimeMode: DEFAULT_RUNTIME_MODE,
        });
        applyStickyState(threadId);

        if (options?.skipNavigation) {
          return threadId;
        }
        if (projectEnvironmentId) {
          await navigate({
            to: "/$environmentId/$threadId",
            params: { environmentId: projectEnvironmentId, threadId },
          });
        }
        return threadId;
      })();
    },
    [navigate, projects, routeThreadId],
  );

  return {
    activeDraftThread,
    activeThread,
    handleNewThread,
    projects,
    routeThreadId,
  };
}
