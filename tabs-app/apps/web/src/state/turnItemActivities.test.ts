import { describe, expect, it } from "vitest";
import { deriveWorkLogEntries } from "../session-logic";
import {
  TURN_ITEM_ACTIVITY_ID_PREFIX,
  activitiesFromTurnItems,
  mergeTurnItemActivities,
} from "./turnItemActivities";

// Shapes taken from a real OpenCode thread: a shell command that worked, and `read` calls the
// provider rejected because the model sent `path` instead of `filePath`.
const command = {
  id: "item-command",
  type: "command_execution",
  status: "completed",
  ordinal: 1000004,
  title: "pwd && git status",
  input: "pwd && git status",
  output: "/Users/me/Passes\nOn branch main",
  exitCode: 0,
  startedAt: "2026-11-14T07:22:18.329Z",
  updatedAt: "2026-11-14T07:22:19.051Z",
};
const failedRead = {
  id: "item-read",
  type: "dynamic_tool",
  status: "failed",
  ordinal: 1000005,
  title: "Read /Users/me/Passes/README.md",
  toolName: "read",
  input: { path: "/Users/me/Passes/README.md" },
  output:
    'The read tool was called with invalid arguments: SchemaError(Missing key\n  at ["filePath"]).',
  startedAt: "2026-11-14T07:22:18.994Z",
  updatedAt: "2026-11-14T07:22:18.996Z",
};

describe("activitiesFromTurnItems", () => {
  it("turns commands and tool calls into work log entries the timeline can show", () => {
    const entries = deriveWorkLogEntries(activitiesFromTurnItems([command, failedRead]), undefined);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      tone: "tool",
      itemType: "command_execution",
      command: "pwd && git status",
    });
    expect(entries[0]!.detail).toContain("On branch main");
    expect(entries[1]).toMatchObject({
      tone: "error",
      itemType: "dynamic_tool_call",
      toolName: "read",
      label: "Read /Users/me/Passes/README.md",
    });
    // The provider's reason for rejecting the call is kept, so the cause is visible in the chat.
    expect(entries[1]!.detail).toContain("Missing key");
  });

  it("orders entries by the server's committed order, not by arrival", () => {
    const entries = deriveWorkLogEntries(activitiesFromTurnItems([failedRead, command]), undefined);
    expect(entries.map((entry) => entry.command ?? entry.toolName)).toEqual([
      "pwd && git status",
      "read",
    ]);
  });

  it("carries verified workflow references from projected tool items into the chat work log", () => {
    const reference = { workflowId: "a".repeat(64), stage: "published" };
    const item = {
      ...failedRead,
      status: "completed",
      toolName: "t3-code.preview_workflow",
      outputOmitted: true,
      output: { browserWorkflowResult: reference },
    };
    const derive = (candidate: Record<string, unknown>) =>
      deriveWorkLogEntries(activitiesFromTurnItems([candidate]), undefined)[0];
    const entry = derive(item);
    expect(entry?.browserWorkflowResult).toEqual(reference);
    expect(entry?.detail).toBeUndefined();
    expect(derive({ ...item, outputOmitted: false })?.browserWorkflowResult).toBeUndefined();
    expect(derive({ ...item, status: "failed" })?.browserWorkflowResult).toBeUndefined();
    expect(
      derive({
        ...item,
        output: { browserWorkflowResult: { ...reference, workflowId: "../elsewhere" } },
      })?.browserWorkflowResult,
    ).toBeUndefined();
  });

  it("passes a completed Figma receipt reference to the work log without showing the ID as text", () => {
    const reference = { operationId: "a".repeat(64) };
    const item = {
      ...failedRead,
      toolName: "t3-code.preview_figma_frame",
      status: "completed",
      outputOmitted: true,
      output: { figmaCanvasResult: reference },
    };
    const derive = (candidate: Record<string, unknown>) =>
      deriveWorkLogEntries(activitiesFromTurnItems([candidate]), undefined)[0];
    const entry = derive(item);
    expect(entry?.figmaCanvasResult).toEqual(reference);
    expect(entry?.detail).toBeUndefined();
    expect(derive({ ...item, outputOmitted: false })?.figmaCanvasResult).toBeUndefined();
    expect(derive({ ...item, status: "failed" })?.figmaCanvasResult).toBeUndefined();
    expect(
      derive({ ...item, output: { figmaCanvasResult: { operationId: "other" } } })
        ?.figmaCanvasResult,
    ).toBeUndefined();
  });

  it("ignores messages, reasoning and checkpoints", () => {
    const activities = activitiesFromTurnItems([
      { id: "m", type: "assistant_message", status: "completed", ordinal: 1 },
      { id: "r", type: "reasoning", status: "completed", ordinal: 2 },
      { id: "c", type: "checkpoint", status: "completed", ordinal: 3 },
    ]);
    expect(activities).toEqual([]);
  });

  it("shows provider errors as error entries", () => {
    const [entry] = deriveWorkLogEntries(
      activitiesFromTurnItems([
        {
          id: "e",
          type: "error",
          status: "completed",
          ordinal: 9,
          failure: { message: "Usage limit reached" },
          updatedAt: "2026-11-14T07:30:00.000Z",
        },
      ]),
      undefined,
    );
    expect(entry).toMatchObject({ tone: "error", label: "Usage limit reached" });
  });

  it("marks a command that exited non-zero as an error", () => {
    const [entry] = deriveWorkLogEntries(
      activitiesFromTurnItems([{ ...command, exitCode: 2, output: "boom" }]),
      undefined,
    );
    expect(entry!.tone).toBe("error");
  });
});

describe("mergeTurnItemActivities", () => {
  it("replaces earlier derived activities and keeps every other activity", () => {
    const legacy = {
      id: "legacy-1",
      tone: "info",
      kind: "x",
      summary: "kept",
      payload: {},
      turnId: null,
      createdAt: "2026-11-14T00:00:00.000Z",
    };
    const first = activitiesFromTurnItems([command]);
    const merged = mergeTurnItemActivities(
      [legacy as never, ...first],
      activitiesFromTurnItems([command, failedRead]),
    );
    expect(
      merged.filter((a) => String(a.id).startsWith(TURN_ITEM_ACTIVITY_ID_PREFIX)),
    ).toHaveLength(2);
    expect(merged.some((a) => a.id === ("legacy-1" as never))).toBe(true);
  });
});
