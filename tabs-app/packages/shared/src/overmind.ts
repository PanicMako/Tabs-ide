/**
 * Overmind: pure planning and bookkeeping for a lead thread that fans a goal
 * out to parallel delegated sub-threads.
 *
 * Nothing here performs I/O. The server feeds in what it observed about each
 * delegated task (running, terminal, or lost) and gets back the next state and
 * the set of tasks that may start. Keeping this pure is what makes the hard
 * guarantees testable: every task ends in a terminal phase, a vanished or hung
 * sub-thread can never leave the plan "busy" forever, and tasks that might
 * edit the same files never run at the same time.
 */

export const OVERMIND_DEFAULT_LIMITS = {
  /** Most sub-threads running at once. Bounds spend and machine load. */
  maxParallel: 3,
  /** Most tasks one plan may contain. */
  maxTasks: 12,
  /** Runs per task, the first try included. */
  maxAttempts: 2,
  /** A sub-thread running longer than this is treated as hung. */
  taskTimeoutMs: 30 * 60 * 1000,
  /** Tokens (input + output, as providers report them) the whole plan may use. */
  maxTotalTokens: 3_000_000,
} as const;

export interface OvermindLimits {
  readonly maxParallel: number;
  readonly maxTasks: number;
  readonly maxAttempts: number;
  readonly taskTimeoutMs: number;
  readonly maxTotalTokens: number;
}

/** Hard ceilings so a model cannot talk itself into an unbounded fan-out. */
export const OVERMIND_LIMIT_CEILINGS: OvermindLimits = {
  maxParallel: 6,
  maxTasks: 24,
  maxAttempts: 3,
  taskTimeoutMs: 4 * 60 * 60 * 1000,
  maxTotalTokens: 50_000_000,
};

export type OvermindTaskRole =
  | "implementation"
  | "research"
  | "review"
  | "design"
  | "test"
  | "general";

/** Roles that only read. They may share files with anyone. */
const READ_ONLY_ROLES: ReadonlySet<OvermindTaskRole> = new Set(["research", "review"]);

export interface OvermindTaskSpec {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  readonly dependsOn: ReadonlyArray<string>;
  /** Paths or directories (`src/a/`, `src/a/**`) this task may write. */
  readonly files: ReadonlyArray<string>;
  readonly role: OvermindTaskRole;
}

export type OvermindPhase =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  /** Never started because a dependency failed or was cancelled. */
  | "blocked";

/** A git worktree a task works in so parallel siblings never share a checkout. */
export interface OvermindWorkspace {
  readonly path: string;
  readonly branch: string;
}

export interface OvermindTaskState {
  readonly phase: OvermindPhase;
  /** Isolated checkout of the live attempt; null when it shares the lead's. */
  readonly workspace: OvermindWorkspace | null;
  /** Tokens all attempts have used, as last measured. */
  readonly tokens: number;
  /** Tokens finished attempts used, so the live attempt adds on top. */
  readonly priorTokens: number;
  /** Runs started so far, 0 before the first dispatch. */
  readonly attempt: number;
  /** Delegated task id of the live or latest attempt. */
  readonly taskId: string | null;
  readonly startedAtMs: number | null;
  readonly summary: string | null;
  readonly error: string | null;
  /** The live attempt is blocked on a question, approval or other input only a person can give. */
  readonly attention: boolean;
}

export const initialOvermindTaskState: OvermindTaskState = {
  phase: "pending",
  workspace: null,
  tokens: 0,
  priorTokens: 0,
  attempt: 0,
  taskId: null,
  startedAtMs: null,
  summary: null,
  error: null,
  attention: false,
};

export type OvermindObservation =
  | { readonly kind: "running" }
  /** Alive but blocked until a person answers; the timeout still applies. */
  | { readonly kind: "attention" }
  | {
      readonly kind: "terminal";
      readonly status: "completed" | "failed" | "cancelled" | "interrupted";
      readonly summary: string | null;
    }
  /** The task or its thread could not be read: deleted, disconnected, unknown. */
  | { readonly kind: "lost"; readonly reason: string };

export function isTerminalPhase(phase: OvermindPhase): boolean {
  return (
    phase === "completed" || phase === "failed" || phase === "cancelled" || phase === "blocked"
  );
}

