import { describe, expect, it } from "vitest";
import { orderedActions } from "./actions";
import { terminalQuickCommandLauncherActions } from "./terminalQuickCommandActions";

describe("terminal command launcher actions", () => {
  it("exposes each saved command as a launcher entry that runs it by id", () => {
    const actions = terminalQuickCommandLauncherActions([
      {
        id: "abc",
        label: "Tests",
        command: "bun test\nbun lint",
        appendEnter: true,
        scope: { type: "global" },
        cwd: "",
      },
    ]);
    expect(actions[0]).toMatchObject({
      id: "terminal-command:abc",
      label: "Tests",
      detail: "bun test",
      custom: { actionId: "terminal-quick-command", query: "abc" },
    });
    const all = orderedActions([], [], [], actions);
    expect(all.at(-1)?.id).toBe("terminal-command:abc");
    expect(
      orderedActions([], ["terminal-command:abc"], [], actions).map((a) => a.id),
    ).not.toContain("terminal-command:abc");
  });
});
