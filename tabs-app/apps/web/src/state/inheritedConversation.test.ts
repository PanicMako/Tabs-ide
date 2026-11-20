import type { OrchestrationV2ProjectedTurnItem } from "@tabs/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vitest";

import { inheritedConversationMessages } from "./readModelTransitions";

const at = (iso: string) => DateTime.makeUnsafe(iso);

function row(
  visibility: OrchestrationV2ProjectedTurnItem["visibility"],
  item: Record<string, unknown>,
): OrchestrationV2ProjectedTurnItem {
  return {
    position: 0,
    visibility,
    sourceThreadId: "parent",
    sourceItemId: String(item.id),
    item: {
      threadId: "parent",
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 0,
      status: "completed",
      title: null,
      startedAt: at("2026-11-20T07:00:00.000Z"),
      completedAt: at("2026-11-20T07:00:05.000Z"),
      updatedAt: at("2026-11-20T07:00:05.000Z"),
      attachments: [],
      ...item,
    },
  } as unknown as OrchestrationV2ProjectedTurnItem;
}

describe("inheritedConversationMessages", () => {
  it("brings a side chat's starting conversation over from its parent, in order", () => {
    const messages = inheritedConversationMessages(
      [
        row("inherited", { id: "i1", type: "user_message", messageId: "m1", text: "Plan it" }),
        row("inherited", { id: "i2", type: "reasoning", text: "thinking", streaming: false }),
        row("inherited", {
          id: "i3",
          type: "assistant_message",
          messageId: "m2",
          text: "Here is the plan",
          streaming: false,
        }),
        row("synthetic", { id: "fork", type: "fork" }),
      ],
      new Set(),
    );
    expect(messages.map((message) => [message.role, message.text])).toEqual([
      ["user", "Plan it"],
      ["assistant", "Here is the plan"],
    ]);
    expect(messages[1]?.completedAt).toBe("2026-11-20T07:00:05.000Z");
  });

  it("leaves the fork's own messages to the projection's messages", () => {
    const messages = inheritedConversationMessages(
      [
        row("local", { id: "l1", type: "user_message", messageId: "own", text: "Mine" }),
        row("inherited", { id: "i1", type: "user_message", messageId: "own", text: "Mine" }),
      ],
      new Set(["own"]),
    );
    expect(messages).toEqual([]);
  });
});
