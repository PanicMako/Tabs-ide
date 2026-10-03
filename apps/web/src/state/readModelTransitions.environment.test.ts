import { EnvironmentId, ProjectId, ThreadId } from "@tabs/contracts";
import { describe, expect, it } from "vitest";

import type { Project, Thread } from "../types";
import {
  markThreadVisited,
  reorderProjects,
  setError,
  setThreadBranch,
  toggleProject,
  type AppState,
} from "./readModelTransitions";

const threadId = ThreadId.make("thread-1");
const localEnvironment = EnvironmentId.make("environment-local");
const remoteEnvironment = EnvironmentId.make("environment-remote");

function makeThread(environmentId: EnvironmentId, overrides: Partial<Thread> = {}): Thread {
  return {
    id: threadId,
    environmentId,
    error: null,
    branch: "main",
    worktreePath: null,
    lastVisitedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Thread;
}

function makeState(): AppState {
  return {
    projects: [],
    threads: [makeThread(localEnvironment), makeThread(remoteEnvironment)],
    threadsHydrated: true,
  };
}

function makeProject(environmentId: EnvironmentId, id: string, expanded = false): Project {
  return {
    id: ProjectId.make(id),
    environmentId,
    cwd: `/${environmentId}/${id}`,
    expanded,
  } as Project;
}

describe("environment-scoped read model mutations", () => {
  it("updates errors only in the requested environment", () => {
    const next = setError(makeState(), threadId, "remote failure", remoteEnvironment);
    expect(next.threads.map((thread) => thread.error)).toEqual([null, "remote failure"]);
  });

  it("updates branch state only in the requested environment", () => {
    const next = setThreadBranch(
      makeState(),
      threadId,
      "feature/remote",
      "/remote/worktree",
      remoteEnvironment,
    );
    expect(next.threads.map((thread) => thread.branch)).toEqual(["main", "feature/remote"]);
  });

  it("marks only the requested environment copy as visited", () => {
    const next = markThreadVisited(
      makeState(),
      threadId,
      "2026-02-01T00:00:00.000Z",
      remoteEnvironment,
    );
    expect(next.threads.map((thread) => thread.lastVisitedAt)).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
    ]);
  });

  it("toggles only the requested environment copy of a project", () => {
    const state = makeState();
    state.projects = [
      makeProject(localEnvironment, "project-1"),
      makeProject(remoteEnvironment, "project-1"),
    ];
    const next = toggleProject(state, ProjectId.make("project-1"), remoteEnvironment);
    expect(next.projects.map((project) => project.expanded)).toEqual([false, true]);
  });

  it("reorders exact scoped projects even when their local ids collide", () => {
    const state = makeState();
    state.projects = [
      makeProject(localEnvironment, "project-1"),
      makeProject(remoteEnvironment, "project-1"),
      makeProject(remoteEnvironment, "project-2"),
    ];
    const next = reorderProjects(
      state,
      ProjectId.make("project-1"),
      ProjectId.make("project-2"),
      remoteEnvironment,
      remoteEnvironment,
    );
    expect(next.projects.map((project) => project.cwd)).toEqual([
      "/environment-local/project-1",
      "/environment-remote/project-2",
      "/environment-remote/project-1",
    ]);
  });
});
