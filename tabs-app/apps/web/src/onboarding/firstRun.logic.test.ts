import { describe, expect, it } from "vitest";
import {
  isFreshFirstRunWorkspace,
  resolveFirstRunDecision,
  transitionFirstRunGateState,
  type FirstRunGateState,
} from "./firstRun.logic";

describe("isFreshFirstRunWorkspace", () => {
  it("returns true for a completely empty workspace", () => {
    expect(isFreshFirstRunWorkspace({ projects: [], threads: [] })).toBe(true);
  });

  it("returns true for a single bootstrap project with zero threads", () => {
    expect(
      isFreshFirstRunWorkspace({
        projects: [{ id: "p1", cwd: "/test" }],
        threads: [],
      }),
    ).toBe(true);
  });

  it("returns true for a single bootstrap project with one inactive thread", () => {
    expect(
      isFreshFirstRunWorkspace({
        projects: [{ id: "p1", cwd: "/test" }],
        threads: [{ id: "t1", messages: [], activities: [], turnDiffSummaries: [] }],
      }),
    ).toBe(true);
  });

  it("returns false if a thread has chat messages", () => {
    expect(
      isFreshFirstRunWorkspace({
        projects: [{ id: "p1", cwd: "/test" }],
        threads: [
          {
            id: "t1",
            messages: [{ id: "m1", text: "hello", role: "user" }],
            activities: [],
            turnDiffSummaries: [],
          },
        ],
      }),
    ).toBe(false);
  });

  it("returns false if a thread has activities", () => {
    expect(
      isFreshFirstRunWorkspace({
        projects: [{ id: "p1", cwd: "/test" }],
        threads: [
          {
            id: "t1",
            messages: [],
            activities: [{ id: "act-1" }],
            turnDiffSummaries: [],
          },
        ],
      }),
    ).toBe(false);
  });

  it("returns false if a thread has turn diff summaries", () => {
    expect(
      isFreshFirstRunWorkspace({
        projects: [{ id: "p1", cwd: "/test" }],
        threads: [
          {
            id: "t1",
            messages: [],
            activities: [],
            turnDiffSummaries: [{ turnId: "turn-1" }],
          },
        ],
      }),
    ).toBe(false);
  });

  it("returns false if multiple projects exist", () => {
    expect(
      isFreshFirstRunWorkspace({
        projects: [
          { id: "p1", cwd: "/test1" },
          { id: "p2", cwd: "/test2" },
        ],
        threads: [],
      }),
    ).toBe(false);
  });

  it("returns false if multiple threads exist", () => {
    expect(
      isFreshFirstRunWorkspace({
        projects: [{ id: "p1", cwd: "/test" }],
        threads: [
          { id: "t1", messages: [] },
          { id: "t2", messages: [] },
        ],
      }),
    ).toBe(false);
  });
});

describe("transitionFirstRunGateState", () => {
  it("transitions pending state to app on timeout to prevent trapping users", () => {
    const initialState: FirstRunGateState = { decision: "pending", stalled: false };
    const nextState = transitionFirstRunGateState(initialState, { type: "timeout" });
    expect(nextState.decision).toBe("app");
    expect(nextState.stalled).toBe(true);
  });

  it("does not alter app state on timeout", () => {
    const initialState: FirstRunGateState = { decision: "app", stalled: false };
    const nextState = transitionFirstRunGateState(initialState, { type: "timeout" });
    expect(nextState.decision).toBe("app");
    expect(nextState.stalled).toBe(false);
  });

  it("does not alter wizard state on timeout", () => {
    const initialState: FirstRunGateState = { decision: "wizard", stalled: false };
    const nextState = transitionFirstRunGateState(initialState, { type: "timeout" });
    expect(nextState.decision).toBe("wizard");
    expect(nextState.stalled).toBe(false);
  });

  it("transitions to wizard when reset event is received", () => {
    const initialState: FirstRunGateState = { decision: "app", stalled: false };
    const nextState = transitionFirstRunGateState(initialState, { type: "reset" });
    expect(nextState.decision).toBe("wizard");
    expect(nextState.stalled).toBe(false);
  });

  it("updates decision on evidence event", () => {
    const initialState: FirstRunGateState = { decision: "pending", stalled: false };
    const nextState = transitionFirstRunGateState(initialState, {
      type: "evidence",
      decision: "wizard",
    });
    expect(nextState.decision).toBe("wizard");
    expect(nextState.stalled).toBe(false);
  });

  it("ignores pending evidence if already resolved to app or wizard", () => {
    const appState: FirstRunGateState = { decision: "app", stalled: false };
    expect(
      transitionFirstRunGateState(appState, { type: "evidence", decision: "pending" }).decision,
    ).toBe("app");

    const wizardState: FirstRunGateState = { decision: "wizard", stalled: false };
    expect(
      transitionFirstRunGateState(wizardState, { type: "evidence", decision: "pending" }).decision,
    ).toBe("wizard");
  });
});

describe("resolveFirstRunDecision", () => {
  const baseInput = {
    enabled: true,
    hydrated: true,
    completed: false,
    threadsHydrated: true,
    projectCount: 0,
    threadCount: 0,
    workspaceFresh: true,
  };

  it("returns app when onboarding is disabled", () => {
    const result = resolveFirstRunDecision({ ...baseInput, enabled: false });
    expect(result.decision).toBe("app");
    expect(result.persistCompletion).toBe(false);
  });

  it("returns app when onboarding has already been completed", () => {
    const result = resolveFirstRunDecision({ ...baseInput, completed: true });
    expect(result.decision).toBe("app");
    expect(result.persistCompletion).toBe(false);
  });

  it("returns pending when client settings are not yet hydrated", () => {
    const result = resolveFirstRunDecision({ ...baseInput, hydrated: false });
    expect(result.decision).toBe("pending");
    expect(result.persistCompletion).toBe(false);
  });

  it("routes to app for existing users with multiple projects", () => {
    const result = resolveFirstRunDecision({
      ...baseInput,
      projectCount: 3,
      threadCount: 1,
      workspaceFresh: false,
    });
    expect(result.decision).toBe("app");
    expect(result.persistCompletion).toBe(true);
  });

  it("routes to app for existing users with multiple threads", () => {
    const result = resolveFirstRunDecision({
      ...baseInput,
      projectCount: 1,
      threadCount: 4,
      workspaceFresh: false,
    });
    expect(result.decision).toBe("app");
    expect(result.persistCompletion).toBe(true);
  });

  it("returns pending while threads are not yet hydrated", () => {
    const result = resolveFirstRunDecision({
      ...baseInput,
      threadsHydrated: false,
    });
    expect(result.decision).toBe("pending");
    expect(result.persistCompletion).toBe(false);
  });

  it("routes fresh install to wizard", () => {
    const result = resolveFirstRunDecision(baseInput);
    expect(result.decision).toBe("wizard");
    expect(result.persistCompletion).toBe(false);
  });

  it("routes non-fresh install with single active project to app and persists completion", () => {
    const result = resolveFirstRunDecision({
      ...baseInput,
      projectCount: 1,
      threadCount: 1,
      workspaceFresh: false,
    });
    expect(result.decision).toBe("app");
    expect(result.persistCompletion).toBe(true);
  });
});
