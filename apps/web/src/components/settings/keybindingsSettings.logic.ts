import {
  MAX_KEYBINDINGS_COUNT,
  type KeybindingCommand,
  type KeybindingRule,
  type KeybindingShortcut,
  type KeybindingWhenNode,
  type ResolvedKeybindingRule,
  type ResolvedKeybindingsConfig,
} from "@tabs/contracts";
import {
  DEFAULT_RESOLVED_KEYBINDINGS,
  parseKeybindingWhenExpression,
} from "@tabs/shared/keybindings";

import { shortcutKeyFromEvent } from "../../keybindings";
import { isMacPlatform } from "../../lib/utils";

export type KeybindingSource = "Default" | "Custom" | "Project";

export interface KeybindingRow {
  readonly id: string;
  readonly command: KeybindingCommand;
  readonly key: string;
  readonly when: string;
  readonly source: KeybindingSource;
  readonly defaultKey: string | null;
  readonly defaultWhen: string;
  readonly binding: ResolvedKeybindingRule;
  readonly conflicts: ReadonlyArray<string>;
}

export type WhenVariableOption = string;
export type KeybindingCommandOption = KeybindingCommand;

const CORE_WHEN_VARIABLES = [
  "terminalFocus",
  "terminalOpen",
  "shellChromeFocus",
  "true",
  "false",
] as const;

const DEFAULT_WHEN_VARIABLES = new Set<string>(CORE_WHEN_VARIABLES);
for (const binding of DEFAULT_RESOLVED_KEYBINDINGS) {
  collectWhenIdentifiersFromNode(binding.whenAst, DEFAULT_WHEN_VARIABLES);
}

export const DEFAULT_WHEN_VARIABLE =
  [...DEFAULT_WHEN_VARIABLES].find(
    (identifier) => identifier !== "true" && identifier !== "false",
  ) ?? "terminalFocus";
const KNOWN_WHEN_VARIABLES = new Set(DEFAULT_WHEN_VARIABLES);

export function shortcutToKeybindingInput(shortcut: KeybindingShortcut): string {
  const parts: string[] = [];
  if (shortcut.modKey) parts.push("mod");
  if (shortcut.metaKey) parts.push("meta");
  if (shortcut.ctrlKey) parts.push("ctrl");
  if (shortcut.altKey) parts.push("alt");
  if (shortcut.shiftKey) parts.push("shift");
  parts.push(shortcut.key === " " ? "space" : shortcut.key === "escape" ? "esc" : shortcut.key);
  return parts.join("+");
}

export function whenNodeRemoveLabel(node: KeybindingWhenNode, depth: number): string {
  if (depth === 0) return "Clear all conditions";
  if (node.type === "identifier" || (node.type === "not" && node.node.type === "identifier")) {
    return "Remove condition";
  }
  return "Remove group and its conditions";
}

export function whenAstToExpression(node: KeybindingWhenNode | undefined): string {
  if (!node) return "";
  switch (node.type) {
    case "identifier":
      return node.name;
    case "not":
      return `!${wrapWhenExpression(node.node)}`;
    case "and":
      return `${wrapWhenExpression(node.left)} && ${wrapWhenExpression(node.right)}`;
    case "or":
      return `${wrapWhenExpression(node.left)} || ${wrapWhenExpression(node.right)}`;
  }
}

function wrapWhenExpression(node: KeybindingWhenNode): string {
  if (node.type === "identifier" || node.type === "not") return whenAstToExpression(node);
  return `(${whenAstToExpression(node)})`;
}

export function parseWhenExpressionDraft(
  expression: string,
): { ok: true; value: KeybindingWhenNode | undefined } | { ok: false; message: string } {
  const trimmed = expression.trim();
  if (trimmed.length === 0) return { ok: true, value: undefined };

  const ast = parseKeybindingWhenExpression(trimmed);
  if (!ast) {
    return {
      ok: false,
      message: "Use variables with !, &&, ||, and parentheses.",
    };
  }

  return { ok: true, value: ast };
}

function sourceForBinding(binding: ResolvedKeybindingRule): KeybindingSource {
  if (String(binding.command).startsWith("script.")) {
    return "Project";
  }

  const bindingKey = shortcutToKeybindingInput(binding.shortcut);
  const bindingWhen = whenAstToExpression(binding.whenAst);
  const isDefault = DEFAULT_RESOLVED_KEYBINDINGS.some(
    (entry) =>
      entry.command === binding.command &&
      shortcutToKeybindingInput(entry.shortcut) === bindingKey &&
      whenAstToExpression(entry.whenAst) === bindingWhen,
  );

  return isDefault ? "Default" : "Custom";
}

