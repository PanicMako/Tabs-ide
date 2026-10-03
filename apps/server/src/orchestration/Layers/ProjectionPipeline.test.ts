import {
  CheckpointRef,
  CommandId,
  CorrelationId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  ProviderInstanceId,
} from "@tabs/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import {
  makeSqlitePersistenceLive,
  SqlitePersistenceMemory,
} from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import {
  ORCHESTRATION_PROJECTOR_NAMES,
  OrchestrationProjectionPipelineLive,
} from "./ProjectionPipeline.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { ServerConfig } from "../../config.ts";

const makeProjectionPipelinePrefixedTestLayer = (prefix: string) =>
  OrchestrationProjectionPipelineLive.pipe(
    Layer.provideMerge(OrchestrationEventStoreLive),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix })),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(NodeServices.layer),
  );

const exists = (filePath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const fileInfo = yield* Effect.result(fileSystem.stat(filePath));
    return fileInfo._tag === "Success";
  });

const BaseTestLayer = makeProjectionPipelinePrefixedTestLayer("tabs-projection-pipeline-test-");

it.layer(BaseTestLayer)("OrchestrationProjectionPipeline", (it) => {
  it.effect("bootstraps all projection states and writes projection rows", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = new Date().toISOString();

      yield* eventStore.append({
        type: "project.created",
        eventId: "evt-1" as EventId,
        aggregateKind: "project",
        aggregateId: "project-1" as ProjectId,
        occurredAt: now,
        commandId: "cmd-1" as CommandId,
        causationEventId: null,
        correlationId: "cmd-1" as CommandId,
        metadata: {},
        payload: {
          projectId: "project-1" as ProjectId,
          title: "Project 1",
          workspaceRoot: "/tmp/project-1",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.created",
        eventId: "evt-2" as EventId,
        aggregateKind: "thread",
        aggregateId: "thread-1" as ThreadId,
        occurredAt: now,
        commandId: "cmd-2" as CommandId,
        causationEventId: null,
        correlationId: "cmd-2" as CommandId,
        metadata: {},
        payload: {
          threadId: "thread-1" as ThreadId,
          projectId: "project-1" as ProjectId,
          title: "Thread 1",
          modelSelection: {
            instanceId: "codex" as ProviderInstanceId,
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: "evt-3" as EventId,
        aggregateKind: "thread",
        aggregateId: "thread-1" as ThreadId,
        occurredAt: now,
        commandId: "cmd-3" as CommandId,
        causationEventId: null,
        correlationId: "cmd-3" as CommandId,
        metadata: {},
        payload: {
          threadId: "thread-1" as ThreadId,
          messageId: "message-1" as MessageId,
          role: "assistant",
          text: "hello",
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* projectionPipeline.bootstrap;

      const projectRows = yield* sql<{
        readonly projectId: string;
        readonly title: string;
        readonly scriptsJson: string;
      }>`
        SELECT
          project_id AS "projectId",
          title,
          scripts_json AS "scriptsJson"
        FROM projection_projects
      `;
      assert.deepEqual(projectRows, [
        { projectId: "project-1", title: "Project 1", scriptsJson: "[]" },
      ]);

      const messageRows = yield* sql<{
        readonly messageId: string;
        readonly text: string;
      }>`
        SELECT
          message_id AS "messageId",
          text
        FROM projection_thread_messages
      `;
      assert.deepEqual(messageRows, [{ messageId: "message-1", text: "hello" }]);

      const stateRows = yield* sql<{
        readonly projector: string;
        readonly lastAppliedSequence: number;
      }>`
        SELECT
          projector,
          last_applied_sequence AS "lastAppliedSequence"
        FROM projection_state
        ORDER BY projector ASC
      `;
      assert.equal(stateRows.length, Object.keys(ORCHESTRATION_PROJECTOR_NAMES).length);
      for (const row of stateRows) {
        assert.equal(row.lastAppliedSequence, 3);
      }
    }),
  );
});

it.layer(Layer.fresh(makeProjectionPipelinePrefixedTestLayer("tabs-base-")))(
  "OrchestrationProjectionPipeline",
  (it) => {
    it.effect("stores message attachment references without mutating payloads", () =>
      Effect.gen(function* () {
        const projectionPipeline = yield* OrchestrationProjectionPipeline;
        const eventStore = yield* OrchestrationEventStore;
        const sql = yield* SqlClient.SqlClient;
        const now = new Date().toISOString();

        yield* eventStore.append({
          type: "thread.message-sent",
          eventId: "evt-attachments" as EventId,
          aggregateKind: "thread",
          aggregateId: "thread-attachments" as ThreadId,
          occurredAt: now,
          commandId: "cmd-attachments" as CommandId,
          causationEventId: null,
          correlationId: "cmd-attachments" as CommandId,
          metadata: {},
          payload: {
            threadId: "thread-attachments" as ThreadId,
            messageId: "message-attachments" as MessageId,
            role: "user",
            text: "Inspect this",
            attachments: [
              {
                type: "image",
                id: "thread-attachments-att-1",
                name: "example.png",
                mimeType: "image/png",
                sizeBytes: 5,
              },
            ],
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        });

        yield* projectionPipeline.bootstrap;

        const rows = yield* sql<{
          readonly attachmentsJson: string | null;
        }>`
            SELECT
              attachments_json AS "attachmentsJson"
            FROM projection_thread_messages
            WHERE message_id = 'message-attachments'
          `;
        assert.equal(rows.length, 1);
        assert.deepEqual(JSON.parse(rows[0]?.attachmentsJson ?? "null"), [
          {
            type: "image",
            id: "thread-attachments-att-1",
            name: "example.png",
            mimeType: "image/png",
            sizeBytes: 5,
          },
        ]);
      }),
    );
  },
);

it.layer(Layer.fresh(makeProjectionPipelinePrefixedTestLayer("tabs-projection-attachments-safe-")))(
  "OrchestrationProjectionPipeline",
  (it) => {
    it.effect("preserves mixed image attachment metadata as-is", () =>
      Effect.gen(function* () {
        const projectionPipeline = yield* OrchestrationProjectionPipeline;
        const eventStore = yield* OrchestrationEventStore;
        const sql = yield* SqlClient.SqlClient;
        const now = new Date().toISOString();

        yield* eventStore.append({
          type: "thread.message-sent",
          eventId: "evt-attachments-safe" as EventId,
          aggregateKind: "thread",
          aggregateId: "thread-attachments-safe" as ThreadId,
          occurredAt: now,
          commandId: "cmd-attachments-safe" as CommandId,
          causationEventId: null,
          correlationId: "cmd-attachments-safe" as CommandId,
          metadata: {},
          payload: {
            threadId: "thread-attachments-safe" as ThreadId,
            messageId: "message-attachments-safe" as MessageId,
            role: "user",
            text: "Inspect this",
            attachments: [
              {
                type: "image",
                id: "thread-attachments-safe-att-1",
                name: "untrusted.exe",
                mimeType: "image/x-unknown",
                sizeBytes: 5,
              },
              {
                type: "image",
                id: "thread-attachments-safe-att-2",
                name: "not-image.png",
                mimeType: "image/png",
                sizeBytes: 5,
              },
            ],
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        });

        yield* projectionPipeline.bootstrap;

        const rows = yield* sql<{
          readonly attachmentsJson: string | null;
        }>`
            SELECT
              attachments_json AS "attachmentsJson"
            FROM projection_thread_messages
            WHERE message_id = 'message-attachments-safe'
          `;
        assert.equal(rows.length, 1);
        assert.deepEqual(JSON.parse(rows[0]?.attachmentsJson ?? "null"), [
          {
            type: "image",
            id: "thread-attachments-safe-att-1",
            name: "untrusted.exe",
            mimeType: "image/x-unknown",
            sizeBytes: 5,
          },
          {
            type: "image",
            id: "thread-attachments-safe-att-2",
            name: "not-image.png",
            mimeType: "image/png",
            sizeBytes: 5,
          },
        ]);
      }),
    );
  },
);

it.layer(BaseTestLayer)("OrchestrationProjectionPipeline", (it) => {
  it.effect(
    "passes explicit empty attachment arrays through the projection pipeline to clear attachments",
    () =>
      Effect.gen(function* () {
        const projectionPipeline = yield* OrchestrationProjectionPipeline;
        const eventStore = yield* OrchestrationEventStore;
        const sql = yield* SqlClient.SqlClient;
        const now = new Date().toISOString();
        const later = new Date(Date.now() + 1_000).toISOString();

        yield* eventStore.append({
          type: "project.created",
          eventId: "evt-clear-attachments-1" as EventId,
          aggregateKind: "project",
          aggregateId: "project-clear-attachments" as ProjectId,
          occurredAt: now,
          commandId: "cmd-clear-attachments-1" as CommandId,
          causationEventId: null,
          correlationId: "cmd-clear-attachments-1" as CommandId,
          metadata: {},
          payload: {
            projectId: "project-clear-attachments" as ProjectId,
            title: "Project Clear Attachments",
            workspaceRoot: "/tmp/project-clear-attachments",
            defaultModelSelection: null,
            scripts: [],
            createdAt: now,
            updatedAt: now,
          },
        });

        yield* eventStore.append({
          type: "thread.created",
          eventId: "evt-clear-attachments-2" as EventId,
          aggregateKind: "thread",
          aggregateId: "thread-clear-attachments" as ThreadId,
          occurredAt: now,
          commandId: "cmd-clear-attachments-2" as CommandId,
          causationEventId: null,
          correlationId: "cmd-clear-attachments-2" as CommandId,
          metadata: {},
          payload: {
            threadId: "thread-clear-attachments" as ThreadId,
            projectId: "project-clear-attachments" as ProjectId,
            title: "Thread Clear Attachments",
            modelSelection: {
              instanceId: "codex" as ProviderInstanceId,
              model: "gpt-5-codex",
            },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt: now,
            updatedAt: now,
          },
        });

        yield* eventStore.append({
          type: "thread.message-sent",
          eventId: "evt-clear-attachments-3" as EventId,
          aggregateKind: "thread",
          aggregateId: "thread-clear-attachments" as ThreadId,
          occurredAt: now,
          commandId: "cmd-clear-attachments-3" as CommandId,
          causationEventId: null,
          correlationId: "cmd-clear-attachments-3" as CommandId,
          metadata: {},
          payload: {
            threadId: "thread-clear-attachments" as ThreadId,
            messageId: "message-clear-attachments" as MessageId,
            role: "user",
            text: "Has attachments",
            attachments: [
              {
                type: "image",
                id: "thread-clear-attachments-att-1",
                name: "clear.png",
                mimeType: "image/png",
                sizeBytes: 5,
              },
            ],
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        });

        yield* eventStore.append({
          type: "thread.message-sent",
          eventId: "evt-clear-attachments-4" as EventId,
          aggregateKind: "thread",
          aggregateId: "thread-clear-attachments" as ThreadId,
          occurredAt: later,
          commandId: "cmd-clear-attachments-4" as CommandId,
          causationEventId: null,
          correlationId: "cmd-clear-attachments-4" as CommandId,
          metadata: {},
          payload: {
            threadId: "thread-clear-attachments" as ThreadId,
            messageId: "message-clear-attachments" as MessageId,
            role: "user",
            text: "",
            attachments: [],
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: later,
          },
        });

        yield* projectionPipeline.bootstrap;

        const rows = yield* sql<{
          readonly attachmentsJson: string | null;
        }>`
          SELECT
            attachments_json AS "attachmentsJson"
          FROM projection_thread_messages
          WHERE message_id = 'message-clear-attachments'
        `;
        assert.equal(rows.length, 1);
        assert.deepEqual(JSON.parse(rows[0]?.attachmentsJson ?? "null"), []);
      }),
  );
});

it.layer(
  Layer.fresh(makeProjectionPipelinePrefixedTestLayer("tabs-projection-attachments-overwrite-")),
)("OrchestrationProjectionPipeline", (it) => {
  it.effect("overwrites stored attachment references when a message updates attachments", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = new Date().toISOString();
      const later = new Date(Date.now() + 1_000).toISOString();

      yield* eventStore.append({
        type: "project.created",
        eventId: "evt-overwrite-1" as EventId,
        aggregateKind: "project",
        aggregateId: "project-overwrite" as ProjectId,
        occurredAt: now,
        commandId: "cmd-overwrite-1" as CommandId,
        causationEventId: null,
        correlationId: "cmd-overwrite-1" as CommandId,
        metadata: {},
        payload: {
          projectId: "project-overwrite" as ProjectId,
          title: "Project Overwrite",
          workspaceRoot: "/tmp/project-overwrite",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.created",
        eventId: "evt-overwrite-2" as EventId,
        aggregateKind: "thread",
        aggregateId: "thread-overwrite" as ThreadId,
        occurredAt: now,
        commandId: "cmd-overwrite-2" as CommandId,
        causationEventId: null,
        correlationId: "cmd-overwrite-2" as CommandId,
        metadata: {},
        payload: {
          threadId: "thread-overwrite" as ThreadId,
          projectId: "project-overwrite" as ProjectId,
          title: "Thread Overwrite",
          modelSelection: {
            instanceId: "codex" as ProviderInstanceId,
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: "evt-overwrite-3" as EventId,
        aggregateKind: "thread",
        aggregateId: "thread-overwrite" as ThreadId,
        occurredAt: now,
        commandId: "cmd-overwrite-3" as CommandId,
        causationEventId: null,
        correlationId: "cmd-overwrite-3" as CommandId,
        metadata: {},
        payload: {
          threadId: "thread-overwrite" as ThreadId,
          messageId: "message-overwrite" as MessageId,
          role: "user",
          text: "first image",
          attachments: [
            {
              type: "image",
              id: "thread-overwrite-att-1",
              name: "file.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
          ],
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: "evt-overwrite-4" as EventId,
        aggregateKind: "thread",
        aggregateId: "thread-overwrite" as ThreadId,
        occurredAt: later,
        commandId: "cmd-overwrite-4" as CommandId,
        causationEventId: null,
        correlationId: "cmd-overwrite-4" as CommandId,
        metadata: {},
        payload: {
          threadId: "thread-overwrite" as ThreadId,
          messageId: "message-overwrite" as MessageId,
          role: "user",
          text: "",
          attachments: [
            {
              type: "image",
              id: "thread-overwrite-att-2",
              name: "file.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
          ],
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: later,
        },
      });

      yield* projectionPipeline.bootstrap;

      const rows = yield* sql<{
        readonly attachmentsJson: string | null;
      }>`
              SELECT attachments_json AS "attachmentsJson"
              FROM projection_thread_messages
              WHERE message_id = 'message-overwrite'
            `;
      assert.equal(rows.length, 1);
      assert.deepEqual(JSON.parse(rows[0]?.attachmentsJson ?? "null"), [
        {
          type: "image",
          id: "thread-overwrite-att-2",
          name: "file.png",
          mimeType: "image/png",
          sizeBytes: 5,
        },
      ]);
    }),
  );
});

it.layer(
  Layer.fresh(makeProjectionPipelinePrefixedTestLayer("tabs-projection-attachments-rollback-")),
)("OrchestrationProjectionPipeline", (it) => {
  it.effect("does not persist attachment files when projector transaction rolls back", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const path = yield* Path.Path;
      const sql = yield* SqlClient.SqlClient;
      const now = new Date().toISOString();

      const appendAndProject = (event: Parameters<typeof eventStore.append>[0]) =>
        eventStore
          .append(event)
          .pipe(Effect.flatMap((savedEvent) => projectionPipeline.projectEvent(savedEvent)));

      yield* appendAndProject({
        type: "project.created",
        eventId: "evt-rollback-1" as EventId,
        aggregateKind: "project",
        aggregateId: "project-rollback" as ProjectId,
        occurredAt: now,
        commandId: "cmd-rollback-1" as CommandId,
        causationEventId: null,
        correlationId: "cmd-rollback-1" as CorrelationId,
        metadata: {},
        payload: {
          projectId: "project-rollback" as ProjectId,
          title: "Project Rollback",
          workspaceRoot: "/tmp/project-rollback",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.created",
        eventId: "evt-rollback-2" as EventId,
        aggregateKind: "thread",
        aggregateId: "thread-rollback" as ThreadId,
        occurredAt: now,
        commandId: "cmd-rollback-2" as CommandId,
        causationEventId: null,
        correlationId: "cmd-rollback-2" as CorrelationId,
        metadata: {},
        payload: {
          threadId: "thread-rollback" as ThreadId,
          projectId: "project-rollback" as ProjectId,
          title: "Thread Rollback",
          modelSelection: {
            instanceId: "codex" as ProviderInstanceId,
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* sql`
        CREATE TRIGGER fail_thread_messages_projection_state_update
        BEFORE UPDATE ON projection_state
        WHEN NEW.projector = 'projection.thread-messages'
        BEGIN
          SELECT RAISE(ABORT, 'forced-projection-state-failure');
        END;
      `;

      const result = yield* Effect.result(
        appendAndProject({
          type: "thread.message-sent",
          eventId: "evt-rollback-3" as EventId,
          aggregateKind: "thread",
          aggregateId: "thread-rollback" as ThreadId,
          occurredAt: now,
          commandId: "cmd-rollback-3" as CommandId,
          causationEventId: null,
          correlationId: "cmd-rollback-3" as CorrelationId,
          metadata: {},
          payload: {
            threadId: "thread-rollback" as ThreadId,
            messageId: "message-rollback" as MessageId,
            role: "user",
            text: "Rollback me",
            attachments: [
              {
                type: "image",
                id: "thread-rollback-att-1",
                name: "rollback.png",
                mimeType: "image/png",
                sizeBytes: 5,
              },
            ],
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        }),
      );
      assert.equal(result._tag, "Failure");

      const rows = yield* sql<{
        readonly count: number;
      }>`
        SELECT COUNT(*) AS "count"
        FROM projection_thread_messages
        WHERE message_id = 'message-rollback'
      `;
      assert.equal(rows[0]?.count ?? 0, 0);

      const { attachmentsDir } = yield* ServerConfig;
      const attachmentPath = path.join(attachmentsDir, "thread-rollback-att-1.png");
      assert.isFalse(yield* exists(attachmentPath));
      yield* sql`DROP TRIGGER IF EXISTS fail_thread_messages_projection_state_update`;
    }),
  );
});

it.layer(
  Layer.fresh(makeProjectionPipelinePrefixedTestLayer("tabs-projection-attachments-overwrite-")),
)("OrchestrationProjectionPipeline", (it) => {
  it.effect("removes unreferenced attachment files when a thread is reverted", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const { attachmentsDir } = yield* ServerConfig;
      const now = new Date().toISOString();
      const threadId = "Thread Revert.Files" as ThreadId;
      const keepAttachmentId = "thread-revert-files-00000000-0000-4000-8000-000000000001";
      const removeAttachmentId = "thread-revert-files-00000000-0000-4000-8000-000000000002";
      const otherThreadAttachmentId =
        "thread-revert-files-extra-00000000-0000-4000-8000-000000000003";

      const appendAndProject = (event: Parameters<typeof eventStore.append>[0]) =>
        eventStore
          .append(event)
          .pipe(Effect.flatMap((savedEvent) => projectionPipeline.projectEvent(savedEvent)));

      yield* appendAndProject({
        type: "project.created",
        eventId: "evt-revert-files-1" as EventId,
        aggregateKind: "project",
        aggregateId: "project-revert-files" as ProjectId,
        occurredAt: now,
        commandId: "cmd-revert-files-1" as CommandId,
        causationEventId: null,
        correlationId: "cmd-revert-files-1" as CorrelationId,
        metadata: {},
        payload: {
          projectId: "project-revert-files" as ProjectId,
          title: "Project Revert Files",
          workspaceRoot: "/tmp/project-revert-files",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.created",
        eventId: "evt-revert-files-2" as EventId,
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: "cmd-revert-files-2" as CommandId,
        causationEventId: null,
        correlationId: "cmd-revert-files-2" as CorrelationId,
        metadata: {},
        payload: {
          threadId,
          projectId: "project-revert-files" as ProjectId,
          title: "Thread Revert Files",
          modelSelection: {
            instanceId: "codex" as ProviderInstanceId,
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.turn-diff-completed",
        eventId: "evt-revert-files-3" as EventId,
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: "cmd-revert-files-3" as CommandId,
        causationEventId: null,
        correlationId: "cmd-revert-files-3" as CorrelationId,
        metadata: {},
        payload: {
          threadId,
          turnId: "turn-keep" as TurnId,
          checkpointTurnCount: 1,
          checkpointRef: "refs/tabs/checkpoints/thread-revert-files/turn/1" as CheckpointRef,
          status: "ready",
          files: [],
          assistantMessageId: "message-keep" as MessageId,
          completedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.message-sent",
        eventId: "evt-revert-files-4" as EventId,
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: "cmd-revert-files-4" as CommandId,
        causationEventId: null,
        correlationId: "cmd-revert-files-4" as CorrelationId,
        metadata: {},
        payload: {
          threadId,
          messageId: "message-keep" as MessageId,
          role: "assistant",
          text: "Keep",
          attachments: [
            {
              type: "image",
              id: keepAttachmentId,
              name: "keep.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
          ],
          turnId: "turn-keep" as TurnId,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.turn-diff-completed",
        eventId: "evt-revert-files-5" as EventId,
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: "cmd-revert-files-5" as CommandId,
        causationEventId: null,
        correlationId: "cmd-revert-files-5" as CorrelationId,
        metadata: {},
        payload: {
          threadId,
          turnId: "turn-remove" as TurnId,
          checkpointTurnCount: 2,
          checkpointRef: "refs/tabs/checkpoints/thread-revert-files/turn/2" as CheckpointRef,
          status: "ready",
          files: [],
          assistantMessageId: "message-remove" as MessageId,
          completedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.message-sent",
        eventId: "evt-revert-files-6" as EventId,
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: "cmd-revert-files-6" as CommandId,
        causationEventId: null,
        correlationId: "cmd-revert-files-6" as CorrelationId,
        metadata: {},
        payload: {
          threadId,
          messageId: "message-remove" as MessageId,
          role: "assistant",
          text: "Remove",
          attachments: [
            {
              type: "image",
              id: removeAttachmentId,
              name: "remove.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
          ],
          turnId: "turn-remove" as TurnId,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      const keepPath = path.join(attachmentsDir, `${keepAttachmentId}.png`);
      const removePath = path.join(attachmentsDir, `${removeAttachmentId}.png`);
      yield* fileSystem.makeDirectory(attachmentsDir, { recursive: true });
      yield* fileSystem.writeFileString(keepPath, "keep");
      yield* fileSystem.writeFileString(removePath, "remove");
      const otherThreadPath = path.join(attachmentsDir, `${otherThreadAttachmentId}.png`);
      yield* fileSystem.writeFileString(otherThreadPath, "other");
      assert.isTrue(yield* exists(keepPath));
      assert.isTrue(yield* exists(removePath));
      assert.isTrue(yield* exists(otherThreadPath));

      yield* appendAndProject({
        type: "thread.reverted",
        eventId: "evt-revert-files-7" as EventId,
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: "cmd-revert-files-7" as CommandId,
        causationEventId: null,
        correlationId: "cmd-revert-files-7" as CorrelationId,
        metadata: {},
        payload: {
          threadId,
          turnCount: 1,
        },
      });

      assert.isTrue(yield* exists(keepPath));
      assert.isFalse(yield* exists(removePath));
      assert.isTrue(yield* exists(otherThreadPath));
    }),
  );
});

it.layer(
  Layer.fresh(makeProjectionPipelinePrefixedTestLayer("tabs-projection-attachments-revert-")),
)("OrchestrationProjectionPipeline", (it) => {
  it.effect("removes thread attachment directory when thread is deleted", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const { attachmentsDir } = yield* ServerConfig;
      const now = new Date().toISOString();
      const threadId = "Thread Delete.Files" as ThreadId;
      const attachmentId = "thread-delete-files-00000000-0000-4000-8000-000000000001";
      const otherThreadAttachmentId =
        "thread-delete-files-extra-00000000-0000-4000-8000-000000000002";

      const appendAndProject = (event: Parameters<typeof eventStore.append>[0]) =>
        eventStore
          .append(event)
          .pipe(Effect.flatMap((savedEvent) => projectionPipeline.projectEvent(savedEvent)));

      yield* appendAndProject({
        type: "project.created",
        eventId: "evt-delete-files-1" as EventId,
        aggregateKind: "project",
        aggregateId: "project-delete-files" as ProjectId,
        occurredAt: now,
        commandId: "cmd-delete-files-1" as CommandId,
        causationEventId: null,
        correlationId: "cmd-delete-files-1" as CorrelationId,
        metadata: {},
        payload: {
          projectId: "project-delete-files" as ProjectId,
          title: "Project Delete Files",
          workspaceRoot: "/tmp/project-delete-files",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.created",
        eventId: "evt-delete-files-2" as EventId,
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: "cmd-delete-files-2" as CommandId,
        causationEventId: null,
        correlationId: "cmd-delete-files-2" as CorrelationId,
        metadata: {},
        payload: {
          threadId,
          projectId: "project-delete-files" as ProjectId,
          title: "Thread Delete Files",
          modelSelection: {
            instanceId: "codex" as ProviderInstanceId,
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.message-sent",
        eventId: "evt-delete-files-3" as EventId,
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: "cmd-delete-files-3" as CommandId,
        causationEventId: null,
        correlationId: "cmd-delete-files-3" as CorrelationId,
        metadata: {},
        payload: {
          threadId,
          messageId: "message-delete-files" as MessageId,
          role: "user",
          text: "Delete",
          attachments: [
            {
              type: "image",
              id: attachmentId,
              name: "delete.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
          ],
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      const threadAttachmentPath = path.join(attachmentsDir, `${attachmentId}.png`);
      const otherThreadAttachmentPath = path.join(attachmentsDir, `${otherThreadAttachmentId}.png`);
      yield* fileSystem.makeDirectory(attachmentsDir, { recursive: true });
      yield* fileSystem.writeFileString(threadAttachmentPath, "delete");
      yield* fileSystem.writeFileString(otherThreadAttachmentPath, "other-thread");
      assert.isTrue(yield* exists(threadAttachmentPath));
      assert.isTrue(yield* exists(otherThreadAttachmentPath));

      yield* appendAndProject({
        type: "thread.deleted",
        eventId: "evt-delete-files-4" as EventId,
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: "cmd-delete-files-4" as CommandId,
        causationEventId: null,
        correlationId: "cmd-delete-files-4" as CorrelationId,
        metadata: {},
        payload: {
          threadId,
          deletedAt: now,
        },
      });

      assert.isFalse(yield* exists(threadAttachmentPath));
      assert.isTrue(yield* exists(otherThreadAttachmentPath));
    }),
  );
});

it.layer(
  Layer.fresh(makeProjectionPipelinePrefixedTestLayer("tabs-projection-attachments-delete-")),
)("OrchestrationProjectionPipeline", (it) => {
  it.effect("ignores unsafe thread ids for attachment cleanup paths", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const now = new Date().toISOString();
      const { attachmentsDir: attachmentsRootDir, stateDir } = yield* ServerConfig;
      const attachmentsSentinelPath = path.join(attachmentsRootDir, "sentinel.txt");
      const stateDirSentinelPath = path.join(stateDir, "state-sentinel.txt");
      yield* fileSystem.makeDirectory(attachmentsRootDir, { recursive: true });
      yield* fileSystem.writeFileString(attachmentsSentinelPath, "keep-attachments-root");
      yield* fileSystem.writeFileString(stateDirSentinelPath, "keep-state-dir");

      yield* eventStore.append({
        type: "thread.deleted",
        eventId: "evt-unsafe-thread-delete" as EventId,
        aggregateKind: "thread",
        aggregateId: ".." as ThreadId,
        occurredAt: now,
        commandId: "cmd-unsafe-thread-delete" as CommandId,
        causationEventId: null,
        correlationId: "cmd-unsafe-thread-delete" as CorrelationId,
        metadata: {},
        payload: {
          threadId: ".." as ThreadId,
          deletedAt: now,
        },
      });

      yield* projectionPipeline.bootstrap;

      assert.isTrue(yield* exists(attachmentsRootDir));
      assert.isTrue(yield* exists(attachmentsSentinelPath));
      assert.isTrue(yield* exists(stateDirSentinelPath));
    }),
  );
});

it.layer(BaseTestLayer)("OrchestrationProjectionPipeline", (it) => {
  it.effect("resumes from projector last_applied_sequence without replaying older events", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = new Date().toISOString();

      yield* eventStore.append({
        type: "project.created",
        eventId: "evt-a1" as EventId,
        aggregateKind: "project",
        aggregateId: "project-a" as ProjectId,
        occurredAt: now,
        commandId: "cmd-a1" as CommandId,
        causationEventId: null,
        correlationId: "cmd-a1" as CorrelationId,
        metadata: {},
        payload: {
          projectId: "project-a" as ProjectId,
          title: "Project A",
          workspaceRoot: "/tmp/project-a",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.created",
        eventId: "evt-a2" as EventId,
        aggregateKind: "thread",
        aggregateId: "thread-a" as ThreadId,
        occurredAt: now,
        commandId: "cmd-a2" as CommandId,
        causationEventId: null,
        correlationId: "cmd-a2" as CorrelationId,
        metadata: {},
        payload: {
          threadId: "thread-a" as ThreadId,
          projectId: "project-a" as ProjectId,
          title: "Thread A",
          modelSelection: {
            instanceId: "codex" as ProviderInstanceId,
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: "evt-a3" as EventId,
        aggregateKind: "thread",
        aggregateId: "thread-a" as ThreadId,
        occurredAt: now,
        commandId: "cmd-a3" as CommandId,
        causationEventId: null,
        correlationId: "cmd-a3" as CorrelationId,
        metadata: {},
        payload: {
          threadId: "thread-a" as ThreadId,
          messageId: "message-a" as MessageId,
          role: "assistant",
          text: "hello",
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* projectionPipeline.bootstrap;

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: "evt-a4" as EventId,
        aggregateKind: "thread",
        aggregateId: "thread-a" as ThreadId,
        occurredAt: now,
        commandId: "cmd-a4" as CommandId,
        causationEventId: null,
        correlationId: "cmd-a4" as CorrelationId,
        metadata: {},
        payload: {
          threadId: "thread-a" as ThreadId,
          messageId: "message-a" as MessageId,
          role: "assistant",
          text: " world",
          turnId: null,
          streaming: true,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* projectionPipeline.bootstrap;
      yield* projectionPipeline.bootstrap;

      const messageRows = yield* sql<{ readonly text: string }>`
        SELECT text FROM projection_thread_messages WHERE message_id = 'message-a'
      `;
      assert.deepEqual(messageRows, [{ text: "hello world" }]);

      const stateRows = yield* sql<{
        readonly projector: string;
        readonly lastAppliedSequence: number;
      }>`
        SELECT
          projector,
          last_applied_sequence AS "lastAppliedSequence"
        FROM projection_state
      `;
      const maxSequenceRows = yield* sql<{ readonly maxSequence: number }>`
        SELECT MAX(sequence) AS "maxSequence" FROM orchestration_events
      `;
      const maxSequence = maxSequenceRows[0]?.maxSequence ?? 0;
      for (const row of stateRows) {
        assert.equal(row.lastAppliedSequence, maxSequence);
      }
    }),
  );

  it.effect("keeps accumulated assistant text when completion payload text is empty", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = new Date().toISOString();

      yield* eventStore.append({
        type: "project.created",
        eventId: "evt-empty-1" as EventId,
        aggregateKind: "project",
        aggregateId: "project-empty" as ProjectId,
        occurredAt: now,
        commandId: "cmd-empty-1" as CommandId,
        causationEventId: null,
        correlationId: "cmd-empty-1" as CorrelationId,
        metadata: {},
        payload: {
          projectId: "project-empty" as ProjectId,
          title: "Project Empty",
          workspaceRoot: "/tmp/project-empty",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.created",
        eventId: "evt-empty-2" as EventId,
        aggregateKind: "thread",
        aggregateId: "thread-empty" as ThreadId,
        occurredAt: now,
        commandId: "cmd-empty-2" as CommandId,
        causationEventId: null,
        correlationId: "cmd-empty-2" as CorrelationId,
        metadata: {},
        payload: {
          threadId: "thread-empty" as ThreadId,
          projectId: "project-empty" as ProjectId,
          title: "Thread Empty",
          modelSelection: {
            instanceId: "codex" as ProviderInstanceId,
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: "evt-empty-3" as EventId,
        aggregateKind: "thread",
        aggregateId: "thread-empty" as ThreadId,
        occurredAt: now,
        commandId: "cmd-empty-3" as CommandId,
        causationEventId: null,
        correlationId: "cmd-empty-3" as CorrelationId,
        metadata: {},
        payload: {
          threadId: "thread-empty" as ThreadId,
          messageId: "assistant-empty" as MessageId,
          role: "assistant",
          text: "Hello",
          turnId: null,
          streaming: true,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: "evt-empty-4" as EventId,
        aggregateKind: "thread",
        aggregateId: "thread-empty" as ThreadId,
        occurredAt: now,
        commandId: "cmd-empty-4" as CommandId,
        causationEventId: null,
        correlationId: "cmd-empty-4" as CorrelationId,
        metadata: {},
        payload: {
          threadId: "thread-empty" as ThreadId,
          messageId: "assistant-empty" as MessageId,
          role: "assistant",
          text: " world",
          turnId: null,
          streaming: true,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: "evt-empty-5" as EventId,
        aggregateKind: "thread",
        aggregateId: "thread-empty" as ThreadId,
        occurredAt: now,
        commandId: "cmd-empty-5" as CommandId,
        causationEventId: null,
        correlationId: "cmd-empty-5" as CorrelationId,
        metadata: {},
        payload: {
          threadId: "thread-empty" as ThreadId,
          messageId: "assistant-empty" as MessageId,
          role: "assistant",
          text: "",
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* projectionPipeline.bootstrap;

      const messageRows = yield* sql<{ readonly text: string; readonly isStreaming: unknown }>`
        SELECT
          text,
          is_streaming AS "isStreaming"
        FROM projection_thread_messages
        WHERE message_id = 'assistant-empty'
      `;
      assert.equal(messageRows.length, 1);
      assert.equal(messageRows[0]?.text, "Hello world");
      assert.isFalse(Boolean(messageRows[0]?.isStreaming));
    }),
  );

  it.effect(
    "resolves turn-count conflicts when checkpoint completion rewrites provisional turns",
    () =>
      Effect.gen(function* () {
        const projectionPipeline = yield* OrchestrationProjectionPipeline;
        const eventStore = yield* OrchestrationEventStore;
        const sql = yield* SqlClient.SqlClient;
        const appendAndProject = (event: Parameters<typeof eventStore.append>[0]) =>
          eventStore
            .append(event)
            .pipe(Effect.flatMap((savedEvent) => projectionPipeline.projectEvent(savedEvent)));

        yield* appendAndProject({
          type: "project.created",
          eventId: "evt-conflict-1" as EventId,
          aggregateKind: "project",
          aggregateId: "project-conflict" as ProjectId,
          occurredAt: "2026-02-26T13:00:00.000Z",
          commandId: "cmd-conflict-1" as CommandId,
          causationEventId: null,
          correlationId: "cmd-conflict-1" as CorrelationId,
          metadata: {},
          payload: {
            projectId: "project-conflict" as ProjectId,
            title: "Project Conflict",
            workspaceRoot: "/tmp/project-conflict",
            defaultModelSelection: null,
            scripts: [],
            createdAt: "2026-02-26T13:00:00.000Z",
            updatedAt: "2026-02-26T13:00:00.000Z",
          },
        });

        yield* appendAndProject({
          type: "thread.created",
          eventId: "evt-conflict-2" as EventId,
          aggregateKind: "thread",
          aggregateId: "thread-conflict" as ThreadId,
          occurredAt: "2026-02-26T13:00:01.000Z",
          commandId: "cmd-conflict-2" as CommandId,
          causationEventId: null,
          correlationId: "cmd-conflict-2" as CorrelationId,
          metadata: {},
          payload: {
            threadId: "thread-conflict" as ThreadId,
            projectId: "project-conflict" as ProjectId,
            title: "Thread Conflict",
            modelSelection: {
              instanceId: "codex" as ProviderInstanceId,
              model: "gpt-5-codex",
            },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt: "2026-02-26T13:00:01.000Z",
            updatedAt: "2026-02-26T13:00:01.000Z",
          },
        });

        yield* appendAndProject({
          type: "thread.turn-interrupt-requested",
          eventId: "evt-conflict-3" as EventId,
          aggregateKind: "thread",
          aggregateId: "thread-conflict" as ThreadId,
          occurredAt: "2026-02-26T13:00:02.000Z",
          commandId: "cmd-conflict-3" as CommandId,
          causationEventId: null,
          correlationId: "cmd-conflict-3" as CorrelationId,
          metadata: {},
          payload: {
            threadId: "thread-conflict" as ThreadId,
            turnId: "turn-interrupted" as TurnId,
            createdAt: "2026-02-26T13:00:02.000Z",
          },
        });

        yield* appendAndProject({
          type: "thread.message-sent",
          eventId: "evt-conflict-4" as EventId,
          aggregateKind: "thread",
          aggregateId: "thread-conflict" as ThreadId,
          occurredAt: "2026-02-26T13:00:03.000Z",
          commandId: "cmd-conflict-4" as CommandId,
          causationEventId: null,
          correlationId: "cmd-conflict-4" as CorrelationId,
          metadata: {},
          payload: {
            threadId: "thread-conflict" as ThreadId,
            messageId: "assistant-conflict" as MessageId,
            role: "assistant",
            text: "done",
            turnId: "turn-completed" as TurnId,
            streaming: false,
            createdAt: "2026-02-26T13:00:03.000Z",
            updatedAt: "2026-02-26T13:00:03.000Z",
          },
        });

        yield* appendAndProject({
          type: "thread.turn-diff-completed",
          eventId: "evt-conflict-5" as EventId,
          aggregateKind: "thread",
          aggregateId: "thread-conflict" as ThreadId,
          occurredAt: "2026-02-26T13:00:04.000Z",
          commandId: "cmd-conflict-5" as CommandId,
          causationEventId: null,
          correlationId: "cmd-conflict-5" as CorrelationId,
          metadata: {},
          payload: {
            threadId: "thread-conflict" as ThreadId,
            turnId: "turn-completed" as TurnId,
            checkpointTurnCount: 1,
            checkpointRef: "refs/tabs/checkpoints/thread-conflict/turn/1" as CheckpointRef,
            status: "ready",
            files: [],
            assistantMessageId: "assistant-conflict" as MessageId,
            completedAt: "2026-02-26T13:00:04.000Z",
          },
        });

        const turnRows = yield* sql<{
          readonly turnId: string;
          readonly checkpointTurnCount: number | null;
          readonly status: string;
        }>`
        SELECT
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          state AS "status"
        FROM projection_turns
        WHERE thread_id = 'thread-conflict'
        ORDER BY
          CASE
            WHEN checkpoint_turn_count IS NULL THEN 1
            ELSE 0
          END ASC,
          checkpoint_turn_count ASC,
          requested_at ASC
      `;
        assert.deepEqual(turnRows, [
          { turnId: "turn-completed", checkpointTurnCount: 1, status: "completed" },
          { turnId: "turn-interrupted", checkpointTurnCount: null, status: "interrupted" },
        ]);
      }),
  );

  it.effect("does not fallback-retain messages whose turnId is removed by revert", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const appendAndProject = (event: Parameters<typeof eventStore.append>[0]) =>
        eventStore
          .append(event)
          .pipe(Effect.flatMap((savedEvent) => projectionPipeline.projectEvent(savedEvent)));

      yield* appendAndProject({
        type: "project.created",
        eventId: "evt-revert-1" as EventId,
        aggregateKind: "project",
        aggregateId: "project-revert" as ProjectId,
        occurredAt: "2026-02-26T12:00:00.000Z",
        commandId: "cmd-revert-1" as CommandId,
        causationEventId: null,
        correlationId: "cmd-revert-1" as CorrelationId,
        metadata: {},
        payload: {
          projectId: "project-revert" as ProjectId,
          title: "Project Revert",
          workspaceRoot: "/tmp/project-revert",
          defaultModelSelection: null,
          scripts: [],
          createdAt: "2026-02-26T12:00:00.000Z",
          updatedAt: "2026-02-26T12:00:00.000Z",
        },
      });

      yield* appendAndProject({
        type: "thread.created",
        eventId: "evt-revert-2" as EventId,
        aggregateKind: "thread",
        aggregateId: "thread-revert" as ThreadId,
        occurredAt: "2026-02-26T12:00:01.000Z",
        commandId: "cmd-revert-2" as CommandId,
        causationEventId: null,
        correlationId: "cmd-revert-2" as CorrelationId,
        metadata: {},
        payload: {
          threadId: "thread-revert" as ThreadId,
          projectId: "project-revert" as ProjectId,
          title: "Thread Revert",
          modelSelection: {
            instanceId: "codex" as ProviderInstanceId,
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: "2026-02-26T12:00:01.000Z",
          updatedAt: "2026-02-26T12:00:01.000Z",
        },
      });

      yield* appendAndProject({
        type: "thread.turn-diff-completed",
        eventId: "evt-revert-3" as EventId,
        aggregateKind: "thread",
        aggregateId: "thread-revert" as ThreadId,
        occurredAt: "2026-02-26T12:00:02.000Z",
        commandId: "cmd-revert-3" as CommandId,
        causationEventId: null,
        correlationId: "cmd-revert-3" as CorrelationId,
        metadata: {},
        payload: {
          threadId: "thread-revert" as ThreadId,
          turnId: "turn-1" as TurnId,
          checkpointTurnCount: 1,
          checkpointRef: "refs/tabs/checkpoints/thread-revert/turn/1" as CheckpointRef,
          status: "ready",
          files: [],
          assistantMessageId: "assistant-keep" as MessageId,
          completedAt: "2026-02-26T12:00:02.000Z",
        },
      });

      yield* appendAndProject({
        type: "thread.message-sent",
        eventId: "evt-revert-4" as EventId,
        aggregateKind: "thread",
        aggregateId: "thread-revert" as ThreadId,
        occurredAt: "2026-02-26T12:00:02.100Z",
        commandId: "cmd-revert-4" as CommandId,
        causationEventId: null,
        correlationId: "cmd-revert-4" as CorrelationId,
        metadata: {},
        payload: {
          threadId: "thread-revert" as ThreadId,
          messageId: "assistant-keep" as MessageId,
          role: "assistant",
          text: "kept",
          turnId: "turn-1" as TurnId,
          streaming: false,
          createdAt: "2026-02-26T12:00:02.100Z",
          updatedAt: "2026-02-26T12:00:02.100Z",
        },
      });

      yield* appendAndProject({
        type: "thread.turn-diff-completed",
        eventId: "evt-revert-5" as EventId,
        aggregateKind: "thread",
        aggregateId: "thread-revert" as ThreadId,
        occurredAt: "2026-02-26T12:00:03.000Z",
        commandId: "cmd-revert-5" as CommandId,
        causationEventId: null,
        correlationId: "cmd-revert-5" as CorrelationId,
        metadata: {},
        payload: {
          threadId: "thread-revert" as ThreadId,
          turnId: "turn-2" as TurnId,
          checkpointTurnCount: 2,
          checkpointRef: "refs/tabs/checkpoints/thread-revert/turn/2" as CheckpointRef,
          status: "ready",
          files: [],
          assistantMessageId: "assistant-remove" as MessageId,
          completedAt: "2026-02-26T12:00:03.000Z",
        },
      });

      yield* appendAndProject({
        type: "thread.message-sent",
        eventId: "evt-revert-6" as EventId,
        aggregateKind: "thread",
        aggregateId: "thread-revert" as ThreadId,
        occurredAt: "2026-02-26T12:00:03.050Z",
        commandId: "cmd-revert-6" as CommandId,
        causationEventId: null,
        correlationId: "cmd-revert-6" as CorrelationId,
        metadata: {},
        payload: {
          threadId: "thread-revert" as ThreadId,
          messageId: "user-remove" as MessageId,
          role: "user",
          text: "removed",
          turnId: "turn-2" as TurnId,
          streaming: false,
          createdAt: "2026-02-26T12:00:03.050Z",
          updatedAt: "2026-02-26T12:00:03.050Z",
        },
      });

      yield* appendAndProject({
        type: "thread.message-sent",
        eventId: "evt-revert-7" as EventId,
        aggregateKind: "thread",
        aggregateId: "thread-revert" as ThreadId,
        occurredAt: "2026-02-26T12:00:03.100Z",
        commandId: "cmd-revert-7" as CommandId,
        causationEventId: null,
        correlationId: "cmd-revert-7" as CorrelationId,
        metadata: {},
        payload: {
          threadId: "thread-revert" as ThreadId,
          messageId: "assistant-remove" as MessageId,
          role: "assistant",
          text: "removed",
          turnId: "turn-2" as TurnId,
          streaming: false,
          createdAt: "2026-02-26T12:00:03.100Z",
          updatedAt: "2026-02-26T12:00:03.100Z",
        },
      });

      yield* appendAndProject({
        type: "thread.reverted",
        eventId: "evt-revert-8" as EventId,
        aggregateKind: "thread",
        aggregateId: "thread-revert" as ThreadId,
        occurredAt: "2026-02-26T12:00:04.000Z",
        commandId: "cmd-revert-8" as CommandId,
        causationEventId: null,
        correlationId: "cmd-revert-8" as CorrelationId,
        metadata: {},
        payload: {
          threadId: "thread-revert" as ThreadId,
          turnCount: 1,
        },
      });

      const messageRows = yield* sql<{
        readonly messageId: string;
        readonly turnId: string | null;
        readonly role: string;
      }>`
        SELECT
          message_id AS "messageId",
          turn_id AS "turnId",
          role
        FROM projection_thread_messages
        WHERE thread_id = 'thread-revert'
        ORDER BY created_at ASC, message_id ASC
      `;
      assert.deepEqual(messageRows, [
        {
          messageId: "assistant-keep",
          turnId: "turn-1",
          role: "assistant",
        },
      ]);
    }),
  );
});

it.effect("restores pending turn-start metadata across projection pipeline restart", () =>
  Effect.gen(function* () {
    const { dbPath } = yield* ServerConfig;
    const persistenceLayer = makeSqlitePersistenceLive(dbPath);
    const firstProjectionLayer = OrchestrationProjectionPipelineLive.pipe(
      Layer.provideMerge(OrchestrationEventStoreLive),
      Layer.provideMerge(persistenceLayer),
    );
    const secondProjectionLayer = OrchestrationProjectionPipelineLive.pipe(
      Layer.provideMerge(OrchestrationEventStoreLive),
      Layer.provideMerge(persistenceLayer),
    );

    const threadId = "thread-restart" as ThreadId;
    const turnId = "turn-restart" as TurnId;
    const messageId = "message-restart" as MessageId;
    const sourcePlanThreadId = "thread-plan-source" as ThreadId;
    const sourcePlanId = "plan-source";
    const turnStartedAt = "2026-02-26T14:00:00.000Z";
    const sessionSetAt = "2026-02-26T14:00:05.000Z";

    yield* Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;

      yield* eventStore.append({
        type: "thread.turn-start-requested",
        eventId: "evt-restart-1" as EventId,
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: turnStartedAt,
        commandId: "cmd-restart-1" as CommandId,
        causationEventId: null,
        correlationId: "cmd-restart-1" as CorrelationId,
        metadata: {},
        payload: {
          threadId,
          messageId,
          sourceProposedPlan: {
            threadId: sourcePlanThreadId,
            planId: sourcePlanId,
          },
          runtimeMode: "approval-required",
          createdAt: turnStartedAt,
        },
      });

      yield* projectionPipeline.bootstrap;
    }).pipe(Effect.provide(firstProjectionLayer));

    const turnRows = yield* Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const sql = yield* SqlClient.SqlClient;

      yield* eventStore.append({
        type: "thread.session-set",
        eventId: "evt-restart-2" as EventId,
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: sessionSetAt,
        commandId: "cmd-restart-2" as CommandId,
        causationEventId: null,
        correlationId: "cmd-restart-2" as CorrelationId,
        metadata: {},
        payload: {
          threadId,
          session: {
            threadId,
            status: "running",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: turnId,
            lastError: null,
            updatedAt: sessionSetAt,
          },
        },
      });

      yield* projectionPipeline.bootstrap;

      const pendingRows = yield* sql<{ readonly threadId: string }>`
        SELECT thread_id AS "threadId"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND turn_id IS NULL
          AND state = 'pending'
      `;
      assert.deepEqual(pendingRows, []);

      return yield* sql<{
        readonly turnId: string;
        readonly userMessageId: string | null;
        readonly sourceProposedPlanThreadId: string | null;
        readonly sourceProposedPlanId: string | null;
        readonly startedAt: string;
      }>`
        SELECT
          turn_id AS "turnId",
          pending_message_id AS "userMessageId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId",
          started_at AS "startedAt"
        FROM projection_turns
        WHERE turn_id = ${turnId}
      `;
    }).pipe(Effect.provide(secondProjectionLayer));

    assert.deepEqual(turnRows, [
      {
        turnId: "turn-restart",
        userMessageId: "message-restart",
        sourceProposedPlanThreadId: "thread-plan-source",
        sourceProposedPlanId: "plan-source",
        startedAt: turnStartedAt,
      },
    ]);
  }).pipe(
    Effect.provide(
      Layer.provideMerge(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "tabs-projection-pipeline-restart-",
        }),
        NodeServices.layer,
      ),
    ),
  ),
);

const engineLayer = it.layer(
  OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), {
        prefix: "tabs-projection-pipeline-engine-dispatch-",
      }),
    ),
    Layer.provideMerge(NodeServices.layer),
  ),
);

engineLayer("OrchestrationProjectionPipeline via engine dispatch", (it) => {
  it.effect("projects dispatched engine events immediately", () =>
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const sql = yield* SqlClient.SqlClient;
      const createdAt = new Date().toISOString();

      yield* engine.dispatch({
        type: "project.create",
        commandId: "cmd-live-project" as CommandId,
        projectId: "project-live" as ProjectId,
        title: "Live Project",
        workspaceRoot: "/tmp/project-live",
        defaultModelSelection: {
          instanceId: "codex" as ProviderInstanceId,
          model: "gpt-5-codex",
        },
        createdAt,
      });

      const projectRows = yield* sql<{ readonly title: string; readonly scriptsJson: string }>`
        SELECT
          title,
          scripts_json AS "scriptsJson"
        FROM projection_projects
        WHERE project_id = 'project-live'
      `;
      assert.deepEqual(projectRows, [{ title: "Live Project", scriptsJson: "[]" }]);

      const projectorRows = yield* sql<{ readonly lastAppliedSequence: number }>`
        SELECT
          last_applied_sequence AS "lastAppliedSequence"
        FROM projection_state
        WHERE projector = 'projection.projects'
      `;
      assert.deepEqual(projectorRows, [{ lastAppliedSequence: 1 }]);
    }),
  );

  it.effect("projects persist updated scripts from project.meta.update", () =>
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const sql = yield* SqlClient.SqlClient;
      const createdAt = new Date().toISOString();

      yield* engine.dispatch({
        type: "project.create",
        commandId: "cmd-scripts-project-create" as CommandId,
        projectId: "project-scripts" as ProjectId,
        title: "Scripts Project",
        workspaceRoot: "/tmp/project-scripts",
        defaultModelSelection: {
          instanceId: "codex" as ProviderInstanceId,
          model: "gpt-5-codex",
        },
        createdAt,
      });

      yield* engine.dispatch({
        type: "project.meta.update",
        commandId: "cmd-scripts-project-update" as CommandId,
        projectId: "project-scripts" as ProjectId,
        scripts: [
          {
            id: "script-1",
            name: "Build",
            command: "bun run build",
            icon: "build",
            runOnWorktreeCreate: false,
          },
        ],
        defaultModelSelection: {
          instanceId: "codex" as ProviderInstanceId,
          model: "gpt-5",
        },
      });

      const projectRows = yield* sql<{
        readonly scriptsJson: string;
        readonly defaultModelSelection: string;
      }>`
        SELECT
          scripts_json AS "scriptsJson",
          default_model_selection_json AS "defaultModelSelection"
        FROM projection_projects
        WHERE project_id = 'project-scripts'
      `;
      assert.deepEqual(projectRows, [
        {
          scriptsJson:
            '[{"id":"script-1","name":"Build","command":"bun run build","icon":"build","runOnWorktreeCreate":false}]',
          defaultModelSelection: '{"instanceId":"codex","model":"gpt-5"}',
        },
      ]);
    }),
  );
});
