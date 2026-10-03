import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type ServerProvider,
} from "@tabs/contracts";
import { it, assert, vi } from "@effect/vitest";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import type { ClaudeAdapterShape } from "../Services/ClaudeAdapter";
import type { CodexAdapterShape } from "../Services/CodexAdapter";
import type { CursorAdapterShape } from "../Services/CursorAdapter";
import type { OpenCodeAdapterShape } from "../Services/OpenCodeAdapter";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry";
import { ProviderInstanceRegistry } from "../Services/ProviderInstanceRegistry";
import type { ProviderInstance } from "../ProviderDriver";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance";
import type { TextGenerationShape } from "../../textGeneration/TextGeneration";
import { ProviderAdapterRegistryLive } from "./ProviderAdapterRegistry";
import * as NodeServices from "@effect/platform-node/NodeServices";

const CODEX_DRIVER = "codex" as ProviderDriverKind;
const CLAUDE_AGENT_DRIVER = "claudeAgent" as ProviderDriverKind;
const OPENCODE_DRIVER = "opencode" as ProviderDriverKind;
const CURSOR_DRIVER = "cursor" as ProviderDriverKind;

const fakeCodexAdapter: CodexAdapterShape = {
  provider: CODEX_DRIVER,
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeClaudeAdapter: ClaudeAdapterShape = {
  provider: CLAUDE_AGENT_DRIVER,
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeOpenCodeAdapter: OpenCodeAdapterShape = {
  provider: OPENCODE_DRIVER,
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeCursorAdapter: CursorAdapterShape = {
  provider: CURSOR_DRIVER,
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

// ProviderAdapterRegistryLive is now a facade over ProviderInstanceRegistry —
// it walks `listInstances` once at boot and surfaces the default-instance
// adapter keyed by its driver kind. To test the facade we supply four fake
// instances whose `instanceId === defaultInstanceIdForDriver(driverKind)` so
// they pass the default-instance filter.
const makeFakeInstance = (
  driverKindString: "codex" | "claudeAgent" | "cursor" | "opencode",
  adapter: ProviderInstance["adapter"],
): ProviderInstance => {
  const driverKind = driverKindString as ProviderDriverKind;
  return {
    instanceId: defaultInstanceIdForDriver(driverKind),
    driverKind,
    continuationIdentity: {
      driverKind,
      continuationKey: `${driverKind}:instance:${defaultInstanceIdForDriver(driverKind)}`,
    },
    displayName: undefined,
    enabled: true,
    snapshot: {
      maintenanceCapabilities: makeManualOnlyProviderMaintenanceCapabilities({
        provider: driverKind,
        packageName: null,
      }),
      getSnapshot: Effect.succeed({} as unknown as ServerProvider),
      refresh: Effect.succeed({} as unknown as ServerProvider),
      streamChanges: Stream.empty,
    },
    adapter,
    textGeneration: {} as unknown as TextGenerationShape,
  } as any as ProviderInstance;
};

const fakeInstances: ReadonlyArray<ProviderInstance> = [
  makeFakeInstance("codex", fakeCodexAdapter),
  makeFakeInstance("claudeAgent", fakeClaudeAdapter),
  makeFakeInstance("opencode", fakeOpenCodeAdapter),
  makeFakeInstance("cursor", fakeCursorAdapter),
];

const fakeInstanceRegistryLayer = Layer.succeed(ProviderInstanceRegistry, {
  getInstance: (instanceId) =>
    Effect.succeed(fakeInstances.find((instance) => instance.instanceId === instanceId)),
  listInstances: Effect.succeed(fakeInstances),
  listUnavailable: Effect.succeed([]),
  streamChanges: Stream.empty,
  // Tests never drive changes through this fake; acquire a throwaway
  // subscription on an unused PubSub so the shape is satisfied.
  subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), (pubsub) => PubSub.subscribe(pubsub)),
});

const layer = Layer.mergeAll(
  Layer.provide(ProviderAdapterRegistryLive, fakeInstanceRegistryLayer),
  NodeServices.layer,
);

it.layer(layer)("ProviderAdapterRegistryLive", (it) => {
  it("resolves adapters and routing metadata from provider instances", () =>
    Effect.gen(function* () {
      const registry = yield* ProviderAdapterRegistry;
      const claudeInstanceId = defaultInstanceIdForDriver(CLAUDE_AGENT_DRIVER);

      const adapter = yield* registry.getByInstance(claudeInstanceId);
      assert.strictEqual(adapter, fakeClaudeAdapter);

      const info = yield* registry.getInstanceInfo(claudeInstanceId);
      assert.deepStrictEqual(info, {
        instanceId: claudeInstanceId,
        driverKind: CLAUDE_AGENT_DRIVER,
        displayName: undefined,
        accentColor: undefined,
        enabled: true,
        continuationIdentity: {
          driverKind: CLAUDE_AGENT_DRIVER,
          continuationKey: "claudeAgent:instance:claudeAgent",
        },
      });

      const instances = yield* registry.listInstances();
      assert.deepStrictEqual(instances, [
        defaultInstanceIdForDriver(CODEX_DRIVER),
        claudeInstanceId,
        defaultInstanceIdForDriver(OPENCODE_DRIVER),
        defaultInstanceIdForDriver(CURSOR_DRIVER),
      ]);

      const providers = yield* registry.listProviders();
      assert.deepStrictEqual(providers, [
        CODEX_DRIVER,
        CLAUDE_AGENT_DRIVER,
        OPENCODE_DRIVER,
        CURSOR_DRIVER,
      ]);
    }));
});
