import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@tabs/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vitest";

import { buildThreadTree } from "../lib/threadTree";
import { syncV2ShellSnapshot } from "./readModelTransitions";

const at = DateTime.makeUnsafe("2026-10-01T00:00:00.000Z");
const projectId = ProjectId.make("project");

const shell = (
  name: string,
  parent: string | null,
  settled: boolean,
): OrchestrationV2ThreadShell => ({
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
  lineage: {
    rootThreadId: ThreadId.make(parent ?? name),
    parentThreadId: parent === null ? null : ThreadId.make(parent),
    relationshipToParent: parent === null ? null : "subagent",
  },
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
  settledOverride: settled ? "settled" : null,
  settledAt: settled ? at : null,
  deletedAt: null,
});

describe("sub-threads from the server to the sidebar tree", () => {
  it("carries the parent id through and nests a finished child under its active lead", () => {
    const state = syncV2ShellSnapshot(
      { projects: [], threads: [], threadsHydrated: false },
      {
        schemaVersion: 1,
        snapshotSequence: 1,
        projects: [],
        archivedThreads: [],
        threads: [
          shell("lead", null, false),
          shell("child-1", "lead", true),
          shell("child-2", "lead", true),
        ],
        olderSettled: { before: "2026-10-15T00:00:00.000Z", asOfSequence: 1, counts: [] },
      },
      EnvironmentId.make("local"),
    );
    const lead = state.threads.find((thread) => thread.id === "lead")!;
    const children = state.threads.filter((thread) => thread.parentThreadId === "lead");
    expect(children).toHaveLength(2);

    // The lead is active; its children are settled. They must still hang off the lead.
    const entries = buildThreadTree(
      [
        { name: "active" as const, threads: [lead] },
        { name: "settled" as const, threads: children },
      ],
      state.threads,
      new Set(),
    );
    expect(entries.map((entry) => [entry.thread.id, entry.section, entry.depth])).toEqual([
      ["lead", "active", 0],
      ["child-1", "active", 1],
      ["child-2", "active", 1],
    ]);
  });
});
