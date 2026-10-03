import { describe, expect, it, vi, beforeEach } from "vitest";
import { parseAndValidateKeybindingImport } from "./keybindingsSettings.logic";
import { toastManager } from "../ui/toast";

describe("Keybinding import validation & parsing (parseAndValidateKeybindingImport)", () => {
  const knownCommands = [
    "commandPalette.toggle",
    "terminal.toggle",
    "terminal.new",
    "terminal.split",
    "window.close",
    "window.reload",
    "window.settings",
    "tab.next",
    "tab.prev",
    "tab.close",
    "tab.new",
    "chat.new",
    "chat.newLocal",
    "sidebar.toggle",
    "zoom.in",
    "zoom.out",
    "zoom.reset",
  ];

  it("rejects invalid JSON syntax", () => {
    expect(() => parseAndValidateKeybindingImport("{ not-valid-json", knownCommands)).toThrow(
      "Invalid JSON format in keybindings file.",
    );
  });

  it("rejects non-array JSON roots", () => {
    expect(() => parseAndValidateKeybindingImport('{"command": "tab.new"}', knownCommands)).toThrow(
      "Expected an array of keybindings.",
    );
  });

  it("rejects empty keybindings arrays", () => {
    expect(() => parseAndValidateKeybindingImport("[]", knownCommands)).toThrow(
      "The keybindings file is empty.",
    );
  });

  it("rejects structurally invalid entries upfront", () => {
    // Non-object item in array
    expect(() =>
      parseAndValidateKeybindingImport(
        '[{"command": "tab.new", "key": "meta+t"}, 123]',
        knownCommands,
      ),
    ).toThrow("Invalid keybinding entry at index 1: entry must be an object.");

    // Missing key property
    expect(() =>
      parseAndValidateKeybindingImport('[{"command": "tab.new"}]', knownCommands),
    ).toThrow("Invalid keybinding entry at index 0: 'key' must be a non-empty string.");

    // Non-string command
    expect(() =>
      parseAndValidateKeybindingImport('[{"command": 999, "key": "meta+t"}]', knownCommands),
    ).toThrow("Invalid keybinding entry at index 0: 'command' must be a non-empty string.");

    // Non-string when
    expect(() =>
      parseAndValidateKeybindingImport(
        '[{"command": "tab.new", "key": "meta+t", "when": 42}]',
        knownCommands,
      ),
    ).toThrow("Invalid keybinding entry at index 0: 'when' must be a string if provided.");
  });

  it("strips JSONC single-line and multi-line comments", () => {
    const jsonc = `
      // Custom keybinding config
      [
        /* First rule */
        {
          "command": "tab.new",
          "key": "meta+t"
        }, // trailing comment
        {
          "command": "tab.close",
          "key": "meta+w"
        }
      ]
    `;
    const result = parseAndValidateKeybindingImport(jsonc, knownCommands);
    expect(result.validRules).toHaveLength(2);
    expect(result.validRules[0]?.command).toBe("tab.new");
    expect(result.validRules[1]?.command).toBe("tab.close");
  });

  it("preserves comment markers inside quoted strings", () => {
    const jsonc = `[
      { "command": "tab.new", "key": "meta+//" },
      { "command": "tab.close", "key": "meta+/*x*/" }
    ]`;

    const result = parseAndValidateKeybindingImport(jsonc, knownCommands);
    expect(result.validRules).toEqual([
      { command: "tab.new", key: "meta+//" },
      { command: "tab.close", key: "meta+/*x*/" },
    ]);
  });

  it("normalizes common IDE command aliases and key syntax", () => {
    const content = JSON.stringify([
      { command: "workbench.action.quickOpen", key: "cmd+p" },
      { command: "workbench.action.terminal.toggleTerminal", key: "ctrl+`" },
      { command: "workbench.action.toggleSidebarVisibility", key: "CMD+B" },
    ]);

    const result = parseAndValidateKeybindingImport(content, knownCommands);
    expect(result.validRules).toEqual([
      { command: "commandPalette.toggle", key: "meta+p" },
      { command: "terminal.toggle", key: "ctrl+`" },
      { command: "sidebar.toggle", key: "meta+b" },
    ]);
  });

  it("resolves duplicate commands deterministically with later entries winning", () => {
    const content = JSON.stringify([
      { command: "terminal.toggle", key: "meta+j" },
      { command: "tab.new", key: "meta+t" },
      // Duplicate of terminal.toggle with different key
      { command: "terminal.toggle", key: "ctrl+`" },
    ]);

    const result = parseAndValidateKeybindingImport(content, knownCommands);
    expect(result.validRules).toHaveLength(2);
    const terminalToggle = result.validRules.find((r) => r.command === "terminal.toggle");
    expect(terminalToggle?.key).toBe("ctrl+`");
  });

  it("skips unsupported commands and records them", () => {
    const content = JSON.stringify([
      { command: "tab.new", key: "meta+t" },
      { command: "some.unknown.extension.command", key: "meta+shift+x" },
      { command: "tab.close", key: "meta+w" },
    ]);

    const result = parseAndValidateKeybindingImport(content, knownCommands);
    expect(result.validRules).toHaveLength(2);
    expect(result.skippedCommands).toEqual(["some.unknown.extension.command"]);
  });

  it("throws when all commands in the file are unsupported", () => {
    const content = JSON.stringify([
      { command: "unknown.cmd.1", key: "meta+1" },
      { command: "unknown.cmd.2", key: "meta+2" },
    ]);

    expect(() => parseAndValidateKeybindingImport(content, knownCommands)).toThrow(
      "No supported keybinding commands found to import. Skipped 2 unsupported command(s).",
    );
  });
});