const TASK_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

export function clampOvermindLimits(
  input: { readonly [K in keyof OvermindLimits]?: number | undefined } | undefined,
): OvermindLimits {
  const pick = (key: keyof OvermindLimits): number => {
    const requested = input?.[key];
    const fallback = OVERMIND_DEFAULT_LIMITS[key];
    if (requested === undefined || !Number.isFinite(requested) || requested < 1) return fallback;
    return Math.min(Math.floor(requested), OVERMIND_LIMIT_CEILINGS[key]);
  };
  return {
    maxParallel: pick("maxParallel"),
    maxTasks: pick("maxTasks"),
    maxAttempts: pick("maxAttempts"),
    taskTimeoutMs: pick("taskTimeoutMs"),
    maxTotalTokens: pick("maxTotalTokens"),
  };
}

export function validateOvermindPlan(
  tasks: ReadonlyArray<OvermindTaskSpec>,
  limits: OvermindLimits,
): ReadonlyArray<string> {
  const errors: string[] = [];
  if (tasks.length === 0) errors.push("The plan has no tasks.");
  if (tasks.length > limits.maxTasks) {
    errors.push(`The plan has ${tasks.length} tasks; the limit is ${limits.maxTasks}.`);
  }
  const ids = new Set<string>();
  for (const task of tasks) {
    if (!TASK_ID_PATTERN.test(task.id)) {
      errors.push(`Task id "${task.id}" must be 1-32 letters, digits, "-" or "_".`);
    }
    if (ids.has(task.id)) errors.push(`Task id "${task.id}" is used twice.`);
    ids.add(task.id);
  }
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (dependency === task.id) errors.push(`Task "${task.id}" depends on itself.`);
      else if (!ids.has(dependency)) {
        errors.push(`Task "${task.id}" depends on unknown task "${dependency}".`);
      }
    }
  }
  if (errors.length === 0 && hasDependencyCycle(tasks)) {
    errors.push("The plan has a dependency cycle.");
  }
  return errors;
}

function hasDependencyCycle(tasks: ReadonlyArray<OvermindTaskSpec>): boolean {
  const byId = new Map(tasks.map((task) => [task.id, task] as const));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string): boolean => {
    if (done.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(id);
    done.add(id);
    return false;
  };
  return tasks.some((task) => visit(task.id));
}

