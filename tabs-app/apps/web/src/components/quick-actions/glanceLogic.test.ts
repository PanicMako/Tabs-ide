import { describe, expect, it, vi } from "vitest";
import type { Thread } from "../../types";

// Pending requests are read from activities; drive them directly per thread.
const pending = new Map<string, { inputs: unknown[]; approvals: unknown[] }>();
vi.mock("../../session-logic", () => ({
  derivePendingUserInputs: (activities: Array<{ threadId: string }>) =>
    pending.get(activities[0]?.threadId ?? "")?.inputs ?? [],
  derivePendingApprovals: (activities: Array<{ threadId: string }>) =>
    pending.get(activities[0]?.threadId ?? "")?.approvals ?? [],
  isLatestTurnSettled: () => true,
}));

const { awaySummaryLine, deriveAwaySummary, deriveInbox } = await import("./glanceLogic");

const NOW = Date.parse("2026-11-12T12:00:00Z");
const names = new Map([
  ["p1", "api"],
  ["p2", "web"],
]);

function thread(id: string, projectId: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    projectId,
    title: `Thread ${id}`,
    archivedAt: null,
    session: null,
    latestTurn: null,
    activities: [{ threadId: id }],
    ...overrides,
  } as unknown as Thread;
}

function turn(state: string, completedAt: string) {
  return { turnId: "t", state, requestedAt: completedAt, startedAt: completedAt, completedAt };
}

describe("Waiting for you", () => {
  it("lists every question and approval across projects, oldest first", () => {
    pending.clear();
    pending.set("a", {
      inputs: [{ createdAt: "2026-11-12T11:30:00Z", questions: [{ question: "Use Postgres?" }] }],
      approvals: [],
    });
    pending.set("b", {
      inputs: [],
      approvals: [
        { requestKind: "command", detail: "rm -rf dist\nmore", createdAt: "2026-11-12T11:00:00Z" },
      ],
    });
    const items = deriveInbox([thread("a", "p1"), thread("b", "p2")], names);
    expect(items.map((item) => [item.projectName, item.kind, item.summary])).toEqual([
      ["web", "approval", "Run a command: rm -rf dist"],
      ["api", "question", "Use Postgres?"],
    ]);
  });

  it("ignores archived conversations and subagents", () => {
    pending.clear();
    pending.set("a", {
      inputs: [{ createdAt: "2026-11-12T11:30:00Z", questions: [] }],
      approvals: [],
    });
    expect(deriveInbox([thread("a", "p1", { archivedAt: "2026-11-12T10:00:00Z" })], names)).toEqual(
      [],
    );
    expect(deriveInbox([thread("a", "p1", { isSubagent: true })], names)).toEqual([]);
  });
});

describe("While you were away", () => {
  it("groups what finished, failed and waits for you per project since you left", () => {
    pending.clear();
    pending.set("w", {
      inputs: [{ createdAt: "2026-11-12T11:40:00Z", questions: [] }],
      approvals: [],
    });
    const since = NOW - 60 * 60 * 1000;
    const projects = deriveAwaySummary(
      [
        thread("done", "p1", { latestTurn: turn("completed", "2026-11-12T11:30:00Z") as never }),
        thread("old", "p1", { latestTurn: turn("completed", "2026-11-12T09:00:00Z") as never }),
        thread("seen", "p1", {
          latestTurn: turn("completed", "2026-11-12T11:20:00Z") as never,
          lastVisitedAt: "2026-11-12T11:50:00Z",
        }),
        thread("boom", "p2", { latestTurn: turn("error", "2026-11-12T11:45:00Z") as never }),
        thread("w", "p2"),
      ],
      names,
      since,
    );
    expect(
      projects.map((project) => ({
        name: project.projectName,
        finished: project.finished.map((entry) => entry.id),
        failed: project.failed.map((entry) => entry.id),
        waiting: project.waiting,
      })),
    ).toEqual([
      { name: "api", finished: ["done"], failed: [], waiting: 0 },
      { name: "web", finished: [], failed: ["boom"], waiting: 1 },
    ]);
    expect(awaySummaryLine(projects)).toBe("1 finished · 1 waiting for you · 1 stopped or failed");
  });

  it("says nothing when nothing happened", () => {
    pending.clear();
    expect(awaySummaryLine(deriveAwaySummary([thread("x", "p1")], names, NOW))).toBeNull();
  });
});
