import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_CLI_MIN_WORK_MS,
  AGENT_CLI_QUIET_MS,
  createAgentCliActivityTracker,
  useAgentCliActivityStore,
} from "./agentCliActivity";

function harness() {
  let clock = 0;
  const timers: Array<{ at: number; run: () => void; cancelled: boolean }> = [];
  const onNeedsAttention = vi.fn();
  const tracker = createAgentCliActivityTracker({
    onNeedsAttention,
    now: () => clock,
    setTimer: (run, ms) => {
      const timer = { at: clock + ms, run, cancelled: false };
      timers.push(timer);
      return timer as never;
    },
    clearTimer: (timer) => {
      (timer as unknown as { cancelled: boolean }).cancelled = true;
    },
  });
  const advance = (ms: number) => {
    clock += ms;
    for (const timer of timers)
      if (!timer.cancelled && timer.at <= clock) {
        timer.cancelled = true;
        timer.run();
      }
  };
  const state = (id: string) => useAgentCliActivityStore.getState().activity[id];
  return { tracker, advance, state, onNeedsAttention, now: () => clock };
}

afterEach(() => useAgentCliActivityStore.setState({ activity: {} }));

describe("agent CLI activity", () => {
  it("flags a session that worked and went quiet as waiting, once", () => {
    const { tracker, advance, state, onNeedsAttention } = harness();
    for (let elapsed = 0; elapsed <= AGENT_CLI_MIN_WORK_MS; elapsed += 500) {
      tracker.output("a");
      advance(500);
    }
    expect(state("a")).toBe("working");
    advance(AGENT_CLI_QUIET_MS);
    expect(state("a")).toBe("waiting");
    expect(onNeedsAttention).toHaveBeenCalledTimes(1);
    advance(AGENT_CLI_QUIET_MS * 3);
    expect(onNeedsAttention).toHaveBeenCalledTimes(1);
  });

  it("treats a short burst (prompt redraw) as idle, not waiting", () => {
    const { tracker, advance, state, onNeedsAttention } = harness();
    tracker.output("a");
    advance(AGENT_CLI_QUIET_MS);
    expect(state("a")).toBe("idle");
    expect(onNeedsAttention).not.toHaveBeenCalled();
  });

  it("does not count the user's own typing echo as work", () => {
    const { tracker, advance, state, onNeedsAttention } = harness();
    for (let i = 0; i < 20; i += 1) {
      tracker.input("a");
      advance(10);
      tracker.output("a");
      advance(400);
    }
    advance(AGENT_CLI_QUIET_MS);
    expect(state("a")).not.toBe("waiting");
    expect(onNeedsAttention).not.toHaveBeenCalled();
  });

  it("clears waiting when acknowledged or typed into", () => {
    const { tracker, advance, state } = harness();
    for (let elapsed = 0; elapsed <= AGENT_CLI_MIN_WORK_MS; elapsed += 500) {
      tracker.output("a");
      advance(500);
    }
    advance(AGENT_CLI_QUIET_MS);
    expect(state("a")).toBe("waiting");
    tracker.acknowledge("a");
    expect(state("a")).toBe("idle");
    tracker.forget("a");
    expect(state("a")).toBeUndefined();
  });
});
