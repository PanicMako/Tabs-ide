import type { EnvironmentId, ThreadId } from "@tabs/contracts";
import { FolderIcon, GitForkIcon, GitPullRequestIcon } from "lucide-react";
import { useCheckoutPullRequest } from "../hooks/useCheckoutPullRequest";
import { useQuery } from "@tanstack/react-query";
import { gitStatusQueryOptions } from "../lib/gitReactQuery";
import { useCallback, useMemo } from "react";

import { newCommandId } from "../lib/utils";
import { environmentApi } from "../connection/environmentApiRegistry";
import {
  composerDraftActions,
  createScopedComposerDraftActions,
  useDraftThread,
} from "../state/composerDrafts";
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
import type { Project } from "../types";
import { BranchToolbarEnvironmentSelector } from "./BranchToolbarEnvironmentSelector";
import { toastManager } from "./ui/toast";
import { useCompanionSurfaceStore } from "../stores/companionSurfaceStore";
import { useRightPanelStore } from "../stores/rightPanelStore";

const envModeItems = [
  { value: "local", label: "Current checkout" },
  { value: "worktree", label: "New worktree" },
] as const;

interface BranchToolbarProps {
  threadId: ThreadId;
  environmentId?: EnvironmentId | undefined;
  onEnvModeChange: (mode: EnvMode) => void;
  envLocked: boolean;
  showGitControls?: boolean;
  showMachineSelector?: boolean;
  onMachineChange?: (project: Project) => Promise<void>;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest?: () => void;
}

export default function BranchToolbar({
  threadId,
  environmentId,
  onEnvModeChange,
  envLocked,
  showGitControls = true,
  showMachineSelector = true,
  onMachineChange,
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
}: BranchToolbarProps) {
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
  const status = useQuery(
    gitStatusQueryOptions(showGitControls ? branchCwd : null, activeProject?.environmentId),
  );
  const pullRequest = useCheckoutPullRequest(
    showGitControls ? branchCwd : null,
    status.data?.branch ?? null,
    activeProject?.environmentId,
  );
  const checkoutPr = pullRequest.data?.pullRequest ?? status.data?.pr;
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

  if (!activeThreadId || !activeProject) return null;

  if (!showGitControls)
    return showMachineSelector ? (
      <BranchToolbarEnvironmentSelector
        project={activeProject}
        projects={projects}
        locked={envLocked || hasServerThread}
        onChange={onMachineChange}
      />
    ) : null;

  return (
    <div
      data-chat-workspace-controls="true"
      className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 py-2"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {showMachineSelector ? (
          <BranchToolbarEnvironmentSelector
            project={activeProject}
            projects={projects}
            locked={envLocked || hasServerThread}
            onChange={onMachineChange}
          />
        ) : null}
        {showGitControls ? (
          envLocked || activeWorktreePath ? (
            <span className="inline-flex items-center gap-1 border border-transparent px-[calc(--spacing(3)-1px)] text-sm font-medium text-muted-foreground/70 sm:text-xs">
              {activeWorktreePath ? (
                <>
                  <GitForkIcon className="size-3" />
                  Worktree
                </>
              ) : (
                <>
                  <FolderIcon className="size-3" />
                  Current checkout
                </>
              )}
            </span>
          ) : (
            <Select
              value={effectiveEnvMode}
              onValueChange={(value) => onEnvModeChange(value as EnvMode)}
              items={envModeItems}
            >
              <SelectTrigger
                aria-label="Workspace mode"
                variant="ghost"
                size="xs"
                className="font-medium"
              >
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
                    Current checkout
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
          )
        ) : null}
      </div>

      {showGitControls ? (
        <div className="flex min-w-0 items-center gap-1">
          {checkoutPr && (
            <button
              type="button"
              title={checkoutPr.title}
              aria-label={`Open pull request #${checkoutPr.number}`}
              className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => {
                const url = checkoutPr?.url;
                if (!url) return;
                const scope = `${environmentId ?? activeProject.environmentId ?? "local"}:${threadId ?? activeProject.id ?? "projectless"}`;
                const workspace = useCompanionSurfaceStore.getState().workspaces[scope];
                const existingTab = workspace?.tabs.find(
                  (tab) => tab.kind === "browser" && tab.url === url,
                );
                if (existingTab) {
                  useCompanionSurfaceStore.getState().activate(scope, existingTab.id);
                } else {
                  useCompanionSurfaceStore.getState().open(scope, "browser", {
                    url,
                    title: checkoutPr.title
                      ? `PR #${checkoutPr.number}: ${checkoutPr.title}`
                      : `PR #${checkoutPr.number}`,
                  });
                }
                useRightPanelStore.getState().openPanel("browser");
              }}
            >
              <GitPullRequestIcon className="size-3" aria-hidden="true" />
              {checkoutPr.number}
            </button>
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
            onPrepareBranchChange={prepareBranchChange}
            {...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {})}
            {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
          />
        </div>
      ) : null}
    </div>
  );
}
