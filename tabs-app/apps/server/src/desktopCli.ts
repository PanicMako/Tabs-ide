import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@tabs/shared/Net";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/unstable/cli";

import packageJson from "../package.json" with { type: "json" };
import { sharedServerCommandFlags } from "./cli/config.ts";
import { runDefaultServerCommand } from "./cli/server.ts";

// Reuse the regular flags, bootstrap validation and server startup without
// registering update, service, pairing and other unrelated CLI commands.
export function runDesktopCli(): void {
  const command = Command.make("tabs", { ...sharedServerCommandFlags }).pipe(
    Command.withHandler(runDefaultServerCommand),
  );
  const program = Command.run(command, { version: packageJson.version }).pipe(
    Effect.scoped,
    Effect.provide(Layer.mergeAll(NodeServices.layer, NetService.layer)),
  );
  NodeRuntime.runMain(program as any);
}
