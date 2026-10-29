import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as Socket from "effect/unstable/socket/Socket";
import { makeWsRpcProtocolClient } from "@tabs/client-runtime/rpc";
import { WS_METHODS } from "@tabs/contracts";

export async function generateCommitDraft(
  socketUrl: string,
  cwd: string,
  signal: AbortSignal,
): Promise<string> {
  const socketLayer = Socket.layerWebSocket(socketUrl, { openTimeout: "15 seconds" }).pipe(
    Layer.provide(Layer.succeed(Socket.WebSocketConstructor, (url) => new WebSocket(url))),
  );
  const protocol = Layer.effect(
    RpcClient.Protocol,
    RpcClient.makeProtocolSocket({
      retryTransientErrors: false,
      retryPolicy: Schedule.recurs(0),
    }),
  ).pipe(Layer.provide(Layer.mergeAll(socketLayer, RpcSerialization.layerJson)));
  const program = Effect.scoped(
    Effect.gen(function* () {
      const client = yield* makeWsRpcProtocolClient;
      const result = yield* client[WS_METHODS.gitGenerateCommitDraft]({ cwd });
      return result.message;
    }).pipe(Effect.provide(protocol), Effect.timeout("90 seconds")),
  );
  const result = await Effect.runPromise(Effect.result(program), { signal });
  if (result._tag === "Failure") {
    const error = result.failure;
    throw new Error("detail" in error ? String(error.detail) : error.message);
  }
  return result.success;
}