function defaultBindingForBinding(
  binding: ResolvedKeybindingRule,
): ResolvedKeybindingRule | undefined {
  const bindingKey = shortcutToKeybindingInput(binding.shortcut);
  const bindingWhen = whenAstToExpression(binding.whenAst);

  return (
    DEFAULT_RESOLVED_KEYBINDINGS.find(
      (entry) =>
        entry.command === binding.command &&
        shortcutToKeybindingInput(entry.shortcut) === bindingKey &&
        whenAstToExpression(entry.whenAst) === bindingWhen,
    ) ??
    DEFAULT_RESOLVED_KEYBINDINGS.find(
      (entry) =>
        entry.command === binding.command && whenAstToExpression(entry.whenAst) === bindingWhen,
    ) ??
    DEFAULT_RESOLVED_KEYBINDINGS.find((entry) => entry.command === binding.command)
  );
}

function keybindingRowId(command: KeybindingCommand, key: string, when: string): string {
  return `${command}\u0000${key}\u0000${when}`;
}

function conflictsWithWhen(leftWhen: string, rightWhen: string): boolean {
  return leftWhen.length === 0 || rightWhen.length === 0 || leftWhen === rightWhen;
}

export function keybindingConflictLabels(
  rows: ReadonlyArray<KeybindingRow>,
  input: { readonly rowId: string; readonly key: string; readonly when: string },
): ReadonlyArray<string> {
  if (input.key.trim().length === 0) return [];
  const conflicts: Array<string> = [];
  for (const candidate of rows) {
    if (
      candidate.id !== input.rowId &&
      candidate.key === input.key &&
      conflictsWithWhen(candidate.when, input.when)
    ) {
      conflicts.push(commandLabel(candidate.command));
    }
  }
  return [...new Set(conflicts)].toSorted();
}

export function buildKeybindingRows(
  keybindings: ResolvedKeybindingsConfig,
  query: string,
): ReadonlyArray<KeybindingRow> {
  const normalizedQuery = query.trim().toLowerCase();
  const rows = keybindings.map((binding, index) => {
    const defaultBinding = defaultBindingForBinding(binding);
    const key = shortcutToKeybindingInput(binding.shortcut);
    const when = whenAstToExpression(binding.whenAst);
    return {
      id: `${keybindingRowId(binding.command, key, when)}\u0000${index}`,
      command: binding.command,
      key,
      when,
      source: sourceForBinding(binding),
      defaultKey: defaultBinding ? shortcutToKeybindingInput(defaultBinding.shortcut) : null,
      defaultWhen: whenAstToExpression(defaultBinding?.whenAst),
      binding,
      conflicts: [],
    } satisfies KeybindingRow;
  });

  const rowsWithConflicts = rows.map((row) => {
    const conflicts = keybindingConflictLabels(rows, {
      rowId: row.id,
      key: row.key,
      when: row.when,
    });
    return conflicts.length > 0
      ? Object.assign({}, row, { conflicts: [...new Set(conflicts)].toSorted() })
      : row;
  });

  rowsWithConflicts.sort((left, right) => {
    const commandCompare = left.command.localeCompare(right.command);
    if (commandCompare !== 0) return commandCompare;
    return left.key.localeCompare(right.key);
  });

  if (normalizedQuery.length === 0) {
    return rowsWithConflicts;
  }

  return rowsWithConflicts.filter((row) => {
    return (
      row.command.toLowerCase().includes(normalizedQuery) ||
      row.key.toLowerCase().includes(normalizedQuery) ||
      row.when.toLowerCase().includes(normalizedQuery) ||
      row.source.toLowerCase().includes(normalizedQuery)
    );
  });
}

function collectWhenIdentifiersFromNode(
  node: KeybindingWhenNode | undefined,
  identifiers: Set<string>,
): void {
  if (!node) return;
  switch (node.type) {
    case "identifier":
      identifiers.add(node.name);
      return;
    case "not":
      collectWhenIdentifiersFromNode(node.node, identifiers);
      return;
    case "and":
    case "or":
      collectWhenIdentifiersFromNode(node.left, identifiers);
      collectWhenIdentifiersFromNode(node.right, identifiers);
      return;
  }
}

export function isKnownWhenVariable(identifier: string): boolean {
  return KNOWN_WHEN_VARIABLES.has(identifier);
}

export function unknownWhenVariables(node: KeybindingWhenNode | undefined): ReadonlyArray<string> {
  const identifiers = new Set<string>();
  collectWhenIdentifiersFromNode(node, identifiers);
  return [...identifiers].filter((identifier) => !isKnownWhenVariable(identifier)).toSorted();
}

