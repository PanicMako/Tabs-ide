import { PlusIcon, SettingsIcon, ZapIcon } from "lucide-react";
import { useCallback } from "react";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { openSettingsLayer } from "../../lib/settingsLayerStore";
import { quickCommandTitle } from "../../lib/terminalQuickCommands";
import { runTerminalQuickCommand } from "../../terminalQuickCommandRunner";
import type { TerminalQuickCommandTarget } from "../../terminalQuickCommandTarget";
import { useTerminalQuickCommands } from "../../hooks/useTerminalQuickCommands";
import type { TerminalQuickCommand } from "@tabs/contracts";

/** Reports a failed run the way every entry point does. */
export function reportQuickCommandFailure(command: TerminalQuickCommand, error: unknown): void {
  toastManager.add({
    type: "error",
    title: `Could not run ${quickCommandTitle(command)}`,
    description: error instanceof Error ? error.message : String(error),
  });
}

/** Saved commands for one terminal: choose one and it is typed into that terminal. */
export function TerminalQuickCommandsMenu({
  target,
  className,
}: {
  target: TerminalQuickCommandTarget;
  className?: string;
}) {
  const { visible } = useTerminalQuickCommands();
  const run = useCallback(
    (command: TerminalQuickCommand) => {
      void runTerminalQuickCommand(command, target).catch((error) =>
        reportQuickCommandFailure(command, error),
      );
    },
    [target],
  );
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              className={className}
              aria-label="Quick commands"
              data-testid="terminal-quick-commands-trigger"
            />
          }
        >
          <ZapIcon className="size-3.25" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Quick commands</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" className="max-h-80 min-w-60 max-w-80 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="px-3 py-3 text-center">
            <p className="text-sm text-foreground">No saved commands yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Save something like npm run dev and run it here in one click.
            </p>
          </div>
        ) : (
          visible.map((command) => (
            <MenuItem key={command.id} onClick={() => run(command)}>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{quickCommandTitle(command)}</span>
                {command.label.trim() ? (
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {command.command.split(/\r?\n/, 1)[0]}
                  </span>
                ) : null}
              </span>
            </MenuItem>
          ))
        )}
        <MenuSeparator />
        <MenuItem onClick={() => openSettingsLayer("terminal-commands")}>
          {visible.length === 0 ? <PlusIcon /> : <SettingsIcon />}
          {visible.length === 0 ? "Add your first command" : "Manage quick commands"}
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