function normalizeScope(path: string): string {
  let value = path.trim().replaceAll("\\", "/");
  value = value.replace(/^\.\//, "");
  value = value
    .replace(/\/\*\*$/, "")
    .replace(/\/\*$/, "")
    .replace(/\/+$/, "");
  return value;
}

function scopesOverlap(left: string, right: string): boolean {
  const a = normalizeScope(left);
  const b = normalizeScope(right);
  if (a === "" || b === "") return true; // the whole repository
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/**
 * Whether two tasks might write the same files. A write task that declares no
 * files is treated as touching everything, so an under-specified plan degrades
 * to serial execution instead of parallel overwrites.
 */
export function overmindTasksConflict(left: OvermindTaskSpec, right: OvermindTaskSpec): boolean {
  if (READ_ONLY_ROLES.has(left.role) || READ_ONLY_ROLES.has(right.role)) return false;
  if (left.files.length === 0 || right.files.length === 0) return true;
  return left.files.some((a) => right.files.some((b) => scopesOverlap(a, b)));
}

/**
 * Folds one observation of a task's delegated run into its state. A failed,
 * lost or hung attempt is retried while attempts remain; a user cancel is
 * final so Overmind never fights a Stop.
 */
export function reduceOvermindObservation(
  state: OvermindTaskState,
  observation: OvermindObservation,
  nowMs: number,
  limits: OvermindLimits,
): OvermindTaskState {
  if (state.phase !== "running") return state;
  if (observation.kind === "running" || observation.kind === "attention") {
    const attention = observation.kind === "attention";
    const current = state.attention === attention ? state : { ...state, attention };
    const startedAt = state.startedAtMs ?? nowMs;
    if (nowMs - startedAt <= limits.taskTimeoutMs) return current;
    return failOvermindTask(state, "Timed out; the sub-thread made no result in time.", limits);
  }
  if (observation.kind === "lost") {
    return failOvermindTask(state, `Sub-thread lost: ${observation.reason}`, limits);
  }
  if (observation.status === "completed") {
    return {
      ...state,
      phase: "completed",
      summary: observation.summary,
      error: null,
      attention: false,
    };
  }
  if (observation.status === "cancelled") {
    return {
      ...state,
      phase: "cancelled",
      summary: observation.summary,
      error: "Cancelled.",
      attention: false,
    };
  }
  return failOvermindTask(
    state,
    observation.summary ?? `Sub-thread ${observation.status}.`,
    limits,
  );
}

/**
 * Ends the live attempt as failed: retried while attempts remain, otherwise
 * final. Also used by the server for failures Overmind finds itself, such as a
 * merge conflict or a sub-thread that could not start.
 */
export function failOvermindTask(
  state: OvermindTaskState,
  error: string,
  limits: OvermindLimits,
): OvermindTaskState {
  if (state.attempt < limits.maxAttempts) {
    return {
      ...state,
      phase: "pending",
      taskId: null,
      startedAtMs: null,
      workspace: null,
      error,
      attention: false,
    };
  }
  return { ...state, phase: "failed", workspace: null, error, attention: false };
}

/** Whether a running task has outlived its budget and its sub-thread should be stopped. */
export function isOvermindTaskStalled(
  state: OvermindTaskState,
  nowMs: number,
  limits: OvermindLimits,
): boolean {
  return (
    state.phase === "running" &&
    state.startedAtMs !== null &&
    nowMs - state.startedAtMs > limits.taskTimeoutMs
  );
}

export function markOvermindDispatched(
  state: OvermindTaskState,
  taskId: string,
  nowMs: number,
  workspace: OvermindWorkspace | null = null,
): OvermindTaskState {
  return {
    ...state,
    workspace,
    priorTokens: state.tokens,
    phase: "running",
    attempt: state.attempt + 1,
    taskId,
    startedAtMs: nowMs,
    error: null,
    attention: false,
  };
}

/** Pending tasks whose dependencies can never complete become blocked. */
export function blockOvermindDependents(
  tasks: ReadonlyArray<OvermindTaskSpec>,
  states: ReadonlyMap<string, OvermindTaskState>,
): ReadonlyMap<string, OvermindTaskState> {
  const next = new Map(states);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      const state = next.get(task.id);
      if (state?.phase !== "pending") continue;
      const dead = task.dependsOn.find((dependency) => {
        const phase = next.get(dependency)?.phase;
        return phase === "failed" || phase === "cancelled" || phase === "blocked";
      });
      if (dead !== undefined) {
        next.set(task.id, {
          ...state,
          phase: "blocked",
          error: `Dependency "${dead}" did not complete.`,
        });
        changed = true;
      }
    }
  }
  return next;
}

export type OvermindBudgetStatus = "ok" | "exhausted" | "overrun";

/**
 * Exhausted: spend reached the cap, so nothing new starts. Overrun: running
 * tasks pushed spend well past it, so they are stopped too.
 */
export function evaluateOvermindBudget(
  spentTokens: number,
  limits: OvermindLimits,
): OvermindBudgetStatus {
  if (spentTokens >= limits.maxTotalTokens * 1.25) return "overrun";
  if (spentTokens >= limits.maxTotalTokens) return "exhausted";
  return "ok";
}

/** Total tokens across tasks. */
export function totalOvermindTokens(states: ReadonlyMap<string, OvermindTaskState>): number {
  let total = 0;
  for (const state of states.values()) total += state.tokens;
  return total;
}

/**
 * Settles tasks that have not started when the plan must stop (budget spent),
 * so the plan reads as finished instead of waiting forever.
 */
export function haltPendingOvermindTasks(
  states: ReadonlyMap<string, OvermindTaskState>,
  reason: string,
): ReadonlyMap<string, OvermindTaskState> {
  const next = new Map(states);
  for (const [id, state] of states) {
    if (state.phase === "pending") next.set(id, { ...state, phase: "blocked", error: reason });
  }
  return next;
}

/**
 * Tasks to start now, in plan order. A task is chosen only when its
 * dependencies completed, a parallel slot is free, and it cannot write the
 * same files as anything running or chosen before it.
 */