export function buildWhenVariableOptions(): ReadonlyArray<WhenVariableOption> {
  return [...KNOWN_WHEN_VARIABLES].toSorted((left, right) => {
    const leftCoreIndex = CORE_WHEN_VARIABLES.indexOf(left as (typeof CORE_WHEN_VARIABLES)[number]);
    const rightCoreIndex = CORE_WHEN_VARIABLES.indexOf(
      right as (typeof CORE_WHEN_VARIABLES)[number],
    );
    if (leftCoreIndex !== -1 || rightCoreIndex !== -1) {
      return (
        (leftCoreIndex === -1 ? Number.MAX_SAFE_INTEGER : leftCoreIndex) -
        (rightCoreIndex === -1 ? Number.MAX_SAFE_INTEGER : rightCoreIndex)
      );
    }
    return left.localeCompare(right);
  });
}

export function buildKeybindingCommandOptions(
  keybindings: ResolvedKeybindingsConfig,
): ReadonlyArray<KeybindingCommandOption> {
  const commands = new Set<KeybindingCommand>();
  for (const binding of DEFAULT_RESOLVED_KEYBINDINGS) {
    commands.add(binding.command);
  }
  for (const binding of keybindings) {
    commands.add(binding.command);
  }
  return [...commands].toSorted((left, right) =>
    commandLabel(left).localeCompare(commandLabel(right)),
  );
}

export function commandLabel(command: KeybindingCommand): string {
  const raw = String(command);
  if (raw === "editor.openFavorite") {
    return "Editor: Jump to Favorite";
  }
  if (raw.startsWith("script.") && raw.endsWith(".run")) {
    return `Run Script: ${titleCaseCommandSegment(raw.slice("script.".length, -".run".length))}`;
  }
  if (raw.startsWith("tool.")) {
    return `Toolbar Tools: ${raw.slice("tool.".length).split(".").map(titleCaseCommandSegment).join(": ")}`;
  }
  if (raw.startsWith("tab.")) {
    return `Project: ${raw.slice("tab.".length).split(".").map(titleCaseCommandSegment).join(": ")}`;
  }
  return raw.split(".").map(titleCaseCommandSegment).join(": ");
}

function titleCaseCommandSegment(segment: string): string {
  const words: Array<string> = [];
  for (const part of segment.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[-_\s]+/)) {
    if (part.length > 0) {
      words.push(part.slice(0, 1).toUpperCase() + part.slice(1));
    }
  }
  return words.join(" ");
}

export function normalizeShortcutKeyToken(key: string): string | null {
  const normalized = key.toLowerCase();
  if (
    normalized === "meta" ||
    normalized === "control" ||
    normalized === "ctrl" ||
    normalized === "shift" ||
    normalized === "alt" ||
    normalized === "option"
  ) {
    return null;
  }
  if (normalized === " ") return "space";
  if (normalized === "escape") return "esc";
  if (normalized === "arrowup") return "arrowup";
  if (normalized === "arrowdown") return "arrowdown";
  if (normalized === "arrowleft") return "arrowleft";
  if (normalized === "arrowright") return "arrowright";
  if (normalized.length === 1) return normalized;
  if (/^f\d{1,2}$/.test(normalized)) return normalized;
  if (normalized === "enter" || normalized === "tab" || normalized === "backspace") {
    return normalized;
  }
  if (normalized === "delete" || normalized === "home" || normalized === "end") {
    return normalized;
  }
  if (normalized === "pageup" || normalized === "pagedown") return normalized;
  return null;
}

export function keybindingFromKeyboardEvent(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"> & {
    readonly code?: string;
  },
  platform: string,
): string | null {
  const keyToken = normalizeShortcutKeyToken(shortcutKeyFromEvent(event));
  if (!keyToken) return null;

  const parts: string[] = [];
  if (isMacPlatform(platform)) {
    if (event.metaKey) parts.push("mod");
    if (event.ctrlKey) parts.push("ctrl");
  } else {
    if (event.ctrlKey) parts.push("mod");
    if (event.metaKey) parts.push("meta");
  }
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  parts.push(keyToken);
  return parts.join("+");
}

export interface KeybindingImportResult {
  readonly validRules: ReadonlyArray<KeybindingRule>;
  readonly skippedCommands: ReadonlyArray<string>;
  readonly totalParsed: number;
}

