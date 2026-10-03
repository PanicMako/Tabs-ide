import { describe, expect, it, vi } from "vitest";
import { handleTerminalMiddleClick, type TerminalMiddleClickTarget } from "./terminalMiddleClick";

function createMockTerminal(): TerminalMiddleClickTarget & {
  focusSpy: ReturnType<typeof vi.fn>;
  clearSelectionSpy: ReturnType<typeof vi.fn>;
  pasteSpy: ReturnType<typeof vi.fn>;
} {
  const focusSpy = vi.fn();
  const clearSelectionSpy = vi.fn();
  const pasteSpy = vi.fn();

  return {
    focus: focusSpy,
    clearSelection: clearSelectionSpy,
    paste: pasteSpy,
    focusSpy,
    clearSelectionSpy,
    pasteSpy,
  };
}

describe("handleTerminalMiddleClick", () => {
  it("ignores non-middle clicks (left or right click)", async () => {
    const terminal = createMockTerminal();
    const event = {
      button: 0,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    const handled = await handleTerminalMiddleClick(event, terminal);
    expect(handled).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(terminal.focusSpy).not.toHaveBeenCalled();
    expect(terminal.pasteSpy).not.toHaveBeenCalled();
  });

  it("handles middle click by focusing terminal, clearing selection, and pasting primary selection", async () => {
    const terminal = createMockTerminal();
    const event = {
      button: 1,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    const readClipboardText = vi.fn(async (type?: "clipboard" | "selection") => {
      if (type === "selection") return "echo 'hello from primary selection'";
      return "fallback text";
    });

    const handled = await handleTerminalMiddleClick(event, terminal, { readClipboardText });
    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(terminal.focusSpy).toHaveBeenCalled();
    expect(terminal.clearSelectionSpy).toHaveBeenCalled();
    expect(readClipboardText).toHaveBeenCalledWith("selection");
    expect(terminal.pasteSpy).toHaveBeenCalledWith("echo 'hello from primary selection'");
  });

  it("falls back to standard clipboard if primary selection is empty", async () => {
    const terminal = createMockTerminal();
    const event = {
      button: 1,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    const readClipboardText = vi.fn(async (type?: "clipboard" | "selection") => {
      if (type === "selection") return "";
      return "git status";
    });

    const handled = await handleTerminalMiddleClick(event, terminal, { readClipboardText });
    expect(handled).toBe(true);
    expect(readClipboardText).toHaveBeenCalledWith("selection");
    expect(readClipboardText).toHaveBeenCalledWith("clipboard");
    expect(terminal.pasteSpy).toHaveBeenCalledWith("git status");
  });

  it("falls back to navigator.clipboard if no bridge readClipboardText is present", async () => {
    const terminal = createMockTerminal();
    const event = {
      button: 1,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    const clipboardReader = vi.fn(async () => "ls -la");

    const handled = await handleTerminalMiddleClick(event, terminal, { clipboardReader });
    expect(handled).toBe(true);
    expect(clipboardReader).toHaveBeenCalled();
    expect(terminal.pasteSpy).toHaveBeenCalledWith("ls -la");
  });

  it("does not crash or paste if clipboard read throws an error", async () => {
    const terminal = createMockTerminal();
    const event = {
      button: 1,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    const readClipboardText = vi.fn(async () => {
      throw new Error("Permission denied");
    });

    const handled = await handleTerminalMiddleClick(event, terminal, { readClipboardText });
    expect(handled).toBe(true);
    expect(terminal.focusSpy).toHaveBeenCalled();
    expect(terminal.pasteSpy).not.toHaveBeenCalled();
  });
});
