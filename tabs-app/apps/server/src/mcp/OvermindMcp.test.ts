import { applySubagentModel } from "@tabs/shared/subagents";
import { assert, describe, it } from "@effect/vitest";
import { OrchestratorMcpFailure } from "@tabs/contracts";
import * as Effect from "effect/Effect";

import type { McpInvocationScope } from "./McpInvocationContext.ts";
import type { OrchestratorMcpServiceShape } from "./OrchestratorMcpService.ts";
import { advanceOvermind, resetOvermindRecordsForTest } from "./OvermindMcp.ts";
import type {
  OvermindPlanStore,
  OvermindWorkspaceHost,
  StoredOvermindPlan,
} from "./OvermindWorkspace.ts";

const scope = {
  requestNamespace: "ns",
  thread: { threadId: "thread:lead" },
} as unknown as McpInvocationScope;

type Status = "running" | "waiting" | "completed" | "failed" | "cancelled" | "interrupted" | "gone";

const tokenUsage = new Map<string, number>();
const workspaces: Array<{ title?: string; workspace?: unknown }> = [];

function fakeService(statuses: Map<string, Status>, started: string[]) {
  let counter = 0;
  const seenKeys = new Map<string, string>();
  return {
    delegateTask: (
      _scope: unknown,
      input: { clientRequestId?: string; title?: string },
      options?: { workspace?: unknown },
    ) =>
      Effect.sync(() => {
        workspaces.push({ title: input.title ?? "", workspace: options?.workspace });
        const key = input.clientRequestId ?? "";
        let id = seenKeys.get(key);
        if (id === undefined) {
          id = `node:${++counter}`;
          seenKeys.set(key, id);
          statuses.set(id, "running");
          started.push(input.title ?? "");
        }
        return { taskId: id };
      }),
    taskStatus: (_scope: unknown, taskId: string) => {
      const status = statuses.get(taskId);
      if (status === "gone") {
        return Effect.fail(new OrchestratorMcpFailure({ code: "task_not_found", message: "gone" }));
      }
      return Effect.succeed({
        status: status ?? "running",
        summary: status === "completed" ? "done" : null,
        latestTerminalSummary: null,
      });
    },
    taskTokenUsage: (_scope: unknown, taskId: string) =>
      Effect.succeed(tokenUsage.get(taskId) ?? null),
    cancelTask: () => Effect.succeed({ status: "cancel_requested" }),
  } as unknown as OrchestratorMcpServiceShape;
}

const plan = {
  planId: "p1",
  goal: "build it",
  tasks: [
    { id: "a", title: "A", prompt: "do a", files: ["src/a/"] },
    { id: "b", title: "B", prompt: "do b", files: ["src/b/"] },
    { id: "c", title: "C", prompt: "do c", files: ["src/a/x.ts"] },
    { id: "d", title: "D", prompt: "do d", dependsOn: ["a", "b"], files: ["src/d/"] },
  ],
} as never;

