import { describe, expect, it } from "vitest";

import {
  blockOvermindDependents,
  buildOvermindTaskPrompt,
  clampOvermindLimits,
  initialOvermindTaskState,
  isOvermindTaskStalled,
  markOvermindDispatched,
  overmindTasksConflict,
  reduceOvermindObservation,
  selectOvermindDispatch,
  summarizeOvermindProgress,
  evaluateOvermindBudget,
  haltPendingOvermindTasks,
  failOvermindTask,
  totalOvermindTokens,
  summarizeOvermindSubagents,
  listOvermindTasks,
  buildOvermindStartMessage,
  validateOvermindPlan,
  type OvermindTaskSpec,
  type OvermindTaskState,
} from "./overmind.ts";

const limits = clampOvermindLimits({ maxParallel: 2, maxAttempts: 2, taskTimeoutMs: 1000 });

const task = (id: string, extra: Partial<OvermindTaskSpec> = {}): OvermindTaskSpec => ({
  id,
  title: id,
  prompt: `do ${id}`,
  dependsOn: [],
  files: [`src/${id}/`],
  role: "implementation",
  ...extra,
});

const states = (entries: Record<string, Partial<OvermindTaskState>>) =>
  new Map(
    Object.entries(entries).map(
      ([id, patch]) => [id, { ...initialOvermindTaskState, ...patch }] as const,
    ),
  );

describe("overmind plan validation", () => {
  it("accepts a valid plan and rejects cycles, unknown deps, duplicates and oversize plans", () => {
    expect(validateOvermindPlan([task("a"), task("b", { dependsOn: ["a"] })], limits)).toEqual([]);
    expect(
      validateOvermindPlan(
        [task("a", { dependsOn: ["b"] }), task("b", { dependsOn: ["a"] })],
        limits,
      ),
    ).toContain("The plan has a dependency cycle.");
    expect(validateOvermindPlan([task("a", { dependsOn: ["x"] })], limits)[0]).toContain("unknown");
    expect(validateOvermindPlan([task("a"), task("a")], limits)[0]).toContain("twice");
    expect(validateOvermindPlan([], limits)).toHaveLength(1);
  });

  it("clamps limits to the ceilings", () => {
    expect(clampOvermindLimits({ maxParallel: 999 }).maxParallel).toBe(6);
    expect(clampOvermindLimits({ maxParallel: -1 }).maxParallel).toBe(3);
  });
});

describe("overmind file conflicts", () => {
  it("serializes overlapping scopes and unscoped writers, not disjoint or read-only tasks", () => {
    expect(
      overmindTasksConflict(task("a", { files: ["src/a/"] }), task("b", { files: ["src/a/x.ts"] })),
    ).toBe(true);
    expect(
      overmindTasksConflict(task("a", { files: ["src/a/**"] }), task("b", { files: ["src/ab/"] })),
    ).toBe(false);
    expect(overmindTasksConflict(task("a", { files: [] }), task("b"))).toBe(true);
    expect(overmindTasksConflict(task("a", { files: [] }), task("b", { role: "research" }))).toBe(
      false,
    );
  });
});

