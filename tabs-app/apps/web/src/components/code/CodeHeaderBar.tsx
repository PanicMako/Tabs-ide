import { SearchIcon, EllipsisIcon, TerminalSquareIcon, PanelLeftCloseIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CODE_CHROME_COMMANDS, deriveActiveFileName } from "@tabs/shared/codeChrome";

import { AssistantBubbleIcon } from "../AssistantBubbleIcon";
import { cn, isMacPlatform } from "../../lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import "./code-workspace.css";

interface CodeHeaderBarProps {
  modalOpen?: boolean;
  workspaceName: string;
  activeFilePath: string | null;
  branch: string | null;
  panelOpen: boolean;
  panelMaximized: boolean;
  sideChatOpen: boolean | undefined;
  sideChatLabel: string;
  onToggleSideChat: () => void;
  onRunCommand: (commandId: string) => void;
  onMenuOpenChange: (open: boolean) => Promise<void>;
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
            className={cn("code-chrome-action", props.pressed && "is-active")}
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
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      // Native editor key events stay in Code-OSS. Forward the same shortcuts
      // when focus is on Tabs chrome, before the app-wide palette handles them.
      if (event.defaultPrevented || headerRef.current?.closest("[inert]")) return;
      const primaryModifier = isMacPlatform(navigator.platform)
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
      if (!primaryModifier || event.altKey || event.key.toLowerCase() !== "p") return;
      event.preventDefault();
      event.stopPropagation();
      props.onRunCommand(
        event.shiftKey ? CODE_CHROME_COMMANDS.commandPalette : CODE_CHROME_COMMANDS.quickOpen,
      );
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [props.onRunCommand]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuOpening, setMenuOpening] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const shortcut = isMacPlatform(navigator.platform) ? "⌘P" : "Ctrl+P";
  return (
    <header
      ref={headerRef}
      inert={props.modalOpen}
      aria-label="Code workspace toolbar"
      className="code-command-strip"
    >
      <div
        className="code-current-file"
        role="group"
        aria-label="Current file"
        title={props.activeFilePath ?? props.workspaceName}
      >
        <span className="code-current-project">{props.workspaceName}</span>
        {props.activeFilePath ? (
          <>
            <span aria-hidden="true" className="code-path-separator">
              /
            </span>
            <span className="code-current-filename">
              {deriveActiveFileName(props.activeFilePath)}
            </span>
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
              className="code-quick-open"
            >
              <SearchIcon aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">Search files…</span>
              <kbd aria-hidden="true">{shortcut}</kbd>
            </button>
          }
        />
        <TooltipPopup side="bottom">Go to file ({shortcut})</TooltipPopup>
      </Tooltip>

      <div role="toolbar" aria-label="Code layout and actions" className="code-command-actions">
        <HeaderAction
          label="Toggle primary side bar"
          onClick={() => props.onRunCommand(CODE_CHROME_COMMANDS.toggleSidebar)}
        >
          <PanelLeftCloseIcon aria-hidden="true" className="size-[18px]" />
        </HeaderAction>
        <HeaderAction
          label="Toggle panel"
          pressed={props.panelOpen}
          onClick={() => props.onRunCommand(CODE_CHROME_COMMANDS.togglePanel)}
        >
          <TerminalSquareIcon aria-hidden="true" className="size-[18px]" />
        </HeaderAction>
        <HeaderAction
          label={props.sideChatLabel}
          pressed={props.sideChatOpen}
          onClick={props.onToggleSideChat}
        >
          <AssistantBubbleIcon aria-hidden="true" className="size-[18px]" />
        </HeaderAction>
        <DropdownMenu
          open={menuOpen}
          onOpenChange={(open, details) => {
            if (!open) {
              setMenuOpen(false);
              // Reattaching the native workbench can restore its previous
              // focus. Return Escape to this control after that completes.
              void props.onMenuOpenChange(false).then(() => {
                if (details.reason === "escape-key") {
                  window.focus();
                  menuTriggerRef.current?.focus();
                }
              });
            } else if (!menuOpening) {
              setMenuOpening(true);
              void props.onMenuOpenChange(true).finally(() => {
                setMenuOpening(false);
                setMenuOpen(true);
              });
            }
          }}
        >
          <DropdownMenuTrigger
            ref={menuTriggerRef}
            aria-label="More Code actions"
            className="code-chrome-action"
          >
            <EllipsisIcon aria-hidden="true" className="size-[18px]" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="code-actions-menu w-56">
            <DropdownMenuItem
              onClick={() => props.onRunCommand(CODE_CHROME_COMMANDS.commandPalette)}
            >
              Command Palette
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => props.onRunCommand(CODE_CHROME_COMMANDS.runTask)}>
              Run Task
            </DropdownMenuItem>
            {props.branch ? (
              <DropdownMenuItem onClick={() => props.onRunCommand("workbench.view.scm")}>
                <span className="truncate">Source Control · {props.branch}</span>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => props.onRunCommand(CODE_CHROME_COMMANDS.toggleMaximizedPanel)}
            >
              {props.panelMaximized ? "Restore Panel" : "Maximize Panel"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => props.onRunCommand(CODE_CHROME_COMMANDS.customizeLayout)}
            >
              Customize Layout
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => props.onRunCommand(CODE_CHROME_COMMANDS.settings)}>
              Editor Settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
