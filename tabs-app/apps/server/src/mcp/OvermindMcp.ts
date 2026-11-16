import {
  OrchestratorMcpFailure,
  type ProviderInstanceId,
  type OrchestratorMcpOvermindAdvanceInput,
  type OrchestratorMcpOvermindAdvanceResult,
  type SubagentModelSettings,
} from "@tabs/contracts";
import {
  blockOvermindDependents,
  buildOvermindTaskPrompt,
  clampOvermindLimits,
  evaluateOvermindBudget,
  failOvermindTask,
  haltPendingOvermindTasks,
  initialOvermindTaskState,
  isOvermindTaskStalled,
  markOvermindDispatched,
  overmindClientRequestId,
  reduceOvermindObservation,
  selectOvermindDispatch,
  summarizeOvermindProgress,
  totalOvermindTokens,
  validateOvermindPlan,
  formatOvermindTaskTitle,
  type OvermindLimits,
  type OvermindObservation,
  type OvermindTaskSpec,
  type OvermindTaskState,
  type OvermindWorkspace,
} from "@tabs/shared/overmind";
import * as Effect from "effect/Effect";

import type { McpInvocationScope } from "./McpInvocationContext.ts";
import type { OrchestratorMcpServiceShape } from "./OrchestratorMcpService.ts";
import type {
  OvermindPlanStore,
  OvermindWorkspaceHost,
  StoredOvermindPlan,
} from "./OvermindWorkspace.ts";

/**
 * Overmind driver. The lead thread calls `overmind_advance`; each call reads
 * the durable state of every delegated sub-thread, folds it through the pure
 * planner in `@tabs/shared/overmind`, and starts whatever may now run.
 *
 * Sub-thread liveness is never taken from this module's memory: the source of
 * truth is the delegated task each attempt created. The plan is kept in memory
 * and, when a store is given, on disk, so a server restart resumes it. Without
 * the file the lead can re-send the plan; the stable per-attempt client request
 * ids make re-dispatch idempotent.
 */

interface OvermindRecord {
  readonly goal: string;
  readonly isolate: boolean;
  readonly tasks: ReadonlyArray<OvermindTaskSpec>;
  readonly models: ReadonlyMap<string, string>;
  /** Provider instance per task, when a task runs on another provider than the lead. */
  readonly providers: ReadonlyMap<string, string>;
  readonly limits: OvermindLimits;
  states: Map<string, OvermindTaskState>;
}

export interface OvermindDriverDeps {
  readonly store?: OvermindPlanStore | undefined;
  /** Provisions and merges isolated worktrees; absent means tasks share the lead's checkout. */
  readonly host?: OvermindWorkspaceHost | undefined;
  readonly leadCwd?: string | null | undefined;
  /** The user's sub-agent models, by role; they override what the plan asks for. */
  readonly settings?: SubagentModelSettings | undefined;
}

const MAX_RECORDS = 64;
const records = new Map<string, OvermindRecord>();

export function resetOvermindRecordsForTest(): void {
  records.clear();
}

const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

const LOST_CODES: ReadonlySet<string> = new Set(["task_not_found", "thread_not_found"]);
const writes = (task: OvermindTaskSpec) => task.role !== "research" && task.role !== "review";

function toSpec(
  task: NonNullable<OrchestratorMcpOvermindAdvanceInput["tasks"]>[number],
): OvermindTaskSpec {
  return {
    id: task.id,
    title: task.title ?? task.id,
    prompt: task.prompt,
    dependsOn: task.dependsOn ?? [],
    files: task.files ?? [],
    role: task.role ?? "implementation",
  };
}

function rememberRecord(key: string, record: OvermindRecord): void {
  records.delete(key);
  records.set(key, record);
  while (records.size > MAX_RECORDS) {
    const oldest = records.keys().next().value;
    if (oldest === undefined) break;
    records.delete(oldest);
  }
}

