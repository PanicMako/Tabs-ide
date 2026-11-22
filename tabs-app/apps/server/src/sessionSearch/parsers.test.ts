import { describe, expect, it } from "vitest";

import {
  buildOpenCodeSession,
  cleanMessageText,
  parseClaudeTranscript,
  parseCodexTranscript,
  parseGeminiTranscript,
} from "./parsers.ts";

const j = (value: unknown) => JSON.stringify(value);

describe("cleanMessageText", () => {
  it("drops harness scaffolding and strips injected reminders", () => {
    expect(cleanMessageText("<environment_context>cwd</environment_context>")).toBe("");
    expect(cleanMessageText("Fix it<system-reminder>secret rules</system-reminder>")).toBe(
      "Fix it",
    );
    expect(cleanMessageText("<system-reminder>only noise</system-reminder>")).toBe("");
    expect(cleanMessageText("  hello  ")).toBe("hello");
  });
});

describe("parseClaudeTranscript", () => {
  const lines = [
    j({ type: "queue-operation", content: "ignored" }),
    j({
      type: "user",
      sessionId: "s-1",
      cwd: "/work/app",
      timestamp: "2026-11-01T10:00:00.000Z",
      message: { role: "user", content: "How do I debounce the sidebar search?" },
    }),
    j({
      type: "assistant",
      sessionId: "s-1",
      timestamp: "2026-11-01T10:00:05.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "private" },
          { type: "text", text: "Use a trailing debounce of 150ms." },
          { type: "tool_use", name: "Edit", input: { file: "x" } },
        ],
      },
    }),
    j({
      type: "user",
      timestamp: "2026-11-01T10:00:06.000Z",
      message: { role: "user", content: [{ type: "tool_result", content: "output" }] },
    }),
    j({ type: "user", isMeta: true, message: { role: "user", content: "meta" } }),
    "not json",
  ];

  it("keeps conversational text only", () => {
    const parsed = parseClaudeTranscript(lines, "fallback")!;
    expect(parsed.agent).toBe("claude");
    expect(parsed.sessionId).toBe("s-1");
    expect(parsed.cwd).toBe("/work/app");
    expect(parsed.messages.map((m) => [m.role, m.text])).toEqual([
      ["user", "How do I debounce the sidebar search?"],
      ["assistant", "Use a trailing debounce of 150ms."],
    ]);
    expect(parsed.title).toBe("How do I debounce the sidebar search?");
    expect(parsed.updatedAt).toBe(Date.parse("2026-11-01T10:00:06.000Z"));
  });

  it("prefers an explicit custom title and falls back to the file id", () => {
    const parsed = parseClaudeTranscript(
      [
        lines[1]!.replace('"sessionId":"s-1",', ""),
        j({ type: "custom-title", customTitle: "Sidebar work" }),
      ],
      "file-id",
    )!;
    expect(parsed.title).toBe("Sidebar work");
    expect(parsed.sessionId).toBe("file-id");
  });

  it("returns null when there is no conversation", () => {
    expect(parseClaudeTranscript([j({ type: "queue-operation" })], "x")).toBeNull();
  });
});

describe("parseCodexTranscript", () => {
  const lines = [
    j({
      type: "session_meta",
      timestamp: "2026-11-02T08:00:00.000Z",
      payload: { id: "codex-1", cwd: "/work/api", timestamp: "2026-11-02T08:00:00.000Z" },
    }),
    j({
      type: "response_item",
      timestamp: "2026-11-02T08:00:01.000Z",
      payload: {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "<skills_instructions>" }],
      },
    }),
    j({
      type: "response_item",
      timestamp: "2026-11-02T08:00:02.000Z",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Add retry logic to the fetcher" }],
      },
    }),
    j({
      type: "response_item",
      timestamp: "2026-11-02T08:00:03.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Added exponential backoff." }],
      },
    }),
    j({ type: "response_item", payload: { type: "function_call", name: "shell" } }),
  ];

  it("reads user and assistant messages and ignores developer/tool items", () => {
    const parsed = parseCodexTranscript(lines, "rollout")!;
    expect(parsed.sessionId).toBe("codex-1");
    expect(parsed.cwd).toBe("/work/api");
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[1]!.text).toBe("Added exponential backoff.");
  });
});

describe("parseGeminiTranscript", () => {
  it("parses the JSONL chat format", () => {
    const text = [
      j({
        sessionId: "6ac5fa82-4dff-43ce-82a8-a0032bda8b2c",
        startTime: "2026-05-10T10:00:00.000Z",
        kind: "main",
      }),
      j({
        id: "a",
        timestamp: "2026-05-10T10:00:01.000Z",
        type: "user",
        content: [{ text: "install codex button" }],
      }),
      j({ id: "b", timestamp: "2026-05-10T10:00:02.000Z", type: "gemini", content: "Done." }),
      j({ $set: { lastUpdated: "x" } }),
    ].join("\n");
    const parsed = parseGeminiTranscript(text, "file")!;
    expect(parsed.sessionId).toBe("6ac5fa82-4dff-43ce-82a8-a0032bda8b2c");
    expect(parsed.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("reads $set snapshots, drops session context and extracts the workspace", () => {
    const text = [
      j({ sessionId: "a2a-server", kind: "main" }),
      j({
        $set: {
          messages: [
            {
              id: "1",
              type: "user",
              content: [
                {
                  text: "<session_context>\n- **Workspace Directories:**\n  - /Users/me/game\n</session_context>",
                },
              ],
            },
            { id: "2", type: "user", content: [{ text: "build the level editor" }] },
          ],
        },
      }),
      j({ id: "3", type: "gemini", content: "On it." }),
      j({ id: "3", type: "gemini", content: "On it, updated." }),
    ].join("\n");
    const parsed = parseGeminiTranscript(text, "file")!;
    expect(parsed.cwd).toBe("/Users/me/game");
    expect(parsed.messages.map((m) => m.text)).toEqual([
      "build the level editor",
      "On it, updated.",
    ]);
  });

  it("uses the file id when the session id is not a UUID", () => {
    const text = j({ sessionId: "a2a-server", messages: [{ type: "user", content: "hi" }] });
    expect(parseGeminiTranscript(text, "session-2026-a2a")!.sessionId).toBe("session-2026-a2a");
  });

  it("parses the legacy single-document format", () => {
    const text = j({
      sessionId: "g-2",
      messages: [{ type: "user", content: "hello world" }],
    });
    expect(parseGeminiTranscript(text, "file")!.messages[0]!.text).toBe("hello world");
  });
});

describe("buildOpenCodeSession", () => {
  it("joins message roles with their text parts", () => {
    const parsed = buildOpenCodeSession(
      { id: "ses_1", directory: "/work/x", title: "Greeting", timeCreated: 1, timeUpdated: 2 },
      [
        {
          messageId: "m1",
          messageData: j({ role: "user" }),
          partData: j({ type: "text", text: "hi there" }),
          timeCreated: 1,
        },
        {
          messageId: "m1",
          messageData: j({ role: "user" }),
          partData: j({ type: "tool", text: "x" }),
          timeCreated: 2,
        },
        {
          messageId: "m2",
          messageData: j({ role: "assistant" }),
          partData: j({ type: "text", text: "hello" }),
          timeCreated: 3,
        },
      ],
    )!;
    expect(parsed.title).toBe("Greeting");
    expect(parsed.cwd).toBe("/work/x");
    expect(parsed.messages.map((m) => m.text)).toEqual(["hi there", "hello"]);
  });
});
