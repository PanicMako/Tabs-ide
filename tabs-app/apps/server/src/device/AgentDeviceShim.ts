// @effect-diagnostics preferSchemaOverJson:off - JSON string literals embed paths safely into generated JavaScript.
/**
 * A directory holding an `agent-device` launcher that runs the pinned install
 * with a Node runtime and accepts grant configs for this Tabs server instance.
 */
import { HostProcessPlatform } from "@tabs/shared/hostProcess";
import { resolveNodeExecutable } from "@tabs/shared/nodeRuntime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { managedAgentDeviceCommands, managedAgentDeviceOverride } from "./AgentDeviceCommand.ts";
export const ensureAgentDeviceShim = Effect.fn("AgentDeviceShim.ensure")(function* (input: {
  readonly entryPath: string;
  readonly configDirectory: string;
  readonly proxyOrigin: string;
}) {
  const { entryPath } = input;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcessPlatform;
  const node = yield* resolveNodeExecutable("Device automation");
  const shimDir = path.join(input.configDirectory, "bin");
  yield* fs.makeDirectory(shimDir, { recursive: true });
  const launcherPath = path.join(shimDir, "agent-device-launcher.mjs");
  yield* fs.writeFileString(
    launcherPath,
    `import { spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
let args = process.argv.slice(2);
const supported = new Set(${JSON.stringify(managedAgentDeviceCommands)});
const override = ${managedAgentDeviceOverride.toString()};
const help = ["--help", "-h", "--version", "-V", "version"];
const informational = args[0] === "help" || (args.length === 1 && help.includes(args[0])) ||
  (supported.has(args[0]) && args.length === 2 && help.includes(args[1]));
function refuse(message) {
  console.error(message);
  process.exit(1);
}
if (!informational) {
  const configIndex = args.indexOf("--config");
  const sessionIndex = args.indexOf("--session");
  const config = args[configIndex + 1];
  if (configIndex < 0 || sessionIndex < 0 || !config || !/^t3-[0-9a-f]{24}$/.test(args[sessionIndex + 1] ?? "")) {
    refuse("Call device_open first and include its --config and --session flags.");
  }
  const commandArgs = args.filter((_, index) =>
    index !== configIndex && index !== configIndex + 1 && index !== sessionIndex && index !== sessionIndex + 1);
  if (commandArgs.some((arg) => override.test(arg))) {
    refuse("Keep the exact device_open target and use its managed launcher options.");
  }
  const command = commandArgs.find((arg, index) =>
    !arg.startsWith("-") && !["--platform", "--serial", "--udid", "--level"].includes(commandArgs[index - 1]));
  if (!supported.has(command)) refuse("Use a supported single-device command with the Tabs launcher.");
  try {
    const root = realpathSync(${JSON.stringify(input.configDirectory)});
    const file = realpathSync(config);
    if (path.dirname(file) !== root || !/^[0-9a-f-]{36}\\.json$/.test(path.basename(file))) throw new Error();
    const grant = JSON.parse(readFileSync(file, "utf8"));
    if (grant.daemonBaseUrl !== ${JSON.stringify(input.proxyOrigin)} || typeof grant.daemonAuthToken !== "string") throw new Error();
    args = ["--config", file, "--session", args[sessionIndex + 1], ...commandArgs];
  } catch {
    refuse("Call device_open again to get the current device configuration.");
  }
}
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("AGENT_DEVICE_")));
env.AGENT_DEVICE_NO_UPDATE_NOTIFIER = "1";
const child = spawn(${JSON.stringify(node)}, [${JSON.stringify(entryPath)}, ...args], { stdio: "inherit", env });
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
`,
  );
  if (platform === "win32") {
    const script = `@echo off\r\n"${node}" "${launcherPath}" %*\r\n`;
    yield* fs.writeFileString(path.join(shimDir, "agent-device.cmd"), script);
  } else {
    const command = [node, launcherPath]
      .map((value) => "'" + value.replaceAll("'", "'\"'\"'") + "'")
      .join(" ");
    const script = `#!/bin/sh\nexec ${command} "$@"\n`;
    const shimPath = path.join(shimDir, "agent-device");
    yield* fs.writeFileString(shimPath, script);
    yield* fs.chmod(shimPath, 0o755);
  }
  return path.join(shimDir, platform === "win32" ? "agent-device.cmd" : "agent-device");
});
