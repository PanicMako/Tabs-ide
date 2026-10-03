import { describe, expect, it } from "vitest";
import { resolveTabActivityIndicator } from "./tabActivityIndicator";
import { ProjectId, ThreadId } from "@tabs/contracts";
import type { Thread } from "../types";

function createMockThread(overrides?: Partial<Thread>): Thread {
  return {
    id: "thread-1" as ThreadId,
    projectId: "project-1" as ProjectId,
    codexThreadId: null,
    title: "Test Thread",
    modelSelection: { provider: "codex", model: "default" } as any,
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-09T10:00:00.000Z",
    latestTurn: null,
    lastVisitedAt: "2026-03-09T10:00:00.000Z",
    archivedAt: null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

describe("resolveTabActivityIndicator", () => {
  it("returns null when there are no threads", () => {
    expect(resolveTabActivityIndicator([])).toBeNull();
  });

  it("returns null when threads are quiet (visited and no pending input)", () => {
    const thread = createMockThread({
      latestTurn: {
        turnId: "turn-1" as any,
        state: "completed",
        assistantMessageId: null,
        requestedAt: "2026-03-09T10:00:00.000Z",
        startedAt: "2026-03-09T10:00:00.000Z",
        completedAt: "2026-03-09T10:05:00.000Z",
      },
      lastVisitedAt: "2026-03-09T10:10:00.000Z", // visited after completion
    });

    expect(resolveTabActivityIndicator([thread])).toBeNull();
  });

  it("returns completed emerald indicator when thread completed after last visit", () => {
    const thread = createMockThread({
      latestTurn: {
        turnId: "turn-1" as any,
        state: "completed",
        assistantMessageId: null,
        requestedAt: "2026-03-09T10:00:00.000Z",
        startedAt: "2026-03-09T10:00:00.000Z",
        completedAt: "2026-03-09T10:05:00.000Z",
      },
      lastVisitedAt: "2026-03-09T10:02:00.000Z", // visited before completion
    });

    const indicator = resolveTabActivityIndicator([thread]);
    expect(indicator).not.toBeNull();
    expect(indicator?.type).toBe("completed");
    expect(indicator?.label).toBe("Task completed");
    expect(indicator?.dotClass).toContain("bg-emerald-500");
    expect(indicator?.pulse).toBe(false);
  });

  it("returns waiting-input amber indicator when thread has pending user input", () => {
    const thread = createMockThread({
      activities: [
        {
          id: "act-1",
          threadId: "thread-1" as any,
          turnId: "turn-1" as any,
          kind: "user-input.requested",
          createdAt: "2026-03-09T10:00:00.000Z",
          summary: "User input requested",
          payload: {
            requestId: "req-1",
            questions: [
              {
                id: "q1",
                header: "Input Required",
                question: "Which file?",
                options: [{ label: "A", description: "Option A" }],
              },
            ],
          },
        } as any,
      ],
    });

    const indicator = resolveTabActivityIndicator([thread]);
    expect(indicator).not.toBeNull();
    expect(indicator?.type).toBe("waiting-input");
    expect(indicator?.label).toBe("Agent waiting for input");
    expect(indicator?.dotClass).toContain("bg-amber-500");
    expect(indicator?.pulse).toBe(true);
  });

  it("prioritizes waiting-input over completed when multiple threads exist", () => {
    const completedThread = createMockThread({
      id: "thread-1" as ThreadId,
      latestTurn: {
        turnId: "turn-1" as any,
        state: "completed",
        assistantMessageId: null,
        requestedAt: "2026-03-09T10:00:00.000Z",
        startedAt: "2026-03-09T10:00:00.000Z",
        completedAt: "2026-03-09T10:05:00.000Z",
      },
      lastVisitedAt: "2026-03-09T10:02:00.000Z",
    });

    const inputThread = createMockThread({
      id: "thread-2" as ThreadId,
      activities: [
        {
          id: "act-1",
          threadId: "thread-2" as any,
          turnId: "turn-2" as any,
          kind: "user-input.requested",
          createdAt: "2026-03-09T10:00:00.000Z",
          summary: "User input requested",
          payload: {
            requestId: "req-1",
            questions: [
              {
                id: "q1",
                header: "Confirm",
                question: "Confirm?",
                options: [{ label: "Yes", description: "Confirm yes" }],
              },
            ],
          },
        } as any,
      ],
    });

    const indicator = resolveTabActivityIndicator([completedThread, inputThread]);
    expect(indicator?.type).toBe("waiting-input");
  });

  it("returns null (no green dot) when thread is actively running", () => {
    const runningThread = createMockThread({
      latestTurn: {
        turnId: "turn-1" as any,
        state: "running",
        assistantMessageId: null,
        requestedAt: "2026-03-09T10:00:00.000Z",
        startedAt: "2026-03-09T10:00:00.000Z",
        completedAt: null,
      },
      session: {
        provider: "codex" as any,
        status: "running",
        orchestrationStatus: "running",
        createdAt: "2026-03-09T10:00:00.000Z",
        updatedAt: "2026-03-09T10:00:00.000Z",
      },
      lastVisitedAt: "2026-03-09T09:59:00.000Z",
    });

    expect(resolveTabActivityIndicator([runningThread])).toBeNull();
  });

  it("returns null when thread had a prior completed turn but is now running a new turn", () => {
    const rerunningThread = createMockThread({
      latestTurn: {
        turnId: "turn-2" as any,
        state: "running",
        assistantMessageId: null,
        requestedAt: "2026-03-09T10:10:00.000Z",
        startedAt: "2026-03-09T10:10:00.000Z",
        completedAt: "2026-03-09T10:05:00.000Z", // from prior turn
      },
      session: {
        provider: "codex" as any,
        status: "running",
        orchestrationStatus: "running",
        createdAt: "2026-03-09T10:00:00.000Z",
        updatedAt: "2026-03-09T10:10:00.000Z",
      },
      lastVisitedAt: "2026-03-09T10:02:00.000Z",
    });

    expect(resolveTabActivityIndicator([rerunningThread])).toBeNull();
  });

  it("suppresses green dot for the entire project if any thread is actively working", () => {
    const completedThread = createMockThread({
      id: "thread-1" as ThreadId,
      latestTurn: {
        turnId: "turn-1" as any,
        state: "completed",
        assistantMessageId: null,
        requestedAt: "2026-03-09T10:00:00.000Z",
        startedAt: "2026-03-09T10:00:00.000Z",
        completedAt: "2026-03-09T10:05:00.000Z",
      },
      session: {
        provider: "codex" as any,
        status: "ready",
        orchestrationStatus: "ready",
        createdAt: "2026-03-09T10:00:00.000Z",
        updatedAt: "2026-03-09T10:05:00.000Z",
      },
      lastVisitedAt: "2026-03-09T10:02:00.000Z",
    });

    const runningThread = createMockThread({
      id: "thread-2" as ThreadId,
      latestTurn: {
        turnId: "turn-2" as any,
        state: "running",
        assistantMessageId: null,
        requestedAt: "2026-03-09T10:10:00.000Z",
        startedAt: "2026-03-09T10:10:00.000Z",
        completedAt: null,
      },
      session: {
        provider: "codex" as any,
        status: "running",
        orchestrationStatus: "running",
        createdAt: "2026-03-09T10:10:00.000Z",
        updatedAt: "2026-03-09T10:10:00.000Z",
      },
      lastVisitedAt: "2026-03-09T10:10:00.000Z",
    });

    // While thread-2 is working, project must NOT show green dot
    expect(resolveTabActivityIndicator([completedThread, runningThread])).toBeNull();
  });

  it("still shows amber waiting-input even when thread is running", () => {
    const runningWithQuestion = createMockThread({
      latestTurn: {
        turnId: "turn-1" as any,
        state: "running",
        assistantMessageId: null,
        requestedAt: "2026-03-09T10:00:00.000Z",
        startedAt: "2026-03-09T10:00:00.000Z",
        completedAt: null,
      },
      session: {
        provider: "codex" as any,
        status: "running",
        orchestrationStatus: "running",
        createdAt: "2026-03-09T10:00:00.000Z",
        updatedAt: "2026-03-09T10:00:00.000Z",
      },
      activities: [
        {
          id: "act-1",
          threadId: "thread-1" as any,
          turnId: "turn-1" as any,
          kind: "user-input.requested",
          createdAt: "2026-03-09T10:01:00.000Z",
          summary: "Question",
          payload: {
            requestId: "req-1",
            questions: [
              {
                id: "q1",
                header: "Input Required",
                question: "Proceed?",
                options: [{ label: "Yes", description: "Confirm" }],
              },
            ],
          },
        } as any,
      ],
    });

    const indicator = resolveTabActivityIndicator([runningWithQuestion]);
    expect(indicator?.type).toBe("waiting-input");
    expect(indicator?.pulse).toBe(true);
  });
});
