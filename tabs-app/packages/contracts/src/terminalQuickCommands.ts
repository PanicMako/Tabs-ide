// Adapted from Orca (MIT, (c) 2026 Lovecast Inc.) — src/shared/terminal/quick-commands/terminal-quick-command-types.ts
import * as Schema from "effect/Schema";

export const TERMINAL_QUICK_COMMAND_MAX_COUNT = 200;
export const TERMINAL_QUICK_COMMAND_MAX_LABEL_LENGTH = 80;
/** Terminal writes are capped at 65,536 characters; leave room for the cwd prefix and Enter. */
export const TERMINAL_QUICK_COMMAND_MAX_COMMAND_LENGTH = 16_000;
export const TERMINAL_QUICK_COMMAND_MAX_CWD_LENGTH = 1_024;

/** A command either shows everywhere (`global`) or only inside one project. */
export const TerminalQuickCommandScope = Schema.Union([
  Schema.Struct({ type: Schema.Literal("global") }),
  Schema.Struct({ type: Schema.Literal("project"), projectId: Schema.String }),
]);
export type TerminalQuickCommandScope = typeof TerminalQuickCommandScope.Type;

export const TerminalQuickCommand = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(128)),
  label: Schema.String.check(Schema.isMaxLength(TERMINAL_QUICK_COMMAND_MAX_LABEL_LENGTH)),
  command: Schema.String.check(Schema.isMaxLength(TERMINAL_QUICK_COMMAND_MAX_COMMAND_LENGTH)),
  /** Press Enter after typing the command. Off leaves it on the prompt for editing. */
  appendEnter: Schema.Boolean,
  scope: TerminalQuickCommandScope,
  /** Run from this directory (`cd` first); empty keeps the terminal's current one. */
  cwd: Schema.String.check(Schema.isMaxLength(TERMINAL_QUICK_COMMAND_MAX_CWD_LENGTH)),
});
export type TerminalQuickCommand = typeof TerminalQuickCommand.Type;

export const TerminalQuickCommands = Schema.Array(TerminalQuickCommand).check(
  Schema.isMaxLength(TERMINAL_QUICK_COMMAND_MAX_COUNT),
);
export type TerminalQuickCommands = typeof TerminalQuickCommands.Type;
