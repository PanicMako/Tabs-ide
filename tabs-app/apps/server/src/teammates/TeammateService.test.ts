import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  type OrchestrationV2DomainEvent,
  type ProjectId,
  type TeammateId,
  type ThreadId,
} from "@tabs/contracts";
import * as NodeSqliteClient from "@tabs/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as IdAllocator from "../orchestration-v2/IdAllocator.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ServerSettings from "../serverSettings.ts";
import { runTeammateAction } from "../mcp/toolkits/teammate/handlers.ts";
import { TeammateHome, layer as homeLayer } from "./TeammateHome.ts";
import { TeammateService, layer as serviceLayer } from "./TeammateService.ts";
import { TeammateStore, layer as storeLayer } from "./TeammateStore.ts";

const SCRATCH = "project-scratch" as ProjectId;
const REAL = "project-real" as ProjectId;

interface Calls {
  launches: Array<Record<string, any>>;
  sends: Array<Record<string, any>>;
  dispatches: Array<Record<string, any>>;
  interrupts: Array<Record<string, any>>;
  shells: Map<string, Record<string, any>>;
}

const makeHarness = (
  gitRepo: { isRepo: boolean; defaultBranch: string | null } = {
    isRepo: true,
    defaultBranch: "trunk",
  },
) => {
  const calls: Calls = {
    launches: [],
    sends: [],
    dispatches: [],
    interrupts: [],
    shells: new Map(),
  };
  let threadCounter = 0;
  const events = Effect.runSync(PubSub.unbounded<OrchestrationV2DomainEvent>());
  const settings = {
    teammatesEnabled: true,
    defaultModelSelection: { instanceId: "codex", model: "gpt-5" },
    textGenerationModelSelection: null,
    defaultRuntimeMode: "full-access",
  };

  const launch = Layer.succeed(ThreadLaunchService.ThreadLaunchService, {
    launch: (input: any) =>
      Effect.sync(() => {
        calls.launches.push(input);
        calls.shells.set(input.threadId, {
          id: input.threadId,
          projectId: input.projectId,
          title: input.title,
          status: "idle",
          archivedAt: null,
          deletedAt: null,
          pendingRuntimeRequest: null,
          latestVisibleMessage: null,
          lastError: null,
          branch: null,
        });
        return { threadId: input.threadId, projection: {} as any, resumed: false };
      }),
    retryPreparation: () => Effect.die("unused"),
  } as any);
  const threads = Layer.succeed(ThreadManagement.ThreadManagementService, {
    getThreadShell: (id: string) => Effect.succeed(calls.shells.get(id) ?? null),
    sendToThread: (input: any) => Effect.sync(() => (calls.sends.push(input), {} as any)),
    dispatch: (input: any) => Effect.sync(() => (calls.dispatches.push(input), {} as any)),
    interruptThread: (input: any) => Effect.sync(() => (calls.interrupts.push(input), {} as any)),
    listProjectThreads: () => Effect.succeed([]),
    streamDomainEvents: Stream.fromPubSub(events),
  } as any);
  const folders = Layer.succeed(ManagedProjectFolders.ManagedProjectFolders, {
    ensureScratchProject: Effect.succeed({ projectId: SCRATCH }),
  } as any);
  const projects = Layer.succeed(ProjectService.ProjectService, {
    getById: (projectId: string) =>
      Effect.succeed(
        projectId === REAL
          ? Option.some({ id: REAL, workspaceRoot: "/repo", defaultModelSelection: null })
          : Option.none(),
      ),
    listShells: () => Effect.succeed([{ id: REAL, title: "tabs", workspaceRoot: "/repo" }]),
  } as any);
  const serverSettings = Layer.succeed(ServerSettings.ServerSettingsService, {
    getSettings: Effect.sync(() => settings),
    subscribeChanges: Effect.succeed(Stream.empty),
  } as any);
  const ids = Layer.succeed(IdAllocator.IdAllocatorV2, {
    allocate: { thread: () => Effect.sync(() => `thread-${++threadCounter}`) },
  } as any);
  const gitWorkflow = Layer.succeed(GitWorkflowService.GitWorkflowService, {
    isRepository: () => Effect.succeed(gitRepo.isRepo),
  } as any);
  const gitDriver = Layer.succeed(GitVcsDriver.GitVcsDriver, {
    resolvePrimaryRemoteName: () => Effect.succeed("origin"),
    resolveDefaultBranchName: () => Effect.succeed(gitRepo.defaultBranch),
    execute: () => Effect.succeed({ exitCode: 0, stdout: "current-branch\n" }),
  } as any);
  const scheduler = Layer.succeed(Scheduler.Scheduler, { register: () => Effect.void } as any);

  const layer = serviceLayer.pipe(
    Layer.provideMerge(Layer.merge(storeLayer, homeLayer)),
    Layer.provide(
      Layer.mergeAll(
        launch,
        threads,
        folders,
        projects,
        serverSettings,
        ids,
        scheduler,
        gitWorkflow,
        gitDriver,
      ),
    ),
    Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "tabs-teammates-" })),
    Layer.provideMerge(NodeServices.layer),
  );
  return { calls, events, layer };
};

