import { useMemo } from "react";
import type { BrowserQuickAction, TerminalQuickCommand } from "@tabs/contracts";
import { useInstalledExtensions } from "../../state/extensions";
import { useTerminalQuickCommands } from "../../hooks/useTerminalQuickCommands";
import { quickCommandTitle } from "../../lib/terminalQuickCommands";
import type { CustomLauncherAction, LauncherExtraAction } from "./actions";
import { useWorkspaceShellStore } from "../../workspaceShellStore";
import { extensionLauncherActions } from "./extensionQuickActions";

export const TERMINAL_COMMAND_ACTION_PREFIX = "terminal-command:";

/** One launcher entry per saved command; choosing it types the command into a terminal. */
export function terminalQuickCommandLauncherActions(
  commands: readonly TerminalQuickCommand[],
): CustomLauncherAction[] {
  return commands.map((command) => ({
    id: `${TERMINAL_COMMAND_ACTION_PREFIX}${command.id}`,
    label: quickCommandTitle(command),
    detail: command.command.split(/\r?\n/, 1)[0] ?? "",
    group: "Custom" as const,
    icon: "terminal" as const,
    custom: { actionId: "terminal-quick-command" as const, query: command.id },
  }));
}

/** Everything the launcher adds beyond the built-ins, for the project in front. */
export function useLauncherExtraActions(): LauncherExtraAction[] {
  const installedExtensions = useInstalledExtensions();
  const { visible } = useTerminalQuickCommands();
  const browserActions = useWorkspaceShellStore((state) => {
    const projectId = state.session.activeProjectId;
    return projectId ? state.projectSettingsByProjectId[projectId]?.browserQuickActions : undefined;
  });
  return useMemo(
    () => [
      ...extensionLauncherActions(installedExtensions),
      ...terminalQuickCommandLauncherActions(visible),
      ...(browserActions ?? []).map(browserQuickActionLauncherEntry),
    ],
    [browserActions, installedExtensions, visible],
  );
}

function browserQuickActionLauncherEntry(action: BrowserQuickAction): CustomLauncherAction {
  return {
    id: `browser-quick-action:${action.id}`,
    label: action.label,
    detail: action.origin,
    group: "Custom",
    icon: "play",
    custom: { actionId: "browser-quick-action", query: action.id },
  };
}
