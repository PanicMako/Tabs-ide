import { describe, expect, it } from "vite-plus/test";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { ORCHESTRATION_V2_WS_METHODS } from "./orchestrationV2.ts";
import { WsRpcGroup, WsSubscribeServerConfigRpc } from "./rpc.ts";

/**
 * The client always sends `environmentThemes`, including to servers built
 * before the field existed, whose payload schema was an empty struct. What
 * makes that safe is that such a schema accepts the request rather than
 * rejecting it -- an error here would take down the config subscription.
 */
describe("subscribeServerConfig payload compatibility", () => {
  it("is accepted by a server whose schema predates the field", () => {
    const oldServerPayload = Schema.Struct({});
    const decoded = Schema.decodeExit(oldServerPayload)({ environmentThemes: true });
    expect(Exit.isSuccess(decoded)).toBe(true);
  });

  it("is carried by a server that declares it", () => {
    const decoded = Schema.decodeSync(WsSubscribeServerConfigRpc.payloadSchema)({
      environmentThemes: true,
    });
    expect(decoded).toEqual({ environmentThemes: true });
  });

  it("stays optional, so a client that never sends it still subscribes", () => {
    const decoded = Schema.decodeSync(WsSubscribeServerConfigRpc.payloadSchema)({});
    expect(decoded).toEqual({});
  });
});

describe("WebSocket RPC contracts", () => {
  it("exposes only the V2 orchestration transport surface", () => {
    const methods = [...WsRpcGroup.requests.keys()];

    expect(methods).toEqual(expect.arrayContaining(Object.values(ORCHESTRATION_V2_WS_METHODS)));
    expect(methods.filter((method) => method.startsWith("orchestrationV1."))).toEqual([]);
  });

  it("rejects server-internal commands sent to dispatchCommand", () => {
    const dispatchCommand = WsRpcGroup.requests.get(ORCHESTRATION_V2_WS_METHODS.dispatchCommand);
    if (dispatchCommand === undefined) throw new Error("dispatchCommand is not registered");
    const decode = Schema.decodeUnknownExit(dispatchCommand.payloadSchema);

    expect(
      Exit.isFailure(
        decode({
          type: "checkpoint.rollback.fail",
          commandId: "forged-rollback-failure",
          threadId: "thread-1",
          requestId: "rollback-1",
          message: "Forged failure.",
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isSuccess(
        decode({
          type: "checkpoint.rollback",
          commandId: "rollback-1",
          threadId: "thread-1",
          scopeId: "scope-1",
          checkpointId: "checkpoint-1",
        }),
      ),
    ).toBe(true);
  });

  it("rejects legacy orchestration commands and accepts V2 commands at RPC boundary", () => {
    const dispatchCommand = WsRpcGroup.requests.get(ORCHESTRATION_V2_WS_METHODS.dispatchCommand);
    if (dispatchCommand === undefined) throw new Error("dispatchCommand is not registered");
    const decode = Schema.decodeUnknownExit(dispatchCommand.payloadSchema);

    // Legacy command types rejected
    expect(
      Exit.isFailure(
        decode({
          type: "thread.turn.start",
          commandId: "cmd-1",
          threadId: "thread-1",
          input: { text: "hello" },
        }),
      ),
    ).toBe(true);

    expect(
      Exit.isFailure(
        decode({
          type: "thread.approval.respond",
          commandId: "cmd-2",
          threadId: "thread-1",
          requestId: "req-1",
          decision: "approved",
        }),
      ),
    ).toBe(true);

    expect(
      Exit.isFailure(
        decode({
          type: "thread.user-input.respond",
          commandId: "cmd-3",
          threadId: "thread-1",
          requestId: "req-2",
          answers: {},
        }),
      ),
    ).toBe(true);

    expect(
      Exit.isFailure(
        decode({
          type: "thread.meta.update",
          commandId: "cmd-4",
          threadId: "thread-1",
          title: "New title",
        }),
      ),
    ).toBe(true);

    // V2 equivalents accepted
    expect(
      Exit.isSuccess(
        decode({
          type: "message.dispatch",
          commandId: "cmd-5",
          threadId: "thread-1",
          messageId: "msg-1",
          text: "hello",
          attachments: [],
          dispatchMode: { type: "start_immediately" },
        }),
      ),
    ).toBe(true);

    expect(
      Exit.isSuccess(
        decode({
          type: "runtime-request.respond",
          commandId: "cmd-6",
          threadId: "thread-1",
          requestId: "req-1",
          decision: "accept",
        }),
      ),
    ).toBe(true);

    expect(
      Exit.isSuccess(
        decode({
          type: "runtime-request.respond",
          commandId: "cmd-7",
          threadId: "thread-1",
          requestId: "req-2",
          answers: { q1: "a1" },
        }),
      ),
    ).toBe(true);

    expect(
      Exit.isSuccess(
        decode({
          type: "thread.metadata.update",
          commandId: "cmd-8",
          threadId: "thread-1",
          title: "New title",
        }),
      ),
    ).toBe(true);

    expect(
      Exit.isSuccess(
        decode({
          type: "thread.model-selection.set",
          commandId: "cmd-9",
          threadId: "thread-1",
          modelSelection: { provider: "codex", model: "gpt-5" },
        }),
      ),
    ).toBe(true);
  });
});