describe("advanceOvermind", () => {
  it.effect("runs a plan to completion without overlapping writers", () =>
    Effect.gen(function* () {
      resetOvermindRecordsForTest();
      const statuses = new Map<string, Status>();
      const started: string[] = [];
      const service = fakeService(statuses, started);

      const first = yield* advanceOvermind(service, scope, plan, 0);
      // a and b run together; c conflicts with a; d waits.
      assert.deepEqual(first.started, ["a", "b"]);
      assert.isFalse(first.settled);

      for (const task of first.tasks) if (task.taskId) statuses.set(task.taskId, "completed");
      const second = yield* advanceOvermind(service, scope, { planId: "p1" } as never, 10);
      assert.deepEqual(second.started, ["c", "d"]);

      for (const task of second.tasks)
        if (task.phase === "running" && task.taskId) statuses.set(task.taskId, "completed");
      const done = yield* advanceOvermind(service, scope, { planId: "p1" } as never, 20);
      assert.isTrue(done.settled);
      assert.equal(done.outcome, "succeeded");
    }),
  );

  it.effect("hands the user's sub-agent models to delegation, which applies them by role", () =>
    Effect.gen(function* () {
      resetOvermindRecordsForTest();
      const requested: unknown[] = [];
      const applied: unknown[] = [];
      const service = {
        ...fakeService(new Map(), []),
        delegateTask: (
          _scope: unknown,
          input: { target?: never; role?: never },
          options?: { subagentModels?: never },
        ) =>
          Effect.sync(() => {
            requested.push({ role: input.role, target: input.target });
            applied.push(applySubagentModel(options?.subagentModels, input.role, input.target));
            return { taskId: `node:${requested.length}` };
          }),
      } as unknown as OrchestratorMcpServiceShape;
      yield* advanceOvermind(
        service,
        scope,
        {
          planId: "w",
          goal: "g",
          tasks: [
            {
              id: "a",
              title: "A",
              prompt: "x",
              files: ["a/"],
              model: "opus",
              providerInstanceId: "claudeAgent",
            },
            { id: "b", title: "B", prompt: "y", role: "review" },
            { id: "c", title: "C", prompt: "z", role: "research" },
          ],
        } as never,
        0,
        {
          settings: {
            enabled: true,
            workers: {
              instanceId: "opencode",
              model: "cheap",
              options: [{ id: "effort", value: "low" }],
            },
            roles: { review: { instanceId: "codex", model: "strong" } },
          } as never,
        },
      );
      // The plan's own choice still reaches delegation; the user's choice wins there.
      assert.deepEqual(requested[0], {
        role: "implementation",
        target: { providerInstanceId: "claudeAgent", model: "opus" },
      });
      assert.deepEqual(applied, [
        {
          providerInstanceId: "opencode",
          model: "cheap",
          options: [{ id: "effort", value: "low" }],
        },
        { providerInstanceId: "codex", model: "strong" },
        {
          providerInstanceId: "opencode",
          model: "cheap",
          options: [{ id: "effort", value: "low" }],
        },
      ]);
    }),
  );

  it.effect("retries a lost sub-thread once, then fails and blocks dependents", () =>
    Effect.gen(function* () {
      resetOvermindRecordsForTest();
      const statuses = new Map<string, Status>();
      const service = fakeService(statuses, []);
      const first = yield* advanceOvermind(service, scope, plan, 0);
      for (const task of first.tasks)
        if (task.taskId) statuses.set(task.taskId, task.id === "a" ? "gone" : "completed");

      const second = yield* advanceOvermind(service, scope, { planId: "p1" } as never, 1);
      assert.equal(second.tasks.find((t) => t.id === "a")?.attempt, 2); // retried
      for (const task of second.tasks)
        if (task.phase === "running" && task.taskId) statuses.set(task.taskId, "failed");

      let latest = second;
      for (let i = 0; i < 4 && !latest.settled; i++) {
        latest = yield* advanceOvermind(service, scope, { planId: "p1" } as never, 2 + i);
        for (const task of latest.tasks)
          if (task.phase === "running" && task.taskId) statuses.set(task.taskId, "failed");
      }
      assert.isTrue(latest.settled);
      assert.equal(latest.tasks.find((t) => t.id === "a")?.phase, "failed");
      assert.equal(latest.tasks.find((t) => t.id === "d")?.phase, "blocked");
    }),
  );

  it.effect("flags a blocked sub-thread, clears it when answered, and never sticks busy", () =>
    Effect.gen(function* () {
      resetOvermindRecordsForTest();
      const statuses = new Map<string, Status>();
      const service = fakeService(statuses, []);
      const first = yield* advanceOvermind(service, scope, plan, 0);
      const running = first.tasks.filter((t) => t.phase === "running" && t.taskId);
      assert.isAbove(running.length, 0);
      const blocked = running[0]!;
      statuses.set(blocked.taskId as string, "waiting");

      const waiting = yield* advanceOvermind(service, scope, { planId: "p1" } as never, 1);
      const view = waiting.tasks.find((t) => t.id === blocked.id);
      assert.equal(view?.phase, "running");
      assert.isTrue(view?.needsAttention);
      assert.isTrue(waiting.notes.some((note) => note.includes(`Task ${blocked.id} is blocked`)));
      assert.isFalse(waiting.settled);

      // Answered: the flag clears.
      statuses.set(blocked.taskId as string, "running");
      const resumed = yield* advanceOvermind(service, scope, { planId: "p1" } as never, 2);
      assert.isFalse(resumed.tasks.find((t) => t.id === blocked.id)?.needsAttention ?? false);

      // Whatever ends the worker (done, failed, cancelled, interrupted, deleted),
      // the plan settles instead of staying busy.
      const endings: Status[] = ["completed", "failed", "cancelled", "interrupted", "gone"];
      let latest = resumed;
      for (let i = 0; i < 12 && !latest.settled; i++) {
        for (const task of latest.tasks) {
          if (task.phase === "running" && task.taskId) {
            statuses.set(task.taskId, endings[i % endings.length]!);
          }
        }
        latest = yield* advanceOvermind(service, scope, { planId: "p1" } as never, 3 + i);
      }
      assert.isTrue(latest.settled);
      assert.isFalse(latest.tasks.some((t) => t.needsAttention === true));
    }),
  );

  it.effect("times out a hung sub-thread and cancel stops everything", () =>
    Effect.gen(function* () {
      resetOvermindRecordsForTest();
      const statuses = new Map<string, Status>();
      const service = fakeService(statuses, []);
      yield* advanceOvermind(
        service,
        scope,
        { ...(plan as object), limits: { taskTimeoutMs: 1000, maxAttempts: 1 } } as never,
        0,
      );
      const hung = yield* advanceOvermind(service, scope, { planId: "p1" } as never, 5000);
      assert.equal(hung.tasks.find((t) => t.id === "a")?.phase, "failed");
      const cancelled = yield* advanceOvermind(
        service,
        scope,
        { planId: "p1", cancel: true } as never,
        5001,
      );
      assert.isTrue(cancelled.settled);
    }),
  );

  it.effect("rejects bad plans and unknown plan ids", () =>
    Effect.gen(function* () {
      resetOvermindRecordsForTest();
      const service = fakeService(new Map(), []);
      const cyclic = yield* advanceOvermind(
        service,
        scope,
        {
          planId: "x",
          goal: "g",
          tasks: [{ id: "a", title: "a", prompt: "p", dependsOn: ["a"] }],
        } as never,
        0,
      ).pipe(Effect.flip);
      assert.equal(cyclic.code, "invalid_request");
      const unknown = yield* advanceOvermind(service, scope, { planId: "nope" } as never, 0).pipe(
        Effect.flip,
      );
      assert.equal(unknown.code, "invalid_request");
    }),
  );
});

