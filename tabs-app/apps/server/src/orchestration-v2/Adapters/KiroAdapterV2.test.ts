import { describe, expect, it } from "vitest";

import {
  isKiroPromptActivity,
  makeKiroCloudConfigFilter,
  makeKiroSteeringNoteFilter,
} from "./KiroAdapterV2.ts";

const chunk = (text: string) =>
  ({
    sessionId: "s",
    update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
  }) as never;
const info = (kind: string, extra: object = {}) =>
  ({
    sessionId: "s",
    update: { sessionUpdate: "session_info_update", _meta: { kiro: { kind, ...extra } } },
  }) as never;
const textOf = (notification: any) => notification.update.content.text as string;
const toolUpdate = (toolCallId: string, toolId?: string, status?: string) =>
  ({
    sessionId: "s",
    update: {
      sessionUpdate: toolId ? "tool_call" : "tool_call_update",
      toolCallId,
      ...(status ? { status } : {}),
      _meta: toolId ? { kiro: { toolId } } : undefined,
    },
  }) as never;

describe("Kiro steering note filter", () => {
  it("passes text through until a steer is injected", () => {
    const filter = makeKiroSteeringNoteFilter();
    expect(textOf(filter(chunk("hello [STEERING steer-1: x]")))).toBe(
      "hello [STEERING steer-1: x]",
    );
  });

  it("drops the trailing note, even when it arrives split across chunks", () => {
    const filter = makeKiroSteeringNoteFilter();
    filter(info("steering_injected", { messageId: "1" }));
    expect(textOf(filter(chunk("Done. [STEER")))).toBe("Done. ");
    expect(textOf(filter(chunk("ING steer-1: use b]")))).toBe("");
  });

  it("releases held text that turns out not to be the note", () => {
    const filter = makeKiroSteeringNoteFilter();
    filter(info("steering_injected", { messageId: "1" }));
    expect(textOf(filter(chunk("a [STEER")))).toBe("a ");
    expect(textOf(filter(chunk("x")))).toBe("[STEERx");
  });
});

describe("Kiro cloud config filter", () => {
  it("drops the fetch_cloud_config call and its updates only", () => {
    const ignore = makeKiroCloudConfigFilter();
    expect(ignore(toolUpdate("a", "fetch_cloud_config"))).toBe(true);
    expect(ignore(toolUpdate("a", undefined, "completed"))).toBe(true);
    expect(ignore(toolUpdate("a", undefined, "completed"))).toBe(false);
    expect(ignore(toolUpdate("b", "read_file"))).toBe(false);
  });
});

describe("isKiroPromptActivity", () => {
  it("counts output and turn_start, not other info updates", () => {
    expect(isKiroPromptActivity({ sessionUpdate: "agent_message_chunk" } as never)).toBe(true);
    expect(isKiroPromptActivity((info("turn_start") as any).update)).toBe(true);
    expect(isKiroPromptActivity((info("context_usage") as any).update)).toBe(false);
  });
});
