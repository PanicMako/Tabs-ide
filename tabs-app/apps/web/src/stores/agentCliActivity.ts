import { create } from "zustand";

/**
 * Live working / waiting state of agent CLI sessions.
 *
 * Agent TUIs stream output (spinners, tokens, tool logs) while they work and
 * go quiet when they finish or wait for input, so output recency is a reliable,
 * agent-agnostic signal. A session counts as "waiting" once it has worked for
 * a while and then stayed quiet; that is when the user's attention is needed.
 */
export type AgentCliActivity = "working" | "waiting" | "idle";

/** Quiet time after output before a session is considered done/waiting. */
export const AGENT_CLI_QUIET_MS = 2_500;
/** Minimum stretch of work before going quiet counts as "needs you". */
export const AGENT_CLI_MIN_WORK_MS = 4_000;

interface SessionTimeline {
  readonly workStartedAt: number | null;
  readonly lastOutputAt: number;
}

interface AgentCliActivityState {
  readonly activity: Record<string, AgentCliActivity>;
  set: (terminalId: string, activity: AgentCliActivity) => void;
  clear: (terminalId: string) => void;
}

export const useAgentCliActivityStore = create<AgentCliActivityState>()((set) => ({
  activity: {},
  set: (terminalId, activity) =>
    set((state) =>
      state.activity[terminalId] === activity
        ? state
        : { activity: { ...state.activity, [terminalId]: activity } },
    ),
  clear: (terminalId) =>
    set((state) => {
      if (!(terminalId in state.activity)) return state;
      const { [terminalId]: _removed, ...rest } = state.activity;
      return { activity: rest };
    }),
}));

/**
 * Pure transition used by the tracker: given a session's timeline and the
 * current time, what is it doing now?
 */
export function classifyAgentCliActivity(
  timeline: SessionTimeline,
  now: number,
): { activity: AgentCliActivity; workedMs: number } {
  const quiet = now - timeline.lastOutputAt >= AGENT_CLI_QUIET_MS;
  const workedMs =
    timeline.workStartedAt === null ? 0 : timeline.lastOutputAt - timeline.workStartedAt;
  if (!quiet) return { activity: "working", workedMs };
  return { activity: workedMs >= AGENT_CLI_MIN_WORK_MS ? "waiting" : "idle", workedMs };
}

/** Output this soon after a keystroke is the shell echoing the user's typing. */
export const AGENT_CLI_ECHO_MS = 200;

export interface AgentCliActivityTracker {
  /** Record output from a session. */
  output: (terminalId: string, now?: number) => void;
  /** The user typed into the session; its echo must not count as agent work. */
  input: (terminalId: string, now?: number) => void;
  /** The user looked at / typed into the session: drop the "waiting" flag. */
  acknowledge: (terminalId: string) => void;
  forget: (terminalId: string) => void;
  dispose: () => void;
}

/**
 * Tracks output timing per session and publishes activity changes. Calls
 * `onNeedsAttention` once per working stretch that ends in "waiting".
 */
export function createAgentCliActivityTracker(options: {
  onNeedsAttention: (terminalId: string) => void;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}): AgentCliActivityTracker {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  const timelines = new Map<string, SessionTimeline>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const lastInputAt = new Map<string, number>();
  const store = useAgentCliActivityStore.getState;

  const settle = (terminalId: string) => {
    timers.delete(terminalId);
    const timeline = timelines.get(terminalId);
    if (!timeline) return;
    const { activity } = classifyAgentCliActivity(timeline, now());
    store().set(terminalId, activity);
    timelines.set(terminalId, { workStartedAt: null, lastOutputAt: timeline.lastOutputAt });
    if (activity === "waiting") options.onNeedsAttention(terminalId);
  };

  return {
    output: (terminalId, at = now()) => {
      const previous = timelines.get(terminalId);
      const isEcho =
        previous?.workStartedAt == null &&
        at - (lastInputAt.get(terminalId) ?? -Infinity) < AGENT_CLI_ECHO_MS;
      timelines.set(terminalId, {
        workStartedAt: previous?.workStartedAt ?? (isEcho ? null : at),
        lastOutputAt: at,
      });
      if (isEcho) return;
      store().set(terminalId, "working");
      const timer = timers.get(terminalId);
      if (timer !== undefined) clearTimer(timer);
      timers.set(
        terminalId,
        setTimer(() => settle(terminalId), AGENT_CLI_QUIET_MS),
      );
    },
    input: (terminalId, at = now()) => {
      lastInputAt.set(terminalId, at);
      if (store().activity[terminalId] === "waiting") store().set(terminalId, "idle");
    },
    acknowledge: (terminalId) => {
      if (store().activity[terminalId] === "waiting") store().set(terminalId, "idle");
    },
    forget: (terminalId) => {
      const timer = timers.get(terminalId);
      if (timer !== undefined) clearTimer(timer);
      timers.delete(terminalId);
      timelines.delete(terminalId);
      lastInputAt.delete(terminalId);
      store().clear(terminalId);
    },
    dispose: () => {
      for (const timer of timers.values()) clearTimer(timer);
      timers.clear();
      timelines.clear();
      lastInputAt.clear();
    },
  };
}

/** The running tracker, owned by `AgentCliActivityHost`. */
export const agentCliActivityTracker: { current: AgentCliActivityTracker | null } = {
  current: null,
};
