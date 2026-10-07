import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";
import { layer as netServiceLayer } from "@tabs/shared/Net";
import packageJson from "../package.json" with { type: "json" };

import { CliConfig, tabsCli } from "./main.ts";
import { OpenLive } from "./open.ts";
import { ServerLive } from "./wsServer.ts";
import { isEntrypoint } from "./entrypoint.ts";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";

export const RuntimeLayer = Layer.empty.pipe(
  Layer.provideMerge(CliConfig.layer),
  Layer.provideMerge(ServerLive),
  Layer.provideMerge(OpenLive),
  Layer.provideMerge(netServiceLayer),
  Layer.provideMerge(NodeCrypto.layer),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(FetchHttpClient.layer),
);

export function runCli() {
  Command.run(tabsCli, { version: packageJson.version }).pipe(
    Effect.provide(RuntimeLayer),
    NodeRuntime.runMain,
  );
}

if (
  isEntrypoint({
    moduleUrl: import.meta.url,
    entryPath: process.argv[1],
    runtimeMain: import.meta.main,
  })
) {
  void (async () => {
    const command = process.argv[2];
    if (command === "acp-mcp-bridge" || command === "acp-mcp-call") {
      const { runAcpMcpCliFastPath } = await import("./mcp/AcpMcpStdioBridge.ts");
      await runAcpMcpCliFastPath(command, process.argv.slice(3));
    } else {
      runCli();
    }
  })();
}