const setup = Effect.gen(function* () {
  yield* runMigrations();
  return yield* TeammateService;
});

it.effect("creates Notch on first snapshot, then numbered teammates", () => {
  const h = makeHarness();
  return Effect.gen(function* () {
    const service = yield* setup;
    const first = yield* service.snapshot;
    assert.deepEqual(
      first.teammates.map((t) => t.name),
      ["Notch"],
    );
    const second = yield* service.create({});
    const renamed = yield* service.create({ name: "Pixel" });
    assert.equal(second.name, "Notch 2");
    assert.equal(renamed.name, "Pixel");
    // Opening a snapshot again never adds another default.
    assert.equal((yield* service.snapshot).teammates.length, 3);
    const home = yield* TeammateHome;
    const soul = yield* service.getSoul(second.id);
    assert.include(soul, "# Notch 2");
    assert.include((yield* home.readSoul(second.id)) ?? "", "Describe Notch 2 here");
  }).pipe(Effect.provide(h.layer));
});

it.effect("opens a home chat once, in the scratch project, linked before launch", () => {
  const h = makeHarness();
  return Effect.gen(function* () {
    const service = yield* setup;
    const [notch] = (yield* service.snapshot).teammates;
    const opened = yield* service.openHome(notch!.id);
    assert.equal(opened.projectId, SCRATCH);
    assert.equal(h.calls.launches.length, 1);
    assert.equal(h.calls.launches[0]!.initialMessage, undefined);
    assert.equal(h.calls.launches[0]!.createdBy, "system");
    assert.equal(h.calls.launches[0]!.creationSource, "server");
    const again = yield* service.openHome(notch!.id);
    assert.equal(again.threadId, opened.threadId);
    assert.equal(h.calls.launches.length, 1);
    const snapshot = yield* service.snapshot;
    assert.deepEqual(snapshot.hiddenThreadIds, [opened.threadId]);
    assert.equal(snapshot.teammates[0]!.homeThreadId, opened.threadId);
    const store = yield* TeammateStore;
    assert.equal((yield* store.getThreadLink(opened.threadId))?.kind, "home");
  }).pipe(Effect.provide(h.layer));
});

it.effect(
  "tools resolve only in teammate chats; remember dedupes; look-around is restricted",
  () => {
    const h = makeHarness();
    return Effect.gen(function* () {
      const service = yield* setup;
      const [notch] = (yield* service.snapshot).teammates;
      const { threadId } = yield* service.openHome(notch!.id);
      const refused = yield* Effect.flip(
        runTeammateAction(service, "somebody-else" as ThreadId, { action: "item_list" }),
      );
      assert.include(refused.message, "only available in a teammate's own chat");

      const first = yield* runTeammateAction(service, threadId, {
        action: "remember",
        text: "Owns billing",
        topic: "people",
      });
      const second = yield* runTeammateAction(service, threadId, {
        action: "remember",
        text: "owns billing",
      });
      assert.equal((first as any).saved, true);
      assert.equal((second as any).saved, false);
      const home = yield* TeammateHome;
      assert.include((yield* home.readMemory(notch!.id)) ?? "", "Owns billing (people)");
      assert.equal(((yield* service.listFacts(notch!.id)) as any[]).length, 1);
      yield* runTeammateAction(service, threadId, { action: "forget", text: "billing" });
      assert.equal((yield* home.readMemory(notch!.id)) ?? "x", "");

      // A look-around thread may suggest and read, nothing else.
      const look = yield* service.lookAroundNow(notch!.id);
      assert.equal(look.status, "started");
      const lookThread = look.threadId!;
      const denied = yield* Effect.flip(
        runTeammateAction(service, lookThread, { action: "remember", text: "x" }),
      );
      assert.include(denied.message, "only reads and suggests");
      const added = yield* runTeammateAction(service, lookThread, {
        action: "suggest",
        title: "Fix CI",
        why: "red",
        ask: "fix ci please",
      });
      assert.equal((added as any).added, true);
      const dup = yield* runTeammateAction(service, lookThread, {
        action: "suggest",
        title: "fix ci",
        why: "red",
        ask: "again",
      });
      assert.equal((dup as any).added, false);
      // The look-around launch carried the read-only prompt on its own approval policy.
      const launched = h.calls.launches.at(-1)!;
      assert.equal(launched.runtimeMode, "approval-required");
      assert.include(
        launched.initialMessage.text,
        "Look around: find what is waiting on your owner",
      );
    }).pipe(Effect.provide(h.layer));
  },
);