export function selectOvermindDispatch(
  tasks: ReadonlyArray<OvermindTaskSpec>,
  states: ReadonlyMap<string, OvermindTaskState>,
  limits: OvermindLimits,
): ReadonlyArray<OvermindTaskSpec> {
  const active: OvermindTaskSpec[] = tasks.filter(
    (task) => states.get(task.id)?.phase === "running",
  );
  const chosen: OvermindTaskSpec[] = [];
  for (const task of tasks) {
    if (active.length + chosen.length >= limits.maxParallel) break;
    if (states.get(task.id)?.phase !== "pending") continue;
    if (!task.dependsOn.every((dependency) => states.get(dependency)?.phase === "completed"))
      continue;
    if ([...active, ...chosen].some((other) => overmindTasksConflict(task, other))) continue;
    chosen.push(task);
  }
  return chosen;
}

export interface OvermindProgress {
  readonly total: number;
  readonly pending: number;
  readonly running: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly blocked: number;
  /** Nothing is pending or running: the plan can make no more progress. */
  readonly settled: boolean;
  readonly outcome: "in_progress" | "succeeded" | "partial" | "failed";
}

export function summarizeOvermindProgress(
  states: ReadonlyMap<string, OvermindTaskState>,
): OvermindProgress {
  const counts = { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0, blocked: 0 };
  for (const state of states.values()) counts[state.phase] += 1;
  const settled = counts.pending === 0 && counts.running === 0;
  const outcome = !settled
    ? "in_progress"
    : counts.completed === states.size
      ? "succeeded"
      : counts.completed > 0
        ? "partial"
        : "failed";
  return { total: states.size, ...counts, settled, outcome };
}

/** Stable per-attempt idempotency key, so a retried tool call never double-starts a sub-thread. */
export function overmindClientRequestId(planId: string, taskId: string, attempt: number): string {
  return `overmind:${planId}:${taskId}:${attempt}`;
}

const MAX_DEPENDENCY_SUMMARY_CHARS = 2_000;

/**
 * The sub-thread starts cold, so everything it needs goes into this prompt:
 * the overall goal, its own job, results of what it builds on, and the file
 * boundary that keeps parallel siblings from overwriting each other.
 */
export function buildOvermindTaskPrompt(input: {
  readonly goal: string;
  readonly task: OvermindTaskSpec;
  readonly dependencyResults: ReadonlyArray<{
    readonly id: string;
    readonly summary: string | null;
  }>;
  readonly siblingTitles: ReadonlyArray<string>;
  readonly retryReason: string | null;
  /** The task has its own git worktree; Overmind commits and merges its work. */
  readonly isolated: boolean;
}): string {
  const lines: string[] = [
    `You are one sub-task of a larger goal, run by a lead thread. Do only your task and report a short result.`,
    ``,
    `Overall goal: ${input.goal}`,
    ``,
    `Your task (${input.task.id}): ${input.task.prompt}`,
  ];
  if (input.dependencyResults.length > 0) {
    lines.push("", "Results of tasks you build on:");
    for (const result of input.dependencyResults) {
      const text = (result.summary ?? "(no summary)").slice(0, MAX_DEPENDENCY_SUMMARY_CHARS);
      lines.push(`- ${result.id}: ${text}`);
    }
  }
  if (input.retryReason !== null) {
    lines.push(
      "",
      `A previous attempt failed: ${input.retryReason}. Check the current state of the files before redoing work.`,
    );
  }
  const writes = !READ_ONLY_ROLES.has(input.task.role);
  lines.push("", "Rules:");
  if (writes && input.isolated) {
    lines.push(
      "- You work in your own git worktree on your own branch. Edit freely there; other tasks cannot see your changes until you finish.",
      `- Stay within your task${input.task.files.length > 0 ? `, mainly ${input.task.files.join(", ")}` : ""}. Overmind commits your work and merges it into the lead's checkout, so do not merge or switch branches.`,
    );
  } else if (writes && input.task.files.length > 0) {
    lines.push(
      `- Only edit these paths: ${input.task.files.join(", ")}. Other tasks run in parallel in the same checkout and own the rest.`,
    );
  } else if (writes) {
    lines.push("- You run alone; no sibling edits files while you work.");
  } else {
    lines.push("- This task is read-only. Do not modify files.");
  }
  lines.push(
    input.isolated
      ? "- Do not run git checkout, switch, reset, stash or rebase."
      : "- Do not run git commit, checkout, switch, reset, stash or rebase; the lead integrates changes.",
    "- If you need a file outside your paths changed, say so in your result instead of editing it.",
  );
  if (input.siblingTitles.length > 0) {
    lines.push(`- Parallel siblings: ${input.siblingTitles.join("; ")}.`);
  }
  lines.push(
    "- Finish with a concise result: what changed, what you verified, and anything the lead must handle.",
  );
  return lines.join("\n");
}

