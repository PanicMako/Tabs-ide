import { describe, expect, it } from "vitest";

import {
  CODE_ACTIVITY_ITEMS,
  CODE_CHROME_COMMAND_ALLOWLIST,
  CODE_CHROME_COMMANDS,
  coerceChromeState,
  DEFAULT_CODE_CHROME_STATE,
  deriveActiveFileName,
  isAllowedChromeCommand,
  parseCodeControlClientMessage,
  parseCodeControlServerMessage,
} from "./codeChrome";

describe("deriveActiveFileName", () => {
  it("returns the basename for POSIX paths", () => {
    expect(deriveActiveFileName("/Users/x/project/src/main.ts")).toBe("main.ts");
  });
  it("returns the basename for Windows paths", () => {
    expect(deriveActiveFileName("C:\\Users\\x\\project\\src\\main.ts")).toBe("main.ts");
  });
  it("returns empty string for nullish/empty input", () => {
    expect(deriveActiveFileName(null)).toBe("");
    expect(deriveActiveFileName(undefined)).toBe("");
    expect(deriveActiveFileName("")).toBe("");
  });
  it("ignores a trailing separator", () => {
    expect(deriveActiveFileName("/a/b/c/")).toBe("c");
  });
});

describe("command allowlist", () => {
  it("includes every activity-item command and every chrome command", () => {
    for (const item of CODE_ACTIVITY_ITEMS) {
      expect(isAllowedChromeCommand(item.commandId)).toBe(true);
    }
    for (const commandId of Object.values(CODE_CHROME_COMMANDS)) {
      expect(isAllowedChromeCommand(commandId)).toBe(true);
    }
  });
  it("rejects arbitrary commands", () => {
    expect(isAllowedChromeCommand("workbench.action.files.delete")).toBe(false);
    expect(isAllowedChromeCommand("")).toBe(false);
  });
  it("has no duplicate entries", () => {
    const set = new Set(CODE_CHROME_COMMAND_ALLOWLIST);
    expect(set.size).toBe(CODE_CHROME_COMMAND_ALLOWLIST.length);
  });
});

describe("parseCodeControlServerMessage", () => {
  it("parses a valid runCommand", () => {
    expect(
      parseCodeControlServerMessage(JSON.stringify({ type: "runCommand", commandId: "x" })),
    ).toEqual({
      type: "runCommand",
      commandId: "x",
    });
  });
  it("parses a valid setTheme", () => {
    expect(
      parseCodeControlServerMessage(JSON.stringify({ type: "setTheme", theme: "light" })),
    ).toEqual({
      type: "setTheme",
      theme: "light",
    });
  });
  it("parses a valid openFile with lineNumber", () => {
    expect(
      parseCodeControlServerMessage(
        JSON.stringify({ type: "openFile", filePath: "src/main.ts", lineNumber: 42 }),
      ),
    ).toEqual({
      type: "openFile",
      filePath: "src/main.ts",
      lineNumber: 42,
    });
  });
  it("rejects malformed JSON and unknown/invalid shapes", () => {
    expect(parseCodeControlServerMessage("not json")).toBeNull();
    expect(parseCodeControlServerMessage(JSON.stringify({ type: "runCommand" }))).toBeNull();
    expect(parseCodeControlServerMessage(JSON.stringify({ type: "nope" }))).toBeNull();
  });
});

describe("parseCodeControlClientMessage / coerceChromeState", () => {
  it("filters the native Chat container from the custom activity rail", () => {
    expect(
      coerceChromeState({
        activeViewId: "workbench.panel.chat",
        activityBarItems: [
          {
            id: "workbench.panel.chat",
            label: "Chat",
            commandId: "workbench.panel.chat",
            icon: { type: "themeIcon", value: "chat-sparkle" },
          },
          {
            id: "provider.sidebar",
            label: "Provider",
            commandId: "workbench.view.extension.provider.sidebar",
            location: "auxiliaryBar",
            icon: { type: "themeIcon", value: "sparkle" },
          },
        ],
      }),
    ).toMatchObject({
      activeViewId: null,
      activityBarItems: [{ id: "provider.sidebar", label: "Provider", location: "auxiliaryBar" }],
    });
  });

  it("parses hello with projectId and token", () => {
    expect(
      parseCodeControlClientMessage(
        JSON.stringify({ type: "hello", projectId: "p1", token: "t1" }),
      ),
    ).toEqual({ type: "hello", projectId: "p1", token: "t1" });
  });
  it("defaults projectId and token to empty strings when missing", () => {
    expect(parseCodeControlClientMessage(JSON.stringify({ type: "hello" }))).toEqual({
      type: "hello",
      projectId: "",
      token: "",
    });
  });
  it("parses and coerces chromeState with projectId", () => {
    const parsed = parseCodeControlClientMessage(
      JSON.stringify({
        type: "chromeState",
        projectId: "p2",
        state: { activeViewId: "scm", panelOpen: true, dirtyCount: 2.9, branch: "main" },
      }),
    );
    expect(parsed).toEqual({
      type: "chromeState",
      projectId: "p2",
      state: {
        activeViewId: "scm",
        panelOpen: true,
        panelMaximized: false,
        dirtyCount: 2,
        branch: "main",
        languageId: null,
        cursor: null,
      },
    });
  });
  it("parses the narrowly scoped request to open a Tabs project tab", () => {
    expect(
      parseCodeControlClientMessage(
        JSON.stringify({ type: "openTabsProjectTab", projectId: "p4" }),
      ),
    ).toEqual({ type: "openTabsProjectTab", projectId: "p4" });
  });
  it("parses editor state (language + cursor) folded into chromeState", () => {
    const parsed = parseCodeControlClientMessage(
      JSON.stringify({
        type: "chromeState",
        projectId: "p3",
        state: {
          activeViewId: "explorer",
          languageId: "typescript",
          cursor: { line: 12.7, col: 4.2 },
        },
      }),
    );
    expect(parsed).toEqual({
      type: "chromeState",
      projectId: "p3",
      state: {
        activeViewId: "explorer",
        panelOpen: false,
        panelMaximized: false,
        dirtyCount: 0,
        branch: null,
        languageId: "typescript",
        cursor: { line: 12, col: 4 },
      },
    });
  });
  it("deduplicates provider containers by label and keeps the active container", () => {
    expect(
      coerceChromeState({
        activeViewId: "claude-sessions-sidebar",
        activityBarItems: [
          {
            id: "claude-sidebar",
            label: "Claude Code",
            commandId: "claude.open",
            icon: { type: "themeIcon", value: "sparkle" },
          },
          {
            id: "claude-sessions-sidebar",
            label: "Claude Code",
            commandId: "claude.sessions.open",
            icon: { type: "uri", value: "data:image/svg+xml;base64,PHN2Zy8+" },
          },
        ],
      }).activityBarItems,
    ).toEqual([
      {
        id: "claude-sessions-sidebar",
        label: "Claude Code",
        commandId: "claude.sessions.open",
        icon: { type: "uri", value: "data:image/svg+xml;base64,PHN2Zy8+" },
      },
    ]);
  });
  it("falls back to defaults for junk state", () => {
    expect(coerceChromeState(null)).toEqual(DEFAULT_CODE_CHROME_STATE);
    expect(coerceChromeState({ activeViewId: "bogus", dirtyCount: -5 })).toEqual({
      activeViewId: null,
      panelOpen: false,
      panelMaximized: false,
      dirtyCount: 0,
      branch: null,
      languageId: null,
      cursor: null,
    });
  });
  it("rejects malformed JSON", () => {
    expect(parseCodeControlClientMessage("{")).toBeNull();
  });
});