it.effect("suggestions start a tracked worker and dismissed ones never come back", () => {
  const h = makeHarness();
  return Effect.gen(function* () {
    const service = yield* setup;
    const [notch] = (yield* service.snapshot).teammates;
    const { threadId } = yield* service.openHome(notch!.id);
    yield* runTeammateAction(service, threadId, {
      action: "suggest",
      title: "Fix CI",
      why: "red",
      ask: "fix ci",
    });
    yield* runTeammateAction(service, threadId, {
      action: "suggest",
      title: "Bump deps",
      why: "old",
      ask: "bump",
    });
    const [fixCi, bump] = (yield* service.snapshot).suggestions;

    // Workers need a project.
    const noProject = yield* Effect.flip(service.startSuggestion(fixCi!.id));
    assert.include(noProject.message, "needs a default project");

    yield* service.update({ id: notch!.id, patch: { projectId: REAL } });
    const started = yield* service.startSuggestion(fixCi!.id);
    assert.equal(started.item.status, "working");
    assert.deepEqual(started.item.workerThreadIds, [started.workerThreadId]);
    const worker = h.calls.launches.at(-1)!;
    assert.equal(worker.projectId, REAL);
    // A git project gets its own worktree on the repo's real default branch.
    assert.deepEqual(worker.workspaceStrategy, {
      type: "worktree",
      baseRef: "trunk",
      startFromOrigin: true,
    });
    assert.equal(worker.initialMessage.text, "fix ci");
    // Workers are ordinary threads: they are not hidden from the sidebar.
    assert.notInclude((yield* service.snapshot).hiddenThreadIds, started.workerThreadId);
    // And they do not get the teammate tool.
    const asWorker = yield* Effect.flip(
      runTeammateAction(service, started.workerThreadId, { action: "item_list" }),
    );
    assert.include(asWorker.message, "only available in a teammate's own chat");

    yield* service.dismissSuggestion(bump!.id);
    const again = yield* runTeammateAction(service, threadId, {
      action: "suggest",
      title: "Bump deps",
      why: "old",
      ask: "bump",
    });
    assert.equal((again as any).added, false);
    assert.deepEqual(
      (yield* service.snapshot).suggestions.map((suggestion) => [
        suggestion.title,
        suggestion.status,
      ]),
      [["Fix CI", "started"]],
    );
  }).pipe(Effect.provide(h.layer));
});

it.live("a finished worker posts a note to the home chat, raises a notice and a happy mood", () => {
  const h = makeHarness();
  return Effect.gen(function* () {
    const service = yield* setup;
    const [notch] = (yield* service.snapshot).teammates;
    yield* service.update({ id: notch!.id, patch: { projectId: REAL } });
    const home = yield* service.openHome(notch!.id);
    const started = (yield* runTeammateAction(service, home.threadId, {
      action: "worker_start",
      prompt: "Fix the login bug",
      title: "Login bug",
    })) as any;
    const workerThread = started.threadId as ThreadId;
    h.calls.shells.get(workerThread)!.latestVisibleMessage = { text: "Fixed in PR #1" };

    yield* PubSub.publish(h.events, {
      type: "run.updated",
      threadId: workerThread,
      payload: { id: "run-1", status: "completed" },
    } as any);
    yield* Effect.sleep("100 millis");

    assert.equal(h.calls.sends.length, 1);
    assert.equal(h.calls.sends[0]!.threadId, home.threadId);
    assert.include(h.calls.sends[0]!.text, "finished");
    assert.include(h.calls.sends[0]!.text, "Fixed in PR #1");
    const snapshot = yield* service.snapshot;
    assert.deepEqual(
      snapshot.notices.map((n) => n.kind),
      ["workDone"],
    );
    assert.equal(snapshot.activity[0]!.mood, "happy");

    // A replayed terminal event posts nothing twice.
    yield* PubSub.publish(h.events, {
      type: "run.updated",
      threadId: workerThread,
      payload: { id: "run-1", status: "completed" },
    } as any);
    yield* Effect.sleep("50 millis");
    assert.equal(h.calls.sends.length, 1);

    // A failed run turns the item to needsYou and notifies "couldn't finish".
    yield* PubSub.publish(h.events, {
      type: "run.updated",
      threadId: workerThread,
      payload: { id: "run-2", status: "failed" },
    } as any);
    yield* Effect.sleep("100 millis");
    const after = yield* service.snapshot;
    assert.equal(after.items[0]!.status, "needsYou");
    assert.equal(after.notices.at(-1)!.kind, "couldntFinish");
    assert.equal(after.activity[0]!.mood, "needsYou");
  }).pipe(Effect.provide(h.layer));
});

