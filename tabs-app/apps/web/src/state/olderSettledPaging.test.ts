import { describe, expect, it } from "vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2ShellSnapshot,
} from "@tabs/contracts";
import * as DateTime from "effect/DateTime";
import {
  appendOlderSettledThreads,
  applyOlderSettledPage,
  applyOlderSettledCounts,
  applyShellStreamItem,
  olderSettledPageState,
  syncV2ShellSnapshot,
  mergeV2ProjectEnrichment,
  type AppState,
} from "./readModelTransitions";

const environment = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const projectId = ProjectId.make("project");
const at = DateTime.makeUnsafe("2026-10-01T00:00:00.000Z");
const before = "2026-10-15T00:00:00.000Z";
const shell = (name: string): OrchestrationV2ThreadShell => ({
  id: ThreadId.make(name),
  projectId,
  title: name,
  createdBy: "user",
  creationSource: "web",
  providerInstanceId: ProviderInstanceId.make("codex"),
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
  runtimeMode: "approval-required",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  lineage: { rootThreadId: ThreadId.make(name), parentThreadId: null, relationshipToParent: null },
  forkedFrom: null,
  activeProviderThreadId: null,
  latestRunId: null,
  activeRunId: null,
  status: "idle",
  pendingRuntimeRequest: null,
  latestVisibleMessage: null,
  latestUserMessageAt: null,
  hasActionableProposedPlan: false,
  pendingBackgroundTasks: [],
  providerInstanceHistory: [],
  itemCount: 0,
  visibleItemCount: 0,
  createdAt: at,
  updatedAt: at,
  archivedAt: null,
  settledOverride: "settled",
  settledAt: at,
  deletedAt: null,
});
const snapshot = (
  sequence: number,
  threads: OrchestrationV2ThreadShell[] = [],
): OrchestrationV2ShellSnapshot => ({
  schemaVersion: 1,
  snapshotSequence: sequence,
  projects: [],
  archivedThreads: [],
  threads,
  olderSettled: { before, asOfSequence: sequence, counts: [{ projectId, count: 2 }] },
});
const initial = (): AppState =>
  syncV2ShellSnapshot(
    { projects: [], threads: [], threadsHydrated: false },
    snapshot(10),
    environment,
  );
const page = (
  state: AppState,
  sequence: number,
  threads: OrchestrationV2ThreadShell[],
  generation = 10,
) =>
  applyOlderSettledPage(state, {
    environmentId: environment,
    projectId,
    generation,
    cursor: { settledAt: before },
    limit: 2,
    page: { snapshotSequence: sequence, threads, counts: [] },
  });

describe("older settled paging", () => {
  it("uses the server's settle-time/id cursor and ends on a short page", () => {
    const next = page(initial(), 10, [shell("a"), shell("b")]);
    expect(next.threads.map((thread) => thread.id)).toEqual(["a", "b"]);
    expect(olderSettledPageState(next, environment, projectId)?.cursor).toEqual({
      settledAt: DateTime.formatIso(at),
      threadId: "b",
    });
    expect(
      olderSettledPageState(page(initial(), 10, [shell("a")]), environment, projectId)?.cursor,
    ).toBeNull();
  });

  it("does not resurrect a deleted thread from an in-flight page", () => {
    const removed = applyShellStreamItem(
      initial(),
      { kind: "thread.removed", location: "active", sequence: 12, threadId: ThreadId.make("a") },
      environment,
    );
    expect(page(removed, 11, [shell("a")]).threads).toHaveLength(0);
  });

  it("rejects a late page for a deleted project without removing another environment's rows", () => {
    const localProject = {
      id: projectId,
      environmentId: environment,
      name: "Local project",
      cwd: "/local/project",
      defaultModelSelection: null,
      expanded: true,
      scripts: [],
    };
    const remoteProject = { ...localProject, environmentId: remote, name: "Remote project" };
    const withRemoteRow = appendOlderSettledThreads(
      { ...initial(), projects: [localProject, remoteProject] },
      [shell("remote-row")],
      remote,
    );
    const removed = applyShellStreamItem(
      withRemoteRow,
      { kind: "project.removed", sequence: 12, projectId },
      environment,
    );
    const latePage = applyOlderSettledPage(removed, {
      environmentId: environment,
      projectId,
      generation: 10,
      cursor: { settledAt: before },
      limit: 2,
      page: { snapshotSequence: 13, threads: [shell("late-project-row")], counts: [] },
    });

    expect(latePage.threads.map((thread) => [thread.environmentId, thread.id])).toEqual([
      [remote, "remote-row"],
    ]);
    expect(latePage.projects.map((project) => project.environmentId)).toEqual([remote]);
  });

  it("keeps a newer live update instead of replacing it with an older page", () => {
    const newer = applyShellStreamItem(
      initial(),
      {
        kind: "thread.updated",
        location: "active",
        sequence: 12,
        thread: { ...shell("a"), title: "New title" },
      },
      environment,
    );
    expect(page(newer, 11, [shell("a")]).threads[0]?.title).toBe("New title");
  });

  it("rejects previous-generation pages and clears disconnected stale rows", () => {
    const loaded = page(initial(), 10, [shell("a")]);
    const refreshed = syncV2ShellSnapshot(loaded, snapshot(20), environment);
    expect(refreshed.threads).toHaveLength(0);
    expect(page(refreshed, 19, [shell("a")])).toBe(refreshed);
  });

  it("keeps duplicate ids on other machines isolated for shell updates and pages", () => {
    const both = syncV2ShellSnapshot(initial(), snapshot(10, [shell("a")]), remote);
    const changed = applyShellStreamItem(
      both,
      {
        kind: "thread.updated",
        location: "active",
        sequence: 11,
        thread: { ...shell("a"), title: "Local title" },
      },
      environment,
    );
    expect(changed.threads.find((thread) => thread.environmentId === remote)?.title).toBe("a");
    expect(
      page(changed, 10, [shell("a")]).threads.find((thread) => thread.environmentId === environment)
        ?.title,
    ).toBe("Local title");
  });

  it("preserves paging metadata during enrichment and rejects stale counts", () => {
    const changed = applyShellStreamItem(
      initial(),
      { kind: "thread.removed", location: "active", sequence: 12, threadId: ThreadId.make("a") },
      environment,
    );
    expect(applyOlderSettledCounts(changed, environment, 10, 0, [])).toBe(changed);
    const current = applyOlderSettledCounts(changed, environment, 10, 1, [{ projectId, count: 1 }]);
    expect(current.environmentSnapshots?.[environment]?.olderSettled?.counts[0]?.count).toBe(1);
    expect(
      mergeV2ProjectEnrichment(current, snapshot(10), environment).environmentSnapshots?.[
        environment
      ]?.olderSettled,
    ).toBe(current.environmentSnapshots?.[environment]?.olderSettled);
    expect(
      applyShellStreamItem(
        current,
        { kind: "thread.updated", location: "active", sequence: 11, thread: shell("a") },
        environment,
      ),
    ).toBe(current);
  });
});
