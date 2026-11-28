// @effect-diagnostics nodeBuiltinImport:off - exercises concurrent real CLI subprocesses.
import {
  HostProcessExecutablePath,
  HostProcessIsExecutable,
  HostProcessPlatform,
} from "@tabs/shared/hostProcess";
import { describe, expect, it } from "@effect/vitest";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ensureAgentDeviceShim } from "./AgentDeviceShim.ts";
import {
  agentDeviceGrantDirectory,
  agentDeviceSession,
  writeAgentDeviceConfig,
} from "./AgentDeviceTarget.ts";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);

describe("host-bound agent commands", () => {
  it.effect("keeps per-grant configs independent and rejects unmanaged arguments", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const temp = yield* fs.makeTempDirectoryScoped({ prefix: "t3-device-target-" });
      const platform = yield* HostProcessPlatform;
      const dir = path.join(
        temp,
        platform === "win32" ? "paths with spaces" : "quotes '\" $HOME `literal`",
      );
      yield* fs.makeDirectory(dir);
      const entryPath = path.join(dir, "cli.mjs");
      yield* fs.writeFileString(
        entryPath,
        `import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
console.log(readFileSync(args[args.indexOf('--config') + 1], 'utf8'));
if (process.env.AGENT_DEVICE_DAEMON_BASE_URL) process.exit(2);`,
      );
      const root = agentDeviceGrantDirectory(dir, path);
      yield* fs.makeDirectory(root, { recursive: true });
      const grantDir = yield* fs.makeTempDirectoryScoped({ directory: root, prefix: "grants-" });
      const proxyOrigin = "http://127.0.0.1:1000";
      const command = yield* ensureAgentDeviceShim({
        entryPath,
        configDirectory: grantDir,
        proxyOrigin,
      });
      const launcher = path.join(path.dirname(command), "agent-device-launcher.mjs");
      const files = [
        path.join(grantDir, "123e4567-e89b-12d3-a456-426614174000.json"),
        path.join(grantDir, "123e4567-e89b-12d3-a456-426614174001.json"),
      ];
      for (const [index, file] of files.entries())
        yield* writeAgentDeviceConfig(file, {
          baseUrl: proxyOrigin,
          token: `token-${index}`,
        });
      const invoke = (file: string) =>
        exec(
          platform === "win32" ? process.execPath : command,
          [
            ...(platform === "win32" ? [launcher] : []),
            "snapshot",
            "--config",
            file,
            "--session",
            agentDeviceSession("thread", "host", "device"),
          ],
          { env: { ...process.env, AGENT_DEVICE_DAEMON_BASE_URL: "http://wrong-host" } },
        ).then((result) => JSON.parse(result.stdout));
      expect(yield* Effect.promise(() => Promise.all(files.map(invoke)))).toEqual([
        { daemonBaseUrl: "http://127.0.0.1:1000", daemonAuthToken: "token-0" },
        { daemonBaseUrl: proxyOrigin, daemonAuthToken: "token-1" },
      ]);
      const second = yield* fs.readFileString(files[1]!);
      yield* writeAgentDeviceConfig(files[0]!, {
        baseUrl: proxyOrigin,
        token: "new",
      });
      expect((yield* Effect.promise(() => invoke(files[0]!))).daemonAuthToken).toBe("new");
      expect(yield* fs.readFileString(files[1]!)).toBe(second);
      expect(agentDeviceSession("thread", "mini", "same-id")).not.toBe(
        agentDeviceSession("thread", "android", "same-id"),
      );
      yield* writeAgentDeviceConfig(files[1]!, {
        baseUrl: "http://127.0.0.1:9999",
        token: "other",
      });
      yield* Effect.promise(() =>
        expect(invoke(files[1]!)).rejects.toThrow("get the current device configuration"),
      );
      const sessionArgs = ["--session", agentDeviceSession("thread", "host", "device")];
      for (const args of [
        ["snapshot"],
        ["snapshot", "--config", files[0]!],
        ["snapshot", "--config", "help"],
        ["snapshot", "--config", files[0]!, "--session"],
      ]) {
        yield* Effect.promise(() =>
          expect(exec(process.execPath, [launcher, ...args])).rejects.toThrow(
            "Call device_open first",
          ),
        );
      }
      for (const [args, error] of [
        [
          ["snapshot", "--config", entryPath, ...sessionArgs],
          "get the current device configuration",
        ],
        [
          [
            "snapshot",
            "--config",
            files[0]!,
            ...sessionArgs,
            "--daemon-base-url=http://wrong-host",
          ],
          "exact device_open target",
        ],
        [
          ["daemon", "stop", "--config", files[0]!, ...sessionArgs],
          "supported single-device command",
        ],
      ] as const) {
        yield* Effect.promise(() =>
          expect(exec(process.execPath, [launcher, ...args])).rejects.toThrow(error),
        );
      }
    }).pipe(
      Effect.scoped,
      Effect.provideService(HostProcessIsExecutable, true),
      Effect.provideService(HostProcessExecutablePath, "/packaged/t3"),
      Effect.provide(NodeServices.layer),
    ),
  );
});
