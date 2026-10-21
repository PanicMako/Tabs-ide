// @effect-diagnostics nodeBuiltinImport:off - the test kills a real Node process to prove the cache is on disk.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { persistCompileCacheOnShutdown } from "./compileCache.ts";

it.each([false, true])(
  "persists an enabled cache before forced exit (disabled: %s)",
  async (disabled) => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-compile-cache-"));
    try {
      const cacheDirectory = NodePath.join(directory, "cache");
      const child = NodeChildProcess.spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `import * as Effect from ${JSON.stringify(import.meta.resolve("effect/Effect"))};
const { flushCompileCache } = await import(${JSON.stringify(new URL("./compileCache.ts", import.meta.url).href)});
await Effect.runPromise(flushCompileCache);
process.kill(process.pid, "SIGKILL");`,
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            NODE_COMPILE_CACHE: cacheDirectory,
            NODE_DISABLE_COMPILE_CACHE: disabled ? "1" : undefined,
          },
        },
      );
      assert.equal(child.error, undefined);
      assert.equal(child.stderr, "");
      assert.notEqual(child.status, 0);
      const entries = await NodeFSP.readdir(cacheDirectory, { recursive: true }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        },
      );
      const files = await Promise.all(
        entries.map((entry) => NodeFSP.stat(NodePath.join(cacheDirectory, entry))),
      );
      assert.equal(
        files.some((entry) => entry.isFile()),
        !disabled,
      );
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  },
);

it.each([
  ["win32", "SIGKILL", true],
  ["darwin", "SIGKILL", false],
  ["linux", "SIGKILL", false],
  ["darwin", "SIGTERM", true],
  ["linux", "SIGTERM", true],
] as const)(
  "preserves the cache on %s with %s (explicit persistence: %s)",
  async (platform, signal, explicitFlush) => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "tabs-startup-cache-"));
    try {
      const cacheDirectory = NodePath.join(directory, "cache");
      const child = NodeChildProcess.spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `
import * as Effect from ${JSON.stringify(import.meta.resolve("effect/Effect"))};
import * as NodeRuntime from ${JSON.stringify(import.meta.resolve("@effect/platform-node/NodeRuntime"))};
import NodeModule from "node:module";
const flush = NodeModule.flushCompileCache;
NodeModule.flushCompileCache = () => { console.log("explicit-flush"); flush(); };
NodeModule.syncBuiltinESMExports();
const { flushCompileCacheForStartup, persistCompileCacheOnShutdown } = await import(${JSON.stringify(new URL("./compileCache.ts", import.meta.url).href)});
NodeRuntime.runMain(Effect.scoped(Effect.gen(function* () {
  yield* persistCompileCacheOnShutdown;
  // Model a held HTTP connection/finalizer: persistence must precede teardown.
  yield* Effect.addFinalizer(() => Effect.never);
  yield* flushCompileCacheForStartup(${JSON.stringify(platform)});
  console.log("startup-complete");
  setTimeout(() => process.kill(process.pid, ${JSON.stringify(signal)}), 10);
  setTimeout(() => process.kill(process.pid, "SIGKILL"), 100);
  yield* Effect.never;
})));
`,
        ],
        {
          encoding: "utf8",
          timeout: 10_000,
          env: {
            ...process.env,
            NODE_COMPILE_CACHE: cacheDirectory,
            NODE_DISABLE_COMPILE_CACHE: undefined,
          },
        },
      );
      assert.equal(child.error, undefined);
      const entries = await NodeFSP.readdir(cacheDirectory, { recursive: true });
      const files = await Promise.all(
        entries.map((entry) => NodeFSP.stat(NodePath.join(cacheDirectory, entry))),
      );
      const beforeSignal = child.stdout.split("startup-complete")[0]!;
      assert.equal(beforeSignal.includes("explicit-flush"), platform === "win32");
      assert.equal(child.stdout.includes("explicit-flush"), explicitFlush);
      if (signal === "SIGTERM" || explicitFlush) {
        assert.equal(
          files.some((entry) => entry.isFile()),
          true,
        );
      }
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  },
);

it.effect("removes shutdown persistence listeners when its scope closes", () =>
  Effect.gen(function* () {
    const beforeTerm = process.listenerCount("SIGTERM");
    const beforeInt = process.listenerCount("SIGINT");
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* persistCompileCacheOnShutdown;
        assert.equal(process.listenerCount("SIGTERM"), beforeTerm + 1);
        assert.equal(process.listenerCount("SIGINT"), beforeInt + 1);
      }),
    );
    assert.equal(process.listenerCount("SIGTERM"), beforeTerm);
    assert.equal(process.listenerCount("SIGINT"), beforeInt);
  }),
);
