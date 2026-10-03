import type { ProviderRuntimeEvent } from "@tabs/contracts";
import { ProviderDriverKind, ProviderInstanceId, ThreadId } from "@tabs/contracts";
import { DEFAULT_SERVER_SETTINGS } from "@tabs/contracts/settings";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, assert } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, PubSub, Stream } from "effect";

import { ProviderUnsupportedError } from "../src/provider/Errors.ts";
import { ProviderAdapterRegistry } from "../src/provider/Services/ProviderAdapterRegistry.ts";
import { ProviderSessionDirectoryLive } from "../src/provider/Layers/ProviderSessionDirectory.ts";
import { ProviderEventLoggersLive } from "../src/provider/Layers/ProviderEventLoggers.ts";
import { ServerConfig } from "../src/config.ts";
import { makeProviderServiceLive } from "../src/provider/Layers/ProviderService.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../src/provider/Services/ProviderService.ts";
import { ServerSettingsService } from "../src/serverSettings.ts";
import { AnalyticsService } from "../src/telemetry/Services/AnalyticsService.ts";
import { SqlitePersistenceMemory } from "../src/persistence/Layers/Sqlite.ts";
import { ProviderSessionRuntimeRepositoryLive } from "../src/persistence/Layers/ProviderSessionRuntime.ts";

import {
  makeTestProviderAdapterHarness,
  type TestProviderAdapterHarness,
  type TestTurnResponse,
} from "./TestProviderAdapter.integration.ts";
import {
  codexTurnApprovalFixture,
  codexTurnToolFixture,
  codexTurnTextFixture,
} from "./fixtures/providerRuntime.ts";

const makeWorkspaceDirectory = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const cwd = yield* fs.makeTempDirectory();
  yield* fs.writeFileString(pathService.join(cwd, "README.md"), "v1\n");
  return cwd;
}).pipe(Effect.provide(NodeServices.layer));

interface IntegrationFixture {
  readonly cwd: string;
  readonly harness: TestProviderAdapterHarness;
  readonly layer: Layer.Layer<ProviderService, unknown, NodeServices.NodeServices>;
}

const makeIntegrationFixture = Effect.gen(function* () {
  const cwd = yield* makeWorkspaceDirectory;
  const harness = yield* makeTestProviderAdapterHarness();

  const codexInstance = ProviderInstanceId.makeUnsafe("codex");
  const codexDriver = ProviderDriverKind.makeUnsafe("codex");
  const registry: typeof ProviderAdapterRegistry.Service = {
    getByInstance: (instanceId) =>
      instanceId === codexInstance
        ? Effect.succeed(harness.adapter)
        : Effect.fail(new ProviderUnsupportedError({ provider: codexDriver })),
    getInstanceInfo: (instanceId) =>
      instanceId === codexInstance
        ? Effect.succeed({
            instanceId: codexInstance,
            driverKind: codexDriver,
            displayName: undefined,
            enabled: true,
            continuationIdentity: { driverKind: codexDriver, continuationKey: codexInstance },
          })
        : Effect.fail(new ProviderUnsupportedError({ provider: codexDriver })),
    listInstances: () => Effect.succeed([codexInstance]),
    listProviders: () => Effect.succeed([codexDriver]),
    streamChanges: Stream.empty,
    subscribeChanges: PubSub.unbounded<void>().pipe(
      Effect.flatMap((pubsub) => PubSub.subscribe(pubsub)),
    ),
  };

  const directoryLayer = ProviderSessionDirectoryLive.pipe(
    Layer.provide(ProviderSessionRuntimeRepositoryLive),
  );

  const shared = Layer.mergeAll(
    directoryLayer,
    Layer.succeed(ProviderAdapterRegistry, registry),
    ProviderEventLoggersLive,
    ServerSettingsService.layerTest(DEFAULT_SERVER_SETTINGS),
    AnalyticsService.layerTest,
  ).pipe(
    Layer.provideMerge(ServerConfig.layerTest(cwd, { prefix: "tabs-provider-integration-" })),
    Layer.provide(SqlitePersistenceMemory),
  );

  const layer = makeProviderServiceLive().pipe(Layer.provide(shared));

  return {
    cwd,
    harness,
    layer,
  } satisfies IntegrationFixture;
});

const collectEventsDuring = <A, E, R>(
  provider: ProviderServiceShape,
  count: number,
  action: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const subscription = yield* provider.subscribeEvents;

    yield* action;

    return yield* Effect.forEach(
      Array.from({ length: count }, () => undefined),
      () => PubSub.take(subscription),
      { discard: false },
    );
  });

const runTurn = (input: {
  readonly provider: ProviderServiceShape;
  readonly harness: TestProviderAdapterHarness;
  readonly threadId: ThreadId;
  readonly userText: string;
  readonly response: TestTurnResponse;
}) =>
  Effect.gen(function* () {
    yield* input.harness.queueTurnResponse(input.threadId, input.response);

    return yield* collectEventsDuring(
      input.provider,
      input.response.events.length,
      input.provider.sendTurn({
        threadId: input.threadId,
        input: input.userText,
        attachments: [],
      }),
    );
  });