function fakeHost(options: { conflictFor?: string } = {}) {
  const calls = {
    provisioned: [] as string[],
    integrated: [] as string[],
    discarded: [] as string[],
  };
  const host: OvermindWorkspaceHost = {
    provision: ({ taskId, attempt }) =>
      Effect.sync(() => {
        calls.provisioned.push(`${taskId}#${attempt}`);
        return { path: `/wt/${taskId}-${attempt}`, branch: `overmind/p1-${taskId}-${attempt}` };
      }),
    integrate: (workspace) =>
      Effect.sync(() => {
        calls.integrated.push(workspace.branch);
        return workspace.branch.includes(options.conflictFor ?? "\u0000")
          ? { ok: false as const, reason: "conflict in src/a/x.ts" }
          : { ok: true as const };
      }),
    discard: (workspace) => Effect.sync(() => void calls.discarded.push(workspace.branch)),
    leadIsDirty: Effect.succeed(true),
  };
  return { host, calls };
}

describe("advanceOvermind isolation, budget and restart", () => {
  it.effect(
    "gives writers a worktree, merges finished work, and skips it for read-only roles",
    () =>
      Effect.gen(function* () {
        resetOvermindRecordsForTest();
        workspaces.length = 0;
        const statuses = new Map<string, Status>();
        const { host, calls } = fakeHost();
        const service = fakeService(statuses, []);
        const first = yield* advanceOvermind(
          service,
          scope,
          {
            planId: "p1",
            goal: "g",
            tasks: [
              { id: "a", title: "A", prompt: "x", files: ["src/a/"] },
              { id: "r", title: "R", prompt: "y", role: "research" },
            ],
          } as never,
          0,
          { host },
        );
        assert.deepEqual(calls.provisioned, ["a#1"]);
        assert.equal(first.tasks.find((t) => t.id === "a")?.isolation, "worktree");
        assert.equal(first.tasks.find((t) => t.id === "r")?.isolation, "shared");
        assert.isTrue(first.notes.some((n) => n.includes("uncommitted")));
        assert.deepEqual(
          workspaces.find((w) => w.title?.includes("· a:implementation ·"))?.workspace,
          {
            worktreePath: "/wt/a-1",
            branch: "overmind/p1-a-1",
          },
        );
        for (const task of first.tasks) if (task.taskId) statuses.set(task.taskId, "completed");
        const done = yield* advanceOvermind(service, scope, { planId: "p1" } as never, 5, { host });
        assert.deepEqual(calls.integrated, ["overmind/p1-a-1"]);
        assert.deepEqual(calls.discarded, ["overmind/p1-a-1"]);
        assert.equal(done.outcome, "succeeded");
      }),
  );

  it.effect("treats a merge conflict as a failed attempt and retries from a fresh worktree", () =>
    Effect.gen(function* () {
      resetOvermindRecordsForTest();
      const statuses = new Map<string, Status>();
      const { host, calls } = fakeHost({ conflictFor: "-a-1" });
      const service = fakeService(statuses, []);
      const first = yield* advanceOvermind(
        service,
        scope,
        {
          planId: "p1",
          goal: "g",
          tasks: [{ id: "a", title: "A", prompt: "x", files: ["src/a/"] }],
        } as never,
        0,
        { host },
      );
      for (const task of first.tasks) if (task.taskId) statuses.set(task.taskId, "completed");
      const second = yield* advanceOvermind(service, scope, { planId: "p1" } as never, 5, { host });
      assert.deepEqual(calls.provisioned, ["a#1", "a#2"]);
      assert.equal(second.tasks[0]?.attempt, 2);
      assert.equal(second.tasks[0]?.phase, "running");
    }),
  );

  it.effect("stops starting tasks once the token budget is spent and settles the plan", () =>
    Effect.gen(function* () {
      resetOvermindRecordsForTest();
      tokenUsage.clear();
      const statuses = new Map<string, Status>();
      const service = fakeService(statuses, []);
      const first = yield* advanceOvermind(
        service,
        scope,
        {
          planId: "p1",
          goal: "g",
          limits: { maxTotalTokens: 1000 },
          tasks: [
            { id: "a", title: "A", prompt: "x", files: ["src/a/"] },
            { id: "b", title: "B", prompt: "y", files: ["src/b/"], dependsOn: ["a"] },
          ],
        } as never,
        0,
      );
      const a = first.tasks.find((t) => t.id === "a")!;
      statuses.set(a.taskId!, "completed");
      tokenUsage.set(a.taskId!, 1100);
      const next = yield* advanceOvermind(service, scope, { planId: "p1" } as never, 5);
      assert.equal(next.tasks.find((t) => t.id === "b")?.phase, "blocked");
      assert.isTrue(next.settled);
      assert.equal(next.totalTokens, 1100);
      assert.isTrue(next.notes.some((n) => n.includes("Token budget")));
      tokenUsage.clear();
    }),
  );

  it.effect("resumes a stored plan after the in-memory state is gone", () =>
    Effect.gen(function* () {
      resetOvermindRecordsForTest();
      const saved = new Map<string, StoredOvermindPlan>();
      const store: OvermindPlanStore = {
        load: async (key) => saved.get(key) ?? null,
        save: async (key, plan) => void saved.set(key, JSON.parse(JSON.stringify(plan))),
      };
      const statuses = new Map<string, Status>();
      const started: string[] = [];
      const service = fakeService(statuses, started);
      const first = yield* advanceOvermind(service, scope, plan, 0, { store });
      assert.deepEqual(first.started, ["a", "b"]);

      resetOvermindRecordsForTest(); // simulated restart
      for (const task of first.tasks) if (task.taskId) statuses.set(task.taskId, "completed");
      const resumed = yield* advanceOvermind(service, scope, { planId: "p1" } as never, 10, {
        store,
      });
      assert.equal(resumed.tasks.find((t) => t.id === "a")?.phase, "completed");
      assert.deepEqual(resumed.started, ["c", "d"]);
      assert.equal(started.length, 4); // nothing was started twice
    }),
  );
});
