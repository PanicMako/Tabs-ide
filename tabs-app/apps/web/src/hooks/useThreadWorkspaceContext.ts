import type { EnvironmentId, ThreadId } from "@tabs/contracts";
import { useCallback, useMemo } from "react";
import { useAtomValue } from "@effect/atom-react";
import { environmentApi } from "../connection/environmentApiRegistry";
import { newCommandId } from "../lib/utils";
import {
  composerDraftActions,
  createScopedComposerDraftActions,
  useDraftThread,
} from "../state/composerDrafts";
import { setThreadBranchInAtoms } from "../state/readModel";
import { projectsAtom, threadsAtom } from "../state/threads";
import {
  resolveDraftEnvModeAfterBranchChange,
  resolveEffectiveEnvMode,
} from "../components/BranchToolbar.logic";
import { toastManager } from "../components/ui/toast";

/** The card and composer share thread ownership, run interruption and workspace metadata writes. */
export function useThreadWorkspaceContext(threadId: ThreadId, environmentId?: EnvironmentId) {
  const threads = useAtomValue(threadsAtom);
  const projects = useAtomValue(projectsAtom);
  const setThreadBranchAction = setThreadBranchInAtoms;
  const draftThread = useDraftThread(threadId, environmentId);
  const { setDraftThreadContext } = useMemo(
    () => (environmentId ? createScopedComposerDraftActions(environmentId) : composerDraftActions),
    [environmentId],
  );

  const serverThread = threads.find(
    (thread) =>
      thread.id === threadId &&
      (environmentId === undefined || thread.environmentId === environmentId),
  );
  const activeProjectId = serverThread?.projectId ?? draftThread?.projectId ?? null;
  const activeProject = projects.find(
    (project) =>
      project.id === activeProjectId &&
      (environmentId === undefined || project.environmentId === environmentId),
  );
  const activeThreadId = serverThread?.id ?? (draftThread ? threadId : undefined);
  const activeThreadBranch = serverThread?.branch ?? draftThread?.branch ?? null;
  const activeWorktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const branchCwd = activeWorktreePath ?? activeProject?.cwd ?? null;
  const hasServerThread = serverThread !== undefined;
  const effectiveEnvMode = resolveEffectiveEnvMode({
    activeWorktreePath,
    hasServerThread,
    draftThreadEnvMode: draftThread?.envMode,
  });

  const prepareBranchChange = useCallback(async () => {
    if (!serverThread?.activeRunId || !activeThreadId) return true;
    try {
      const api = await environmentApi(activeProject?.environmentId);
      await api.orchestration.dispatchCommand({
        type: "run.interrupt",
        commandId: newCommandId(),
        threadId: activeThreadId,
        runId: serverThread.activeRunId,
        holdQueue: true,
        reason: "Branch or worktree switched",
      });
      return true;
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Cannot switch branch or worktree",
        description: error instanceof Error ? error.message : "Failed to stop the active run.",
      });
      return false;
    }
  }, [serverThread?.activeRunId, activeThreadId, activeProject?.environmentId]);

  const setThreadBranch = useCallback(
    async (branch: string | null, worktreePath: string | null) => {
      if (!activeThreadId) return false;
      if (hasServerThread) {
        try {
          const api = await environmentApi(activeProject?.environmentId);
          await api.orchestration.dispatchCommand({
            type: "thread.metadata.update",
            commandId: newCommandId(),
            threadId: activeThreadId,
            branch,
            worktreePath,
          });
          setThreadBranchAction(activeThreadId, branch, worktreePath, environmentId);
          return true;
        } catch (err) {
          toastManager.add({
            type: "error",
            title: "Cannot update branch metadata",
            description: err instanceof Error ? err.message : String(err),
          });
        }
        return false;
      }

      const nextDraftEnvMode = resolveDraftEnvModeAfterBranchChange({
        nextWorktreePath: worktreePath,
        currentWorktreePath: activeWorktreePath,
        effectiveEnvMode,
      });
      setDraftThreadContext(threadId, {
        branch,
        worktreePath,
        envMode: nextDraftEnvMode,
      });
      return true;
    },
    [
      activeProject?.environmentId,
      activeThreadId,
      activeWorktreePath,
      effectiveEnvMode,
      environmentId,
      hasServerThread,
      serverThread?.activeRunId,
      setDraftThreadContext,
      setThreadBranchAction,
      threadId,
    ],
  );

  return {
    projects,
    activeProject,
    activeThreadId,
    activeThreadBranch,
    activeWorktreePath,
    branchCwd,
    hasServerThread,
    effectiveEnvMode,
    prepareBranchChange,
    setThreadBranch,
  };
}
