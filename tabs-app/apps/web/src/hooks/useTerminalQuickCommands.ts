import { useCallback, useMemo } from "react";
import type { TerminalQuickCommand } from "@tabs/contracts";
import { useSettings, useUpdateSettings } from "./useSettings";
import { useWorkspaceShellStore } from "../workspaceShellStore";
import { quickCommandsForProject } from "../lib/terminalQuickCommands";

const NO_COMMANDS: readonly TerminalQuickCommand[] = [];

/** The saved terminal commands and the ones that apply to the project in front. */
export function useTerminalQuickCommands() {
  const commands = useSettings((settings) => settings.terminalQuickCommands) ?? NO_COMMANDS;
  const activeProjectId = useWorkspaceShellStore((state) => state.session.activeProjectId);
  const { updateSettings } = useUpdateSettings();
  const visible = useMemo(
    () => quickCommandsForProject(commands, activeProjectId ?? null),
    [commands, activeProjectId],
  );
  const save = useCallback(
    (next: readonly TerminalQuickCommand[]) => updateSettings({ terminalQuickCommands: [...next] }),
    [updateSettings],
  );
  return { commands, visible, activeProjectId: activeProjectId ?? null, save };
}