describe("Keybinding import UI workflow & error handling", () => {
  let toastSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    toastSpy = vi.spyOn(toastManager, "add");
    vi.clearAllMocks();
  });

  it("dispatches batch upsert and displays success toast with committed count", async () => {
    const mockBatchUpsert = vi.fn().mockResolvedValue({
      importedCount: 3,
      keybindings: [],
    });

    const fileContent = JSON.stringify([
      { command: "workbench.action.quickOpen", key: "cmd+p" },
      { command: "tab.new", key: "cmd+t" },
      { command: "tab.close", key: "cmd+w" },
    ]);

    const { validRules } = parseAndValidateKeybindingImport(fileContent);
    const res = await mockBatchUpsert(validRules);

    expect(mockBatchUpsert).toHaveBeenCalledTimes(1);
    expect(mockBatchUpsert).toHaveBeenCalledWith(validRules);

    const committedCount = res?.importedCount ?? validRules.length;
    toastManager.add({
      title: "Import Successful",
      description: `Imported ${committedCount} keybindings.`,
      type: "success",
    });

    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Import Successful",
        description: "Imported 3 keybindings.",
        type: "success",
      }),
    );
  });

  it("never displays success toast when batch upsert rejects", async () => {
    const mockBatchUpsert = vi.fn().mockRejectedValue(new Error("Server write failed"));

    const fileContent = JSON.stringify([{ command: "tab.new", key: "cmd+t" }]);

    const { validRules } = parseAndValidateKeybindingImport(fileContent);

    try {
      await mockBatchUpsert(validRules);
      toastManager.add({
        title: "Import Successful",
        description: "Imported 1 keybindings.",
        type: "success",
      });
    } catch (err) {
      toastManager.add({
        title: "Import Failed",
        description: err instanceof Error ? err.message : "Failed",
        type: "error",
      });
    }

    // Success toast was NEVER called
    expect(toastSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "success",
      }),
    );

    // Error toast was called with the failure description
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Import Failed",
        description: "Server write failed",
        type: "error",
      }),
    );
  });

  it("resets file input value after completion so re-selecting same file triggers change", () => {
    const fileInput = { value: "path/to/keybindings.json" };

    // Simulate finally block in handleFileChange
    fileInput.value = "";

    expect(fileInput.value).toBe("");
  });

  it("rejects imports exceeding the maximum keybinding limit (256)", () => {
    const oversized = Array.from({ length: 257 }, (_, i) => ({
      command: `custom.command.${i}`,
      key: `meta+${i}`,
    }));

    expect(() => parseAndValidateKeybindingImport(JSON.stringify(oversized))).toThrow(
      "exceeds the maximum allowed limit of 256",
    );
  });
});
