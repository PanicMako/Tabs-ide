// FILE: opencodeRuntime.test.ts
// Purpose: Covers OpenCode runtime parsing and local server startup diagnostics.
// Layer: Provider runtime tests
// Exports: Vitest suites for opencodeRuntime.ts

import { spawn } from "node:child_process";
import { Duration, Effect, Exit, Fiber, Layer, Scope, Sink, Stream } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as TestClock from "effect/testing/TestClock";
import type { ChatAttachment } from "@tabs/contracts";
import { describe, expect, it } from "vitest";

import {
  buildOpenCodePermissionRules,
  buildOpenCodeServerProcessEnv,
  OpenCodeRuntime,
  OpenCodeRuntimeError,
  makeOpenCodeRuntimeLive,
  OPENCODE_LOCAL_SERVER_IDLE_TTL_MS,
  parseOpenCodeCliModelsOutput,
  parseOpenCodeCredentialProviderIDs,
  resolveOpenCodeConfigContent,
  toOpenCodeFileParts,
  watchDetachedOpenCodeProcessGroup,
} from "./opencodeRuntime.ts";

const encoder = new TextEncoder();

it.skipIf(process.platform === "win32")(
  "stops a detached provider group after its owner dies",
  async () => {
    const owner = spawn("/bin/sleep", ["60"], { stdio: "ignore" });
    const provider = spawn("/bin/sleep", ["60"], { detached: true, stdio: "ignore" });
    try {
      expect(owner.pid).toBeDefined();
      expect(provider.pid).toBeDefined();
      watchDetachedOpenCodeProcessGroup(provider.pid!, owner.pid!);
      owner.kill("SIGKILL");
      await Promise.race([
        new Promise<void>((resolve) => provider.once("exit", () => resolve())),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Provider group survived its owner")), 7_000),
        ),
      ]);
    } finally {
      owner.kill("SIGKILL");
      if (provider.pid) {
        try {
          process.kill(-provider.pid, "SIGKILL");
        } catch {
          // The watchdog already terminated the group.
        }
      }
    }
  },
);

describe("OpenCode process configuration", () => {
  it("preserves explicit and inherited config content", () => {
    expect(resolveOpenCodeConfigContent({ OPENCODE_CONFIG_CONTENT: '{"model":"explicit"}' })).toBe(
      '{"model":"explicit"}',
    );
    expect(
      resolveOpenCodeConfigContent({}, { OPENCODE_CONFIG_CONTENT: '{"model":"inherited"}' }),
    ).toBe('{"model":"inherited"}');
    expect(resolveOpenCodeConfigContent({}, {})).toBe("{}");
  });
});

describe("OpenCode permission policy", () => {
  it("keeps full access non-interactive while enforcing read-only Plan turns", () => {
    expect(buildOpenCodePermissionRules("full-access")).toEqual([
      { permission: "*", pattern: "*", action: "allow" },
    ]);
    expect(buildOpenCodePermissionRules("full-access", "plan" as any)).toEqual([
      { permission: "*", pattern: "*", action: "deny" },
      { permission: "read", pattern: "*", action: "allow" },
      { permission: "glob", pattern: "*", action: "allow" },
      { permission: "grep", pattern: "*", action: "allow" },
      { permission: "list", pattern: "*", action: "allow" },
      { permission: "lsp", pattern: "*", action: "allow" },
      { permission: "webfetch", pattern: "*", action: "allow" },
      { permission: "websearch", pattern: "*", action: "allow" },
      { permission: "codesearch", pattern: "*", action: "allow" },
      { permission: "todoread", pattern: "*", action: "allow" },
      { permission: "todowrite", pattern: "*", action: "allow" },
      { permission: "question", pattern: "*", action: "allow" },
    ]);
  });
});

function mockOpenCodeServerHandle(input: {
  stdout: string;
  stderr: string;
  pid?: number;
  exitCode?: Effect.Effect<ChildProcessSpawner.ExitCode, never>;
  kill?: () => Effect.Effect<void, never>;
}) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(input.pid ?? 1),
    exitCode: input.exitCode ?? Effect.never,
    isRunning: Effect.succeed(true),
    kill: input.kill ?? (() => Effect.void),
    stdin: Sink.drain,
    stdout: Stream.make(encoder.encode(input.stdout)),
    stderr: Stream.make(encoder.encode(input.stderr)),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.void as any,
  });
}