export const COMMON_IDE_COMMAND_MAP: Record<string, KeybindingCommand> = {
  "workbench.action.quickOpen": "commandPalette.toggle",
  "workbench.action.showCommands": "commandPalette.toggle",
  "workbench.action.toggleSidebarVisibility": "sidebar.toggle",
  "workbench.action.terminal.toggleTerminal": "terminal.toggle",
  "workbench.action.terminal.new": "terminal.new",
  "workbench.action.terminal.split": "terminal.split",
  "workbench.action.closeWindow": "window.close",
  "workbench.action.reloadWindow": "window.reload",
  "workbench.action.zoomIn": "zoom.in",
  "workbench.action.zoomOut": "zoom.out",
  "workbench.action.zoomReset": "zoom.reset",
  "workbench.action.openSettings": "window.settings",
  "workbench.action.nextEditor": "tab.next",
  "workbench.action.previousEditor": "tab.prev",
  "workbench.action.closeActiveEditor": "tab.close",
  "workbench.action.files.newUntitledFile": "tab.new",
  "chat.newChat": "chat.new",
  "chat.newLocalChat": "chat.newLocal",
};

function stripJsonComments(content: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  let index = 0;

  while (index < content.length) {
    const current = content[index]!;
    const next = content[index + 1];

    if (inString) {
      result += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === '"') {
        inString = false;
      }
      index++;
      continue;
    }

    if (current === '"') {
      inString = true;
      result += current;
      index++;
      continue;
    }

    if (current === "/" && next === "/") {
      result += "  ";
      index += 2;
      while (index < content.length && content[index] !== "\n" && content[index] !== "\r") {
        result += " ";
        index++;
      }
      continue;
    }

    if (current === "/" && next === "*") {
      result += "  ";
      index += 2;
      while (index < content.length) {
        if (content[index] === "*" && content[index + 1] === "/") {
          result += "  ";
          index += 2;
          break;
        }
        const commentCharacter = content[index]!;
        result += commentCharacter === "\n" || commentCharacter === "\r" ? commentCharacter : " ";
        index++;
      }
      continue;
    }

    result += current;
    index++;
  }

  return result;
}

export function parseAndValidateKeybindingImport(
  jsoncContent: string,
  knownCommandOptions?: ReadonlyArray<string>,
): KeybindingImportResult {
  const withoutComments = stripJsonComments(jsoncContent);
  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutComments);
  } catch {
    throw new Error("Invalid JSON format in keybindings file.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Expected an array of keybindings.");
  }
  if (parsed.length === 0) {
    throw new Error("The keybindings file is empty.");
  }

  // Structural validation upfront: ALL entries must be valid objects with non-empty string command and key
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Invalid keybinding entry at index ${i}: entry must be an object.`);
    }
    if (typeof (entry as any).command !== "string" || !(entry as any).command.trim()) {
      throw new Error(
        `Invalid keybinding entry at index ${i}: 'command' must be a non-empty string.`,
      );
    }
    if (typeof (entry as any).key !== "string" || !(entry as any).key.trim()) {
      throw new Error(`Invalid keybinding entry at index ${i}: 'key' must be a non-empty string.`);
    }
    if ((entry as any).when !== undefined && typeof (entry as any).when !== "string") {
      throw new Error(
        `Invalid keybinding entry at index ${i}: 'when' must be a string if provided.`,
      );
    }
  }

  const skippedCommands: string[] = [];
  const dedupedRulesMap = new Map<string, KeybindingRule>();

  for (const binding of parsed) {
    let cmd = binding.command.trim();
    if (COMMON_IDE_COMMAND_MAP[cmd]) {
      cmd = COMMON_IDE_COMMAND_MAP[cmd];
    } else if (knownCommandOptions && !knownCommandOptions.includes(cmd)) {
      skippedCommands.push(binding.command);
      continue;
    }

    const normalizedKey = binding.key
      .trim()
      .toLowerCase()
      .replace(/\bcmd\b/g, "meta");

    const rule: KeybindingRule = {
      command: cmd as KeybindingCommand,
      key: normalizedKey,
      ...(typeof binding.when === "string" && binding.when.trim()
        ? { when: binding.when.trim() }
        : {}),
    };

    // Deterministic duplicate behavior: later entry overrides earlier entry
    dedupedRulesMap.set(rule.command, rule);
  }

  const validRules = Array.from(dedupedRulesMap.values());
  if (validRules.length === 0) {
    throw new Error(
      `No supported keybinding commands found to import.${skippedCommands.length > 0 ? ` Skipped ${skippedCommands.length} unsupported command(s).` : ""}`,
    );
  }

  if (validRules.length > MAX_KEYBINDINGS_COUNT) {
    throw new Error(
      `The import contains ${validRules.length} valid keybindings, which exceeds the maximum allowed limit of ${MAX_KEYBINDINGS_COUNT} rules.`,
    );
  }

  return {
    validRules,
    skippedCommands,
    totalParsed: parsed.length,
  };
}
