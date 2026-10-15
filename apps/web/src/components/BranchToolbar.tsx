import type { EnvironmentId, ThreadId } from "@tabs/contracts";
import { FolderIcon, GitForkIcon } from "lucide-react";
import { useCallback } from "react";

import { newCommandId } from "../lib/utils";
import { environmentApi } from "../connection/environmentApiRegistry";
import { composerDraftActions, useDraftThread } from "../state/composerDrafts";
import { setThreadBranchInAtoms } from "../state/readModel";
import { projectsAtom, threadsAtom } from "../state/threads";
import { useAtomValue } from "@effect/atom-react";
import {
  EnvMode,
  resolveDraftEnvModeAfterBranchChange,
  resolveEffectiveEnvMode,
} from "./BranchToolbar.logic";
import { BranchToolbarBranchSelector } from "./BranchToolbarBranchSelector";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { toastManager } from "./ui/toast";

const envModeItems = [
  { value: "local", label: "Local" },
  { value: "worktree", label: "New worktree" },
] as const;

interface BranchToolbarProps {
  threadId: ThreadId;
  environmentId?: EnvironmentId;
  onEnvModeChange: (mode: EnvMode) => void;
  envLocked: boolean;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest?: () => void;
}

export default function BranchToolbar({
  threadId,
  environmentId,
  onEnvModeChange,
  envLocked,
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
}: BranchToolbarProps) {
  const threads = useAtomValue(threadsAtom);
  const projects = useAtomValue(projectsAtom);
  const setThreadBranchAction = setThreadBranchInAtoms;
  const draftThread = useDraftThread(threadId);
  const setDraftThreadContext = composerDraftActions.setDraftThreadContext;

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

  const setThreadBranch = useCallback(
    async (branch: string | null, worktreePath: string | null) => {
      if (!activeThreadId) return;
      const api = await environmentApi(activeProject?.environmentId);

      // If the effective cwd is about to change, interrupt the active run first so the
      // next message creates a new session in the correct cwd.
      if (hasServerThread && worktreePath !== activeWorktreePath) {
        const activeRunId = serverThread?.activeRunId;
        if (activeRunId) {
          try {
            await api.orchestration.dispatchCommand({
              type: "run.interrupt",
              commandId: newCommandId(),
              threadId: activeThreadId,
              runId: activeRunId,
              holdQueue: true,
              reason: "Worktree switched",
            });
          } catch (err) {
            toastManager.add({
              type: "error",
              title: "Cannot switch worktree",
              description:
                err instanceof Error
                  ? err.message
                  : "Failed to stop active run before switching worktree.",
            });
            return;
          }
        }
      }

      if (hasServerThread) {
        try {
          await api.orchestration.dispatchCommand({
            type: "thread.metadata.update",
            commandId: newCommandId(),
            threadId: activeThreadId,
            branch,
            worktreePath,
          });
          setThreadBranchAction(activeThreadId, branch, worktreePath, environmentId);
        } catch (err) {
          toastManager.add({
            type: "error",
            title: "Cannot update branch metadata",
            description: err instanceof Error ? err.message : String(err),
          });
        }
        return;
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

  if (!activeThreadId || !activeProject) return null;

  return (
    <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 pb-3 pt-1">
      {envLocked || activeWorktreePath ? (
        <span className="inline-flex items-center gap-1 border border-transparent px-[calc(--spacing(3)-1px)] text-sm font-medium text-muted-foreground/70 sm:text-xs">
          {activeWorktreePath ? (
            <>
              <GitForkIcon className="size-3" />
              Worktree
            </>
          ) : (
            <>
              <FolderIcon className="size-3" />
              Local
            </>
          )}
        </span>
      ) : (
        <Select
          value={effectiveEnvMode}
          onValueChange={(value) => onEnvModeChange(value as EnvMode)}
          items={envModeItems}
        >
          <SelectTrigger variant="ghost" size="xs" className="font-medium">
            {effectiveEnvMode === "worktree" ? (
              <GitForkIcon className="size-3" />
            ) : (
              <FolderIcon className="size-3" />
            )}
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="local">
              <span className="inline-flex items-center gap-1.5">
                <FolderIcon className="size-3" />
                Local
              </span>
            </SelectItem>
            <SelectItem value="worktree">
              <span className="inline-flex items-center gap-1.5">
                <GitForkIcon className="size-3" />
                New worktree
              </span>
            </SelectItem>
          </SelectPopup>
        </Select>
      )}

      <BranchToolbarBranchSelector
        environmentId={activeProject.environmentId}
        activeProjectCwd={activeProject.cwd}
        activeThreadBranch={activeThreadBranch}
        activeWorktreePath={activeWorktreePath}
        branchCwd={branchCwd}
        effectiveEnvMode={effectiveEnvMode}
        envLocked={envLocked}
        onSetThreadBranch={setThreadBranch}
        {...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {})}
        {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
      />
    </div>
  );
}