function mockOpenCodeServerSpawnerLayer(input: { stdout: string; stderr: string }) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() => Effect.succeed(mockOpenCodeServerHandle(input))),
  );
}

function mockPooledOpenCodeServerSpawnerLayer(state: {
  spawnUrls: Array<string>;
  spawnCwds?: Array<string | undefined>;
  killUrls: Array<string>;
  processUrls?: Map<number, string>;
}) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      const cmd = command as unknown as {
        options?: { cwd?: string };
      };
      const url = `http://127.0.0.1:${59000 + state.spawnUrls.length}`;
      const pid = 59_000 + state.spawnUrls.length;
      state.spawnUrls.push(url);
      state.spawnCwds?.push(cmd.options?.cwd);
      state.processUrls?.set(pid, url);
      return Effect.succeed(
        mockOpenCodeServerHandle({
          stdout: `opencode server listening on ${url}\n`,
          stderr: "",
          pid,
          kill: () =>
            Effect.sync(() => {
              state.killUrls.push(url);
            }),
        }),
      );
    }),
  );
}

const advanceOpenCodePoolIdleClock = Effect.gen(function* () {
  yield* Effect.yieldNow;
  yield* TestClock.adjust(Duration.millis(OPENCODE_LOCAL_SERVER_IDLE_TTL_MS + 1));
  yield* Effect.yieldNow;
});

const advanceOpenCodePoolAlmostToIdle = Effect.gen(function* () {
  yield* Effect.yieldNow;
  yield* TestClock.adjust(Duration.millis(OPENCODE_LOCAL_SERVER_IDLE_TTL_MS - 1));
  yield* Effect.yieldNow;
});

function openCodeRuntimePoolTestLayer(state: {
  spawnUrls: Array<string>;
  killUrls: Array<string>;
}) {
  const processUrls = new Map<number, string>();
  return Layer.merge(
    makeOpenCodeRuntimeLive({
      netService: {
        canListenOnHost: () => Effect.succeed(true),
        isPortAvailableOnLoopback: () => Effect.succeed(true),
        hasListenerOnHost: () => Effect.succeed(false),
        reserveLoopbackPort: () => Effect.succeed(59_000),
        findAvailablePort: () => Effect.succeed(59_000),
      },
      teardownProcessTree: async ({ rootPid }: { rootPid?: any }) => {
        const url = processUrls.get(rootPid);
        if (url) state.killUrls.push(url);
        return { escalated: false, signalErrors: [] };
      },
    }).pipe(Layer.provide(mockPooledOpenCodeServerSpawnerLayer({ ...state, processUrls }))),
    TestClock.layer(),
  );
}

describe("toOpenCodeFileParts", () => {
  it("materializes image attachments as SDK file parts", () => {
    const attachment = {
      type: "image",
      id: "thread-attachment-image",
      name: "screenshot.png",
      mimeType: "image/png",
      sizeBytes: 12,
    } satisfies ChatAttachment;

    expect(
      toOpenCodeFileParts({
        attachments: [attachment],
        resolveAttachmentPath: () => "/tmp/synara-attachments/screenshot.png",
      }),
    ).toEqual([
      {
        type: "file",
        mime: "image/png",
        filename: "screenshot.png",
        url: "file:///tmp/synara-attachments/screenshot.png",
      },
    ]);
  });

  it("leaves generic files for prompt-path projection", () => {
    const attachment: any = {
      type: "file",
      id: "thread-attachment-file",
      name: "notes.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 12,
    };

    expect(
      toOpenCodeFileParts({
        attachments: [attachment],
        resolveAttachmentPath: () => "/tmp/synara-attachments/notes.docx",
      }),
    ).toEqual([]);
  });
});

