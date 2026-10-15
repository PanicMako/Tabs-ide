import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { KiloSettings, ProviderInstanceId, ProviderSessionId, ThreadId } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../../config.ts";
import type { OpenCodeRuntimeShape } from "../../provider/opencodeRuntime.ts";
import * as IdAllocator from "../IdAllocator.ts";
import { ProviderAdapterV2RuntimePolicy } from "../ProviderAdapter.ts";
import { makeKiloAdapterV2, KILO_PROVIDER, KiloProviderCapabilitiesV2 } from "./KiloAdapterV2.ts";

const platform = Layer.mergeAll(
  NodeServices.layer,
  IdAllocator.layer,
  ServerConfig.layerTest(process.cwd(), { prefix: "tabs-kilo-v2-" }).pipe(
    Layer.provide(NodeServices.layer),
  ),
);

it.layer(platform, { excludeTestServices: true })("Kilo V2 adapter", (it) => {
  it.effect("reports Kilo driver identity and capabilities", () =>
    Effect.gen(function* () {
      const idAllocator = yield* IdAllocator.IdAllocatorV2;
      const serverConfig = yield* ServerConfig.ServerConfig;
      const instanceId = ProviderInstanceId.make("kilo-test-instance");

      const adapter = makeKiloAdapterV2({
        instanceId,
        settings: Schema.decodeSync(KiloSettings)({ binaryPath: "kilo" }),
        environment: {},
        runtime: {
          connectToOpenCodeServer: () =>
            Effect.succeed({ url: "http://test.invalid", external: true }),
          createOpenCodeSdkClient: () => ({}),
        } as unknown as OpenCodeRuntimeShape,
        idAllocator,
        serverConfig,
      });

      expect(adapter.driver).toBe(KILO_PROVIDER);
      expect(adapter.instanceId).toBe(instanceId);

      const capabilities = yield* adapter.getCapabilities();
      expect(capabilities).toEqual(KiloProviderCapabilitiesV2);
      expect(capabilities.sessions.supportsModelSwitchInSession).toBe(true);
      expect(capabilities.tools.supportsMcpTools).toBe(true);
      expect(capabilities.turns.supportsQueuedMessages).toBe(true);
    }),
  );

  it.effect("opens a session with configured binary and derives threads with driver kilo", () =>
    Effect.gen(function* () {
      const idAllocator = yield* IdAllocator.IdAllocatorV2;
      const serverConfig = yield* ServerConfig.ServerConfig;
      const instanceId = ProviderInstanceId.make("kilo-session-instance");
      const threadId = ThreadId.make("thread:kilo-test");
      const providerSessionId = ProviderSessionId.make("session:kilo-test");

      let connectedBinaryPath: string | undefined;
      const mockSession = {
        id: "native-kilo-session-42",
        time: { created: Date.now(), updated: Date.now() },
      };

      const mockClient = {
        session: {
          create: () => Promise.resolve({ data: mockSession }),
          get: () => Promise.resolve({ data: mockSession }),
          messages: () => Promise.resolve({ data: [] }),
          status: () => Promise.resolve({ data: { type: "idle" } }),
          abort: () => Promise.resolve({ data: undefined }),
          children: () => Promise.resolve({ data: [] }),
        },
        event: {
          subscribe: async () => {
            let connected = false;
            let finish: ((result: IteratorResult<unknown>) => void) | undefined;
            return {
              stream: {
                [Symbol.asyncIterator]() {
                  return {
                    next: () => {
                      if (!connected) {
                        connected = true;
                        return Promise.resolve({
                          done: false,
                          value: { type: "server.connected", properties: {} },
                        });
                      }
                      return new Promise<IteratorResult<unknown>>((resolve) => {
                        finish = resolve;
                      });
                    },
                    return: () => {
                      const result = { done: true as const, value: undefined };
                      finish?.(result);
                      return Promise.resolve(result);
                    },
                  };
                },
              },
            };
          },
        },
      };

      const adapter = makeKiloAdapterV2({
        instanceId,
        settings: Schema.decodeSync(KiloSettings)({
          binaryPath: "/custom/path/to/kilo",
          serverUrl: "http://127.0.0.1:4096",
        }),
        environment: { KILO_API_KEY: "secret" },
        runtime: {
          connectToOpenCodeServer: (input: { binaryPath?: string }) =>
            Effect.sync(() => {
              connectedBinaryPath = input.binaryPath;
              return { url: "http://127.0.0.1:4096", external: true };
            }),
          createOpenCodeSdkClient: () => mockClient,
        } as unknown as OpenCodeRuntimeShape,
        idAllocator,
        serverConfig,
      });

      const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: "/workspace/kilo",
      });
      const modelSelection = { instanceId, model: "kilo-default-model" };

      const runtimeSession = yield* adapter.openSession({
        threadId,
        providerSessionId,
        modelSelection,
        runtimePolicy,
      });

      expect(connectedBinaryPath).toBe("/custom/path/to/kilo");

      const providerThread = yield* runtimeSession.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });

      expect(providerThread.driver).toBe("kilo");
      expect(providerThread.providerInstanceId).toBe(instanceId);
      expect(providerThread.nativeThreadRef?.driver).toBe("kilo");
      expect(providerThread.nativeThreadRef?.nativeId).toBe("native-kilo-session-42");
    }),
  );
});
