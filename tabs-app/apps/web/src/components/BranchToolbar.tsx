import { useThreadWorkspaceContext } from "../hooks/useThreadWorkspaceContext";
import type { EnvironmentId, ThreadId } from "@tabs/contracts";
import { FolderIcon, GitForkIcon } from "lucide-react";

import { EnvMode } from "./BranchToolbar.logic";
import { BranchToolbarBranchSelector } from "./BranchToolbarBranchSelector";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import type { Project } from "../types";
import { BranchToolbarEnvironmentSelector } from "./BranchToolbarEnvironmentSelector";

const envModeItems = [
  { value: "local", label: "Local" },
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
  const {
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
  } = useThreadWorkspaceContext(threadId, environmentId);
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
        onPrepareBranchChange={prepareBranchChange}
        {...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {})}
        {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
      />
    </div>
  );
}
