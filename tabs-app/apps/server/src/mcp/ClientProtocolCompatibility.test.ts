import { expect, it } from "vitest";
import * as Schema from "effect/Schema";
import { OrchestrationV2Command } from "@tabs/contracts";
it("requires conversion of legacy turn commands before V2 dispatch", () => {
  const legacy = {
    type: "thread.turn.start",
    commandId: "command",
    threadId: "thread",
    message: { messageId: "message", role: "user", text: "hello", attachments: [] },
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt: "2026-10-12T00:00:00.000Z",
  };
  expect(() => Schema.decodeUnknownSync(OrchestrationV2Command)(legacy)).toThrow();
  const modern = {
    type: "message.dispatch",
    commandId: "command",
    threadId: "thread",
    messageId: "message",
    text: "hello",
    attachments: [],
    dispatchMode: { type: "queue_after_active" },
    createdBy: "user",
    creationSource: "web",
  };
  expect(Schema.decodeUnknownSync(OrchestrationV2Command)(modern).type).toBe("message.dispatch");
});
