import { type EditorId, type ResolvedKeybindingsConfig, type ThreadId } from "@tabs/contracts";
import { memo } from "react";
import { DiffIcon, Maximize2Icon, Minimize2Icon, TerminalSquareIcon, XIcon } from "lucide-react";
import GitActionsControl from "../GitActionsControl";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Toggle } from "../ui/toggle";
import { SidebarTrigger } from "../ui/sidebar";
import { OpenInPicker } from "./OpenInPicker";
import { cn } from "~/lib/utils";

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
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
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
  diffToggleShortcutLabel,
  gitCwd,
  environmentId,
  diffOpen,
  onToggleTerminal,
  onToggleDiff,
  isSplitActive = false,
  isActivePane = true,
  isMaximized = false,
  onToggleMaximize,
  onClosePane,
}: ChatHeaderProps) {
  const formattedProjectName = activeProjectName
    ? activeProjectName.toLowerCase().includes("tabs")
      ? "Tabs IDE"
      : activeProjectName
    : null;

  return (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
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
        {!isSplitActive && activeProjectName && (
          <OpenInPicker
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        )}
        {activeProjectName && (
          <div className={cn(isSplitActive && "hidden @[440px]/chat-header:flex")}>
            <GitActionsControl
              gitCwd={gitCwd}
              activeThreadId={activeThreadId}
              environmentId={environmentId}
            />
          </div>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="size-7 sm:size-7 rounded-lg border border-border/80 bg-background hover:bg-accent/40 hover:border-border text-foreground transition-colors shrink-0 p-0 shadow-2xs data-pressed:bg-accent data-pressed:text-accent-foreground data-pressed:border-border"
                pressed={terminalOpen}
                onPressedChange={onToggleTerminal}
                aria-label="Toggle terminal drawer"
                disabled={!terminalAvailable}
              >
                <TerminalSquareIcon className="size-3.5" />
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
                className="size-7 sm:size-7 rounded-lg border border-border/80 bg-background hover:bg-accent/40 hover:border-border text-foreground transition-colors shrink-0 p-0 shadow-2xs data-pressed:bg-accent data-pressed:text-accent-foreground data-pressed:border-border"
                pressed={diffOpen}
                onPressedChange={onToggleDiff}
                aria-label="Toggle diff panel"
                disabled={!isGitRepo}
              >
                <DiffIcon className="size-3.5" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!isGitRepo
              ? "Diff panel is unavailable because this project is not a git repository."
              : diffToggleShortcutLabel
                ? `Toggle diff panel (${diffToggleShortcutLabel})`
                : "Toggle diff panel"}
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
  );
});