it.effect("replays typed runtime fixture events", () =>
  Effect.gen(function* () {
    const fixture = yield* makeIntegrationFixture;

    yield* Effect.gen(function* () {
      const provider = yield* ProviderService;
      const session = yield* provider.startSession(
        ThreadId.makeUnsafe("thread-integration-typed"),
        {
          threadId: ThreadId.makeUnsafe("thread-integration-typed"),
          provider: ProviderDriverKind.makeUnsafe("codex"),
          providerInstanceId: ProviderInstanceId.makeUnsafe("codex"),
          cwd: fixture.cwd,
          runtimeMode: "full-access",
        },
      );
      assert.equal((session.threadId ?? "").length > 0, true);

      const observedEvents = yield* runTurn({
        provider,
        harness: fixture.harness,
        threadId: session.threadId,
        userText: "hello",
        response: { events: codexTurnTextFixture },
      });

      assert.deepEqual(
        observedEvents.map((event) => event.type),
        codexTurnTextFixture.map((event) => event.type),
      );
    }).pipe(Effect.provide(fixture.layer));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("replays file-changing fixture turn events", () =>
  Effect.gen(function* () {
    const fixture = yield* makeIntegrationFixture;
    const { join } = yield* Path.Path;
    const { writeFileString } = yield* FileSystem.FileSystem;

    yield* Effect.gen(function* () {
      const provider = yield* ProviderService;
      const session = yield* provider.startSession(
        ThreadId.makeUnsafe("thread-integration-tools"),
        {
          threadId: ThreadId.makeUnsafe("thread-integration-tools"),
          provider: ProviderDriverKind.makeUnsafe("codex"),
          providerInstanceId: ProviderInstanceId.makeUnsafe("codex"),
          cwd: fixture.cwd,
          runtimeMode: "full-access",
        },
      );
      assert.equal((session.threadId ?? "").length > 0, true);

      const observedEvents = yield* runTurn({
        provider,
        harness: fixture.harness,
        threadId: session.threadId,
        userText: "make a small change",
        response: {
          events: codexTurnToolFixture,
          mutateWorkspace: ({ cwd }) =>
            writeFileString(join(cwd, "README.md"), "v2\n").pipe(Effect.asVoid, Effect.ignore),
        },
      });

      assert.deepEqual(
        observedEvents.map((event) => event.type),
        codexTurnToolFixture.map((event) => event.type),
      );
    }).pipe(Effect.provide(fixture.layer));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("runs multi-turn tool/approval flow", () =>
  Effect.gen(function* () {
    const fixture = yield* makeIntegrationFixture;
    const { join } = yield* Path.Path;
    const { writeFileString } = yield* FileSystem.FileSystem;

    yield* Effect.gen(function* () {
      const provider = yield* ProviderService;
      const session = yield* provider.startSession(
        ThreadId.makeUnsafe("thread-integration-multi"),
        {
          threadId: ThreadId.makeUnsafe("thread-integration-multi"),
          provider: ProviderDriverKind.makeUnsafe("codex"),
          providerInstanceId: ProviderInstanceId.makeUnsafe("codex"),
          cwd: fixture.cwd,
          runtimeMode: "full-access",
        },
      );
      assert.equal((session.threadId ?? "").length > 0, true);

      const firstTurnEvents = yield* runTurn({
        provider,
        harness: fixture.harness,
        threadId: session.threadId,
        userText: "turn 1",
        response: {
          events: codexTurnToolFixture,
          mutateWorkspace: ({ cwd }) =>
            writeFileString(join(cwd, "README.md"), "v2\n").pipe(Effect.asVoid, Effect.ignore),
        },
      });
      assert.deepEqual(
        firstTurnEvents.map((event) => event.type),
        codexTurnToolFixture.map((event) => event.type),
      );

      const secondTurnEvents = yield* runTurn({
        provider,
        harness: fixture.harness,
        threadId: session.threadId,
        userText: "turn 2 approval",
        response: {
          events: codexTurnApprovalFixture,
          mutateWorkspace: ({ cwd }) =>
            writeFileString(join(cwd, "README.md"), "v3\n").pipe(Effect.asVoid, Effect.ignore),
        },
      });
      assert.deepEqual(
        secondTurnEvents.map((event) => event.type),
        codexTurnApprovalFixture.map((event) => event.type),
      );
    }).pipe(Effect.provide(fixture.layer));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("rolls back provider conversation state only", () =>
  Effect.gen(function* () {
    const fixture = yield* makeIntegrationFixture;
    const { join } = yield* Path.Path;
    const { writeFileString, readFileString } = yield* FileSystem.FileSystem;

    yield* Effect.gen(function* () {
      const provider = yield* ProviderService;
      const session = yield* provider.startSession(
        ThreadId.makeUnsafe("thread-integration-rollback"),
        {
          threadId: ThreadId.makeUnsafe("thread-integration-rollback"),
          provider: ProviderDriverKind.makeUnsafe("codex"),
          providerInstanceId: ProviderInstanceId.makeUnsafe("codex"),
          cwd: fixture.cwd,
          runtimeMode: "full-access",
        },
      );
      assert.equal((session.threadId ?? "").length > 0, true);

      yield* runTurn({
        provider,
        harness: fixture.harness,
        threadId: session.threadId,
        userText: "turn 1",
        response: {
          events: codexTurnToolFixture,
          mutateWorkspace: ({ cwd }) =>
            writeFileString(join(cwd, "README.md"), "v2\n").pipe(Effect.asVoid, Effect.ignore),
        },
      });

      yield* runTurn({
        provider,
        harness: fixture.harness,
        threadId: session.threadId,
        userText: "turn 2 approval",
        response: {
          events: codexTurnApprovalFixture,
          mutateWorkspace: ({ cwd }) =>
            writeFileString(join(cwd, "README.md"), "v3\n").pipe(Effect.asVoid, Effect.ignore),
        },
      });

      yield* provider.rollbackConversation({
        threadId: session.threadId,
        numTurns: 1,
      });

      const rollbackCalls = fixture.harness.getRollbackCalls(session.threadId);
      assert.deepEqual(rollbackCalls, [1]);

      const readme = yield* readFileString(join(fixture.cwd, "README.md"));
      assert.equal(readme, "v3\n");
    }).pipe(Effect.provide(fixture.layer));
  }).pipe(Effect.provide(NodeServices.layer)),
);