function hydrate(stored: StoredOvermindPlan): OvermindRecord {
  const tasks = stored.tasks as ReadonlyArray<OvermindTaskSpec>;
  const saved = new Map(stored.states as ReadonlyArray<readonly [string, OvermindTaskState]>);
  return {
    goal: stored.goal,
    isolate: stored.isolate,
    tasks,
    models: new Map(stored.models),
    providers: new Map(stored.providers ?? []),
    limits: clampOvermindLimits(stored.limits as Partial<OvermindLimits>),
    states: new Map(
      tasks.map(
        (task) => [task.id, { ...initialOvermindTaskState, ...saved.get(task.id) }] as const,
      ),
    ),
  };
}

function dehydrate(record: OvermindRecord, leadCwd: string | null): StoredOvermindPlan {
  return {
    goal: record.goal,
    isolate: record.isolate,
    tasks: record.tasks,
    models: [...record.models],
    providers: [...record.providers],
    limits: record.limits,
    states: [...record.states],
    leadCwd,
  };
}

const observe = (
  service: OrchestratorMcpServiceShape,
  scope: McpInvocationScope,
  taskId: string,
): Effect.Effect<OvermindObservation> =>
  service.taskStatus(scope, taskId as never).pipe(
    Effect.map((result): OvermindObservation => {
      switch (result.status) {
        case "completed":
        case "failed":
        case "cancelled":
        case "interrupted":
          return {
            kind: "terminal",
            status: result.status,
            summary: result.summary ?? result.latestTerminalSummary,
          };
        case "waiting":
          return { kind: "attention" };
        default:
          return { kind: "running" };
      }
    }),
    // A transient read failure must not fail a healthy task; only a task or
    // thread that no longer exists is lost. Hung tasks fall to the timeout.
    Effect.catch((error) =>
      Effect.succeed<OvermindObservation>(
        LOST_CODES.has(error.code) ? { kind: "lost", reason: error.message } : { kind: "running" },
      ),
    ),
  );

const discardWorkspace = (
  deps: OvermindDriverDeps,
  workspace: OvermindWorkspace | null,
): Effect.Effect<void> =>
  workspace === null || deps.host === undefined ? Effect.void : deps.host.discard(workspace);