describe("buildOpenCodeServerProcessEnv", () => {
  it("does not override file-based config with synthetic empty config content", () => {
    const env = buildOpenCodeServerProcessEnv({
      baseEnv: {
        PATH: "/usr/bin",
      },
    });

    expect(env.OPENCODE_CONFIG_CONTENT).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
  });

  it("preserves an explicitly configured config-content environment value", () => {
    const env = buildOpenCodeServerProcessEnv({
      baseEnv: {
        OPENCODE_CONFIG_CONTENT: '{"provider":{"openai":{}}}',
      },
    });

    expect(env.OPENCODE_CONFIG_CONTENT).toBe('{"provider":{"openai":{}}}');
  });

  it("strips inherited Synara authority from managed server processes", () => {
    const env = buildOpenCodeServerProcessEnv({
      baseEnv: {
        OPENAI_API_KEY: "provider-key",
        SYNARA_AUTH_TOKEN: "server-secret",
        SYNARA_BROWSER_USE_PIPE_PATH: "/tmp/browser.sock",
      },
    });

    expect(env.OPENAI_API_KEY).toBe("provider-key");
    expect(env.SYNARA_AUTH_TOKEN).toBeUndefined();
    expect(env.SYNARA_BROWSER_USE_PIPE_PATH).toBeUndefined();
  });
});

describe("OpenCodeRuntime startup diagnostics", () => {
  it("includes command and partial process output when server startup times out", async () => {
    const error = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* OpenCodeRuntime;
          return yield* runtime
            .startOpenCodeServerProcess({
              binaryPath: "/custom/bin/opencode",
              hostname: "127.0.0.1",
              port: 58123,
              timeoutMs: 5,
            })
            .pipe(Effect.flip);
        }),
      ).pipe(
        Effect.provide(
          makeOpenCodeRuntimeLive({
            teardownProcessTree: async () => ({
              escalated: false,
              signalErrors: [],
            }),
          }).pipe(
            Layer.provide(
              mockOpenCodeServerSpawnerLayer({
                stdout: "booting custom OpenCode wrapper\n",
                stderr: "loading provider credentials\n",
              }),
            ),
          ),
        ),
      ) as any,
    );

    expect(OpenCodeRuntimeError.is(error)).toBe(true);
    expect((error as any).detail).toContain(
      "Timed out waiting for OpenCode server start after 5ms.",
    );
    expect((error as any).detail).toContain(
      "command: /custom/bin/opencode serve --hostname 127.0.0.1 --port 58123",
    );
    expect((error as any).detail).toContain('OpenCode ready prefix: "opencode server listening"');
    expect((error as any).detail).toContain("stdout:\nbooting custom OpenCode wrapper");
    expect((error as any).detail).toContain("stderr:\nloading provider credentials");
  });

  it("redacts likely secrets from startup timeout diagnostics and causes", async () => {
    const error = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* OpenCodeRuntime;
          return yield* runtime
            .startOpenCodeServerProcess({
              binaryPath: "/custom/bin/opencode",
              hostname: "127.0.0.1",
              port: 58123,
              timeoutMs: 5,
            })
            .pipe(Effect.flip);
        }),
      ).pipe(
        Effect.provide(
          makeOpenCodeRuntimeLive({
            teardownProcessTree: async () => ({
              escalated: false,
              signalErrors: [],
            }),
          }).pipe(
            Layer.provide(
              mockOpenCodeServerSpawnerLayer({
                stdout: "OPENAI_API_KEY=sk-live-123\nauth_token: token-abc\nsafe line\n",
                stderr: 'Authorization: Bearer auth-secret\nserverPassword="pw-secret"\n',
              }),
            ),
          ),
        ),
      ) as any,
    );
    const causeJson = JSON.stringify((error as any).cause);

    expect((error as any).detail).toContain("OPENAI_API_KEY=[redacted]");
    expect((error as any).detail).toContain("auth_token: [redacted]");
    expect((error as any).detail).toContain("Authorization: Bearer [redacted]");
    expect((error as any).detail).toContain('serverPassword="[redacted]"');
    expect((error as any).detail).toContain("safe line");
    for (const secret of ["sk-live-123", "token-abc", "auth-secret", "pw-secret"]) {
      expect((error as any).detail).not.toContain(secret);
      expect(causeJson).not.toContain(secret);
    }
  });
});

