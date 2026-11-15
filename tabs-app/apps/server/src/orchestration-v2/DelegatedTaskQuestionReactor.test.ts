import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DelegatedTaskQuestionReactor from "./DelegatedTaskQuestionReactor.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

type Anything = Record<string, unknown>;

const run = (input: {
  readonly request: Anything | null;
  readonly task?: Anything;
  readonly parentRuns?: ReadonlyArray<Anything>;
  readonly event?: Anything;
}) => {
  const dispatched: Anything[] = [];
  const task = {
    origin: "app_owned",
    id: "node-task",
    threadId: "parent",
    childThreadId: "child",
    runId: "parent-run",
    title: "Fix login",
    prompt: "fix it",
    completionWake: "always",
    status: "running",
    ...input.task,
  };
  const projections = {
    getThread: () =>
      Effect.succeed({
        id: "child",
        lineage: { parentThreadId: "parent" },
        forkedFrom: { type: "node", nodeId: "node-task" },
      }),
    getRuntimeRequest: () => Effect.succeed(input.request),
    getThreadRecords: (threadId: string) =>
      Effect.succeed(
        threadId === "parent"
          ? {
              thread: { archivedAt: null, deletedAt: null },
              subagents: [task],
              runs: input.parentRuns ?? [],
            }
          : { runtimeRequests: input.request === null ? [] : [input.request] },
      ),
  };
  const engine = {
    dispatch: (command: Anything) => Effect.sync(() => void dispatched.push(command)),
    streamDomainEvents: undefined,
  };
  const layer = DelegatedTaskQuestionReactor.layer.pipe(
    Layer.provide(Layer.succeed(Orchestrator.OrchestratorV2, engine as never)),
    Layer.provide(Layer.succeed(ProjectionStore.ProjectionStoreV2, projections as never)),
  );
  return Effect.gen(function* () {
    const reactor = yield* DelegatedTaskQuestionReactor.DelegatedTaskQuestionReactor;
    yield* reactor.handle(
      (input.event ?? {
        type: "runtime-request.updated",
        threadId: "child",
        payload: { id: "req-1", kind: "user_input" },
      }) as never,
    );
    return dispatched;
  }).pipe(Effect.provide(layer), Effect.runPromise);
};

const live = { type: "live", providerSessionId: "s" };

describe("DelegatedTaskQuestionReactor", () => {
  it("wakes the parent when its task asks a question", async () => {
    const dispatched = await run({
      request: { id: "req-1", kind: "user_input", status: "pending", responseCapability: live },
    });
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      type: "message.dispatch",
      threadId: "parent",
      dispatchMode: { type: "queue_after_active" },
    });
    expect(String(dispatched[0]?.text)).toContain("t3_pending_request_respond");
  });

  it("wakes the parent for an approval and tells it to hand it to the user", async () => {
    const dispatched = await run({
      request: { id: "req-1", kind: "command", status: "pending", responseCapability: live },
      event: {
        type: "runtime-request.updated",
        threadId: "child",
        payload: { id: "req-1", kind: "command" },
      },
    });
    expect(dispatched).toHaveLength(1);
    expect(String(dispatched[0]?.text)).toContain("approval");
    expect(String(dispatched[0]?.text)).not.toContain("t3_pending_request_respond");
  });

  it("does not wake anyone for a request nobody can answer", async () => {
    const dispatched = await run({
      request: {
        id: "req-1",
        kind: "user_input",
        status: "pending",
        responseCapability: { type: "not_resumable", reason: "gone" },
      },
    });
    expect(dispatched).toHaveLength(0);
  });

  it("leaves a blocking wait to deliver its own request", async () => {
    const dispatched = await run({
      request: { id: "req-1", kind: "user_input", status: "pending", responseCapability: live },
      task: { completionWake: "settled_only" },
      parentRuns: [{ id: "parent-run", status: "running" }],
    });
    expect(dispatched).toHaveLength(0);
  });

  it("cancels the queued wake once the request is answered", async () => {
    const dispatched = await run({
      request: { id: "req-1", kind: "user_input", status: "resolved", responseCapability: live },
      parentRuns: [
        {
          id: "queued-run",
          status: "queued",
          userMessageId: "message:delegated-task-question:parent:req-1",
        },
      ],
    });
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ type: "queued-run.cancel", runId: "queued-run" });
  });
});
