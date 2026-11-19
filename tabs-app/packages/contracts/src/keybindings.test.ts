import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";

import {
  KeybindingShortcut,
  KeybindingsConfig,
  KeybindingRule,
  ResolvedKeybindingRule,
  ResolvedKeybindingsConfig,
} from "./keybindings.ts";

const decode = <S extends Schema.Top>(
  schema: S,
  input: unknown,
): Effect.Effect<Schema.Schema.Type<S>, Schema.SchemaError, never> =>
  Schema.decodeUnknownEffect(schema as never)(input) as Effect.Effect<
    Schema.Schema.Type<S>,
    Schema.SchemaError,
    never
  >;

const decodeResolvedRule = Schema.decodeUnknownEffect(ResolvedKeybindingRule as never);

it.effect("parses keybinding rules", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(KeybindingRule, {
      key: "mod+j",
      command: "terminal.toggle",
    });
    assert.strictEqual(parsed.command, "terminal.toggle");

    const parsedSidebarToggle = yield* decode(KeybindingRule, {
      key: "mod+b",
      command: "sidebar.toggle",
    });
    assert.strictEqual(parsedSidebarToggle.command, "sidebar.toggle");

    const parsedRightPanelToggle = yield* decode(KeybindingRule, {
      key: "mod+alt+b",
      command: "rightPanel.toggle",
    });
    assert.strictEqual(parsedRightPanelToggle.command, "rightPanel.toggle");

    const parsedUndo = yield* decode(KeybindingRule, { key: "mod+z", command: "thread.undo" });
    assert.strictEqual(parsedUndo.command, "thread.undo");

    const parsedStop = yield* decode(KeybindingRule, {
      key: "mod+.",
      command: "thread.stop",
    });
    assert.strictEqual(parsedStop.command, "thread.stop");

    const parsedRegenerate = yield* decode(KeybindingRule, {
      key: "mod+alt+r",
      command: "thread.regenerateTitle",
    });
    assert.strictEqual(parsedRegenerate.command, "thread.regenerateTitle");

    const parsedStash = yield* decode(KeybindingRule, {
      key: "mod+alt+s",
      command: "composer.stash",
    });
    assert.strictEqual(parsedStash.command, "composer.stash");

    const parsedMode = yield* decode(KeybindingRule, {
      key: "mod+alt+p",
      command: "composer.mode",
    });
    assert.strictEqual(parsedMode.command, "composer.mode");

    const parsedUsage = yield* decode(KeybindingRule, {
      key: "mod+alt+u",
      command: "usage.open",
    });
    assert.strictEqual(parsedUsage.command, "usage.open");

    const parsedCopyNumber = yield* decode(KeybindingRule, {
      key: "mod+alt+c",
      command: "pullRequest.copyNumber",
    });
    assert.strictEqual(parsedCopyNumber.command, "pullRequest.copyNumber");

    const parsedFocus = yield* decode(KeybindingRule, {
      key: "f6",
      command: "workspace.focusNext",
    });
    assert.strictEqual(parsedFocus.command, "workspace.focusNext");

    const parsedReopen = yield* decode(KeybindingRule, {
      key: "mod+shift+t",
      command: "view.reopenClosed",
    });
    assert.strictEqual(parsedReopen.command, "view.reopenClosed");

    for (const command of [
      "usage.cost",
      "usage.tokens",
      "usage.limits",
      "usage.period.day",
      "usage.period.week",
      "usage.period.month",
      "usage.period.quarter",
    ] as const) {
      const parsedUsageCommand = yield* decode(KeybindingRule, { key: "mod+alt+shift+c", command });
      assert.strictEqual(parsedUsageCommand.command, command);
    }

    const parsedThemeEditor = yield* decode(KeybindingRule, {
      key: "mod+alt+e",
      command: "themeEditor.toggle",
    });
    assert.strictEqual(parsedThemeEditor.command, "themeEditor.toggle");

    const parsedThemeSelect = yield* decode(KeybindingRule, {
      key: "mod+alt+y",
      command: "theme.select",
    });
    assert.strictEqual(parsedThemeSelect.command, "theme.select");

    const parsedSendNew = yield* decode(KeybindingRule, {
      key: "mod+alt+enter",
      command: "composer.sendAndNewThread",
    });
    assert.strictEqual(parsedSendNew.command, "composer.sendAndNewThread");

    for (const command of ["composer.effort", "modelPicker.toggle"] as const) {
      const parsedPicker = yield* decode(KeybindingRule, { key: "mod+shift+m", command });
      assert.strictEqual(parsedPicker.command, command);
    }

    for (const command of ["composer.increaseEffort", "composer.decreaseEffort"] as const) {
      const parsedEffort = yield* decode(KeybindingRule, { key: "mod+alt+arrowup", command });
      assert.strictEqual(parsedEffort.command, command);
    }

    for (const command of [
      "composer.branch",
      "composer.workspace",
      "composer.previousWorktree",
    ] as const) {
      const parsedPicker = yield* decode(KeybindingRule, { key: "mod+alt+g", command });
      assert.strictEqual(parsedPicker.command, command);
    }

    const parsedNoProject = yield* decode(KeybindingRule, {
      key: "mod+alt+shift+n",
      command: "chat.newWithoutProject",
    });
    assert.strictEqual(parsedNoProject.command, "chat.newWithoutProject");

    const parsedFind = yield* decode(KeybindingRule, { key: "mod+f", command: "chat.find" });
    assert.strictEqual(parsedFind.command, "chat.find");

    const parsedThreadPanel = yield* decode(KeybindingRule, {
      key: "mod+alt+d",
      command: "threadPanel.toggle",
    });
    assert.strictEqual(parsedThreadPanel.command, "threadPanel.toggle");

    for (const command of [
      "modelPicker.nextProvider",
      "modelPicker.previousProvider",
      "modelPicker.jump.3",
    ] as const) {
      const parsedPickerKey = yield* decode(KeybindingRule, {
        key: "mod+]",
        command,
        when: "modelPickerOpen",
      });
      assert.strictEqual(parsedPickerKey.command, command);
    }

    const parsedSnapshot = yield* decode(KeybindingRule, {
      key: "mod+alt+shift+s",
      command: "snapshot.capture",
    });
    assert.strictEqual(parsedSnapshot.command, "snapshot.capture");

    const parsedClose = yield* decode(KeybindingRule, {
      key: "mod+w",
      command: "terminal.close",
    });
    assert.strictEqual(parsedClose.command, "terminal.close");

    const parsedDiffToggle = yield* decode(KeybindingRule, {
      key: "mod+d",
      command: "diff.toggle",
    });
    assert.strictEqual(parsedDiffToggle.command, "diff.toggle");

    const parsedCommandPalette = yield* decode(KeybindingRule, {
      key: "mod+k",
      command: "commandPalette.toggle",
    });
    assert.strictEqual(parsedCommandPalette.command, "commandPalette.toggle");

    const parsedLocal = yield* decode(KeybindingRule, {
      key: "mod+shift+n",
      command: "chat.newLocal",
    });
    assert.strictEqual(parsedLocal.command, "chat.newLocal");

    const parsedModelPickerToggle = yield* decode(KeybindingRule, {
      key: "mod+shift+m",
      command: "modelPicker.toggle",
    });
    assert.strictEqual(parsedModelPickerToggle.command, "modelPicker.toggle");

    const parsedModelPickerJump = yield* decode(KeybindingRule, {
      key: "mod+1",
      command: "modelPicker.jump.1",
    });
    assert.strictEqual(parsedModelPickerJump.command, "modelPicker.jump.1");

    const parsedThreadPrevious = yield* decode(KeybindingRule, {
      key: "mod+shift+[",
      command: "thread.previous",
    });
    assert.strictEqual(parsedThreadPrevious.command, "thread.previous");

    const parsedThreadSettle = yield* decode(KeybindingRule, {
      key: "mod+shift+s",
      command: "thread.settle",
    });
    assert.strictEqual(parsedThreadSettle.command, "thread.settle");

    const parsedThreadCopyReference = yield* decode(KeybindingRule, {
      key: "mod+shift+c",
      command: "thread.copyReference",
    });
    assert.strictEqual(parsedThreadCopyReference.command, "thread.copyReference");
  }),
);

