import { DEFAULT_RESOLVED_KEYBINDINGS } from "@tabs/shared/keybindings";
import { assert, describe, it } from "vitest";

import {
  type KeybindingCommand,
  type KeybindingShortcut,
  type KeybindingWhenNode,
  type ResolvedKeybindingsConfig,
} from "@tabs/contracts";
import { agentControlRequestForCommand } from "./lib/agentControl";
import {
  formatShortcutLabel,
  isChatNewShortcut,
  isChatNewLocalShortcut,
  isDiffToggleShortcut,
  isOpenFavoriteEditorShortcut,
  isTerminalClearShortcut,
  isTerminalCloseShortcut,
  isTerminalNewShortcut,
  isTerminalSplitShortcut,
  isTerminalToggleShortcut,
  resolveShortcutCommand,
  shortcutLabelForCommand,
  terminalNavigationShortcutData,
  type ShortcutEventLike,
} from "./keybindings";

function event(overrides: Partial<ShortcutEventLike> = {}): ShortcutEventLike {
  return {
    key: "j",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

function modShortcut(
  key: string,
  overrides: Partial<Omit<KeybindingShortcut, "key">> = {},
): KeybindingShortcut {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    modKey: true,
    ...overrides,
  };
}

function whenIdentifier(name: string): KeybindingWhenNode {
  return { type: "identifier", name };
}

function whenNot(node: KeybindingWhenNode): KeybindingWhenNode {
  return { type: "not", node };
}

function whenAnd(left: KeybindingWhenNode, right: KeybindingWhenNode): KeybindingWhenNode {
  return { type: "and", left, right };
}

interface TestBinding {
  shortcut: KeybindingShortcut;
  command: KeybindingCommand;
  whenAst?: KeybindingWhenNode;
}

function compile(bindings: TestBinding[]): ResolvedKeybindingsConfig {
  return bindings.map((binding) => ({
    command: binding.command,
    shortcut: binding.shortcut,
    ...(binding.whenAst ? { whenAst: binding.whenAst } : {}),
  }));
}

const DEFAULT_BINDINGS = compile([
  { shortcut: modShortcut("j"), command: "terminal.toggle" },
  {
    shortcut: modShortcut("d"),
    command: "terminal.split",
    whenAst: whenIdentifier("terminalFocus"),
  },
  {
    shortcut: modShortcut("d", { shiftKey: true }),
    command: "terminal.new",
    whenAst: whenIdentifier("terminalFocus"),
  },
  {
    shortcut: modShortcut("w"),
    command: "terminal.close",
    whenAst: whenIdentifier("terminalFocus"),
  },
  {
    shortcut: modShortcut("d"),
    command: "diff.toggle",
    whenAst: whenNot(whenIdentifier("terminalFocus")),
  },
  { shortcut: modShortcut("o", { shiftKey: true }), command: "chat.new" },
  { shortcut: modShortcut("l", { shiftKey: true }), command: "chat.newLocal" },
  { shortcut: modShortcut("f", { shiftKey: true }), command: "editor.openFavorite" },
]);

describe("isTerminalToggleShortcut", () => {
  it("matches Cmd+J on macOS", () => {
    assert.isTrue(
      isTerminalToggleShortcut(event({ metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
  });

  it("matches Ctrl+J on non-macOS", () => {
    assert.isTrue(
      isTerminalToggleShortcut(event({ ctrlKey: true }), DEFAULT_BINDINGS, { platform: "Win32" }),
    );
  });
});

describe("split/new/close terminal shortcuts", () => {
  it("requires terminalFocus for default split/new/close bindings", () => {
    assert.isFalse(
      isTerminalSplitShortcut(event({ key: "d", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { terminalFocus: false },
      }),
    );
    assert.isFalse(
      isTerminalNewShortcut(event({ key: "d", ctrlKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
        context: { terminalFocus: false },
      }),
    );
    assert.isFalse(
      isTerminalCloseShortcut(event({ key: "w", ctrlKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
        context: { terminalFocus: false },
      }),
    );
  });

  it("matches split/new when terminalFocus is true", () => {
    assert.isTrue(
      isTerminalSplitShortcut(event({ key: "d", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { terminalFocus: true },
      }),
    );
    assert.isTrue(
      isTerminalNewShortcut(event({ key: "d", ctrlKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
        context: { terminalFocus: true },
      }),
    );
    assert.isTrue(
      isTerminalCloseShortcut(event({ key: "w", ctrlKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
        context: { terminalFocus: true },
      }),
    );
  });

  it("supports when expressions", () => {
    const keybindings = compile([
      {
        shortcut: modShortcut("\\"),
        command: "terminal.split",
        whenAst: whenAnd(whenIdentifier("terminalOpen"), whenNot(whenIdentifier("terminalFocus"))),
      },
      {
        shortcut: modShortcut("n", { shiftKey: true }),
        command: "terminal.new",
        whenAst: whenAnd(whenIdentifier("terminalOpen"), whenNot(whenIdentifier("terminalFocus"))),
      },
      { shortcut: modShortcut("j"), command: "terminal.toggle" },
    ]);
    assert.isTrue(
      isTerminalSplitShortcut(event({ key: "\\", ctrlKey: true }), keybindings, {
        platform: "Win32",
        context: { terminalOpen: true, terminalFocus: false },
      }),
    );
    assert.isFalse(
      isTerminalSplitShortcut(event({ key: "\\", ctrlKey: true }), keybindings, {
        platform: "Win32",
        context: { terminalOpen: false, terminalFocus: false },
      }),
    );
    assert.isTrue(
      isTerminalNewShortcut(event({ key: "n", ctrlKey: true, shiftKey: true }), keybindings, {
        platform: "Win32",
        context: { terminalOpen: true, terminalFocus: false },
      }),
    );
  });

  it("supports when boolean literals", () => {
    const keybindings = compile([
      { shortcut: modShortcut("n"), command: "terminal.new", whenAst: whenIdentifier("true") },
      { shortcut: modShortcut("m"), command: "terminal.new", whenAst: whenIdentifier("false") },
    ]);

    assert.isTrue(
      isTerminalNewShortcut(event({ key: "n", ctrlKey: true }), keybindings, {
        platform: "Linux",
      }),
    );
    assert.isFalse(
      isTerminalNewShortcut(event({ key: "m", ctrlKey: true }), keybindings, {
        platform: "Linux",
      }),
    );
  });
});

describe("shortcutLabelForCommand", () => {
  it("returns the most recent binding label", () => {
    const bindings = compile([
      {
        shortcut: modShortcut("\\"),
        command: "terminal.split",
        whenAst: whenIdentifier("terminalFocus"),
      },
      {
        shortcut: modShortcut("\\", { shiftKey: true }),
        command: "terminal.split",
        whenAst: whenNot(whenIdentifier("terminalFocus")),
      },
    ]);
    assert.strictEqual(
      shortcutLabelForCommand(bindings, "terminal.split", "Linux"),
      "Ctrl+Shift+\\",
    );
  });

  it("returns labels for non-terminal commands", () => {
    assert.strictEqual(shortcutLabelForCommand(DEFAULT_BINDINGS, "chat.new", "MacIntel"), "⇧⌘O");
    assert.strictEqual(shortcutLabelForCommand(DEFAULT_BINDINGS, "diff.toggle", "Linux"), "Ctrl+D");
    assert.strictEqual(
      shortcutLabelForCommand(DEFAULT_BINDINGS, "editor.openFavorite", "Linux"),
      "Ctrl+Shift+F",
    );
  });
});

describe("chat/editor shortcuts", () => {
  it("matches chat.new shortcut", () => {
    assert.isTrue(
      isChatNewShortcut(event({ key: "o", metaKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
    assert.isTrue(
      isChatNewShortcut(event({ key: "o", ctrlKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
      }),
    );
  });

  it("matches chat.newLocal shortcut", () => {
    assert.isTrue(
      isChatNewLocalShortcut(event({ key: "l", metaKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
      }),
    );
    assert.isTrue(
      isChatNewLocalShortcut(event({ key: "l", ctrlKey: true, shiftKey: true }), DEFAULT_BINDINGS, {
        platform: "Linux",
      }),
    );
  });

  it("matches editor.openFavorite shortcut", () => {
    assert.isTrue(
      isOpenFavoriteEditorShortcut(
        event({ key: "f", metaKey: true, shiftKey: true }),
        DEFAULT_BINDINGS,
        {
          platform: "MacIntel",
        },
      ),
    );
    assert.isTrue(
      isOpenFavoriteEditorShortcut(
        event({ key: "f", ctrlKey: true, shiftKey: true }),
        DEFAULT_BINDINGS,
        {
          platform: "Linux",
        },
      ),
    );
  });

  it("matches diff.toggle shortcut outside terminal focus", () => {
    assert.isTrue(
      isDiffToggleShortcut(event({ key: "d", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { terminalFocus: false },
      }),
    );
    assert.isFalse(
      isDiffToggleShortcut(event({ key: "d", metaKey: true }), DEFAULT_BINDINGS, {
        platform: "MacIntel",
        context: { terminalFocus: true },
      }),
    );
  });
});

describe("cross-command precedence", () => {
  it("uses when + order so a later focused rule overrides a global rule", () => {
    const keybindings = compile([
      { shortcut: modShortcut("n"), command: "chat.new" },
      {
        shortcut: modShortcut("n"),
        command: "terminal.new",
        whenAst: whenIdentifier("terminalFocus"),
      },
    ]);

    assert.isTrue(
      isTerminalNewShortcut(event({ key: "n", metaKey: true }), keybindings, {
        platform: "MacIntel",
        context: { terminalFocus: true },
      }),
    );
    assert.isFalse(
      isChatNewShortcut(event({ key: "n", metaKey: true }), keybindings, {
        platform: "MacIntel",
        context: { terminalFocus: true },
      }),
    );
    assert.isFalse(
      isTerminalNewShortcut(event({ key: "n", metaKey: true }), keybindings, {
        platform: "MacIntel",
        context: { terminalFocus: false },
      }),
    );
    assert.isTrue(
      isChatNewShortcut(event({ key: "n", metaKey: true }), keybindings, {
        platform: "MacIntel",
        context: { terminalFocus: false },
      }),
    );
  });

  it("still lets a later global rule win when both rules match", () => {
    const keybindings = compile([
      {
        shortcut: modShortcut("n"),
        command: "terminal.new",
        whenAst: whenIdentifier("terminalFocus"),
      },
      { shortcut: modShortcut("n"), command: "chat.new" },
    ]);

    assert.isFalse(
      isTerminalNewShortcut(event({ key: "n", ctrlKey: true }), keybindings, {
        platform: "Linux",
        context: { terminalFocus: true },
      }),
    );
    assert.isTrue(
      isChatNewShortcut(event({ key: "n", ctrlKey: true }), keybindings, {
        platform: "Linux",
        context: { terminalFocus: true },
      }),
    );
  });
});

describe("resolveShortcutCommand", () => {
  it("returns dynamic script commands", () => {
    const keybindings = compile([{ shortcut: modShortcut("r"), command: "script.setup.run" }]);

    assert.strictEqual(
      resolveShortcutCommand(event({ key: "r", ctrlKey: true }), keybindings, {
        platform: "Linux",
      }),
      "script.setup.run",
    );
  });

  it("resolves chat.new and chat.newLocal commands when !terminalFocus", () => {
    const keybindings = compile([
      {
        shortcut: modShortcut("n"),
        command: "chat.new",
        whenAst: whenNot(whenIdentifier("terminalFocus")),
      },
      {
        shortcut: modShortcut("o", { shiftKey: true }),
        command: "chat.new",
        whenAst: whenNot(whenIdentifier("terminalFocus")),
      },
      {
        shortcut: modShortcut("l", { shiftKey: true }),
        command: "chat.newLocal",
        whenAst: whenNot(whenIdentifier("terminalFocus")),
      },
    ]);

    // Matches chat.new with mod+n when terminalFocus is false
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "n", ctrlKey: true }), keybindings, {
        platform: "Linux",
        context: { terminalFocus: false },
      }),
      "chat.new",
    );

    // Matches chat.new with mod+shift+o when terminalFocus is false
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "o", ctrlKey: true, shiftKey: true }), keybindings, {
        platform: "Linux",
        context: { terminalFocus: false },
      }),
      "chat.new",
    );

    // Matches chat.newLocal with mod+shift+l when terminalFocus is false
    assert.strictEqual(
      resolveShortcutCommand(event({ key: "l", ctrlKey: true, shiftKey: true }), keybindings, {
        platform: "Linux",
        context: { terminalFocus: false },
      }),
      "chat.newLocal",
    );

    // Does not match when terminalFocus is true
    assert.isNull(
      resolveShortcutCommand(event({ key: "n", ctrlKey: true }), keybindings, {
        platform: "Linux",
        context: { terminalFocus: true },
      }),
    );
  });
});

describe("formatShortcutLabel", () => {
  it("formats labels for macOS", () => {
    assert.strictEqual(
      formatShortcutLabel(modShortcut("d", { shiftKey: true }), "MacIntel"),
      "⇧⌘D",
    );
  });

  it("formats labels for non-macOS", () => {
    assert.strictEqual(
      formatShortcutLabel(modShortcut("d", { shiftKey: true }), "Linux"),
      "Ctrl+Shift+D",
    );
  });

  it("formats labels for plus key", () => {
    assert.strictEqual(formatShortcutLabel(modShortcut("+"), "MacIntel"), "⌘+");
    assert.strictEqual(formatShortcutLabel(modShortcut("+"), "Linux"), "Ctrl++");
  });
});

describe("isTerminalClearShortcut", () => {
  it("matches Ctrl+L on all platforms", () => {
    assert.isTrue(isTerminalClearShortcut(event({ key: "l", ctrlKey: true }), "Linux"));
    assert.isTrue(isTerminalClearShortcut(event({ key: "l", ctrlKey: true }), "MacIntel"));
  });

  it("matches Cmd+K on macOS", () => {
    assert.isTrue(isTerminalClearShortcut(event({ key: "k", metaKey: true }), "MacIntel"));
  });

  it("ignores non-keydown events", () => {
    assert.isFalse(
      isTerminalClearShortcut(event({ type: "keyup", key: "l", ctrlKey: true }), "Linux"),
    );
  });
});

describe("terminalNavigationShortcutData", () => {
  it("maps Option+Arrow on macOS to word movement", () => {
    assert.strictEqual(
      terminalNavigationShortcutData(event({ key: "ArrowLeft", altKey: true }), "MacIntel"),
      "\u001bb",
    );
    assert.strictEqual(
      terminalNavigationShortcutData(event({ key: "ArrowRight", altKey: true }), "MacIntel"),
      "\u001bf",
    );
  });

  it("maps Cmd+Arrow on macOS to line movement", () => {
    assert.strictEqual(
      terminalNavigationShortcutData(event({ key: "ArrowLeft", metaKey: true }), "MacIntel"),
      "\u0001",
    );
    assert.strictEqual(
      terminalNavigationShortcutData(event({ key: "ArrowRight", metaKey: true }), "MacIntel"),
      "\u0005",
    );
  });

  it("maps Ctrl+Arrow on non-macOS to word movement", () => {
    assert.strictEqual(
      terminalNavigationShortcutData(event({ key: "ArrowLeft", ctrlKey: true }), "Win32"),
      "\u001bb",
    );
    assert.strictEqual(
      terminalNavigationShortcutData(event({ key: "ArrowRight", ctrlKey: true }), "Linux"),
      "\u001bf",
    );
  });

  it("rejects unsupported combinations", () => {
    assert.isNull(
      terminalNavigationShortcutData(
        event({ key: "ArrowLeft", shiftKey: true, altKey: true }),
        "MacIntel",
      ),
    );
    assert.isNull(
      terminalNavigationShortcutData(event({ key: "ArrowLeft", metaKey: true }), "Linux"),
    );
    assert.isNull(terminalNavigationShortcutData(event({ key: "a", altKey: true }), "MacIntel"));
  });

  it("ignores non-keydown events", () => {
    assert.isNull(
      terminalNavigationShortcutData(
        event({ type: "keyup", key: "ArrowLeft", altKey: true }),
        "MacIntel",
      ),
    );
  });
});

describe("plus key parsing", () => {
  it("matches the plus key shortcut", () => {
    const plusBindings = compile([{ shortcut: modShortcut("+"), command: "terminal.toggle" }]);
    assert.isTrue(
      isTerminalToggleShortcut(event({ key: "+", metaKey: true }), plusBindings, {
        platform: "MacIntel",
      }),
    );
    assert.isTrue(
      isTerminalToggleShortcut(event({ key: "+", ctrlKey: true }), plusBindings, {
        platform: "Linux",
      }),
    );
  });
});

it("opens Quick Actions with the default Option-K shortcut without using Siri's Space shortcut", () => {
  assert.equal(
    resolveShortcutCommand(
      event({ key: "˚", code: "KeyK", metaKey: true, altKey: true }),
      DEFAULT_RESOLVED_KEYBINDINGS,
      { platform: "MacIntel" },
    ),
    "quickActions.toggle",
  );
  assert.equal(
    resolveShortcutCommand(
      event({ key: "k", ctrlKey: true, altKey: true }),
      DEFAULT_RESOLVED_KEYBINDINGS,
      { platform: "Win32" },
    ),
    "quickActions.toggle",
  );
  assert.notEqual(
    resolveShortcutCommand(
      event({ key: " ", metaKey: true, shiftKey: true }),
      DEFAULT_RESOLVED_KEYBINDINGS,
      { platform: "MacIntel" },
    ),
    "quickActions.toggle",
  );
});

describe("model picker keys only apply while the picker is open", () => {
  const macKey = (name: string) => event({ key: name, metaKey: true });
  const linuxKey = (name: string) => event({ key: name, ctrlKey: true });
  const inPicker = (platform = "MacIntel") => ({
    platform,
    context: { modelPickerOpen: true, terminalFocus: false, shellChromeFocus: false },
  });
  const outside = (platform = "MacIntel") => ({
    platform,
    context: { terminalFocus: false, shellChromeFocus: true },
  });

  it("jumps to a model by number inside the picker, and switches tools outside it", () => {
    assert.strictEqual(
      resolveShortcutCommand(macKey("3"), DEFAULT_RESOLVED_KEYBINDINGS, inPicker("MacIntel")),
      "modelPicker.jump.3",
    );
    assert.strictEqual(
      resolveShortcutCommand(linuxKey("3"), DEFAULT_RESOLVED_KEYBINDINGS, inPicker("Linux")),
      "modelPicker.jump.3",
    );
    assert.strictEqual(
      resolveShortcutCommand(macKey("3"), DEFAULT_RESOLVED_KEYBINDINGS, outside("MacIntel")),
      "tool.jumpTo3",
    );
    assert.strictEqual(
      resolveShortcutCommand(linuxKey("3"), DEFAULT_RESOLVED_KEYBINDINGS, outside("Linux")),
      "tool.jumpTo3",
    );
  });

  it("steps providers inside the picker, and navigates history outside it", () => {
    assert.strictEqual(
      resolveShortcutCommand(macKey("]"), DEFAULT_RESOLVED_KEYBINDINGS, inPicker("MacIntel")),
      "modelPicker.nextProvider",
    );
    assert.strictEqual(
      resolveShortcutCommand(linuxKey("]"), DEFAULT_RESOLVED_KEYBINDINGS, inPicker("Linux")),
      "modelPicker.nextProvider",
    );
    assert.strictEqual(
      resolveShortcutCommand(macKey("["), DEFAULT_RESOLVED_KEYBINDINGS, inPicker("MacIntel")),
      "modelPicker.previousProvider",
    );
    assert.strictEqual(
      resolveShortcutCommand(linuxKey("["), DEFAULT_RESOLVED_KEYBINDINGS, inPicker("Linux")),
      "modelPicker.previousProvider",
    );
    assert.strictEqual(
      resolveShortcutCommand(macKey("]"), DEFAULT_RESOLVED_KEYBINDINGS, outside("MacIntel")),
      "navigation.forward",
    );
    assert.strictEqual(
      resolveShortcutCommand(linuxKey("]"), DEFAULT_RESOLVED_KEYBINDINGS, outside("Linux")),
      "navigation.forward",
    );
  });
});

describe("agent control shortcuts", () => {
  it("resolves take over and stop all without colliding with thread.stop", () => {
    const mac = { platform: "MacIntel" };
    assert.strictEqual(
      resolveShortcutCommand(
        event({ key: "y", metaKey: true, altKey: true, shiftKey: true }),
        DEFAULT_RESOLVED_KEYBINDINGS,
        mac,
      ),
      "agent.takeOver",
    );
    assert.strictEqual(
      resolveShortcutCommand(
        event({ key: "x", metaKey: true, altKey: true, shiftKey: true }),
        DEFAULT_RESOLVED_KEYBINDINGS,
        mac,
      ),
      "agent.stopAll",
    );
    assert.strictEqual(
      resolveShortcutCommand(event({ key: ".", metaKey: true }), DEFAULT_RESOLVED_KEYBINDINGS, mac),
      "thread.stop",
    );
  });

  it("maps keybinding commands to agent control requests", () => {
    assert.strictEqual(agentControlRequestForCommand("agent.takeOver"), "takeOver");
    assert.strictEqual(agentControlRequestForCommand("agent.stopAll"), "stopAll");
    assert.strictEqual(agentControlRequestForCommand("thread.stop"), null);
  });

  it("has no default chord that duplicates the agent commands", () => {
    const keys = DEFAULT_RESOLVED_KEYBINDINGS.filter(
      (rule) => rule.command === "agent.takeOver" || rule.command === "agent.stopAll",
    ).map((rule) => `${rule.shortcut.key}${rule.shortcut.shiftKey}${rule.shortcut.modKey}`);
    assert.strictEqual(new Set(keys).size, 2);
    const clashes = DEFAULT_RESOLVED_KEYBINDINGS.filter(
      (rule) =>
        rule.shortcut.modKey &&
        rule.shortcut.shiftKey &&
        rule.shortcut.altKey &&
        (rule.shortcut.key === "x" || rule.shortcut.key === "y"),
    );
    assert.strictEqual(clashes.length, 2);
  });
});
