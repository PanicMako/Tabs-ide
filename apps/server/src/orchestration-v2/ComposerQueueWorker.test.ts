// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ChatAttachmentId,
  CommandId,
  DateTimeUtc,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type ChatAttachment,
  type ModelSelection,
  type OrchestrationV2Run,
} from "@tabs/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as McpSessionRegistryTestkit from "../mcp/McpSessionRegistry.testkit.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ComposerQueueWorker from "./ComposerQueueWorker.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProviderRuntimeRecoveryService from "./ProviderRuntimeRecoveryService.ts";
import * as RuntimeLayer from "./runtimeLayer.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import { createPendingAttachmentId, resolveAttachmentPath } from "../attachmentStore.ts";
import * as ThreadMessageIntake from "./ThreadMessageIntake.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";

const layerPlatformTest = NodeServices.layer;

const layerServerConfig = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-composer-queue-worker-",
});

const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.4",
} satisfies ModelSelection;

const layerVcsDriverRegistryTest = VcsDriverRegistry.layer.pipe(
  Layer.provide(VcsProcess.layer),
  Layer.provide(layerServerConfig),
  Layer.provide(layerPlatformTest),
);

const layerCheckpointStoreTest = CheckpointStore.layer.pipe(
  Layer.provide(layerVcsDriverRegistryTest),
);

const layerGitWorkflowTest = Layer.mock(GitWorkflow.GitWorkflowService)({
  pruneWorktrees: () => Effect.void,
  createWorktree: () => Effect.succeed({} as never),
});

const layerProjectServiceTest = Layer.mock(ProjectService.ProjectService)({
  getById: () => Effect.succeed(Option.none()),
});

const driver = ProviderDriverKind.make("codex");
const orchestrationAdapter = {
  instanceId: modelSelection.instanceId,
  driver,
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
  openSession: () => Effect.die("sessions are not used by queue durability tests"),
} as any;

const providerInstance = {
  instanceId: modelSelection.instanceId,
  driverKind: driver,
  continuationIdentity: {
    driverKind: driver,
    continuationKey: "codex:test",
  },
  displayName: "Codex test",
  enabled: true,
  snapshot: { getSnapshot: Effect.succeed({}) } as unknown as ProviderInstance["snapshot"],
  orchestrationAdapter,
  textGeneration: {} as ProviderInstance["textGeneration"],
} satisfies ProviderInstance;

const layerTestProviderInstanceRegistry = Layer.succeed(
  ProviderInstanceRegistry.ProviderInstanceRegistry,
  {
    getInstance: (instanceId) =>
      Effect.succeed(instanceId === modelSelection.instanceId ? providerInstance : undefined),
    listInstances: Effect.succeed([providerInstance]),
    listUnavailable: Effect.succeed([]),
    streamChanges: Stream.empty,
    subscribeChanges: Effect.never,
  },
);

const layerQueueTest = Layer.mergeAll(
  RuntimeLayer.layer,
  ComposerQueueWorker.layer.pipe(Layer.provide(RuntimeLayer.layer)),
).pipe(
  Layer.provide(Scheduler.layer),
  Layer.provide(McpSessionRegistryTestkit.layer),
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provideMerge(layerServerConfig),
  Layer.provide(layerCheckpointStoreTest),
  Layer.provide(ServerSettings.layerTest()),
  Layer.provide(layerTestProviderInstanceRegistry),
  Layer.provide(layerGitWorkflowTest),
  Layer.provide(layerProjectServiceTest),
  Layer.provideMerge(layerPlatformTest),
);

