import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import * as IdleCompactionService from "./IdleCompactionService.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ServerSettings from "../serverSettings.ts";

const iso = (ms: number) => new Date(ms).toISOString();

function completedThread(expiresInMs: number) {
  const now = Date.now();
  return {
    thread: {
      id: "thread-1",
      projectId: "project-1",
      deletedAt: null,
      archivedAt: null,
      settledAt: null,
      settledOverride: null,
      snoozedUntil: null,
      lineage: { relationshipToParent: "root" },
      activeProviderThreadId: "pt-1",
      providerInstanceId: "claudeAgent",
    },
    runs: [
      {
        id: "run-1",
        ordinal: 1,
        status: "completed",
        startedAt: DateTime.makeUnsafe(now - 60_000),
        completedAt: DateTime.makeUnsafe(now - 1_000),
        userMessageId: "msg-1",
        providerThreadId: "pt-1",
        providerInstanceId: "claudeAgent",
      },
    ],
    messages: [{ id: "msg-1", text: "refactor the parser" }],
    providerThreads: [{ id: "pt-1", driver: "claudeAgent", providerInstanceId: "claudeAgent" }],
    providerTurns: [
      {
        providerThreadId: "pt-1",
        tokenUsage: {
          usedTokens: 150_000,
          promptCacheExpiresAt: iso(now + expiresInMs),
          updatedAt: iso(now - 1_000),
        },
      },
    ],
    runtimeRequests: [],
    turnItems: [],
    contextTransfers: [],
  };
}

const run = (input: { mode: "off" | "beforeCacheExpires"; expiresInMs: number }) =>
  Effect.gen(function* () {
    const dispatched: unknown[] = [];
    const records = completedThread(input.expiresInMs);
    const orchestrator = {
      streamDomainEvents: Stream.make({
        type: "run.updated",
        threadId: "thread-1",
        payload: { id: "run-1", status: "completed" },
      }),
      dispatch: (command: unknown) =>
        Effect.sync(() => {
          dispatched.push(command);
        }),
    };
    const projections = { getThreadRecords: () => Effect.succeed(records) };
    const settings = {
      getSettings: Effect.succeed({
        providers: { claudeAgent: { idleCompaction: input.mode } },
        providerInstances: {},
      }),
    };
    yield* Effect.gen(function* () {
      const service = yield* IdleCompactionService.make;
      yield* service.start();
      yield* Effect.sleep("150 millis");
    }).pipe(
      Effect.provideService(Orchestrator.OrchestratorV2, orchestrator as never),
      Effect.provideService(ProjectionStore.ProjectionStoreV2, projections as never),
      Effect.provideService(ServerSettings.ServerSettingsService, settings as never),
      Effect.scoped,
    );
    return dispatched;
  });

describe("IdleCompactionService", () => {
  it.live("sends /compact once the cache is close to expiring", () =>
    Effect.gen(function* () {
      const dispatched = (yield* run({ mode: "beforeCacheExpires", expiresInMs: 60_000 })) as Array<
        Record<string, unknown>
      >;
      assert.strictEqual(dispatched.length, 1);
      assert.strictEqual(dispatched[0]?.text, "/compact");
      assert.strictEqual(dispatched[0]?.commandId, "server:idle-compact:thread-1:run-1");
      assert.strictEqual(dispatched[0]?.createdBy, "agent");
    }),
  );

  it.live("waits while the cache is still comfortably warm", () =>
    Effect.gen(function* () {
      const dispatched = yield* run({ mode: "beforeCacheExpires", expiresInMs: 30 * 60_000 });
      assert.deepStrictEqual(dispatched, []);
    }),
  );

  it.live("does nothing when the instance is not set to compact", () =>
    Effect.gen(function* () {
      const dispatched = yield* run({ mode: "off", expiresInMs: 60_000 });
      assert.deepStrictEqual(dispatched, []);
    }),
  );
});
