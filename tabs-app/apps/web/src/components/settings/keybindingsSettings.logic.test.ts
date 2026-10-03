import type { ResolvedKeybindingsConfig } from "@tabs/contracts";
import { describe, expect, it } from "vitest";

import {
  buildKeybindingCommandOptions,
  buildKeybindingRows,
  buildWhenVariableOptions,
  commandLabel,
  keybindingConflictLabels,
  keybindingFromKeyboardEvent,
  parseWhenExpressionDraft,
  shortcutToKeybindingInput,
  unknownWhenVariables,
  whenAstToExpression,
  whenNodeRemoveLabel,
} from "./keybindingsSettings.logic";

const shortcut = (key: string, mods: Partial<Record<"modKey" | "shiftKey", boolean>> = {}) => ({
  key,
  modKey: mods.modKey ?? false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: mods.shiftKey ?? false,
});

describe("keybindingsSettings.logic", () => {
  it("builds searchable rows with readable key and when values", () => {
    const rows = buildKeybindingRows(
      [
        {
          command: "diff.toggle",
          shortcut: shortcut("d", { modKey: true }),
          whenAst: { type: "not", node: { type: "identifier", name: "terminalFocus" } },
        },
      ] satisfies ResolvedKeybindingsConfig,
      "diff",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      command: "diff.toggle",
      key: "mod+d",
      when: "!terminalFocus",
      source: "Default",
    });
  });

  it("classifies a custom shortcut for a default command as Custom", () => {
    const rows = buildKeybindingRows(
      [
        {
          command: "terminal.toggle",
          shortcut: shortcut("k", { modKey: true }),
        },
      ] satisfies ResolvedKeybindingsConfig,
      "",
    );
    expect(rows[0]?.source).toBe("Custom");
    expect(rows[0]?.defaultKey).toBe("mod+j");
  });

  it("serializes shortcuts and when expressions", () => {
    expect(shortcutToKeybindingInput(shortcut("d", { modKey: true, shiftKey: true }))).toBe(
      "mod+shift+d",
    );
    expect(
      whenAstToExpression({
        type: "and",
        left: { type: "identifier", name: "a" },
        right: { type: "not", node: { type: "identifier", name: "b" } },
      }),
    ).toBe("a && !b");
  });

  it("captures platform-specific mod shortcuts", () => {
    expect(
      keybindingFromKeyboardEvent(
        { key: "k", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
        "MacIntel",
      ),
    ).toBe("mod+k");
    expect(
      keybindingFromKeyboardEvent(
        { key: "k", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false },
        "Win32",
      ),
    ).toBe("mod+k");
  });

  it.each([
    ["@", "Digit2", "mod+shift+2"],
    ['"', "Digit2", "mod+shift+2"],
    ["@", "Quote", "mod+shift+'"],
  ])("captures %s at %s by physical key", (key, code, expected) => {
    expect(
      keybindingFromKeyboardEvent(
        {
          key,
          code,
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: true,
        },
        "MacIntel",
      ),
    ).toBe(expected);
  });

  it("captures Latin layout keys instead of their punctuation position", () => {
    expect(
      keybindingFromKeyboardEvent(
        {
          key: "m",
          code: "Semicolon",
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
        "MacIntel",
      ),
    ).toBe("mod+m");
  });

  it("describes the scope of each visual expression removal", () => {
    const condition = { type: "identifier", name: "terminalFocus" } as const;
    const negatedCondition = { type: "not", node: condition } as const;
    const group = { type: "and", left: condition, right: negatedCondition } as const;
    const negatedGroup = { type: "not", node: group } as const;

    expect(whenNodeRemoveLabel(group, 0)).toBe("Clear all conditions");
    expect(whenNodeRemoveLabel(condition, 1)).toBe("Remove condition");
    expect(whenNodeRemoveLabel(negatedCondition, 1)).toBe("Remove condition");
    expect(whenNodeRemoveLabel(group, 1)).toBe("Remove group and its conditions");
    expect(whenNodeRemoveLabel(negatedGroup, 1)).toBe("Remove group and its conditions");
  });

  it("validates when-expression drafts", () => {
    expect(parseWhenExpressionDraft("")).toEqual({ ok: true, value: undefined });
    expect(parseWhenExpressionDraft("a && (b || !c)").ok).toBe(true);
    expect(parseWhenExpressionDraft("a &&")).toEqual({ ok: false, message: expect.any(String) });
  });

  it("formats command labels", () => {
    expect(commandLabel("terminal.toggle")).toBe("Terminal: Toggle");
    expect(commandLabel("chat.newLocal")).toBe("Chat: New Local");
    expect(commandLabel("script.setup-db.run")).toBe("Run Script: Setup Db");
  });

  it("builds known when variable options", () => {
    const options = buildWhenVariableOptions();
    expect(options).toEqual(
      expect.arrayContaining([
        "terminalFocus",
        "terminalOpen",
        "shellChromeFocus",
        "true",
        "false",
      ]),
    );
  });

  it("builds command options from defaults and resolved project bindings", () => {
    const options = buildKeybindingCommandOptions([
      {
        command: "script.setup-db.run",
        shortcut: {
          key: "r",
          modKey: true,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
      },
    ] satisfies ResolvedKeybindingsConfig);

    expect(options).toEqual(
      expect.arrayContaining(["terminal.toggle", "chat.new", "script.setup-db.run"]),
    );
  });

  it("reports unknown when variables without rejecting parseable expressions", () => {
    const parsed = parseWhenExpressionDraft("!terminalFocus && customVar");
    expect(parsed.ok).toBe(true);
    expect(unknownWhenVariables(parsed.ok ? parsed.value : undefined)).toEqual(["customVar"]);
  });

  it("reports conflicting shortcuts that share an active when context", () => {
    const rows = buildKeybindingRows(
      [
        { command: "chat.new", shortcut: shortcut("p", { modKey: true }) },
        { command: "chat.newLocal", shortcut: shortcut("p", { modKey: true }) },
      ] satisfies ResolvedKeybindingsConfig,
      "",
    );
    expect(rows[0]?.conflicts).toEqual(["Chat: New Local"]);
    expect(rows[1]?.conflicts).toEqual(["Chat: New"]);

    expect(
      keybindingConflictLabels(rows, {
        rowId: rows[0]?.id ?? "",
        key: "mod+p",
        when: "",
      }),
    ).toEqual(["Chat: New Local"]);
  });
});