export const advanceOvermind = (
  service: OrchestratorMcpServiceShape,
  scope: McpInvocationScope,
  input: OrchestratorMcpOvermindAdvanceInput,
  nowMs: number,
  deps: OvermindDriverDeps = {},
): Effect.Effect<OrchestratorMcpOvermindAdvanceResult, OrchestratorMcpFailure> =>
  Effect.gen(function* () {
    const leadThreadId = scope.thread?.threadId;
    if (leadThreadId === undefined) {
      return yield* invalid("overmind_advance needs an agent running inside a Tabs thread.");
    }
    const key = `${scope.requestNamespace}:${leadThreadId}:${input.planId}`;
    let record = records.get(key);
    if (record === undefined && deps.store !== undefined) {
      const store = deps.store;
      const stored = yield* Effect.promise(() => store.load(key));
      if (stored !== null) record = hydrate(stored);
    }
    const started = record !== undefined && [...record.states.values()].some((s) => s.attempt > 0);

    if (input.tasks !== undefined && !started) {
      const limits = clampOvermindLimits(input.limits);
      const tasks = input.tasks.map(toSpec);
      const errors = validateOvermindPlan(tasks, limits);
      if (errors.length > 0) return yield* invalid(`Invalid plan: ${errors.join(" ")}`);
      if (input.goal === undefined) return yield* invalid("A new plan needs a goal.");
      record = {
        goal: input.goal,
        isolate: input.isolate ?? true,
        tasks,
        models: new Map(
          input.tasks.flatMap((task) =>
            task.model === undefined ? [] : [[task.id, task.model] as const],
          ),
        ),
        providers: new Map(
          input.tasks.flatMap((task) =>
            task.providerInstanceId === undefined
              ? []
              : [[task.id, task.providerInstanceId as string] as const],
          ),
        ),
        limits,
        states: new Map(tasks.map((task) => [task.id, initialOvermindTaskState])),
      };
    }
    if (record === undefined) {
      return yield* invalid(`Unknown plan "${input.planId}". Send goal and tasks to create it.`);
    }
    rememberRecord(key, record);
    const plan = record;
    let states = plan.states;
    const notes: string[] = [];
    const isolatedHere = new Set<string>();

    /** A task leaving `running` no longer needs its worktree. */
    const releaseWorkspace = (taskId: string) =>
      Effect.gen(function* () {
        const current = states.get(taskId);
        if (current?.workspace == null) return;
        yield* discardWorkspace(deps, current.workspace);
        states.set(taskId, { ...current, workspace: null });
      });

    const stopTask = (state: OvermindTaskState, reason: string) =>
      state.taskId === null
        ? Effect.void
        : service.cancelTask(scope, { taskId: state.taskId as never, reason }).pipe(Effect.ignore);

    // Observe running tasks, measure spend, and bring finished work home.
    for (const task of plan.tasks) {
      const state = states.get(task.id);
      if (state?.phase !== "running" || state.taskId === null) continue;
      if (input.cancel === true) {
        yield* stopTask(state, "Overmind plan cancelled.");
        states.set(task.id, { ...state, phase: "cancelled", error: "Cancelled." });
        yield* releaseWorkspace(task.id);
        continue;
      }
      if (isOvermindTaskStalled(state, nowMs, plan.limits)) {
        yield* stopTask(state, "Overmind task timed out.");
      }
      const observation = yield* observe(service, scope, state.taskId);
      const measured = yield* service
        .taskTokenUsage(scope, state.taskId as never)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      const withTokens: OvermindTaskState =
        measured === null ? state : { ...state, tokens: state.priorTokens + measured };
      const next = reduceOvermindObservation(withTokens, observation, nowMs, plan.limits);
      states.set(task.id, next);

      if (next.phase === "completed" && next.workspace !== null && deps.host !== undefined) {
        const merged = yield* deps.host.integrate(next.workspace, task.title);
        yield* releaseWorkspace(task.id);
        if (!merged.ok) {
          states.set(
            task.id,
            failOvermindTask(
              { ...(states.get(task.id) ?? next), phase: "running" },
              `Its work could not be merged: ${merged.reason}. A retry starts from the updated checkout.`,
              plan.limits,
            ),
          );
        }
      } else if (next.phase !== "running") {
        yield* releaseWorkspace(task.id);
      }
    }

    if (input.cancel === true) {
      for (const task of plan.tasks) {
        const state = states.get(task.id);
        if (state?.phase === "pending") {
          states.set(task.id, { ...state, phase: "cancelled", error: "Cancelled." });
        }
      }
    }

    // Spend: stop starting work once the cap is reached, stop running work well past it.
    const budget = evaluateOvermindBudget(totalOvermindTokens(states), plan.limits);
    if (budget !== "ok" && input.cancel !== true) {
      if (budget === "overrun") {
        for (const task of plan.tasks) {
          const state = states.get(task.id);
          if (state?.phase !== "running") continue;
          yield* stopTask(state, "Overmind token budget exceeded.");
          states.set(task.id, { ...state, phase: "cancelled", error: "Token budget exceeded." });
          yield* releaseWorkspace(task.id);
        }
      }
      states = new Map(
        haltPendingOvermindTasks(states, "Not started: the plan's token budget is spent."),
      );
      notes.push(
        `Token budget reached (${Math.round(totalOvermindTokens(states))} of ${plan.limits.maxTotalTokens}). Unstarted tasks were skipped.`,
      );
    }

    states = new Map(blockOvermindDependents(plan.tasks, states));
    const toStart =
      budget === "ok" && input.cancel !== true
        ? selectOvermindDispatch(plan.tasks, states, plan.limits)
        : [];
    const startedIds: string[] = [];
    for (const task of toStart) {
      const state = states.get(task.id) ?? initialOvermindTaskState;
      const attempt = state.attempt + 1;
      const host = deps.host;
      const wantsIsolation = plan.isolate && writes(task) && host !== undefined;
      const workspace =
        wantsIsolation && host !== undefined
          ? yield* host.provision({ planId: input.planId, taskId: task.id, attempt })
          : null;
      if (wantsIsolation && workspace === null) {
        notes.push(`Task ${task.id} shares the lead's checkout: a worktree could not be created.`);
      }
      const prompt = buildOvermindTaskPrompt({
        goal: plan.goal,
        task,
        dependencyResults: task.dependsOn.map((id) => ({
          id,
          summary: states.get(id)?.summary ?? null,
        })),
        siblingTitles: plan.tasks
          .filter((other) => other.id !== task.id && states.get(other.id)?.phase === "running")
          .map((other) => other.title),
        retryReason: state.error,
        isolated: workspace !== null,
      });
      // The user's sub-agent models, when set, replace this in delegateTask.
      const model = plan.models.get(task.id);
      const providerInstanceId = plan.providers.get(task.id) as ProviderInstanceId | undefined;
      const dispatched = yield* service
        .delegateTask(
          scope,
          {
            task: prompt,
            title: formatOvermindTaskTitle(task),
            role: task.role,
            mode: "async",
            clientRequestId: overmindClientRequestId(input.planId, task.id, attempt),
            ...(model === undefined && providerInstanceId === undefined
              ? {}
              : {
                  target: {
                    ...(providerInstanceId === undefined ? {} : { providerInstanceId }),
                    ...(model === undefined ? {} : { model }),
                  },
                }),
          },
          {
            subagentModels: deps.settings,
            ...(workspace === null
              ? {}
              : { workspace: { worktreePath: workspace.path, branch: workspace.branch } }),
          },
        )
        .pipe(
          Effect.map((success) => ({ ok: true as const, taskId: success.taskId as string })),
          Effect.catch((error) => Effect.succeed({ ok: false as const, message: error.message })),
        );
      if (dispatched.ok) {
        states.set(task.id, markOvermindDispatched(state, dispatched.taskId, nowMs, workspace));
        startedIds.push(task.id);
        if (workspace !== null) isolatedHere.add(task.id);
      } else {
        yield* discardWorkspace(deps, workspace);
        // The attempt counts, so a task that can never start still settles.
        states.set(
          task.id,
          failOvermindTask(
            { ...state, phase: "running", attempt },
            `could not start: ${dispatched.message}`,
            plan.limits,
          ),
        );
      }
    }
    states = new Map(blockOvermindDependents(plan.tasks, states));
    plan.states = states;

    if (isolatedHere.size > 0 && deps.host !== undefined) {
      const dirty = yield* deps.host.leadIsDirty;
      if (dirty) {
        notes.push(
          "The lead checkout has uncommitted changes. Isolated sub-threads start from the last commit and cannot see them; commit them first if tasks need them.",
        );
      }
    }

    if (deps.store !== undefined) {
      const store = deps.store;
      yield* Effect.promise(() => store.save(key, dehydrate(plan, deps.leadCwd ?? null)));
    }

    const progress = summarizeOvermindProgress(states);
    return {
      planId: input.planId,
      outcome: progress.outcome,
      settled: progress.settled,
      tasks: plan.tasks.map((task) => {
        const state = states.get(task.id) ?? initialOvermindTaskState;
        return {
          id: task.id,
          title: task.title,
          phase: state.phase,
          dependsOn: [...task.dependsOn],
          isolation: state.workspace === null ? ("shared" as const) : ("worktree" as const),
          tokens: Math.round(state.tokens),
          attempt: state.attempt,
          taskId: state.taskId as never,
          summary: state.summary,
          error: state.error,
          needsAttention: state.phase === "running" && state.attention,
        };
      }),
      started: startedIds,
      totalTokens: Math.round(totalOvermindTokens(states)),
      maxTotalTokens: plan.limits.maxTotalTokens,
      notes: [
        ...notes,
        ...plan.tasks.flatMap((task) =>
          states.get(task.id)?.attention === true && states.get(task.id)?.phase === "running"
            ? [
                `Task ${task.id} is blocked on a question or approval only a person can answer. Ask the user to open its sub-thread; it stops at the plan timeout otherwise.`,
              ]
            : [],
        ),
      ],
      next: progress.settled
        ? "All tasks are settled. Isolated work is already merged into this checkout. Review each summary, inspect the changes, run the checks, and report the combined result to the user. Do not call overmind_advance again."
        : "Work is still running. End your turn now; you are woken when a sub-thread finishes. Then call overmind_advance again with the same planId.",
    };
  });
