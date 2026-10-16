// @effect-diagnostics nodeBuiltinImport:off - contract coverage reads the shipped client boundary.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WsRpcGroup } from "./rpc.ts";
import { WS_METHODS } from "./ws.ts";

describe("web client RPC coverage", () => {
  it("registers every direct request and stream method used by the real client", () => {
    const source = readFileSync(
      new URL("../../../apps/web/src/wsNativeApi.ts", import.meta.url),
      "utf8",
    );
    const constants = [
      ...new Set(
        [...source.matchAll(/transport\.(?:request|stream)\(WS_METHODS\.(\w+)/g)].map(
          (match) => match[1]!,
        ),
      ),
    ];
    expect(constants.length).toBeGreaterThan(150);
    const missing = constants.filter(
      (key) => !WsRpcGroup.requests.has(WS_METHODS[key as keyof typeof WS_METHODS]),
    );
    expect(missing).toEqual([]);
  });
});