it.effect("rejects invalid command values", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decode(KeybindingRule, {
        key: "mod+j",
        command: "script.Test.run",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("accepts dynamic script run commands", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(KeybindingRule, {
      key: "mod+r",
      command: "script.setup.run",
    });
    assert.strictEqual(parsed.command, "script.setup.run");
  }),
);

it.effect("parses keybindings array payload", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(KeybindingsConfig, [
      { key: "mod+j", command: "terminal.toggle" },
      { key: "mod+d", command: "terminal.split", when: "terminalFocus" },
      { key: "mod+shift+d", command: "terminal.splitVertical", when: "terminalFocus" },
    ]);
    assert.lengthOf(parsed, 3);
  }),
);

it.effect("parses resolved keybinding rules", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(ResolvedKeybindingRule, {
      command: "terminal.split",
      shortcut: {
        key: "d",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        modKey: true,
      },
      whenAst: {
        type: "and",
        left: { type: "identifier", name: "terminalOpen" },
        right: {
          type: "not",
          node: { type: "identifier", name: "terminalFocus" },
        },
      },
    });
    assert.strictEqual(parsed.shortcut.key, "d");
  }),
);

it.effect("parses resolved keybindings arrays", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(ResolvedKeybindingsConfig, [
      {
        command: "terminal.toggle",
        shortcut: {
          key: "j",
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          modKey: true,
        },
      },
      {
        command: "thread.jump.3",
        shortcut: {
          key: "3",
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          modKey: true,
        },
      },
    ]);
    assert.lengthOf(parsed, 2);
  }),
);

it.effect("drops unknown fields in resolved keybinding rules", () =>
  decodeResolvedRule({
    command: "terminal.toggle",
    shortcut: {
      key: "j",
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      modKey: true,
    },
    key: "mod+j",
  }).pipe(
    Effect.map((parsed) => {
      const view = parsed as Record<string, unknown>;
      assert.strictEqual("key" in view, false);
      assert.strictEqual(view.command, "terminal.toggle");
    }),
  ),
);

it.effect("preserves Space shortcuts through the wire schema", () =>
  Effect.gen(function* () {
    const value = {
      key: " ",
      metaKey: false,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      modKey: true,
    };
    const encoded = yield* Schema.encodeEffect(KeybindingShortcut)(value);
    assert.strictEqual(encoded.key, " ");
    const decoded = yield* decode(KeybindingShortcut, encoded);
    assert.strictEqual(decoded.key, " ");
  }),
);
