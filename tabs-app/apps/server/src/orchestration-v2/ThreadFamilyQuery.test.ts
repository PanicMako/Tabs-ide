import { assert, it } from "@effect/vitest";
import { EventId, ProjectId, ProviderInstanceId, ThreadId } from "@tabs/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { OrchestrationEventStore } from "../persistence/OrchestrationEventStore.ts";
import { ThreadManagementService } from "./ThreadManagementService.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import { readThreadFamilyPage } from "./ThreadFamilyQuery.ts";

const database = SqlitePersistence.layerMemory;
const dependencies = Layer.mergeAll(
  database,
  ProjectionStore.layer.pipe(Layer.provide(database)),
  Layer.mock(OrchestrationEventStore)({ latestApplicationSequence: Effect.succeed(42) }),
);

it.effect(
  "pages real family shells with exact membership, archived relatives, ancestors and cycle safety",
  () =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const sql = yield* SqlClient.SqlClient;
      const root = ThreadId.make("zz-root");
      const now = yield* DateTime.now;
      for (let index = -1; index < 123; index++) {
        const id = index === -1 ? root : ThreadId.make(`child-${String(index).padStart(3, "0")}`);
        yield* store.apply({
          id: EventId.make(`created-${id}`),
          type: "thread.created",
          threadId: id,
          occurredAt: now,
          payload: {
            id,
            projectId: ProjectId.make("project"),
            title: id,
            createdBy: "user",
            creationSource: "web",
            providerInstanceId: ProviderInstanceId.make("codex"),
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
            runtimeMode: "approval-required",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            activeProviderThreadId: null,
            lineage: {
              rootThreadId: root,
              parentThreadId: index === -1 ? null : root,
              relationshipToParent: index === -1 ? null : "fork",
            },
            forkedFrom: null,
            autoSettleDisabledAt: null,
            settledOverride: null,
            settledAt: null,
            archivedAt: index === 2 ? now : null,
            deletedAt: index === 1 ? now : null,
            lastVisitedAt: null,
            createdAt: now,
            updatedAt: now,
          },
        });
      }
      const read = (afterThreadId?: ThreadId, limit?: number) =>
        readThreadFamilyPage({
          threadId: root,
          ...(afterThreadId ? { afterThreadId } : {}),
          ...(limit === undefined ? {} : { limit }),
        }).pipe(
          Effect.provide(
            Layer.mock(ThreadManagementService)({
              getShellSnapshot: (options) => store.getShellSnapshot(options).pipe(Effect.orDie),
            }),
          ),
        );
      const first = yield* read(undefined, 10);
      assert.strictEqual(first.totalCount, 123);
      assert.strictEqual(first.snapshotSequence, 42);
      assert.isAtMost(first.threads.length, 42);
      assert.isTrue(first.threads.some((thread) => thread.id === root));
      assert.isTrue(
        first.threads.some((thread) => thread.id === "child-002" && thread.archivedAt !== null),
      );
      assert.isFalse(first.threads.some((thread) => thread.id === "child-001"));
      const seen = new Set(first.threads.map((thread) => thread.id));
      let cursor = first.nextCursor;
      while (cursor) {
        const page = yield* read(cursor, 10);
        assert.isAtMost(page.threads.length, 42);
        for (const thread of page.threads) seen.add(thread.id);
        cursor = page.nextCursor;
      }
      assert.strictEqual(seen.size, 123);
      assert.strictEqual((yield* read()).threads.length, 123);
      yield* sql`UPDATE orchestration_v2_projection_threads SET payload_json = json_set(payload_json, '$.lineage.parentThreadId', 'child-000') WHERE thread_id = ${root}`;
      assert.isAtMost((yield* read(undefined, 1)).threads.length, 33);
    }).pipe(Effect.provide(dependencies)),
);
