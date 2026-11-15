import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import type { ProviderAdapterV2Shape } from "./ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("Runs here never reach a provider"),
} as ProviderAdapterV2Shape;
const layerDatabase = SqlitePersistence.layerMemory;
// No effect worker: runs stay unstarted, so Stop ends them without a provider.
const layerTest = ThreadManagementService.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      layerDatabase,
      ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
      ProviderReplayHarness.layerWithRegistry(
        { name: "delegated-workspace" },
        ProviderAdapterRegistry.layerFromAdapters([adapter]),
        { databaseLayer: layerDatabase, runEffectWorker: false },
      ),
    ),
  ),
);

const setup = (threadId: ThreadId, worktreePath: string | null, branch: string | null) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`create:${threadId}`),
      threadId,
      projectId: ProjectId.make("project:delegated-workspace"),
      title: threadId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch,
      worktreePath,
      createdBy: "user",
      creationSource: "web",
    });
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make(`send:${threadId}`),
      threadId,
      messageId: MessageId.make(`message:${threadId}`),
      text: "go",
      attachments: [],
      dispatchMode: { type: "start_immediately" },
      createdBy: "user",
      creationSource: "web",
    });
  });

const delegateInto = (
  parentThreadId: ThreadId,
  task: string,
  workspace?: { worktreePath: string; branch: string | null },
) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const parentRun = (yield* orchestrator.getThreadProjection(parentThreadId)).runs.at(-1)!;
    yield* orchestrator.dispatch({
      type: "delegated_task.request",
      commandId: CommandId.make(`delegate:${task}`),
      parentThreadId,
      parentRunId: parentRun.id,
      parentNodeId: parentRun.rootNodeId!,
      task,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      completionWake: "always",
      ...(workspace === undefined ? {} : { workspace }),
      createdBy: "agent",
      creationSource: "mcp",
    });
    const projection = yield* orchestrator.getThreadProjection(parentThreadId);
    const childThreadId = projection.subagents.find(
      (candidate) => candidate.prompt === task,
    )!.childThreadId!;
    return (yield* orchestrator.getThreadProjection(childThreadId)).thread;
  });

it.effect("a delegated task runs in the supplied worktree, otherwise in the parent's", () =>
  Effect.gen(function* () {
    const parentThreadId = ThreadId.make("thread:workspace-parent");
    yield* setup(parentThreadId, "/repo/lead", "feature/lead");
    const inherited = yield* delegateInto(parentThreadId, "shares the lead checkout");
    assert.equal(inherited.worktreePath, "/repo/lead");
    assert.equal(inherited.branch, "feature/lead");
    const isolated = yield* delegateInto(parentThreadId, "gets its own worktree", {
      worktreePath: "/repo/wt/task-a",
      branch: "overmind/plan-a-1",
    });
    assert.equal(isolated.worktreePath, "/repo/wt/task-a");
    assert.equal(isolated.branch, "overmind/plan-a-1");
  }).pipe(Effect.provide(layerTest)),
);
