import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeTerminalQuickCommandTarget,
  registerTerminalQuickCommandTarget,
  touchTerminalQuickCommandTarget,
} from "./terminalQuickCommandTarget";

const target = (terminalId: string) => ({ threadId: "t", terminalId, environmentId: null });

describe("terminal quick command target", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
  });

  it("targets the most recently registered, then focused terminal", () => {
    cleanups.push(registerTerminalQuickCommandTarget("a", target("one")));
    cleanups.push(registerTerminalQuickCommandTarget("b", target("two")));
    expect(activeTerminalQuickCommandTarget()?.terminalId).toBe("two");
    touchTerminalQuickCommandTarget("a");
    expect(activeTerminalQuickCommandTarget()?.terminalId).toBe("one");
  });

  it("falls back when a terminal unmounts and is empty with none", () => {
    const unregisterA = registerTerminalQuickCommandTarget("a", target("one"));
    const unregisterB = registerTerminalQuickCommandTarget("b", target("two"));
    unregisterB();
    expect(activeTerminalQuickCommandTarget()?.terminalId).toBe("one");
    unregisterA();
    expect(activeTerminalQuickCommandTarget()).toBeNull();
  });
});

describe("runTerminalQuickCommandById", () => {
  it("opens a new terminal when none is active, and rejects deleted commands", async () => {
    vi.resetModules();
    const { runTerminalQuickCommandById } = await import("./terminalQuickCommandRunner");
    const command = {
      id: "c",
      label: "c",
      command: "ls",
      appendEnter: true,
      scope: { type: "global" as const },
      cwd: "",
    };
    const open = vi.fn(async () => {});
    await runTerminalQuickCommandById([command], "c", open);
    expect(open).toHaveBeenCalledWith("ls");
    await expect(runTerminalQuickCommandById([command], "gone", open)).rejects.toThrow("deleted");
  });
});