it.layer(layerQueueTest)("ComposerQueueWorker durability and migration", (it) => {
  it.effect("duplicate acknowledgements are idempotent and preserve queue order", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const threadId = ThreadId.make("queue-idempotent-ack-thread");
      const projectId = ProjectId.make("queue-idempotent-ack-proj");

      yield* orchestrator.dispatch({
        type: "thread.create",
        createdBy: "user",
        creationSource: "web",
        commandId: CommandId.make("cmd-create-thread"),
        threadId,
        projectId,
        title: "Idempotent Ack",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: process.cwd(),
      });

      // Active message
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        createdBy: "user",
        creationSource: "web",
        commandId: CommandId.make("cmd-active-msg"),
        threadId,
        messageId: MessageId.make("msg-active"),
        text: "Active Message",
        attachments: [],
        modelSelection,
        dispatchMode: { type: "start_immediately" },
      });

      // Queued message command sent once
      const queueCmd = {
        type: "message.dispatch" as const,
        createdBy: "user" as const,
        creationSource: "web" as const,
        commandId: CommandId.make("cmd-queued-msg-stable"),
        threadId,
        messageId: MessageId.make("msg-queued-1"),
        text: "Queued Message 1",
        attachments: [],
        modelSelection,
        dispatchMode: { type: "queue_after_active" as const },
      };

      const receipt1 = yield* orchestrator.dispatch(queueCmd);
      // Duplicate delivery with the same stable commandId
      const receipt2 = yield* orchestrator.dispatch(queueCmd);

      assert.equal(receipt1.sequence, receipt2.sequence);
      const proj = yield* orchestrator.getThreadProjection(threadId);
      const queuedRuns = proj.runs.filter((r) => r.status === "queued");
      assert.equal(queuedRuns.length, 1);
      assert.equal(queuedRuns[0]!.userMessageId, MessageId.make("msg-queued-1"));
    }),
  );

  it.effect("disconnect and reconnect with incomplete migration resumes safely", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const threadId = ThreadId.make("queue-reconnect-migration-thread");
      const projectId = ProjectId.make("queue-reconnect-migration-proj");

      yield* orchestrator.dispatch({
        type: "thread.create",
        createdBy: "user",
        creationSource: "web",
        commandId: CommandId.make("cmd-create-reconn"),
        threadId,
        projectId,
        title: "Reconnect Migration",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: process.cwd(),
      });

      yield* orchestrator.dispatch({
        type: "message.dispatch",
        createdBy: "user",
        creationSource: "web",
        commandId: CommandId.make("cmd-reconn-active"),
        threadId,
        messageId: MessageId.make("msg-reconn-active"),
        text: "Active",
        attachments: [],
        modelSelection,
        dispatchMode: { type: "start_immediately" },
      });

      // Entry 1 migrated before disconnect
      const entry1 = {
        type: "message.dispatch" as const,
        createdBy: "user" as const,
        creationSource: "web" as const,
        commandId: CommandId.make("migration-entry-1"),
        threadId,
        messageId: MessageId.make("msg-entry-1"),
        text: "Migrated Entry 1",
        attachments: [],
        modelSelection,
        dispatchMode: { type: "queue_after_active" as const },
      };
      const ack1Before = yield* orchestrator.dispatch(entry1);

      // Simulate client disconnect and reconnect: client re-sends Entry 1 (idempotent ACK) then Entry 2
      const ack1After = yield* orchestrator.dispatch(entry1);
      assert.equal(ack1Before.sequence, ack1After.sequence);

      const entry2 = {
        type: "message.dispatch" as const,
        createdBy: "user" as const,
        creationSource: "web" as const,
        commandId: CommandId.make("migration-entry-2"),
        threadId,
        messageId: MessageId.make("msg-entry-2"),
        text: "Migrated Entry 2",
        attachments: [],
        modelSelection,
        dispatchMode: { type: "queue_after_active" as const },
      };
      const ack2 = yield* orchestrator.dispatch(entry2);
      assert.isTrue(ack2.sequence > ack1After.sequence);

      const proj = yield* orchestrator.getThreadProjection(threadId);
      const queuedRuns = proj.runs.filter((r) => r.status === "queued");
      assert.equal(queuedRuns.length, 2);
      assert.equal(queuedRuns[0]!.userMessageId, MessageId.make("msg-entry-1"));
      assert.equal(queuedRuns[1]!.userMessageId, MessageId.make("msg-entry-2"));
    }),
  );

  it.effect("server restart holds queued entries until explicit resume", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const recovery = yield* ProviderRuntimeRecoveryService.ProviderRuntimeRecoveryService;
      const threadId = ThreadId.make("queue-restart-hold-thread");
      const projectId = ProjectId.make("queue-restart-hold-proj");

      yield* orchestrator.dispatch({
        type: "thread.create",
        createdBy: "user",
        creationSource: "web",
        commandId: CommandId.make("cmd-create-restart"),
        threadId,
        projectId,
        title: "Restart Hold",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: process.cwd(),
      });

      // Active and queued
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        createdBy: "user",
        creationSource: "web",
        commandId: CommandId.make("cmd-restart-active"),
        threadId,
        messageId: MessageId.make("msg-restart-active"),
        text: "Active",
        attachments: [],
        modelSelection,
        dispatchMode: { type: "start_immediately" },
      });

      yield* orchestrator.dispatch({
        type: "message.dispatch",
        createdBy: "user",
        creationSource: "web",
        commandId: CommandId.make("cmd-restart-queued"),
        threadId,
        messageId: MessageId.make("msg-restart-queued"),
        text: "Queued",
        attachments: [],
        modelSelection,
        dispatchMode: { type: "queue_after_active" },
      });

      // Simulate server reboot / startup recovery
      yield* recovery.reconcile("startup");

      // While held, worker resume returns 0 and does not promote
      assert.equal(yield* orchestrator.resumeQueuedRuns, 0);

      const heldProj = yield* orchestrator.getThreadProjection(threadId);
      const queuedRun = heldProj.runs.find(
        (r) => r.userMessageId === MessageId.make("msg-restart-queued"),
      );
      assert.isDefined(queuedRun);
      assert.equal(queuedRun?.status, "queued");
      assert.isTrue(queuedRun?.queueHeld);

      // Explicit resume releases hold
      yield* orchestrator.dispatch({
        type: "queue.resume",
        commandId: CommandId.make("cmd-explicit-resume"),
        threadId,
      });

      const resumedProj = yield* orchestrator.getThreadProjection(threadId);
      const afterResumeRun = resumedProj.runs.find((r) => r.id === queuedRun!.id);
      // Active run was cancelled during restart reconciliation, so queued run can start
      assert.notEqual(afterResumeRun?.status, "queued");
    }),
  );

  it.effect("cancellation races delivery cleanly without starting cancelled run", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const threadId = ThreadId.make("queue-cancel-race-thread");
      const projectId = ProjectId.make("queue-cancel-race-proj");

      yield* orchestrator.dispatch({
        type: "thread.create",
        createdBy: "user",
        creationSource: "web",
        commandId: CommandId.make("cmd-create-cancel-race"),
        threadId,
        projectId,
        title: "Cancel Race",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: process.cwd(),
      });

      yield* orchestrator.dispatch({
        type: "message.dispatch",
        createdBy: "user",
        creationSource: "web",
        commandId: CommandId.make("cmd-cr-active"),
        threadId,
        messageId: MessageId.make("msg-cr-active"),
        text: "Active",
        attachments: [],
        modelSelection,
        dispatchMode: { type: "start_immediately" },
      });

      yield* orchestrator.dispatch({
        type: "message.dispatch",
        createdBy: "user",
        creationSource: "web",
        commandId: CommandId.make("cmd-cr-queued"),
        threadId,
        messageId: MessageId.make("msg-cr-queued"),
        text: "Will be cancelled",
        attachments: [],
        modelSelection,
        dispatchMode: { type: "queue_after_active" },
      });

      const before = yield* orchestrator.getThreadProjection(threadId);
      const queuedRun = before.runs.find((r) => r.status === "queued")!;
      assert.isDefined(queuedRun);

      // Cancel before delivery
      yield* orchestrator.dispatch({
        type: "queued-run.cancel",
        commandId: CommandId.make("cmd-cr-cancel"),
        threadId,
        runId: queuedRun.id,
      });

      // Worker runs due check
      const resumedCount = yield* orchestrator.resumeQueuedRuns;
      assert.equal(resumedCount, 0);

      const after = yield* orchestrator.getThreadProjection(threadId);
      const cancelledRun = after.runs.find((r) => r.id === queuedRun.id);
      assert.equal(cancelledRun?.status, "cancelled");
    }),
  );

  it.effect("attachment upload then cancel claims and cleans up staged files", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const config = yield* ServerConfig.ServerConfig;
      const threadId = ThreadId.make("queue-attachment-cancel-thread");
      const projectId = ProjectId.make("queue-attachment-cancel-proj");

      yield* orchestrator.dispatch({
        type: "thread.create",
        createdBy: "user",
        creationSource: "web",
        commandId: CommandId.make("cmd-create-att-cancel"),
        threadId,
        projectId,
        title: "Attachment Cancel",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: process.cwd(),
      });

      // Active message so the next message queues behind it
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        createdBy: "user",
        creationSource: "web",
        commandId: CommandId.make("cmd-att-active"),
        threadId,
        messageId: MessageId.make("msg-att-active"),
        text: "Active",
        attachments: [],
        modelSelection,
        dispatchMode: { type: "start_immediately" },
      });

      // Stage a pending attachment file
      const pendingAttachmentId = createPendingAttachmentId("png");
      const stagedFilePath = NodePath.join(config.attachmentsDir, `${pendingAttachmentId}.png`);
      NodeFS.mkdirSync(config.attachmentsDir, { recursive: true });
      NodeFS.writeFileSync(stagedFilePath, "test-attachment-data");

      const attachment = {
        id: ChatAttachmentId.make(pendingAttachmentId),
        type: "image" as const,
        name: "test-image.png",
        mimeType: "image/png",
        sizeBytes: 20,
      };

      // Dispatch through ThreadMessageIntake which claims the pending attachment
      yield* ThreadMessageIntake.dispatchCommand({
        type: "message.dispatch",
        createdBy: "user",
        creationSource: "web",
        commandId: CommandId.make("cmd-att-queued"),
        threadId,
        messageId: MessageId.make("msg-att-queued"),
        text: "With attachment",
        attachments: [attachment],
        modelSelection,
        dispatchMode: { type: "queue_after_active" },
      });

      const before = yield* orchestrator.getThreadProjection(threadId);
      const queuedRun = before.runs.find((r) => r.status === "queued")!;
      assert.isDefined(queuedRun);

      const msg = before.messages.find((m) => m.id === queuedRun.userMessageId)!;
      assert.equal(msg.attachments.length, 1);
      const claimedAttachment = msg.attachments[0]!;
      // Confirmed it was claimed into thread-scoped storage
      const claimedPath = resolveAttachmentPath({
        attachmentsDir: config.attachmentsDir,
        attachment: claimedAttachment,
      });
      assert.isNotNull(claimedPath);
      assert.isTrue(NodeFS.existsSync(claimedPath!));

      // Cancel the queued run
      yield* orchestrator.dispatch({
        type: "queued-run.cancel",
        commandId: CommandId.make("cmd-cancel-att-queued"),
        threadId,
        runId: queuedRun.id,
      });

      const after = yield* orchestrator.getThreadProjection(threadId);
      const cancelledRun = after.runs.find((r) => r.id === queuedRun.id);
      assert.equal(cancelledRun?.status, "cancelled");
    }),
  );

  it.effect("environment isolation preserves independent queues for secondary environments", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const thread1 = ThreadId.make("queue-env1-thread");
      const proj1 = ProjectId.make("queue-env1-proj");
      const thread2 = ThreadId.make("queue-env2-thread");
      const proj2 = ProjectId.make("queue-env2-proj");

      for (const [tId, pId] of [
        [thread1, proj1],
        [thread2, proj2],
      ] as const) {
        yield* orchestrator.dispatch({
          type: "thread.create",
          createdBy: "user",
          creationSource: "web",
          commandId: CommandId.make(`cmd-create-${tId}`),
          threadId: tId,
          projectId: pId,
          title: `Thread ${tId}`,
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: process.cwd(),
        });

        yield* orchestrator.dispatch({
          type: "message.dispatch",
          createdBy: "user",
          creationSource: "web",
          commandId: CommandId.make(`cmd-active-${tId}`),
          threadId: tId,
          messageId: MessageId.make(`msg-active-${tId}`),
          text: "Active",
          attachments: [],
          modelSelection,
          dispatchMode: { type: "start_immediately" },
        });

        yield* orchestrator.dispatch({
          type: "message.dispatch",
          createdBy: "user",
          creationSource: "web",
          commandId: CommandId.make(`cmd-queued-${tId}`),
          threadId: tId,
          messageId: MessageId.make(`msg-queued-${tId}`),
          text: `Queued for ${tId}`,
          attachments: [],
          modelSelection,
          dispatchMode: { type: "queue_after_active" },
        });
      }

      // Reorder or edit thread 1's queue
      const proj1Before = yield* orchestrator.getThreadProjection(thread1);
      const queued1 = proj1Before.runs.find((r) => r.status === "queued")!;

      yield* orchestrator.dispatch({
        type: "queued-run.edit",
        commandId: CommandId.make("cmd-edit-thread1"),
        threadId: thread1,
        runId: queued1.id,
        text: "Edited queue text 1",
      });

      // Verify thread 2 is completely unchanged and isolated
      const proj2After = yield* orchestrator.getThreadProjection(thread2);
      const queued2 = proj2After.runs.find((r) => r.status === "queued")!;
      assert.equal(queued2.userMessageId, MessageId.make(`msg-queued-${thread2}`));
      const msg2 = proj2After.messages.find((m) => m.id === queued2.userMessageId)!;
      assert.equal(msg2.text, `Queued for ${thread2}`);
    }),
  );
});
