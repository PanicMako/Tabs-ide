import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import { DroidSettings, ProviderInstanceId, ProviderSessionId, ThreadId } from "@tabs/contracts";
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
import {
  makeDroidAdapterV2,
  DROID_PROVIDER,
  DroidProviderCapabilitiesV2,
} from "./DroidAdapterV2.ts";

vi.mock("../../provider/ProviderSecretStore.ts", () => ({
  getProviderSecret: async () => null,
}));

const platform = Layer.mergeAll(
  NodeServices.layer,
  IdAllocator.layer,
  ServerConfig.layerTest(process.cwd(), { prefix: "tabs-droid-v2-" }).pipe(
    Layer.provide(NodeServices.layer),
  ),
);

it.layer(platform, { excludeTestServices: true })("Factory Droid V2 ACP wiring", (it) => {
  it.effect(
    "opens a configured Droid process through V2 with exec --output-format acp and discovers capabilities",
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

        const instanceId = ProviderInstanceId.make("droid-test-instance");
        const threadId = ThreadId.make("droid:test-thread");
        const adapter = makeDroidAdapterV2({
          instanceId,
          settings: Schema.decodeSync(DroidSettings)({
            binaryPath: "configured-droid",
            apiKey: "fk-test-key",
          }),
          environment: {},
          childProcessSpawner: spawner,
          crypto: yield* Crypto.Crypto,
          fileSystem: yield* FileSystem.FileSystem,
          idAllocator: yield* IdAllocator.IdAllocatorV2,
          serverConfig: yield* ServerConfig,
          selfInvocation: yield* resolveSelfInvocation(),
        });

        expect(adapter.driver).toBe(DROID_PROVIDER);
        const capabilities = yield* adapter.getCapabilities();
        expect(capabilities).toEqual(DroidProviderCapabilitiesV2);
        expect(capabilities.sessions.supportsModelSwitchInSession).toBe(true);
        expect(capabilities.tools.supportsMcpTools).toBe(true);

        const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
          runtimeMode: "full-access",
          interactionMode: "default",
          cwd: process.cwd(),
        });
        const modelSelection = { instanceId, model: "composer-2" };
        const runtime = yield* adapter.openSession({
          threadId,
          providerSessionId: ProviderSessionId.make("droid:test-session"),
          modelSelection,
          runtimePolicy,
        });

        const thread = yield* runtime.ensureThread({ threadId, modelSelection, runtimePolicy });
        expect(thread.providerInstanceId).toBe(instanceId);
        expect(thread.driver).toBe("droid");
        expect(thread.nativeThreadRef).not.toBeNull();
        expect(launches).toEqual([
          { command: "configured-droid", args: ["exec", "--output-format", "acp"] },
        ]);
      }),
  );

  it.effect("handles auto model selection without forcing a specific model switch", () =>
    Effect.gen(function* () {
      const nodeSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const path = yield* Path.Path;
      const mockAgentPath = yield* path.fromFileUrl(
        new URL("../../../scripts/acp-mock-agent.ts", import.meta.url),
      );
      const spawner = ChildProcessSpawner.make((command) => {
        if (!ChildProcess.isStandardCommand(command)) return nodeSpawner.spawn(command);
        return nodeSpawner.spawn(
          ChildProcess.make(process.execPath, [mockAgentPath], {
            cwd: command.options.cwd,
            env: { ...command.options.env, T3_ACP_SESSION_LIFECYCLE: "1" },
          }),
        );
      });

      const instanceId = ProviderInstanceId.make("droid-auto-instance");
      const threadId = ThreadId.make("droid:auto-thread");
      const adapter = makeDroidAdapterV2({
        instanceId,
        settings: Schema.decodeSync(DroidSettings)({ binaryPath: "droid" }),
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
      const modelSelection = { instanceId, model: "auto" };
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("droid:auto-session"),
        modelSelection,
        runtimePolicy,
      });

      const thread = yield* runtime.ensureThread({ threadId, modelSelection, runtimePolicy });
      expect(thread.driver).toBe("droid");
      expect(thread.providerInstanceId).toBe(instanceId);
    }),
  );
});
