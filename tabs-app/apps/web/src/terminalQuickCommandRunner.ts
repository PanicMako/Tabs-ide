import { environmentApi } from "./connection/environmentApiRegistry";
import {
  activeTerminalQuickCommandTarget,
  type TerminalQuickCommandTarget,
} from "./terminalQuickCommandTarget";
import {
  shellLineForQuickCommand,
  terminalInputForQuickCommand,
  type TerminalQuickCommand,
} from "./lib/terminalQuickCommands";

export class NoActiveTerminalError extends Error {
  constructor() {
    super("Open a terminal first.");
  }
}

/** Types a saved command into a terminal (the active one by default). */
export async function runTerminalQuickCommand(
  command: Pick<TerminalQuickCommand, "command" | "appendEnter" | "cwd">,
  target: TerminalQuickCommandTarget | null = activeTerminalQuickCommandTarget(),
): Promise<void> {
  if (!target) throw new NoActiveTerminalError();
  const api = await environmentApi(target.environmentId);
  await api.terminal.write({
    threadId: target.threadId,
    terminalId: target.terminalId,
    data: terminalInputForQuickCommand(command),
  });
}

/**
 * Runs a saved command chosen from a launcher: in the active terminal when one
 * is open, otherwise `openTerminal` gets the command to run in a new terminal.
 */
export async function runTerminalQuickCommandById(
  commands: readonly TerminalQuickCommand[],
  id: string,
  openTerminal: (shellLine: string) => Promise<void>,
): Promise<void> {
  const command = commands.find((entry) => entry.id === id);
  if (!command) throw new Error("That command was deleted.");
  const target = activeTerminalQuickCommandTarget();
  if (target) return runTerminalQuickCommand(command, target);
  return openTerminal(shellLineForQuickCommand(command));
}
