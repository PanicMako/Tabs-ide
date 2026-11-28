// Adapted from Orca (MIT, (c) 2026 Lovecast Inc.) — src/shared/computer/computer-use-key-spec.ts and
// src/main/computer/action-contracts/computer-blocked-key-combos.ts (macOS rules only).

export type KeyModifier = "command" | "control" | "option" | "shift" | "super";

export interface ParsedKey {
  /** macOS virtual key code; Windows and Linux runtimes use `name` instead. */
  readonly keyCode: number;
  /** Canonical lower-case key name, such as `return`, `escape`, `f5` or `a`. */
  readonly name: string;
  readonly modifiers: ReadonlyArray<KeyModifier>;
  /** The normalized chord, for echoing back to the agent. */
  readonly label: string;
  /** Whether the chord can put text into a field (a printable key or paste), so it must not reach a secret field. */
  readonly insertsText: boolean;
}

export type KeyParseResult =
  | { readonly ok: true; readonly key: ParsedKey }
  | { readonly ok: false; readonly message: string };

const MAC_MODIFIERS: Readonly<Record<string, KeyModifier>> = {
  cmd: "command",
  command: "command",
  meta: "command",
  super: "command",
  win: "command",
  cmdorctrl: "command",
  commandorcontrol: "command",
  ctrl: "control",
  control: "control",
  alt: "option",
  option: "option",
  shift: "shift",
};

const OTHER_MODIFIERS: Readonly<Record<string, KeyModifier>> = {
  ctrl: "control",
  control: "control",
  cmdorctrl: "control",
  commandorcontrol: "control",
  cmd: "super",
  command: "super",
  meta: "super",
  super: "super",
  win: "super",
  alt: "option",
  option: "option",
  shift: "shift",
};

// ANSI layout virtual key codes.
const KEY_CODES: Readonly<Record<string, number>> = {
  a: 0,
  s: 1,
  d: 2,
  f: 3,
  h: 4,
  g: 5,
  z: 6,
  x: 7,
  c: 8,
  v: 9,
  b: 11,
  q: 12,
  w: 13,
  e: 14,
  r: 15,
  y: 16,
  t: 17,
  "1": 18,
  "2": 19,
  "3": 20,
  "4": 21,
  "6": 22,
  "5": 23,
  "=": 24,
  "9": 25,
  "7": 26,
  "-": 27,
  "8": 28,
  "0": 29,
  "]": 30,
  o: 31,
  u: 32,
  "[": 33,
  i: 34,
  p: 35,
  return: 36,
  l: 37,
  j: 38,
  "'": 39,
  k: 40,
  ";": 41,
  "\\": 42,
  ",": 43,
  "/": 44,
  n: 45,
  m: 46,
  ".": 47,
  tab: 48,
  space: 49,
  "`": 50,
  backspace: 51,
  escape: 53,
  forwarddelete: 117,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  left: 123,
  right: 124,
  down: 125,
  up: 126,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111,
};

const KEY_ALIASES: Readonly<Record<string, string>> = {
  enter: "return",
  esc: "escape",
  delete: "backspace",
  del: "forwarddelete",
  arrowleft: "left",
  arrowright: "right",
  arrowup: "up",
  arrowdown: "down",
  pgup: "pageup",
  pgdn: "pagedown",
  spacebar: "space",
};

const SINGLE_KEY_HINT =
  "press_key accepts one key only, e.g. Return, Escape, Tab, or +. Use a chord like Cmd+A with a modifier for shortcuts.";

function normalizeKeyName(raw: string, platform: NodeJS.Platform): string {
  const lower = raw.trim().toLowerCase();
  // macOS sends "Delete" as the backspace key; elsewhere it is the forward delete key.
  if (lower === "delete" && platform !== "darwin") return "forwarddelete";
  return KEY_ALIASES[lower] ?? lower;
}

/** Splits `Cmd+Shift+P` into modifiers and a final key; the lone key `+` is allowed. */
function splitChord(spec: string): { mods: string[]; key: string } | null {
  const trimmed = spec.trim();
  if (trimmed === "+") return { mods: [], key: "+" };
  if (trimmed.endsWith("++")) {
    // "Shift++" => modifiers [Shift], key "+"
    const mods = trimmed
      .slice(0, -2)
      .split("+")
      .map((part) => part.trim())
      .filter((part) => part !== "");
    return { mods, key: "+" };
  }
  const parts = trimmed.split("+").map((part) => part.trim());
  if (parts.some((part) => part === "")) return null;
  const key = parts.at(-1);
  return key === undefined ? null : { mods: parts.slice(0, -1), key };
}

