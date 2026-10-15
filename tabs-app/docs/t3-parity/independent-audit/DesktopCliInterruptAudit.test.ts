// @effect-diagnostics nodeBuiltinImport:off -- The integration fixture binds the same platform socket or named pipe as the CLI.
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import type { DesktopAppActivationRequest } from "@tabs/contracts";
import { resolveDesktopAppControlAddress } from "@tabs/shared/desktopAppControl";
import {
  HostProcessPlatform,
  HostProcessUserId,
  HostProcessWorkingDirectory,
} from "@tabs/shared/hostProcess";
import * as NetService from "@tabs/shared/Net";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Command } from "effect/unstable/cli";
import { afterEach, describe, expect, vi } from "vite-plus/test";

import { makeCli } from "../binCli.ts";
import { PersistedServerRuntimeState } from "../serverRuntimeState.ts";

vi.mock("node:os", async (importOriginal) => {
  const os = await importOriginal<typeof import("node:os")>();
  return { ...os, homedir: vi.fn(os.homedir) };
});

afterEach(() => vi.mocked(NodeOS.homedir).mockReset());

const encodeRuntimeState = Schema.encodeEffect(Schema.fromJsonString(PersistedServerRuntimeState));

const runCli = (args: ReadonlyArray<string>, env: Record<string, string> = {}) =>
  Command.runWith(makeCli({ commandName: "t3" }), { version: "0.0.0" })(args).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        NetService.layer,
        ConfigProvider.layer(ConfigProvider.fromEnv({ env })),
      ),
    ),
  ) as Effect.Effect<void, unknown, never>;

const formatCliError = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const cause = (error as any).cause;
    if (cause instanceof Error) return cause.message;
    if (typeof cause === "string") return cause;
    if ("error" in error && typeof (error as any).error === "string") return (error as any).error;
    if (
      "message" in error &&
      typeof (error as any).message === "string" &&
      (error as any).message.length > 0
    ) {
      return (error as any).message;
    }
    return JSON.stringify(error);
  }
  return String(error);
};

const pathExists = (path: string) =>
  Effect.promise(() =>
    NodeFSP.stat(path).then(
      () => true,
      () => false,
    ),
  );

async function startFakeDesktop(input: {
  readonly baseDir: string;
  readonly stateSubdirectory?: "userdata" | "dev";
  readonly platform: NodeJS.Platform;
  readonly userId: number | undefined;
  readonly reply?: (request: DesktopAppActivationRequest) => unknown;
}) {
  const target = resolveDesktopAppControlAddress({
    stateDir: NodePath.join(input.baseDir, input.stateSubdirectory ?? "userdata"),
    platform: input.platform,
    tempDir: NodeOS.tmpdir(),
    userId: input.userId,
    joinPath: NodePath.join,
  });
  if (target.directory !== null) {
    await NodeFSP.mkdir(target.directory, { recursive: true, mode: 0o700 });
    await NodeFSP.unlink(target.address).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  const received: DesktopAppActivationRequest[] = [];
  const server = NodeNet.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const request = JSON.parse(buffer.slice(0, newline)) as DesktopAppActivationRequest;
      received.push(request);
      const response = input.reply
        ? input.reply(request)
        : {
            version: 1,
            requestId: request.requestId,
            ok: true,
            projectId: "project-1",
            threadId: `thread-${received.length}`,
          };
      socket.end(`${JSON.stringify(response)}\n`);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(target.address, resolve);
  });

  return {
    received,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (target.directory !== null) {
        await NodeFSP.unlink(target.address).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    },
  };
}

const fakeDesktop = Effect.fn(function* (
  input: Omit<Parameters<typeof startFakeDesktop>[0], "platform" | "userId">,
) {
  const platform = yield* HostProcessPlatform;
  const userId = yield* HostProcessUserId;
  return yield* Effect.acquireRelease(
    Effect.promise(() => startFakeDesktop({ ...input, platform, userId })),
    (server) => Effect.promise(() => server.close()),
  );
});

const withTempDirectory = <A, E, R>(
  prefix: string,
  use: (root: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.scoped(
    Effect.acquireUseRelease(
      Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), prefix))),
      use,
      (root) => Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true })),
    ),
  );

describe("desktop CLI interruption audit", () => {
  it.effect("closes an in-flight socket when the CLI fiber is interrupted", () =>
    withTempDirectory("tabs-cli-interrupt-audit-", (root) =>
      Effect.gen(function* () {
        const platform = yield* HostProcessPlatform;
        const userId = yield* HostProcessUserId;
        const baseDir = NodePath.join(root, "home");
        const address = resolveDesktopAppControlAddress({
          stateDir: NodePath.join(baseDir, "userdata"),
          platform,
          tempDir: NodeOS.tmpdir(),
          userId,
          joinPath: NodePath.join,
        });
        const accepted = yield* Deferred.make<void>();
        const runSync = Effect.runSync;
        let connected: NodeNet.Socket | undefined;
        let closed = false;
        const server = NodeNet.createServer((socket) => {
          console.log("audit: connection accepted");
          connected = socket;
          socket.on("data", () => runSync(Deferred.succeed(accepted, undefined)));
          socket.on("close", () => {
            closed = true;
          });
        });
        yield* Effect.acquireRelease(
          Effect.promise(async () => {
            if (address.directory)
              await NodeFSP.mkdir(address.directory, { recursive: true, mode: 0o700 });
            await new Promise<void>((resolve, reject) => {
              server.once("error", reject);
              server.listen(address.address, resolve);
            });
          }),
          () =>
            Effect.promise(async () => {
              connected?.destroy();
              await new Promise<void>((resolve) => server.close(() => resolve()));
              await NodeFSP.unlink(address.address).catch(() => undefined);
            }),
        );
        console.log("audit: listener ready", address.address);
        const fiber = yield* runCli(["app", "--base-dir", baseDir]).pipe(
          Effect.tapError((error) =>
            Effect.sync(() => console.log("audit: CLI error", formatCliError(error))),
          ),
          Effect.forkScoped,
        );
        yield* Deferred.await(accepted);
        console.log("audit: request received");
        yield* Fiber.interrupt(fiber);
        console.log("audit: interruption returned");
        yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
        expect(closed).toBe(true);
      }).pipe(Effect.scoped),
    ),
  );
});
