import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  GitBranchIcon,
  MessageSquareIcon,
  PanelBottomIcon,
  PanelLeftIcon,
  PlayIcon,
  SearchIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { CODE_CHROME_COMMANDS, deriveActiveFileName } from "@tabs/shared/codeChrome";

import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface CodeHeaderBarProps {
  workspaceName: string;
  activeFilePath: string | null;
  branch: string | null;
  panelMaximized: boolean;
  sideChatOpen: boolean | undefined;
  sideChatLabel: string;
  onToggleSideChat: () => void;
  onRunCommand: (commandId: string) => void;
}

function HeaderAction(props: {
  label: string;
  pressed?: boolean | undefined;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={props.label}
            aria-pressed={props.pressed}
            onClick={props.onClick}
            className={cn(
              "flex size-7 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-accent/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              props.pressed && "bg-accent text-foreground shadow-sm",
            )}
          >
            {props.children}
          </button>
        }
      />
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

/** Tabs-owned chrome above the native Code-OSS workbench. */
export function CodeHeaderBar(props: CodeHeaderBarProps) {
  const fileName = deriveActiveFileName(props.activeFilePath);
  return (
    <header
      aria-label="Code workspace toolbar"
      className="flex h-9 shrink-0 items-center gap-2 border-b border-border/70 bg-background/95 px-2.5"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-xs font-medium text-foreground">{props.workspaceName}</span>
        {fileName ? (
          <>
            <span aria-hidden="true" className="text-muted-foreground/50">
              /
            </span>
            <span className="truncate text-xs text-muted-foreground">{fileName}</span>
          </>
        ) : null}
      </div>

      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Quick open file search"
              onClick={() => props.onRunCommand(CODE_CHROME_COMMANDS.quickOpen)}
              className="flex h-7 w-[34rem] max-w-[55%] items-center gap-2 rounded-lg border border-border/70 bg-card/70 px-3 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <SearchIcon aria-hidden="true" className="size-3.5" />
              <span className="truncate">Go to file...</span>
            </button>
          }
        />
        <TooltipPopup side="bottom">Quick open file search</TooltipPopup>
      </Tooltip>

      <div
        role="toolbar"
        aria-label="Code layout and actions"
        className="flex flex-1 items-center justify-end gap-1"
      >
        {props.branch ? (
          <HeaderAction
            label={`Source Control, branch ${props.branch}`}
            onClick={() => props.onRunCommand("workbench.view.scm")}
          >
            <GitBranchIcon aria-hidden="true" className="size-4" />
          </HeaderAction>
        ) : null}
        <HeaderAction
          label="Run task"
          onClick={() => props.onRunCommand(CODE_CHROME_COMMANDS.runTask)}
        >
          <PlayIcon aria-hidden="true" className="size-4" />
        </HeaderAction>
        <HeaderAction
          label="Open settings"
          onClick={() => props.onRunCommand(CODE_CHROME_COMMANDS.settings)}
        >
          <SettingsIcon aria-hidden="true" className="size-4" />
        </HeaderAction>
        <span aria-hidden="true" className="mx-1 h-4 w-px bg-border/70" />
        <HeaderAction
          label="Toggle primary side bar"
          onClick={() => props.onRunCommand(CODE_CHROME_COMMANDS.toggleSidebar)}
        >
          <PanelLeftIcon aria-hidden="true" className="size-4" />
        </HeaderAction>
        <HeaderAction
          label="Toggle panel"
          onClick={() => props.onRunCommand(CODE_CHROME_COMMANDS.togglePanel)}
        >
          <PanelBottomIcon aria-hidden="true" className="size-4" />
        </HeaderAction>
        <HeaderAction
          label={props.panelMaximized ? "Restore panel" : "Maximize panel"}
          pressed={props.panelMaximized}
          onClick={() => props.onRunCommand(CODE_CHROME_COMMANDS.toggleMaximizedPanel)}
        >
          {props.panelMaximized ? (
            <ChevronsDownUpIcon aria-hidden="true" className="size-4" />
          ) : (
            <ChevronsUpDownIcon aria-hidden="true" className="size-4" />
          )}
        </HeaderAction>
        <HeaderAction
          label="Customize layout"
          onClick={() => props.onRunCommand(CODE_CHROME_COMMANDS.customizeLayout)}
        >
          <SlidersHorizontalIcon aria-hidden="true" className="size-4" />
        </HeaderAction>
        <HeaderAction
          label={props.sideChatLabel}
          pressed={props.sideChatOpen}
          onClick={props.onToggleSideChat}
        >
          <MessageSquareIcon aria-hidden="true" className="size-4" />
        </HeaderAction>
      </div>
    </header>
  );
}
