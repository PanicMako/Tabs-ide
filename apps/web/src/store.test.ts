import {
  DEFAULT_MODEL,
  EnvironmentId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
} from "@tabs/contracts";
import { describe, expect, it } from "vitest";

import { makeAppModelSelection } from "./modelSelection";
import {
  markThreadUnread,
  reorderProjects,
  syncServerReadModel,
  type AppState,
} from "./state/readModelTransitions";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "./types";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    modelSelection: makeAppModelSelection("codex", "gpt-5-codex"),
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-02-13T00:00:00.000Z",
    latestTurn: null,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  };
}

function makeState(thread: Thread): AppState {
  return {
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        name: "Project",
        cwd: "/tmp/project",
        defaultModelSelection: makeAppModelSelection("codex", "gpt-5-codex"),
        expanded: true,
        scripts: [],
      },
    ],
    threads: [thread],
    threadsHydrated: true,
  };
}

function makeReadModelThread(overrides: Partial<OrchestrationReadModel["threads"][number]>) {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    modelSelection: makeAppModelSelection("codex", "gpt-5.3-codex"),
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    pullRequests: [],
    latestTurn: null,
    createdAt: "2026-02-27T00:00:00.000Z",
    updatedAt: "2026-02-27T00:00:00.000Z",
    deletedAt: null,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    messages: [],
    activities: [],
    proposedPlans: [],
    checkpoints: [],
    session: null,
    ...overrides,
  } satisfies OrchestrationReadModel["threads"][number];
}

function makeReadModel(thread: OrchestrationReadModel["threads"][number]): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: "2026-02-27T00:00:00.000Z",
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        title: "Project",
        workspaceRoot: "/tmp/project",
        defaultModelSelection: makeAppModelSelection("codex", "gpt-5.3-codex"),
        createdAt: "2026-02-27T00:00:00.000Z",
        updatedAt: "2026-02-27T00:00:00.000Z",
        deletedAt: null,
        scripts: [],
      },
    ],
    threads: [thread],
  };
}

function makeReadModelProject(
  overrides: Partial<OrchestrationReadModel["projects"][number]>,
): OrchestrationReadModel["projects"][number] {
  return {
    id: ProjectId.makeUnsafe("project-1"),
    title: "Project",
    workspaceRoot: "/tmp/project",
    defaultModelSelection: makeAppModelSelection("codex", "gpt-5.3-codex"),
    createdAt: "2026-02-27T00:00:00.000Z",
    updatedAt: "2026-02-27T00:00:00.000Z",
    deletedAt: null,
    scripts: [],
    ...overrides,
  };
}

describe("store pure functions", () => {
  it("markThreadUnread moves lastVisitedAt before completion for a completed thread", () => {
    const latestTurnCompletedAt = "2026-02-25T12:30:00.000Z";
    const initialState = makeState(
      makeThread({
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-1"),
          state: "completed",
          requestedAt: "2026-02-25T12:28:00.000Z",
          startedAt: "2026-02-25T12:28:30.000Z",
          completedAt: latestTurnCompletedAt,
          assistantMessageId: null,
        },
        lastVisitedAt: "2026-02-25T12:35:00.000Z",
      }),
    );

    const next = markThreadUnread(initialState, ThreadId.makeUnsafe("thread-1"));

    const updatedThread = next.threads[0];
    expect(updatedThread).toBeDefined();
    expect(updatedThread?.lastVisitedAt).toBe("2026-02-25T12:29:59.999Z");
    expect(Date.parse(updatedThread?.lastVisitedAt ?? "")).toBeLessThan(
      Date.parse(latestTurnCompletedAt),
    );
  });

  it("markThreadUnread does not change a thread without a completed turn", () => {
    const initialState = makeState(
      makeThread({
        latestTurn: null,
        lastVisitedAt: "2026-02-25T12:35:00.000Z",
      }),
    );

    const next = markThreadUnread(initialState, ThreadId.makeUnsafe("thread-1"));

    expect(next).toEqual(initialState);
  });

  it("reorderProjects moves a project to a target index", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const project3 = ProjectId.makeUnsafe("project-3");
    const state: AppState = {
      projects: [
        {
          id: project1,
          name: "Project 1",
          cwd: "/tmp/project-1",
          defaultModelSelection: makeAppModelSelection("codex", DEFAULT_MODEL),
          expanded: true,
          scripts: [],
        },
        {
          id: project2,
          name: "Project 2",
          cwd: "/tmp/project-2",
          defaultModelSelection: makeAppModelSelection("codex", DEFAULT_MODEL),
          expanded: true,
          scripts: [],
        },
        {
          id: project3,
          name: "Project 3",
          cwd: "/tmp/project-3",
          defaultModelSelection: makeAppModelSelection("codex", DEFAULT_MODEL),
          expanded: true,
          scripts: [],
        },
      ],
      threads: [],
      threadsHydrated: true,
    };

    const next = reorderProjects(state, project1, project3);

    expect(next.projects.map((project) => project.id)).toEqual([project2, project3, project1]);
  });
});