describe("overmind dispatch selection", () => {
  it("respects dependencies, parallel cap and conflicts", () => {
    const tasks = [
      task("a"),
      task("b", { files: ["src/a/y.ts"] }),
      task("c"),
      task("d", { dependsOn: ["a"] }),
    ];
    const chosen = selectOvermindDispatch(tasks, states({ a: {}, b: {}, c: {}, d: {} }), limits);
    // b conflicts with a; d waits on a; cap 2 -> a and c.
    expect(chosen.map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("counts running tasks against the cap and unblocks after completion", () => {
    const tasks = [task("a"), task("b"), task("c")];
    expect(
      selectOvermindDispatch(
        tasks,
        states({ a: { phase: "running" }, b: { phase: "running" }, c: {} }),
        limits,
      ),
    ).toEqual([]);
    expect(
      selectOvermindDispatch(
        tasks,
        states({ a: { phase: "completed" }, b: { phase: "running" }, c: {} }),
        limits,
      ).map((t) => t.id),
    ).toEqual(["c"]);
  });
});

describe("overmind state reduction", () => {
  const running = markOvermindDispatched(initialOvermindTaskState, "node-1", 0);

  it("completes on success", () => {
    const next = reduceOvermindObservation(
      running,
      { kind: "terminal", status: "completed", summary: "ok" },
      10,
      limits,
    );
    expect(next).toMatchObject({ phase: "completed", summary: "ok" });
  });

  it("retries a failure once then fails for good", () => {
    const retry = reduceOvermindObservation(
      running,
      { kind: "terminal", status: "failed", summary: "boom" },
      10,
      limits,
    );
    expect(retry).toMatchObject({ phase: "pending", attempt: 1, taskId: null });
    const second = markOvermindDispatched(retry, "node-2", 20);
    expect(
      reduceOvermindObservation(
        second,
        { kind: "terminal", status: "interrupted", summary: null },
        30,
        limits,
      ).phase,
    ).toBe("failed");
  });

  it("treats a lost sub-thread as a failed attempt so it can never stay busy", () => {
    const next = reduceOvermindObservation(
      running,
      { kind: "lost", reason: "disconnected" },
      10,
      limits,
    );
    expect(next.phase).toBe("pending");
    expect(next.error).toContain("disconnected");
  });

  it("does not retry a user cancel", () => {
    expect(
      reduceOvermindObservation(
        running,
        { kind: "terminal", status: "cancelled", summary: null },
        10,
        limits,
      ).phase,
    ).toBe("cancelled");
  });

  it("times out a hung task", () => {
    expect(isOvermindTaskStalled(running, 500, limits)).toBe(false);
    expect(isOvermindTaskStalled(running, 1500, limits)).toBe(true);
    expect(reduceOvermindObservation(running, { kind: "running" }, 1500, limits).phase).toBe(
      "pending",
    );
    expect(reduceOvermindObservation(running, { kind: "running" }, 500, limits)).toBe(running);
  });
});

describe("overmind blocking and progress", () => {
  it("blocks transitive dependents of a failed task and settles", () => {
    const tasks = [
      task("a"),
      task("b", { dependsOn: ["a"] }),
      task("c", { dependsOn: ["b"] }),
      task("d"),
    ];
    const next = blockOvermindDependents(
      tasks,
      states({ a: { phase: "failed" }, b: {}, c: {}, d: { phase: "completed" } }),
    );
    expect(next.get("b")?.phase).toBe("blocked");
    expect(next.get("c")?.phase).toBe("blocked");
    const progress = summarizeOvermindProgress(next);
    expect(progress).toMatchObject({ settled: true, outcome: "partial", failed: 1, blocked: 2 });
  });

  it("reports in progress while anything is pending or running", () => {
    expect(summarizeOvermindProgress(states({ a: { phase: "running" } })).outcome).toBe(
      "in_progress",
    );
    expect(summarizeOvermindProgress(states({ a: { phase: "completed" } })).outcome).toBe(
      "succeeded",
    );
    expect(summarizeOvermindProgress(states({ a: { phase: "failed" } })).outcome).toBe("failed");
  });
});

describe("overmind task prompt", () => {
  it("states the file boundary, dependency results and no-git rule", () => {
    const prompt = buildOvermindTaskPrompt({
      goal: "ship it",
      task: task("a"),
      dependencyResults: [{ id: "x", summary: "done x" }],
      siblingTitles: ["b"],
      retryReason: "timed out",
      isolated: false,
    });
    expect(prompt).toContain("Only edit these paths: src/a/");
    expect(prompt).toContain("x: done x");
    expect(prompt).toContain("Do not run git commit");
    expect(prompt).toContain("timed out");
  });
});

describe("overmind sidebar summary", () => {
  it("counts only Overmind rows and treats unknown statuses as active", () => {
    expect(summarizeOvermindSubagents([{ title: "Other", status: "running" }])).toBeNull();
    expect(
      summarizeOvermindSubagents([
        { title: "Overmind · a · A", status: "completed" },
        { title: "Overmind · b · B", status: "failed" },
        { title: "Overmind · c · C", status: "mystery" },
        { title: "Unrelated", status: "completed" },
      ]),
    ).toEqual({ total: 3, done: 1, failed: 1, active: 1, attention: 0 });
  });
});

describe("overmind budget and isolation", () => {
  it("evaluates spend against the cap", () => {
    const small = clampOvermindLimits({ maxTotalTokens: 1000 });
    expect(evaluateOvermindBudget(999, small)).toBe("ok");
    expect(evaluateOvermindBudget(1000, small)).toBe("exhausted");
    expect(evaluateOvermindBudget(1250, small)).toBe("overrun");
  });

  it("halts unstarted tasks so a spent plan settles", () => {
    const halted = haltPendingOvermindTasks(
      states({ a: { phase: "running" }, b: {}, c: { phase: "completed", tokens: 40 } }),
      "budget",
    );
    expect(halted.get("b")?.phase).toBe("blocked");
    expect(halted.get("a")?.phase).toBe("running");
    expect(totalOvermindTokens(halted)).toBe(40);
  });

  it("fails a task for server-found reasons with the same retry rule", () => {
    const running = markOvermindDispatched(initialOvermindTaskState, "n", 0, {
      path: "/w",
      branch: "b",
    });
    expect(running.workspace).toEqual({ path: "/w", branch: "b" });
    const retried = failOvermindTask(running, "merge conflict", limits);
    expect(retried).toMatchObject({ phase: "pending", workspace: null });
    const final = failOvermindTask(
      markOvermindDispatched(retried, "m", 1),
      "merge conflict",
      limits,
    );
    expect(final.phase).toBe("failed");
  });

  it("tells an isolated task about its worktree instead of a path fence", () => {
    const prompt = buildOvermindTaskPrompt({
      goal: "g",
      task: task("a"),
      dependencyResults: [],
      siblingTitles: [],
      retryReason: null,
      isolated: true,
    });
    expect(prompt).toContain("own git worktree");
    expect(prompt).not.toContain("Only edit these paths");
  });
});

describe("overmind task rows", () => {
  it("parses ids and titles from sub-thread titles and keeps order", () => {
    const rows = listOvermindTasks([
      {
        id: "n1",
        title: "Overmind · api · Build the API · v2",
        status: "running",
        childThreadId: "t1",
      },
      { id: "n2", title: "Other", status: "running" },
      { id: "n3", title: "Overmind · ui · Build UI", status: "completed", result: "done" },
    ]);
    expect(rows.map((row) => [row.taskKey, row.title, row.status])).toEqual([
      ["api", "Build the API · v2", "running"],
      ["ui", "Build UI", "completed"],
    ]);
    expect(rows[0]?.childThreadId).toBe("t1");
    expect(rows[1]?.result).toBe("done");
  });

  it("builds a start message that names the tool and the goal", () => {
    const text = buildOvermindStartMessage("  ship it ");
    expect(text).toContain("overmind_advance");
    expect(text).toContain("Goal: ship it");
  });
});

describe("overmind attention and idle handling", () => {
  const running = (extra: Partial<OvermindTaskState> = {}) =>
    markOvermindDispatched({ ...initialOvermindTaskState, ...extra }, "t1", 0);

  it("flags a blocked task, clears the flag, and still times it out", () => {
    const blocked = reduceOvermindObservation(running(), { kind: "attention" }, 10, limits);
    expect(blocked.phase).toBe("running");
    expect(blocked.attention).toBe(true);
    const resumed = reduceOvermindObservation(blocked, { kind: "running" }, 20, limits);
    expect(resumed.attention).toBe(false);
    const stalled = reduceOvermindObservation(blocked, { kind: "attention" }, 5_000, limits);
    expect(stalled.phase).toBe("pending");
    expect(stalled.attention).toBe(false);
  });

  it("clears attention when a blocked task finishes", () => {
    const blocked = reduceOvermindObservation(running(), { kind: "attention" }, 10, limits);
    const done = reduceOvermindObservation(
      blocked,
      { kind: "terminal", status: "completed", summary: "ok" },
      20,
      limits,
    );
    expect(done.attention).toBe(false);
  });

  it("counts waiting rows as attention and idle rows as not active", () => {
    expect(
      summarizeOvermindSubagents([
        { title: "Overmind · a · A", status: "waiting" },
        { title: "Overmind · b · B", status: "idle" },
        { title: "Overmind · c · C", status: "running" },
      ]),
    ).toEqual({ total: 3, done: 0, failed: 0, active: 2, attention: 1 });
  });
});