/** Parses a key or chord into a key code, name and modifier list, without checking the blocklist. */
export function parseKeySpec(spec: string, platform: NodeJS.Platform = "darwin"): KeyParseResult {
  const chord = splitChord(spec);
  if (!chord) return { ok: false, message: "Key must look like Return or Cmd+Shift+P." };
  const modifiers: KeyModifier[] = [];
  const aliases = platform === "darwin" ? MAC_MODIFIERS : OTHER_MODIFIERS;
  for (const raw of chord.mods) {
    const modifier = aliases[raw.toLowerCase().replaceAll(/[\s_-]/g, "")];
    if (!modifier) {
      return { ok: false, message: `Unknown modifier '${raw}'. Use Cmd, Ctrl, Option or Shift.` };
    }
    if (!modifiers.includes(modifier)) modifiers.push(modifier);
  }
  let name = normalizeKeyName(chord.key, platform);
  if (name === "+") {
    name = "=";
    if (!modifiers.includes("shift")) modifiers.push("shift");
  }
  const keyCode = KEY_CODES[name];
  if (keyCode === undefined) {
    return {
      ok: false,
      message: `Unknown key '${chord.key}'. Use a letter, digit, Return, Tab, Escape, arrows or F1-F12.`,
    };
  }
  const chorded = modifiers.some((modifier) => modifier !== "shift" && modifier !== "option");
  const printable = name.length === 1 || name === "space";
  const pasteKey =
    modifiers.includes(platform === "darwin" ? "command" : "control") && name === "v";
  return {
    ok: true,
    key: {
      keyCode,
      name,
      modifiers,
      label: [...modifiers, name].join("+"),
      insertsText: chorded ? pasteKey : printable,
    },
  };
}

/** A key spec must not be empty. */
export function pressKeyValidationMessage(spec: string): string | null {
  return spec.trim().length === 0 ? SINGLE_KEY_HINT : null;
}

interface BlockedCombo {
  readonly modifiers: ReadonlyArray<KeyModifier>;
  readonly key: string;
  readonly effect: string;
}

// Most specific first so the error names what the combo would actually do. Extra modifiers still
// match: Cmd+Alt+Shift+Q logs out just like Cmd+Shift+Q.
const MAC_BLOCKED: ReadonlyArray<BlockedCombo> = [
  { modifiers: ["command"], key: "tab", effect: "switch apps" },
  { modifiers: ["command", "control"], key: "q", effect: "lock the screen" },
  { modifiers: ["command", "shift"], key: "q", effect: "log out of macOS" },
  { modifiers: ["command", "option"], key: "escape", effect: "open the Force Quit window" },
  { modifiers: ["command", "shift"], key: "backspace", effect: "empty the Trash" },
  { modifiers: ["command"], key: "q", effect: "quit the app" },
  { modifiers: ["command", "option"], key: "d", effect: "toggle the Dock" },
];

const WINDOWS_BLOCKED: ReadonlyArray<BlockedCombo> = [
  { modifiers: ["option"], key: "tab", effect: "switch windows" },
  { modifiers: ["option"], key: "f4", effect: "close the app" },
  { modifiers: ["super"], key: "l", effect: "lock Windows" },
  { modifiers: ["control", "shift"], key: "escape", effect: "open Task Manager" },
  { modifiers: ["control", "option"], key: "forwarddelete", effect: "open the security screen" },
];

const LINUX_BLOCKED: ReadonlyArray<BlockedCombo> = [
  { modifiers: ["option"], key: "tab", effect: "switch windows" },
  { modifiers: ["control", "option"], key: "forwarddelete", effect: "open the log out dialog" },
  { modifiers: ["control", "option"], key: "backspace", effect: "end the X session" },
  ...Array.from({ length: 12 }, (_, i) => ({
    modifiers: ["control", "option"] as const,
    key: `f${i + 1}`,
    effect: "switch to another virtual terminal",
  })),
  { modifiers: ["control", "option"], key: "l", effect: "lock the screen" },
  { modifiers: ["super"], key: "l", effect: "lock the screen" },
  { modifiers: ["option"], key: "f4", effect: "close the window" },
  { modifiers: ["control"], key: "q", effect: "quit the app" },
];

/** Returns what the chord would do if it is one that computer use must never send. */
export function blockedKeyEffect(
  key: ParsedKey,
  platform: NodeJS.Platform = "darwin",
): string | null {
  const rules =
    platform === "darwin" ? MAC_BLOCKED : platform === "win32" ? WINDOWS_BLOCKED : LINUX_BLOCKED;
  for (const rule of rules) {
    if (
      rule.key === key.name &&
      rule.modifiers.every((modifier) => key.modifiers.includes(modifier))
    ) {
      return rule.effect;
    }
  }
  return null;
}

/** Parses and applies the safety blocklist in one step. */
export function resolveKeySpec(spec: string, platform: NodeJS.Platform = "darwin"): KeyParseResult {
  const hint = pressKeyValidationMessage(spec);
  if (hint) return { ok: false, message: hint };
  const parsed = parseKeySpec(spec, platform);
  if (!parsed.ok) return parsed;
  const effect = blockedKeyEffect(parsed.key, platform);
  if (effect) {
    return {
      ok: false,
      message: `Refusing ${parsed.key.label}: it would ${effect}. Reach the goal with a button or menu item, or ask the user.`,
    };
  }
  return parsed;
}
