import { describe, expect, it } from "vitest";

import { splitDisplayPath, summarizeWorkSteps, workStepKind } from "./workLogPresentation";

describe("work log presentation", () => {
  it("classifies steps by what they did", () => {
    expect(workStepKind({ tone: "tool", command: "bun test" })).toBe("command");
    expect(workStepKind({ tone: "tool", changedFiles: ["a.ts"] })).toBe("edit");
    expect(workStepKind({ tone: "tool", itemType: "web_search" })).toBe("search");
    expect(workStepKind({ tone: "tool", itemType: "mcp_tool_call" })).toBe("tool");
    expect(workStepKind({ tone: "error", command: "bun test" })).toBe("error");
    expect(workStepKind({ tone: "tool", requestKind: "file-read" })).toBe("read");
  });

  it("summarizes the most consequential work first and counts edited files", () => {
    expect(
      summarizeWorkSteps([
        { tone: "tool", command: "bun test" },
        { tone: "tool", changedFiles: ["a.ts", "b.ts"] },
        { tone: "tool", command: "git status" },
        { tone: "error", command: "bun lint" },
      ]),
    ).toBe("Edited 2 files · Ran 2 commands · 1 failed");
    expect(summarizeWorkSteps([{ tone: "tool", itemType: "web_search" }])).toBe("Searched 1 time");
  });

  it("falls back to a step count when nothing is classifiable", () => {
    expect(summarizeWorkSteps([{ tone: "info" }, { tone: "thinking" }])).toBe("2 steps");
  });

  it("splits a path into directory and file name", () => {
    expect(splitDisplayPath("apps/web/src/a.ts")).toEqual({
      directory: "apps/web/src/",
      name: "a.ts",
    });
    expect(splitDisplayPath("README.md")).toEqual({ directory: "", name: "README.md" });
  });
});
