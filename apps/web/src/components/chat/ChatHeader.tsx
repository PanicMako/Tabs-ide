import { type EditorId, type ResolvedKeybindingsConfig, type ThreadId } from "@tabs/contracts";
import { memo, useState } from "react";
import {
  SquareMenuIcon,
  FolderIcon,
  GitBranchIcon,
  DiffIcon,
  Maximize2Icon,
  Minimize2Icon,
  PanelRightIcon,
  PanelBottomIcon,
  XIcon,
} from "lucide-react";
import GitActionsControl from "../GitActionsControl";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Toggle } from "../ui/toggle";
import { SidebarTrigger } from "../ui/sidebar";
import { OpenInPicker } from "./OpenInPicker";
import { useVcs } from "~/state/vcs";
import { cn } from "~/lib/utils";
import { useRightPanelStore } from "~/stores/rightPanelStore";

interface ChatHeaderProps {
  activeThreadId: ThreadId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  isGitRepo: boolean;
  openInCwd: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  diffToggleShortcutLabel: string | null;
  gitCwd: string | null;
  environmentId?: string | undefined;
  diffOpen: boolean;
  rightPanelOpen?: boolean | undefined;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
  onToggleRightPanel?: (() => void) | undefined;
  rightPanelShortcutLabel?: string | null | undefined;
  isSplitActive?: boolean | undefined;
  isActivePane?: boolean | undefined;
  isMaximized?: boolean | undefined;
  onToggleMaximize?: (() => void) | undefined;
  onClosePane?: (() => void) | undefined;
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadId,
  activeThreadTitle,
  activeProjectName,
  isGitRepo,
  openInCwd,
  keybindings,
  availableEditors,
  terminalAvailable,
  terminalOpen,
  terminalToggleShortcutLabel,
  gitCwd,
  environmentId,
  diffOpen,
  rightPanelOpen,
  onToggleTerminal,
  onToggleDiff,
  onToggleRightPanel,
  rightPanelShortcutLabel,
  isSplitActive = false,
  isActivePane = true,
  isMaximized = false,
  onToggleMaximize,
  onClosePane,
}: ChatHeaderProps) {
  const [workspaceOpen, setWorkspaceOpen] = useState(!isSplitActive);
  const vcs = useVcs(gitCwd, environmentId);
  const storeIsOpen = useRightPanelStore((s) => s.isOpen);
  const storeToggle = useRightPanelStore((s) => s.toggleOpen);
  const effectiveRightPanelOpen = rightPanelOpen ?? storeIsOpen;
  const handleToggleRightPanel = onToggleRightPanel ?? (() => storeToggle());

  const formattedProjectName = activeProjectName
    ? activeProjectName.toLowerCase().includes("tabs")
      ? "Tabs IDE"
      : activeProjectName
    : null;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <SidebarTrigger className="size-7 shrink-0 md:hidden" />
          {isSplitActive && (
            <span
              className={cn(
                "size-2 shrink-0 rounded-full transition-colors",
                isActivePane ? "bg-primary shadow-xs shadow-primary/40" : "bg-muted-foreground/30",
              )}
              title={isActivePane ? "Active thread pane" : "Inactive pane — click to activate"}
            />
          )}
          <h2
            className={cn(
              "min-w-0 truncate text-sm font-semibold tracking-tight",
              isSplitActive && !isActivePane
                ? "text-muted-foreground font-normal"
                : "text-foreground",
            )}
            title={activeThreadTitle}
          >
            {activeThreadTitle}
          </h2>
          {!isSplitActive && formattedProjectName && (
            <span
              className="hidden shrink-0 text-xs font-sans text-muted-foreground/50 sm:inline"
              title={activeProjectName}
            >
              · {formattedProjectName}
            </span>
          )}
          {!isSplitActive && !isGitRepo && activeProjectName && (
            <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
              No Git
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {activeProjectName && (
            <button
              type="button"
              aria-label="Toggle workspace card"
              aria-expanded={workspaceOpen}
              aria-controls={`workspace-card-${activeThreadId}`}
              onClick={() => setWorkspaceOpen((open) => !open)}
              className="surface-control flex size-9 items-center justify-center rounded-xl text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <SquareMenuIcon aria-hidden="true" className="size-4" />
            </button>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  className="size-9 rounded-lg border border-border/80 bg-background hover:bg-accent/40 hover:border-border text-foreground transition-colors shrink-0 p-0 shadow-2xs data-pressed:bg-accent data-pressed:text-accent-foreground data-pressed:border-border"
                  pressed={terminalOpen}
                  onPressedChange={onToggleTerminal}
                  aria-label="Toggle terminal drawer"
                  disabled={!terminalAvailable}
                >
                  <PanelBottomIcon className="size-4" />
                </Toggle>
              }
            />
            <TooltipPopup side="bottom">
              {!terminalAvailable
                ? "Terminal is unavailable until this thread has an active project."
                : terminalToggleShortcutLabel
                  ? `Toggle terminal drawer (${terminalToggleShortcutLabel})`
                  : "Toggle terminal drawer"}
            </TooltipPopup>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  className="size-9 rounded-lg border border-border/80 bg-background hover:bg-accent/40 hover:border-border text-foreground transition-colors shrink-0 p-0 shadow-2xs data-pressed:bg-accent data-pressed:text-accent-foreground data-pressed:border-border cursor-pointer"
                  pressed={effectiveRightPanelOpen}
                  onPressedChange={handleToggleRightPanel}
                  aria-label="Toggle companion side panel"
                >
                  <PanelRightIcon className="size-3.5" />
                </Toggle>
              }
            />
            <TooltipPopup side="bottom">
              {rightPanelShortcutLabel
                ? `Toggle companion side panel (${rightPanelShortcutLabel})`
                : "Toggle companion side panel (Browser, Files, Terminal, Diffs, PRs)"}
            </TooltipPopup>
          </Tooltip>

          {isSplitActive && (
            <div className="flex items-center gap-1 border-l border-border/60 pl-1.5 ml-0.5">
              {onToggleMaximize && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={isMaximized ? "Restore split layout" : "Maximize pane"}
                        onClick={onToggleMaximize}
                        className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                      >
                        {isMaximized ? (
                          <Minimize2Icon className="size-3.5" />
                        ) : (
                          <Maximize2Icon className="size-3.5" />
                        )}
                      </button>
                    }
                  />
                  <TooltipPopup side="bottom">
                    {isMaximized ? "Restore split layout" : "Maximize pane"}
                  </TooltipPopup>
                </Tooltip>
              )}
              {onClosePane && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={`Close ${activeThreadTitle}`}
                        onClick={onClosePane}
                        className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition-colors"
                      >
                        <XIcon className="size-3.5" />
                      </button>
                    }
                  />
                  <TooltipPopup side="bottom">Close pane</TooltipPopup>
                </Tooltip>
              )}
            </div>
          )}
        </div>
      </div>
      {activeProjectName && workspaceOpen && (
        <section
          id={`workspace-card-${activeThreadId}`}
          aria-label="Workspace actions"
          className="workspace-card my-3 ml-auto w-64 max-w-full rounded-[22px] border border-border/70 bg-background p-4 text-foreground [-webkit-app-region:no-drag]"
        >
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl border border-border/60 bg-muted/50">
              <FolderIcon aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="workspace-project truncate text-xl">{activeProjectName}</p>
              <p
                title={openInCwd ?? undefined}
                className="truncate font-mono text-[10px] text-muted-foreground"
              >
                {openInCwd ?? "Project path unavailable"}
              </p>
            </div>
          </div>
          <div className="workspace-editor mt-3 flex items-center">
            <OpenInPicker
              keybindings={keybindings}
              availableEditors={availableEditors}
              openInCwd={openInCwd}
              showEditorName
            />
          </div>
          <div className="my-3 h-px bg-border/60" />
          <div className="mb-3 flex items-center gap-2 text-xs">
            <GitBranchIcon aria-hidden="true" className="size-4 text-muted-foreground" />
            <span className="truncate">
              {!isGitRepo
                ? "No Git repository"
                : (vcs.status?.branch ?? (vcs.status ? "Detached HEAD" : "Reading branch…"))}
            </span>
          </div>
          <GitActionsControl
            gitCwd={gitCwd}
            activeThreadId={activeThreadId}
            environmentId={environmentId}
          />
          <button
            type="button"
            disabled={!isGitRepo}
            className="surface-control mt-3 flex h-10 w-full items-center gap-2 rounded-xl px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
            onClick={() => {
              if (!diffOpen) onToggleDiff();
            }}
          >
            <DiffIcon aria-hidden="true" className="size-4 text-muted-foreground" />
            <span className="flex-1 text-left">Changes</span>
            {vcs.status && (
              <span className="flex gap-2 font-mono tabular-nums">
                <span className="text-emerald-500">+{vcs.status.workingTree.insertions}</span>
                <span className="text-red-400">−{vcs.status.workingTree.deletions}</span>
              </span>
            )}
          </button>
          {vcs.error && (
            <p role="status" className="mt-2 text-xs text-muted-foreground">
              Git status is temporarily unavailable.
            </p>
          )}
        </section>
      )}
    </div>
  );
});
