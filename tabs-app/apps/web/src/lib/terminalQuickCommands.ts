// Adapted from Orca (MIT, (c) 2026 Lovecast Inc.) — src/shared/terminal/quick-commands/terminal-quick-commands.ts
import {
  TERMINAL_QUICK_COMMAND_MAX_COMMAND_LENGTH,
  TERMINAL_QUICK_COMMAND_MAX_COUNT,
  TERMINAL_QUICK_COMMAND_MAX_CWD_LENGTH,
  TERMINAL_QUICK_COMMAND_MAX_LABEL_LENGTH,
  type TerminalQuickCommand,
  type TerminalQuickCommandScope,
} from "@tabs/contracts";

export type { TerminalQuickCommand, TerminalQuickCommandScope };

/** What the editor works on: the same fields, always present. */
export interface TerminalQuickCommandDraft {
  id: string;
  label: string;
  command: string;
  appendEnter: boolean;
  scope: TerminalQuickCommandScope;
  cwd: string;
}

export const GLOBAL_SCOPE: TerminalQuickCommandScope = { type: "global" };

export function newTerminalQuickCommandDraft(
  id: string,
  scope: TerminalQuickCommandScope = GLOBAL_SCOPE,
): TerminalQuickCommandDraft {
  return { id, label: "", command: "", appendEnter: true, scope, cwd: "" };
}

/** A label to show when the user never named the command. */
export function quickCommandTitle(
  command: Pick<TerminalQuickCommand, "label" | "command">,
): string {
  const label = command.label.trim();
  if (label) return label;
  const firstLine = command.command.trim().split(/\r?\n/, 1)[0] ?? "";
  return firstLine.length > 40 ? `${firstLine.slice(0, 39)}…` : firstLine;
}

/** Why a draft cannot be saved yet, or null when it can. */
export function quickCommandProblem(draft: TerminalQuickCommandDraft): string | null {
  if (!draft.command.trim()) return "Enter a command to run.";
  if (draft.label.length > TERMINAL_QUICK_COMMAND_MAX_LABEL_LENGTH)
    return `Keep the name under ${TERMINAL_QUICK_COMMAND_MAX_LABEL_LENGTH} characters.`;
  if (draft.command.length > TERMINAL_QUICK_COMMAND_MAX_COMMAND_LENGTH)
    return "That command is too long.";
  if (draft.cwd.length > TERMINAL_QUICK_COMMAND_MAX_CWD_LENGTH) return "That folder is too long.";
  if (/[\r\n]/.test(draft.cwd)) return "The folder must be a single line.";
  if (draft.scope.type === "project" && !draft.scope.projectId) return "Choose a project.";
  return null;
}

export function quickCommandFromDraft(draft: TerminalQuickCommandDraft): TerminalQuickCommand {
  return {
    id: draft.id,
    label: draft.label.trim(),
    command: draft.command.replace(/\s+$/, ""),
    appendEnter: draft.appendEnter,
    scope: draft.scope,
    cwd: draft.cwd.trim(),
  };
}

/** Adds or replaces by id, keeping a replaced command where it was. */
export function upsertQuickCommand(
  commands: readonly TerminalQuickCommand[],
  next: TerminalQuickCommand,
): TerminalQuickCommand[] {
  const index = commands.findIndex((entry) => entry.id === next.id);
  if (index === -1) {
    if (commands.length >= TERMINAL_QUICK_COMMAND_MAX_COUNT) return [...commands];
    return [...commands, next];
  }
  return commands.map((entry, at) => (at === index ? next : entry));
}

export function removeQuickCommand(
  commands: readonly TerminalQuickCommand[],
  id: string,
): TerminalQuickCommand[] {
  return commands.filter((entry) => entry.id !== id);
}

/** Moves one command to `toIndex` in the full list. */
export function moveQuickCommand(
  commands: readonly TerminalQuickCommand[],
  id: string,
  toIndex: number,
): TerminalQuickCommand[] {
  const from = commands.findIndex((entry) => entry.id === id);
  if (from === -1) return [...commands];
  const target = Math.max(0, Math.min(toIndex, commands.length - 1));
  if (target === from) return [...commands];
  const next = [...commands];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved!);
  return next;
}

/**
 * Moves a command one place among those that share `visible` (a filtered view
 * of the full list), so reordering a filtered list never disturbs hidden ones.
 */
export function stepQuickCommand(
  commands: readonly TerminalQuickCommand[],
  visibleIds: readonly string[],
  id: string,
  direction: -1 | 1,
): TerminalQuickCommand[] {
  const at = visibleIds.indexOf(id);
  const neighbour = visibleIds[at + direction];
  if (at === -1 || neighbour === undefined) return [...commands];
  const neighbourIndex = commands.findIndex((entry) => entry.id === neighbour);
  return moveQuickCommand(commands, id, neighbourIndex);
}

export function isQuickCommandVisibleIn(
  command: TerminalQuickCommand,
  projectId: string | null,
): boolean {
  return (
    command.scope.type === "global" || (projectId !== null && command.scope.projectId === projectId)
  );
}

/** Global commands and the ones scoped to this project, in saved order. */
export function quickCommandsForProject(
  commands: readonly TerminalQuickCommand[],
  projectId: string | null,
): TerminalQuickCommand[] {
  return commands.filter((command) => isQuickCommandVisibleIn(command, projectId));
}

export function searchQuickCommands(
  commands: readonly TerminalQuickCommand[],
  query: string,
): TerminalQuickCommand[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...commands];
  return commands.filter((command) => {
    const haystack = `${command.label}\n${command.command}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

function isWindowsPath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

/** Quotes a folder so the shell reads it as one word. */
export function quoteShellPath(path: string): string {
  if (isWindowsPath(path)) return `"${path.replace(/"/g, "")}"`;
  if (path === "~") return path;
  if (path.startsWith("~/")) return `~/${singleQuote(path.slice(2))}`;
  return singleQuote(path);
}
function singleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The command as one shell line (or lines), with the `cd` prefix and no Enter. */
export function shellLineForQuickCommand(
  command: Pick<TerminalQuickCommand, "command" | "cwd">,
): string {
  const body = command.command.replace(/\s+$/, "").replace(/\r\n|\r/g, "\n");
  const cwd = command.cwd.trim();
  return cwd ? `cd ${quoteShellPath(cwd)} && ${body}` : body;
}

/**
 * The bytes typed into the terminal. Line breaks become carriage returns, the
 * way pressing Enter sends them, so a multi-line command runs line by line.
 */
export function terminalInputForQuickCommand(
  command: Pick<TerminalQuickCommand, "command" | "appendEnter" | "cwd">,
): string {
  const text = shellLineForQuickCommand(command).replace(/\n/g, "\r");
  return command.appendEnter ? `${text}\r` : text;
}

/** One-click starting points shown when nothing is saved yet. */
export const QUICK_COMMAND_TEMPLATES: ReadonlyArray<{ label: string; command: string }> = [
  { label: "Start dev server", command: "npm run dev" },
  { label: "Run tests", command: "npm test" },
  { label: "Git status", command: "git status" },
  { label: "Pull latest", command: "git pull --rebase" },
  { label: "Install dependencies", command: "npm install" },
];

/** A global command from one typed line; null when the line is blank. */
export function quickCommandFromLine(
  id: string,
  line: string,
  label = "",
): TerminalQuickCommand | null {
  const command = line.replace(/\s+$/, "");
  if (!command.trim()) return null;
  const draft = { ...newTerminalQuickCommandDraft(id), label, command };
  return quickCommandProblem(draft) ? null : quickCommandFromDraft(draft);
}
