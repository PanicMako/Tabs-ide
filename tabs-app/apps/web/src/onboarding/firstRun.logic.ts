export type FirstRunDecision = "pending" | "app" | "wizard";

export interface FirstRunGateState {
  readonly decision: FirstRunDecision;
  readonly stalled: boolean;
}

export type FirstRunGateEvent =
  | { readonly type: "evidence"; readonly decision: FirstRunDecision }
  | { readonly type: "timeout" }
  | { readonly type: "reset" };

export interface FirstRunWorkspaceInput {
  readonly projects: ReadonlyArray<{
    readonly id: string;
    readonly cwd?: string;
  }>;
  readonly threads: ReadonlyArray<{
    readonly id: string;
    readonly messages?: ReadonlyArray<unknown>;
    readonly activities?: ReadonlyArray<unknown>;
    readonly turnDiffSummaries?: ReadonlyArray<unknown>;
  }>;
}

export interface FirstRunDecisionInput {
  readonly enabled: boolean;
  readonly hydrated: boolean;
  readonly completed: boolean;
  readonly threadsHydrated: boolean;
  readonly projectCount: number;
  readonly threadCount: number;
  readonly workspaceFresh: boolean;
}

/**
 * Evaluates whether the current workspace represents a fresh installation:
 * - Empty workspace (0 projects, 0 threads)
 * - Single bootstrap project with 0 threads
 * - Single bootstrap project with 1 un-interacted thread (no messages, activities, or diffs)
 *
 * If there are multiple projects, multiple threads, or any message/activity,
 * it is considered an active existing workspace.
 */
export function isFreshFirstRunWorkspace(input: FirstRunWorkspaceInput): boolean {
  if (input.projects.length > 1 || input.threads.length > 1) {
    return false;
  }

  if (input.projects.length === 0 && input.threads.length === 0) {
    return true;
  }

  if (input.projects.length <= 1 && input.threads.length === 0) {
    return true;
  }

  if (input.threads.length === 1) {
    const thread = input.threads[0];
    const hasMessages = (thread?.messages?.length ?? 0) > 0;
    const hasActivities = (thread?.activities?.length ?? 0) > 0;
    const hasDiffs = (thread?.turnDiffSummaries?.length ?? 0) > 0;
    return !hasMessages && !hasActivities && !hasDiffs;
  }

  return false;
}

/**
 * State transition machine for the first run gate.
 * Protects against stalls: if waiting on pending and a timeout occurs,
 * it transitions directly to "app" so the user is never trapped or locked out.
 */
export function transitionFirstRunGateState(
  state: FirstRunGateState,
  event: FirstRunGateEvent,
): FirstRunGateState {
  if (event.type === "reset") {
    return { decision: "wizard", stalled: false };
  }

  if (event.type === "timeout") {
    return state.decision === "pending" ? { decision: "app", stalled: true } : state;
  }

  if (state.decision === "wizard" && event.decision === "pending") {
    return state;
  }

  if (state.decision === "app" && event.decision === "pending") {
    return state;
  }

  return { decision: event.decision, stalled: false };
}

/**
 * Resolves the gate decision based on current client settings and workspace state:
 * - If disabled or already completed: "app"
 * - If settings not hydrated: "pending"
 * - If multiple projects/threads exist: "app" (and marks completion once threads are hydrated)
 * - If threads not yet hydrated: "pending"
 * - If workspace is fresh: "wizard"
 * - Otherwise: "app" (with completion persisted)
 */
export function resolveFirstRunDecision(input: FirstRunDecisionInput): {
  readonly decision: FirstRunDecision;
  readonly persistCompletion: boolean;
} {
  if (!input.enabled || (input.hydrated && input.completed)) {
    return { decision: "app", persistCompletion: false };
  }

  if (!input.hydrated) {
    return { decision: "pending", persistCompletion: false };
  }

  // If user already has multiple projects or multiple threads, they are an existing user
  if (input.projectCount > 1 || input.threadCount > 1) {
    return {
      decision: "app",
      persistCompletion: input.threadsHydrated,
    };
  }

  // Wait until thread store is hydrated so we don't flash the wizard before local storage loads
  if (!input.threadsHydrated) {
    return { decision: "pending", persistCompletion: false };
  }

  if (input.workspaceFresh) {
    return { decision: "wizard", persistCompletion: false };
  }

  return { decision: "app", persistCompletion: true };
}
