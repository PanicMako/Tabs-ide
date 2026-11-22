import { describe, expect, it } from "vitest";
import type { TerminalQuickCommand } from "@tabs/contracts";
import {
  moveQuickCommand,
  newTerminalQuickCommandDraft,
  quickCommandFromDraft,
  quickCommandFromLine,
  quickCommandProblem,
  quickCommandsForProject,
  quickCommandTitle,
  quoteShellPath,
  removeQuickCommand,
  searchQuickCommands,
  shellLineForQuickCommand,
  stepQuickCommand,
  terminalInputForQuickCommand,
  upsertQuickCommand,
} from "./terminalQuickCommands";

const make = (id: string, extra: Partial<TerminalQuickCommand> = {}): TerminalQuickCommand => ({
  id,
  label: id,
  command: `echo ${id}`,
  appendEnter: true,
  scope: { type: "global" },
  cwd: "",
  ...extra,
});

describe("terminal quick commands", () => {
  it("types the command and presses Enter by default", () => {
    expect(terminalInputForQuickCommand(make("a"))).toBe("echo a\r");
  });

  it("leaves the command on the prompt when Enter is off", () => {
    expect(terminalInputForQuickCommand(make("a", { appendEnter: false }))).toBe("echo a");
  });

  it("sends line breaks as Enter and drops trailing blank lines", () => {
    expect(terminalInputForQuickCommand(make("a", { command: "one\r\ntwo\n\n" }))).toBe(
      "one\rtwo\r",
    );
  });

  it("changes folder first when a cwd is set", () => {
    expect(shellLineForQuickCommand(make("a", { cwd: "/tmp/it's here" }))).toBe(
      "cd '/tmp/it'\\''s here' && echo a",
    );
    expect(quoteShellPath("~/code/app")).toBe("~/'code/app'");
    expect(quoteShellPath("C:\\work\\app")).toBe('"C:\\work\\app"');
  });

  it("shows only global and matching project commands, in saved order", () => {
    const list = [
      make("g"),
      make("p1", { scope: { type: "project", projectId: "one" } }),
      make("p2", { scope: { type: "project", projectId: "two" } }),
    ];
    expect(quickCommandsForProject(list, "one").map((c) => c.id)).toEqual(["g", "p1"]);
    expect(quickCommandsForProject(list, null).map((c) => c.id)).toEqual(["g"]);
  });

  it("reorders within a filtered view without moving hidden commands", () => {
    const list = [
      make("a"),
      make("hidden", { scope: { type: "project", projectId: "x" } }),
      make("b"),
      make("c"),
    ];
    const next = stepQuickCommand(list, ["a", "b", "c"], "b", -1);
    expect(next.map((c) => c.id)).toEqual(["b", "a", "hidden", "c"]);
    expect(stepQuickCommand(list, ["a", "b", "c"], "a", -1).map((c) => c.id)).toEqual(
      list.map((c) => c.id),
    );
  });

  it("moves, upserts and removes", () => {
    const list = [make("a"), make("b"), make("c")];
    expect(moveQuickCommand(list, "a", 9).map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(upsertQuickCommand(list, make("b", { label: "B" }))[1]!.label).toBe("B");
    expect(upsertQuickCommand(list, make("d")).map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
    expect(removeQuickCommand(list, "b").map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("searches name and command text", () => {
    const list = [make("deploy", { command: "vercel --prod" }), make("test")];
    expect(searchQuickCommands(list, "vercel").map((c) => c.id)).toEqual(["deploy"]);
    expect(searchQuickCommands(list, "  ")).toHaveLength(2);
  });

  it("validates drafts and trims them on save", () => {
    const draft = newTerminalQuickCommandDraft("x");
    expect(quickCommandProblem(draft)).toBe("Enter a command to run.");
    const ready = { ...draft, label: " Tests ", command: "bun test  \n", cwd: " ~/a " };
    expect(quickCommandProblem(ready)).toBeNull();
    expect(quickCommandFromDraft(ready)).toMatchObject({
      label: "Tests",
      command: "bun test",
      cwd: "~/a",
    });
    expect(quickCommandProblem({ ...ready, scope: { type: "project", projectId: "" } })).toBe(
      "Choose a project.",
    );
  });

  it("names an unnamed command after its first line", () => {
    expect(quickCommandTitle({ label: " ", command: "git status\nls" })).toBe("git status");
  });
});

describe("quickCommandFromLine", () => {
  it("builds a global command from a typed line and rejects blanks", () => {
    expect(quickCommandFromLine("a", "npm run dev  ")).toMatchObject({
      id: "a",
      command: "npm run dev",
      appendEnter: true,
      scope: { type: "global" },
    });
    expect(quickCommandFromLine("b", "   ")).toBeNull();
  });
});
