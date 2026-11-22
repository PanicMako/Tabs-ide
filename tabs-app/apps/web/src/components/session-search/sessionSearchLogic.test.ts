import { SESSION_SEARCH_MARK_END as E, SESSION_SEARCH_MARK_START as S } from "@tabs/contracts";
import { describe, expect, it } from "vitest";

import {
  highlightTerms,
  indexingProgress,
  moveSelection,
  projectLabel,
  relativeTime,
  splitHighlight,
  terminalResumeCommand,
  toggleAgent,
} from "./sessionSearchLogic";

describe("splitHighlight", () => {
  it("splits matched runs from plain text", () => {
    expect(splitHighlight(`…use a ${S}debounce${E} of 150ms`)).toEqual([
      { text: "…use a ", match: false },
      { text: "debounce", match: true },
      { text: " of 150ms", match: false },
    ]);
  });

  it("handles text with no markers", () => {
    expect(splitHighlight("plain")).toEqual([{ text: "plain", match: false }]);
    expect(splitHighlight("")).toEqual([]);
  });
});

describe("labels", () => {
  it("shows the last path segment", () => {
    expect(projectLabel("/Users/me/work/app")).toBe("app");
    expect(projectLabel("C:\\code\\api\\")).toBe("api");
    expect(projectLabel(null)).toBe("");
  });

  it("formats relative time", () => {
    const now = Date.parse("2026-11-20T12:00:00Z");
    expect(relativeTime(now - 30_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});

describe("terminalResumeCommand", () => {
  const base = { agent: "claude", sessionId: "s", transcriptPath: null } as const;
  it("changes into the session directory first and quotes it", () => {
    expect(
      terminalResumeCommand({ ...base, cwd: "/work/my app", command: "claude --resume s" }),
    ).toBe("cd '/work/my app' && claude --resume s");
  });
  it("returns the bare command without a directory and null without a command", () => {
    expect(terminalResumeCommand({ ...base, cwd: null, command: "claude --resume s" })).toBe(
      "claude --resume s",
    );
    expect(terminalResumeCommand({ ...base, cwd: "/w", command: null })).toBeNull();
  });
});

describe("selection", () => {
  it("wraps in both directions and handles empty lists", () => {
    expect(moveSelection(-1, 1, 3)).toBe(0);
    expect(moveSelection(-1, -1, 3)).toBe(2);
    expect(moveSelection(2, 1, 3)).toBe(0);
    expect(moveSelection(0, -1, 3)).toBe(2);
    expect(moveSelection(0, 1, 0)).toBe(-1);
  });

  it("toggles agents", () => {
    expect(toggleAgent([], "codex")).toEqual(["codex"]);
    expect(toggleAgent(["codex", "claude"], "codex")).toEqual(["claude"]);
  });
});

describe("highlightTerms", () => {
  it("marks every term case-insensitively", () => {
    expect(highlightTerms("Fix the Debounce bug", ["debounce", "fix"])).toEqual([
      { text: "Fix", match: true },
      { text: " the ", match: false },
      { text: "Debounce", match: true },
      { text: " bug", match: false },
    ]);
  });
  it("escapes regex characters and handles no terms", () => {
    expect(highlightTerms("a (b)", ["("])).toHaveLength(3);
    expect(highlightTerms("plain", [])).toEqual([{ text: "plain", match: false }]);
  });
});

describe("indexingProgress", () => {
  it("is null unless indexing and a fraction otherwise", () => {
    expect(indexingProgress({ sessions: 1, pending: 1, state: "idle" })).toBeNull();
    expect(indexingProgress({ sessions: 3, pending: 1, state: "indexing" })).toBe(0.75);
  });
});