describe("OpenCodeRuntime local server pool", () => {
  it("keeps server scope closure pending until process-tree exit is proven", async () => {
    let proveExit: (() => void) | undefined;
    const exitProof = new Promise<void>((resolve) => {
      proveExit = resolve;
    });
    let teardownCalls = 0;
    const layer = makeOpenCodeRuntimeLive({
      netService: {
        canListenOnHost: () => Effect.succeed(true),
        isPortAvailableOnLoopback: () => Effect.succeed(true),
        hasListenerOnHost: () => Effect.succeed(false),
        reserveLoopbackPort: () => Effect.succeed(59_000),
        findAvailablePort: () => Effect.succeed(59_000),
      },
      teardownProcessTree: async ({ rootPid }: { rootPid?: any }) => {
        teardownCalls += 1;
        expect(rootPid).toBe(1);
        await exitProof;
        return { escalated: false, signalErrors: [] };
      },
    }).pipe(
      Layer.provide(
        mockOpenCodeServerSpawnerLayer({
          stdout: "opencode server listening on http://127.0.0.1:59000\n",
          stderr: "",
        }),
      ),
    );

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* OpenCodeRuntime;
          const serverScope = yield* Scope.make("sequential");
          yield* runtime
            .startOpenCodeServerProcess({ binaryPath: "opencode" })
            .pipe(Effect.provideService(Scope.Scope, serverScope));

          const closing = yield* Scope.close(serverScope, Exit.void).pipe(Effect.forkChild);
          yield* Effect.yieldNow;
          expect(teardownCalls).toBe(1);
          expect(closing.pollUnsafe()).toBeUndefined();

          proveExit?.();
          yield* Fiber.join(closing);
        }),
      ).pipe(Effect.provide(layer)) as any,
    );
  });

  it("reuses a local server while scoped sessions are active and closes it after idling", async () => {
    const state = { spawnUrls: [] as Array<string>, killUrls: [] as Array<string> };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* OpenCodeRuntime;
          const firstScope = yield* Scope.make();
          const secondScope = yield* Scope.make();

          const first = yield* runtime
            .connectToOpenCodeServer({ binaryPath: "opencode" })
            .pipe(Effect.provideService(Scope.Scope, firstScope));
          const second = yield* runtime
            .connectToOpenCodeServer({ binaryPath: "opencode" })
            .pipe(Effect.provideService(Scope.Scope, secondScope));

          expect(first.external).toBe(false);
          expect(first.url).toBe(second.url);
          expect(state.spawnUrls).toEqual(["http://127.0.0.1:59000"]);

          yield* Scope.close(firstScope, Exit.void);
          yield* advanceOpenCodePoolIdleClock;
          expect(state.killUrls).toEqual([]);

          yield* Scope.close(secondScope, Exit.void);
          yield* advanceOpenCodePoolIdleClock;
          expect(state.killUrls).toEqual(["http://127.0.0.1:59000"]);

          const thirdScope = yield* Scope.make();
          const third = yield* runtime
            .connectToOpenCodeServer({ binaryPath: "opencode" })
            .pipe(Effect.provideService(Scope.Scope, thirdScope));
          expect(third.url).toBe("http://127.0.0.1:59001");
          expect(state.spawnUrls).toEqual(["http://127.0.0.1:59000", "http://127.0.0.1:59001"]);
          yield* Scope.close(thirdScope, Exit.void);
        }),
      ).pipe(Effect.provide(openCodeRuntimePoolTestLayer(state) as any)) as any,
    );
  });

  it("isolates same-cwd owners and closes private servers immediately on release", async () => {
    const state = { spawnUrls: [] as Array<string>, killUrls: [] as Array<string> };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* OpenCodeRuntime;
          const firstScope = yield* Scope.make();
          const secondScope = yield* Scope.make();
          const first = yield* runtime
            .connectToOpenCodeServer({
              binaryPath: "opencode",
              ...({ cwd: "/repo", poolIsolationKey: "synara-thread-a" } as any),
            })
            .pipe(Effect.provideService(Scope.Scope, firstScope));
          const second = yield* runtime
            .connectToOpenCodeServer({
              binaryPath: "opencode",
              ...({ cwd: "/repo", poolIsolationKey: "synara-thread-b" } as any),
            })
            .pipe(Effect.provideService(Scope.Scope, secondScope));

          expect(first.url).not.toBe(second.url);
          expect(state.spawnUrls).toEqual(["http://127.0.0.1:59000", "http://127.0.0.1:59001"]);

          yield* Scope.close(firstScope, Exit.void);
          expect(state.killUrls).toEqual(["http://127.0.0.1:59000"]);
          yield* Scope.close(secondScope, Exit.void);
          expect(state.killUrls).toEqual(["http://127.0.0.1:59000", "http://127.0.0.1:59001"]);
        }),
      ).pipe(Effect.provide(openCodeRuntimePoolTestLayer(state) as any)) as any,
    );
  });

  it("does not spawn or pool when an external OpenCode server URL is configured", async () => {
    const state = { spawnUrls: [] as Array<string>, killUrls: [] as Array<string> };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* OpenCodeRuntime;
          const connection = yield* runtime.connectToOpenCodeServer({
            binaryPath: "opencode",
            serverUrl: " http://127.0.0.1:9999 ",
          });

          expect(connection).toMatchObject({
            url: "http://127.0.0.1:9999",
            exitCode: null,
            external: true,
          });
          expect(state.spawnUrls).toEqual([]);
          expect(state.killUrls).toEqual([]);
        }),
      ).pipe(Effect.provide(openCodeRuntimePoolTestLayer(state) as any)) as any,
    );
  });

  it("keeps the warm server alive when a new session starts before idle expiry", async () => {
    const state = { spawnUrls: [] as Array<string>, killUrls: [] as Array<string> };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* OpenCodeRuntime;
          const firstScope = yield* Scope.make();
          const first = yield* runtime
            .connectToOpenCodeServer({ binaryPath: "opencode" })
            .pipe(Effect.provideService(Scope.Scope, firstScope));

          yield* Scope.close(firstScope, Exit.void);
          yield* advanceOpenCodePoolAlmostToIdle;

          const secondScope = yield* Scope.make();
          const second = yield* runtime
            .connectToOpenCodeServer({ binaryPath: "opencode" })
            .pipe(Effect.provideService(Scope.Scope, secondScope));

          expect(second.url).toBe(first.url);
          expect(state.spawnUrls).toEqual(["http://127.0.0.1:59000"]);

          yield* advanceOpenCodePoolIdleClock;
          expect(state.killUrls).toEqual([]);

          yield* Scope.close(secondScope, Exit.void);
          yield* advanceOpenCodePoolIdleClock;
          expect(state.killUrls).toEqual(["http://127.0.0.1:59000"]);
        }),
      ).pipe(Effect.provide(openCodeRuntimePoolTestLayer(state) as any)) as any,
    );
  });

  it("keeps incompatible local server keys separate", async () => {
    const state = { spawnUrls: [] as Array<string>, killUrls: [] as Array<string> };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* OpenCodeRuntime;
          const firstScope = yield* Scope.make();
          const secondScope = yield* Scope.make();

          const defaultServer = yield* runtime
            .connectToOpenCodeServer({ binaryPath: "opencode" })
            .pipe(Effect.provideService(Scope.Scope, firstScope));
          const customServer = yield* runtime
            .connectToOpenCodeServer({ binaryPath: "/custom/bin/opencode" })
            .pipe(Effect.provideService(Scope.Scope, secondScope));

          expect(defaultServer.url).toBe("http://127.0.0.1:59000");
          expect(customServer.url).toBe("http://127.0.0.1:59001");
          expect(state.spawnUrls).toEqual(["http://127.0.0.1:59000", "http://127.0.0.1:59001"]);

          yield* Scope.close(firstScope, Exit.void);
          yield* Scope.close(secondScope, Exit.void);
        }),
      ).pipe(Effect.provide(openCodeRuntimePoolTestLayer(state) as any)) as any,
    );
  });

  it("starts local servers in the requested cwd and separates cwd-specific pools", async () => {
    const state = {
      spawnUrls: [] as Array<string>,
      spawnCwds: [] as Array<string | undefined>,
      killUrls: [] as Array<string>,
    };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* OpenCodeRuntime;
          const firstScope = yield* Scope.make();
          const secondScope = yield* Scope.make();
          const thirdScope = yield* Scope.make();

          const first = yield* runtime
            .connectToOpenCodeServer({ binaryPath: "opencode", ...({ cwd: "/repo/alpha" } as any) })
            .pipe(Effect.provideService(Scope.Scope, firstScope));
          const second = yield* runtime
            .connectToOpenCodeServer({ binaryPath: "opencode", ...({ cwd: "/repo/beta" } as any) })
            .pipe(Effect.provideService(Scope.Scope, secondScope));
          const third = yield* runtime
            .connectToOpenCodeServer({ binaryPath: "opencode", ...({ cwd: "/repo/alpha" } as any) })
            .pipe(Effect.provideService(Scope.Scope, thirdScope));

          expect(first.url).toBe("http://127.0.0.1:59000");
          expect(second.url).toBe("http://127.0.0.1:59001");
          expect(third.url).toBe(first.url);
          expect(state.spawnCwds).toEqual(["/repo/alpha", "/repo/beta"]);

          yield* Scope.close(firstScope, Exit.void);
          yield* Scope.close(secondScope, Exit.void);
          yield* Scope.close(thirdScope, Exit.void);
        }),
      ).pipe(Effect.provide(openCodeRuntimePoolTestLayer(state) as any)) as any,
    );
  });
});