describe("store read model sync", () => {
  it("attaches the owning environment to hydrated projects and threads", () => {
    const environmentId = EnvironmentId.makeUnsafe("environment-remote");
    const next = syncServerReadModel(
      { projects: [], threads: [], threadsHydrated: false },
      makeReadModel(makeReadModelThread({})),
      environmentId,
    );

    expect(next.projects[0]?.environmentId).toBe(environmentId);
    expect(next.threads[0]?.environmentId).toBe(environmentId);
  });

  it("merges environment snapshots without collapsing identical local ids", () => {
    const primaryEnvironmentId = EnvironmentId.makeUnsafe("environment-primary");
    const remoteEnvironmentId = EnvironmentId.makeUnsafe("environment-remote");
    const primary = syncServerReadModel(
      { projects: [], threads: [], threadsHydrated: false },
      makeReadModel(
        makeReadModelThread({
          title: "Primary thread",
        }),
      ),
      primaryEnvironmentId,
    );

    const next = syncServerReadModel(
      primary,
      {
        ...makeReadModel(makeReadModelThread({ title: "Remote thread" })),
        projects: [makeReadModelProject({ title: "Remote project" })],
      },
      remoteEnvironmentId,
    );

    expect(next.projects).toHaveLength(2);
    expect(next.projects.map((project) => [project.environmentId, project.name])).toEqual([
      [primaryEnvironmentId, "Project"],
      [remoteEnvironmentId, "Remote project"],
    ]);
    expect(next.threads).toHaveLength(2);
    expect(next.threads.map((thread) => [thread.environmentId, thread.title])).toEqual([
      [primaryEnvironmentId, "Primary thread"],
      [remoteEnvironmentId, "Remote thread"],
    ]);
  });

  it("preserves claude model slugs without an active session", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        modelSelection: makeAppModelSelection("claudeAgent", "claude-opus-4-6"),
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.modelSelection.model).toBe("claude-opus-4-6");
  });

  it("resolves claude aliases when session provider is claudeAgent", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        modelSelection: makeAppModelSelection("claudeAgent", "sonnet"),
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "ready",
          providerName: "claudeAgent",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: "2026-02-27T00:00:00.000Z",
        },
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.modelSelection.model).toBe("claude-sonnet-5");
  });

  it("preserves project and thread updatedAt timestamps from the read model", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        updatedAt: "2026-02-27T00:05:00.000Z",
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.projects[0]?.updatedAt).toBe("2026-02-27T00:00:00.000Z");
    expect(next.threads[0]?.updatedAt).toBe("2026-02-27T00:05:00.000Z");
  });

  it("preserves the current project order when syncing incoming read model updates", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const project3 = ProjectId.makeUnsafe("project-3");
    const initialState: AppState = {
      projects: [
        {
          id: project2,
          name: "Project 2",
          cwd: "/tmp/project-2",
          defaultModelSelection: makeAppModelSelection("codex", DEFAULT_MODEL),
          expanded: true,
          scripts: [],
        },
        {
          id: project1,
          name: "Project 1",
          cwd: "/tmp/project-1",
          defaultModelSelection: makeAppModelSelection("codex", DEFAULT_MODEL),
          expanded: true,
          scripts: [],
        },
      ],
      threads: [],
      threadsHydrated: true,
    };
    const readModel: OrchestrationReadModel = {
      snapshotSequence: 2,
      updatedAt: "2026-02-27T00:00:00.000Z",
      projects: [
        makeReadModelProject({
          id: project1,
          title: "Project 1",
          workspaceRoot: "/tmp/project-1",
        }),
        makeReadModelProject({
          id: project2,
          title: "Project 2",
          workspaceRoot: "/tmp/project-2",
        }),
        makeReadModelProject({
          id: project3,
          title: "Project 3",
          workspaceRoot: "/tmp/project-3",
        }),
      ],
      threads: [],
    };

    const next = syncServerReadModel(initialState, readModel);

    expect(next.projects.map((project) => project.id)).toEqual([project2, project1, project3]);
  });
});
