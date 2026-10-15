import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import { CopilotSettings, ProviderInstanceId, ProviderSessionId, ThreadId } from "@tabs/contracts";
import { resolveSelfInvocation } from "@tabs/shared/nodeRuntime";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { ServerConfig } from "../../config.ts";
import * as IdAllocator from "../IdAllocator.ts";
import { ProviderAdapterV2RuntimePolicy } from "../ProviderAdapter.ts";
import { makeCopilotAdapterV2 } from "./CopilotAdapterV2.ts";
import { makeCopilotAcpRuntime } from "../../provider/acp/CopilotAcpSupport.ts";

vi.mock("../../provider/CopilotCredentialStore.ts", () => ({ getCopilotToken: async () => null }));

const platform = Layer.mergeAll(
  NodeServices.layer,
  IdAllocator.layer,
  ServerConfig.layerTest(process.cwd(), { prefix: "tabs-copilot-v2-" }).pipe(
    Layer.provide(NodeServices.layer),
  ),
);

it.layer(platform, { excludeTestServices: true })("Copilot V2 ACP wiring", (it) => {
  it.effect(
    "opens a configured Copilot process through V2 and negotiates protocol2 model configuration",
    () =>
      Effect.gen(function* () {
        const nodeSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const path = yield* Path.Path;
        const mockAgentPath = yield* path.fromFileUrl(
          new URL("../../../scripts/acp-mock-agent.ts", import.meta.url),
        );
        const launches: Array<{ command: string; args: ReadonlyArray<string> }> = [];
        const spawner = ChildProcessSpawner.make((command) => {
          if (!ChildProcess.isStandardCommand(command)) return nodeSpawner.spawn(command);
          launches.push({ command: command.command, args: command.args });
          return nodeSpawner.spawn(
            ChildProcess.make(process.execPath, [mockAgentPath], {
              cwd: command.options.cwd,
              env: { ...command.options.env, T3_ACP_SESSION_LIFECYCLE: "1" },
            }),
          );
        });
        const instanceId = ProviderInstanceId.make("copilot-test-instance");
        const threadId = ThreadId.make("copilot:test-thread");
        const adapter = makeCopilotAdapterV2({
          instanceId,
          settings: Schema.decodeSync(CopilotSettings)({ binaryPath: "configured-copilot" }),
          environment: {},
          childProcessSpawner: spawner,
          crypto: yield* Crypto.Crypto,
          fileSystem: yield* FileSystem.FileSystem,
          idAllocator: yield* IdAllocator.IdAllocatorV2,
          serverConfig: yield* ServerConfig,
          selfInvocation: yield* resolveSelfInvocation(),
        });
        const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
          runtimeMode: "full-access",
          interactionMode: "default",
          cwd: process.cwd(),
        });
        const modelSelection = { instanceId, model: "composer-2" };
        const runtime = yield* adapter.openSession({
          threadId,
          providerSessionId: ProviderSessionId.make("copilot:test-session"),
          modelSelection,
          runtimePolicy,
        });
        const thread = yield* runtime.ensureThread({ threadId, modelSelection, runtimePolicy });
        expect(thread.providerInstanceId).toBe(instanceId);
        expect(thread.nativeThreadRef).not.toBeNull();
        expect(launches).toEqual([{ command: "configured-copilot", args: ["--acp", "--stdio"] }]);
        expect((yield* adapter.getCapabilities()).turns.supportsQueuedMessages).toBe(true);
      }),
  );

  it.effect(
    "opens a configured Copilot process through V2 and negotiates protocol1 model configuration",
    () =>
      Effect.gen(function* () {
        const nodeSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const path = yield* Path.Path;
        const mockAgentPath = yield* path.fromFileUrl(
          new URL("../../../scripts/acp-mock-agent.ts", import.meta.url),
        );
        const launches: Array<{ command: string; args: ReadonlyArray<string> }> = [];
        const spawner = ChildProcessSpawner.make((command) => {
          if (!ChildProcess.isStandardCommand(command)) return nodeSpawner.spawn(command);
          launches.push({ command: command.command, args: command.args });
          return nodeSpawner.spawn(
            ChildProcess.make(process.execPath, [mockAgentPath], {
              cwd: command.options.cwd,
              env: {
                ...command.options.env,
                T3_ACP_SESSION_LIFECYCLE: "1",
              },
            }),
          );
        });
        const instanceId = ProviderInstanceId.make("copilot-test-instance-p1");
        const threadId = ThreadId.make("copilot:test-thread-p1");
        const sessionModelCalls: Array<string> = [];
        const adapter = makeCopilotAdapterV2({
          instanceId,
          settings: Schema.decodeSync(CopilotSettings)({ binaryPath: "configured-copilot-p1" }),
          environment: {},
          childProcessSpawner: spawner,
          crypto: yield* Crypto.Crypto,
          fileSystem: yield* FileSystem.FileSystem,
          idAllocator: yield* IdAllocator.IdAllocatorV2,
          serverConfig: yield* ServerConfig,
          selfInvocation: yield* resolveSelfInvocation(),
          makeRuntime: (input) =>
            Effect.gen(function* () {
              const runtime = yield* makeCopilotAcpRuntime({
                ...input,
                copilotSettings: { binaryPath: "configured-copilot-p1" },
                childProcessSpawner: spawner,
              });
              return {
                ...runtime,
                start: () =>
                  runtime.start().pipe(
                    Effect.map((startRes) => ({
                      ...startRes,
                      initializeResult: {
                        ...startRes.initializeResult,
                        protocolVersion: 1,
                      },
                      sessionSetupResult: {
                        ...startRes.sessionSetupResult,
                        models: startRes.sessionSetupResult.models
                          ? { ...startRes.sessionSetupResult.models, currentModelId: "old-model" }
                          : { currentModelId: "old-model", availableModels: [] },
                      },
                    })),
                  ),
                setSessionModel: (model: string) =>
                  Effect.gen(function* () {
                    sessionModelCalls.push(model);
                    return {} as any;
                  }),
              };
            }),
        });
        const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
          runtimeMode: "full-access",
          interactionMode: "default",
          cwd: process.cwd(),
        });
        const modelSelection = { instanceId, model: "composer-2" };
        const runtime = yield* adapter.openSession({
          threadId,
          providerSessionId: ProviderSessionId.make("copilot:test-session-p1"),
          modelSelection,
          runtimePolicy,
        });
        const thread = yield* runtime.ensureThread({ threadId, modelSelection, runtimePolicy });
        expect(thread.providerInstanceId).toBe(instanceId);
        expect(sessionModelCalls).toEqual(["composer-2"]);
        expect(launches).toEqual([
          { command: "configured-copilot-p1", args: ["--acp", "--stdio"] },
        ]);
      }),
  );
});