describe("parseOpenCodeCliModelsOutput", () => {
  it("parses verbose OpenCode model output with metadata blocks", () => {
    const models = parseOpenCodeCliModelsOutput(`
openai/gpt-5.4
{
  "id": "gpt-5.4",
  "providerID": "openai",
  "name": "GPT-5.4",
  "variants": {
    "low": {
      "reasoningEffort": "low"
    },
    "high": {
      "reasoningEffort": "high"
    }
  }
}
opencode/gpt-5-nano
{
  "id": "gpt-5-nano",
  "providerID": "opencode",
  "name": "GPT-5 Nano",
  "variants": {}
}
`);

    expect(models).toEqual([
      {
        slug: "opencode/gpt-5-nano",
        providerID: "opencode",
        modelID: "gpt-5-nano",
        name: "GPT-5 Nano",
        variants: [],
        supportedReasoningEfforts: [],
      },
      {
        slug: "openai/gpt-5.4",
        providerID: "openai",
        modelID: "gpt-5.4",
        name: "GPT-5.4",
        variants: ["high", "low"],
        supportedReasoningEfforts: [
          {
            value: "low",
          },
          {
            value: "high",
          },
        ],
      },
    ]);
  });

  it("falls back to slug-derived metadata when only plain model lines are present", () => {
    const models = parseOpenCodeCliModelsOutput(`
warning: cached model metadata is unavailable
openai/gpt-5.4
opencode/minimax-m2.5-free
`);

    expect(models).toEqual([
      {
        slug: "openai/gpt-5.4",
        providerID: "openai",
        modelID: "gpt-5.4",
        name: "gpt-5.4",
        variants: [],
        supportedReasoningEfforts: [],
      },
      {
        slug: "opencode/minimax-m2.5-free",
        providerID: "opencode",
        modelID: "minimax-m2.5-free",
        name: "minimax-m2.5-free",
        variants: [],
        supportedReasoningEfforts: [],
      },
    ]);
  });

  it("deduplicates repeated slug entries by keeping the latest descriptor", () => {
    const models = parseOpenCodeCliModelsOutput(`
openai/gpt-5.4
{
  "id": "gpt-5.4",
  "providerID": "openai",
  "name": "GPT-5.4"
}
openai/gpt-5.4
{
  "id": "gpt-5.4",
  "providerID": "openai",
  "name": "GPT-5.4 Latest"
}
`);

    expect(models).toEqual([
      {
        slug: "openai/gpt-5.4",
        providerID: "openai",
        modelID: "gpt-5.4",
        name: "GPT-5.4 Latest",
        variants: [],
        supportedReasoningEfforts: [],
      },
    ]);
  });

  it("keeps verbose reasoning metadata from CLI output", () => {
    const models = parseOpenCodeCliModelsOutput(`
openai/gpt-5.4
{
  "id": "gpt-5.4",
  "providerID": "openai",
  "name": "GPT-5.4",
  "options": {
    "reasoningEffort": "medium"
  },
  "variants": {
    "none": {
      "reasoningEffort": "none"
    },
    "low": {
      "reasoningEffort": "low"
    },
    "medium": {
      "reasoningEffort": "medium"
    },
    "high": {
      "reasoningEffort": "high"
    }
  }
}
`);

    expect(models).toEqual([
      {
        slug: "openai/gpt-5.4",
        providerID: "openai",
        modelID: "gpt-5.4",
        name: "GPT-5.4",
        variants: ["high", "low", "medium", "none"],
        supportedReasoningEfforts: [
          { value: "none" },
          { value: "low" },
          { value: "medium" },
          { value: "high" },
        ],
        defaultReasoningEffort: "medium",
      },
    ]);
  });

  it("reads current OpenCode variant effort shapes from verbose CLI output", () => {
    const models = parseOpenCodeCliModelsOutput(`
opencode/claude-opus-4-7
{
  "id": "claude-opus-4-7",
  "providerID": "opencode",
  "name": "Claude Opus 4.7",
  "options": {
    "effort": "high"
  },
  "variants": {
    "low": {
      "thinking": {
        "type": "adaptive"
      }
    },
    "medium": {
      "thinking": {
        "type": "adaptive"
      },
      "effort": "medium"
    },
    "high": {
      "thinking": {
        "type": "adaptive"
      },
      "effort": "high"
    },
    "xhigh": {
      "thinking": {
        "type": "adaptive"
      },
      "effort": "xhigh"
    },
    "max": {
      "thinking": {
        "type": "adaptive"
      },
      "effort": "max"
    }
  }
}
opencode/gemini-3-flash
{
  "id": "gemini-3-flash",
  "providerID": "opencode",
  "name": "Gemini 3 Flash",
  "variants": {
    "minimal": {
      "thinkingConfig": {
        "thinkingLevel": "minimal"
      }
    },
    "high": {
      "thinkingConfig": {
        "thinkingLevel": "high"
      }
    }
  }
}
openrouter/grok-3-mini
{
  "id": "grok-3-mini",
  "providerID": "openrouter",
  "name": "Grok 3 Mini",
  "variants": {
    "low": {
      "reasoning": {
        "effort": "low"
      }
    },
    "high": {
      "reasoning": {
        "effort": "high"
      }
    }
  }
}
amazon-bedrock/nova-reel
{
  "id": "nova-reel",
  "providerID": "amazon-bedrock",
  "name": "Nova Reel",
  "variants": {
    "medium": {
      "reasoningConfig": {
        "maxReasoningEffort": "medium"
      }
    }
  }
}
`);

    expect(models).toEqual([
      {
        slug: "opencode/claude-opus-4-7",
        providerID: "opencode",
        modelID: "claude-opus-4-7",
        name: "Claude Opus 4.7",
        variants: ["high", "low", "max", "medium", "xhigh"],
        supportedReasoningEfforts: [
          { value: "low" },
          { value: "medium" },
          { value: "high" },
          { value: "xhigh" },
          { value: "max" },
        ],
        defaultReasoningEffort: "high",
      },
      {
        slug: "opencode/gemini-3-flash",
        providerID: "opencode",
        modelID: "gemini-3-flash",
        name: "Gemini 3 Flash",
        variants: ["high", "minimal"],
        supportedReasoningEfforts: [{ value: "minimal" }, { value: "high" }],
      },
      {
        slug: "openrouter/grok-3-mini",
        providerID: "openrouter",
        modelID: "grok-3-mini",
        name: "Grok 3 Mini",
        variants: ["high", "low"],
        supportedReasoningEfforts: [{ value: "low" }, { value: "high" }],
      },
      {
        slug: "amazon-bedrock/nova-reel",
        providerID: "amazon-bedrock",
        modelID: "nova-reel",
        name: "Nova Reel",
        variants: ["medium"],
        supportedReasoningEfforts: [{ value: "medium" }],
      },
    ]);
  });
});

describe("parseOpenCodeCredentialProviderIDs", () => {
  it("returns top-level provider ids from the OpenCode credential store", () => {
    const providerIDs = parseOpenCodeCredentialProviderIDs(`{
  "openai": {
    "type": "oauth"
  },
  "opencode": {
    "type": "api"
  }
}`);

    expect(providerIDs).toEqual(["openai", "opencode"]);
  });

  it("ignores non-object entries and empty keys", () => {
    const providerIDs = parseOpenCodeCredentialProviderIDs(`{
  "": {
    "type": "oauth"
  },
  "openai": {
    "type": "oauth"
  },
  "broken": "nope"
}`);

    expect(providerIDs).toEqual(["openai"]);
  });
});