export const OVERMIND_TITLE_PREFIX = "Overmind · ";

/**
 * Progress line for the lead thread's sidebar, read from the sub-thread rows
 * the UI already has. Null when none of them belongs to an Overmind plan.
 * Any status that is not clearly terminal counts as active, so a stale row
 * reads as work in progress rather than as finished.
 */
export function summarizeOvermindSubagents(
  subagents: ReadonlyArray<{ readonly title?: string | null; readonly status: string }>,
): {
  readonly total: number;
  readonly done: number;
  readonly failed: number;
  readonly active: number;
  /** Sub-threads blocked on a person; a subset of `active`. */
  readonly attention: number;
} | null {
  const mine = subagents.filter((agent) => agent.title?.startsWith(OVERMIND_TITLE_PREFIX) === true);
  if (mine.length === 0) return null;
  let done = 0;
  let failed = 0;
  let attention = 0;
  let idle = 0;
  for (const agent of mine) {
    if (agent.status === "waiting") attention += 1;
    // Idle work is resumable but not running; it must not keep the plan "busy".
    if (agent.status === "idle") idle += 1;
    if (agent.status === "completed") done += 1;
    else if (
      agent.status === "failed" ||
      agent.status === "cancelled" ||
      agent.status === "interrupted"
    )
      failed += 1;
  }
  return {
    total: mine.length,
    done,
    failed,
    active: mine.length - done - failed - idle,
    attention,
  };
}

export interface OvermindTaskRow {
  /** The plan's task id, parsed from the sub-thread title. */
  readonly taskKey: string;
  readonly title: string;
  readonly status: string;
  readonly subagentId: string;
  readonly childThreadId: string | null;
  readonly result: string | null;
}

/** Tasks of Overmind plans, read from the delegated sub-thread rows the UI already has. */
export function listOvermindTasks(
  subagents: ReadonlyArray<{
    readonly id: string;
    readonly title?: string | null;
    readonly status: string;
    readonly childThreadId?: string | null;
    readonly result?: string | null;
  }>,
): ReadonlyArray<OvermindTaskRow> {
  const rows: OvermindTaskRow[] = [];
  for (const agent of subagents) {
    if (agent.title?.startsWith(OVERMIND_TITLE_PREFIX) !== true) continue;
    const [taskKey = "", ...rest] = agent.title.slice(OVERMIND_TITLE_PREFIX.length).split(" · ");
    rows.push({
      taskKey,
      title: rest.join(" · ") || taskKey,
      status: agent.status,
      subagentId: agent.id,
      childThreadId: agent.childThreadId ?? null,
      result: agent.result ?? null,
    });
  }
  return rows;
}

/** Text a lead thread receives when the user starts Overmind from the UI. */
export interface OvermindWorkerChoice {
  readonly providerInstanceId: string;
  readonly model: string;
}

export function buildOvermindStartMessage(goal: string, workers?: OvermindWorkerChoice): string {
  const lines = [
    "Use Overmind for this goal: split it into independent tasks, run them in parallel with the overmind_advance tool, then merge, verify and report the combined result.",
    "Call overmind_advance yourself; do not do the tasks in this thread and do not use native subagents. Each task becomes its own nested sub-thread. The tool may carry an MCP prefix or be lazy-loaded: look for it before concluding it is missing.",
  ];
  if (workers) {
    lines.push(
      "",
      `Run every sub-task on provider instance "${workers.providerInstanceId}" with model "${workers.model}": set providerInstanceId and model on each task in the plan. Keep planning, merging and verifying in this thread.`,
    );
  }
  lines.push("", `Goal: ${goal.trim()}`);
  return lines.join("\n");
}