it.effect("delete removes the teammate, its home folder and archives its chats", () => {
  const h = makeHarness();
  return Effect.gen(function* () {
    const service = yield* setup;
    const [notch] = (yield* service.snapshot).teammates;
    const opened = yield* service.openHome(notch!.id);
    const files = yield* FileSystem.FileSystem;
    const home = yield* TeammateHome;
    assert.isTrue(yield* files.exists(home.homeDir(notch!.id)));
    yield* service.delete(notch!.id as TeammateId);
    assert.isFalse(yield* files.exists(home.homeDir(notch!.id)));
    assert.deepEqual(
      h.calls.dispatches.map((d) => [d.type, d.threadId]),
      [["thread.archive", opened.threadId]],
    );
  }).pipe(Effect.provide(h.layer));
});

it.effect("deleting the last teammate does not bring the default Notch back", () => {
  const h = makeHarness();
  return Effect.gen(function* () {
    const service = yield* setup;
    const [notch] = (yield* service.snapshot).teammates;
    yield* service.delete(notch!.id as TeammateId);
    assert.deepEqual((yield* service.snapshot).teammates, []);
    assert.deepEqual((yield* service.snapshot).teammates, []);
    const created = yield* service.create({ name: "Rae" });
    assert.deepEqual(
      (yield* service.snapshot).teammates.map((teammate) => teammate.id),
      [created.id],
    );
  }).pipe(Effect.provide(h.layer));
});

const workerStrategy = (harness: ReturnType<typeof makeHarness>, args: Record<string, unknown>) =>
  Effect.gen(function* () {
    const service = yield* setup;
    const [notch] = (yield* service.snapshot).teammates;
    yield* service.update({ id: notch!.id, patch: { projectId: REAL } });
    const home = yield* service.openHome(notch!.id);
    yield* runTeammateAction(service, home.threadId, {
      action: "worker_start",
      prompt: "go",
      ...args,
    } as any);
    return harness.calls.launches.at(-1)!.workspaceStrategy;
  });

it.effect(
  "workers run in place when the agent opts out, or when the project is not a git repo",
  () => {
    const optOut = makeHarness();
    const noRepo = makeHarness({ isRepo: false, defaultBranch: null });
    return Effect.gen(function* () {
      assert.deepEqual(
        yield* workerStrategy(optOut, { newWorktree: false }).pipe(Effect.provide(optOut.layer)),
        { type: "root" },
      );
      assert.deepEqual(yield* workerStrategy(noRepo, {}).pipe(Effect.provide(noRepo.layer)), {
        type: "root",
      });
    });
  },
);

it.effect("an explicit base ref wins over the repo default branch", () => {
  const h = makeHarness();
  return workerStrategy(h, { baseRef: "release" }).pipe(
    Effect.map((strategy) =>
      assert.deepEqual(strategy, { type: "worktree", baseRef: "release", startFromOrigin: true }),
    ),
    Effect.provide(h.layer),
  );
});

it.live(
  "a look-around that hits an approval prompt is interrupted, and only teammate chats see the tools",
  () => {
    const h = makeHarness();
    return Effect.gen(function* () {
      const service = yield* setup;
      const [notch] = (yield* service.snapshot).teammates;
      const home = yield* service.openHome(notch!.id);
      const look = (yield* service.lookAroundNow(notch!.id)).threadId!;
      assert.isTrue(yield* service.isTeammateThread(home.threadId));
      assert.isTrue(yield* service.isTeammateThread(look));
      assert.isFalse(yield* service.isTeammateThread("someone-else" as ThreadId));

      yield* PubSub.publish(h.events, {
        type: "runtime-request.updated",
        threadId: look,
        payload: { id: "req-1", status: "pending", responseCapability: { type: "live" } },
      } as any);
      yield* Effect.sleep("100 millis");
      assert.equal(h.calls.interrupts.length, 1);
      assert.equal(h.calls.interrupts[0]!.threadId, look);
    }).pipe(Effect.provide(h.layer));
  },
);
