import { describe, expect, it } from "vitest";
import { ThreadId } from "@tabs/contracts";

import {
  deriveThreadRelationshipGraph,
  immediateThreadRelationships,
  orderWebThreadLineageRows,
  relatedThreadIds,
  resolveMergeBackTargetThreadId,
  resolveThreadLineageWindow,
  walkThreadRelationships,
  threadRelationshipRowStatus,
} from "./threadRelationships.ts";

describe("thread relationships", () => {
  it.each([
    ["running", "completed"],
    ["completed", "running"],
  ])("keeps parent %s independent of child %s", (parentStatus, childStatus) => {
    const parent = ThreadId.make("parent");
    const child = ThreadId.make("child");
    const graph = deriveThreadRelationshipGraph({
      threads: [
        {
          id: parent,
          activityRunStatus: parentStatus,
          status: "cancelled",
          lineage: { parentThreadId: null },
        },
        {
          id: child,
          activityRunStatus: childStatus,
          lineage: { parentThreadId: parent, relationshipToParent: "fork" },
        },
      ] as never,
      projection: null,
    });
    expect(threadRelationshipRowStatus(graph, immediateThreadRelationships(graph, child)[0]!)).toBe(
      parentStatus,
    );
    expect(
      threadRelationshipRowStatus(graph, immediateThreadRelationships(graph, parent)[0]!),
    ).toBe(childStatus);
  });

  it("does not label a missing parent with its child's running status", () => {
    const parent = ThreadId.make("missing-parent");
    const child = ThreadId.make("child");
    const graph = deriveThreadRelationshipGraph({
      threads: [
        {
          id: child,
          status: "running",
          lineage: { parentThreadId: parent, relationshipToParent: "subagent" },
        },
      ] as never,
      projection: null,
    });
    expect(
      threadRelationshipRowStatus(graph, immediateThreadRelationships(graph, child)[0]!),
    ).toBeNull();
  });

  it("keeps an older activity run visible over a newer cancelled run", () => {
    const parent = ThreadId.make("thread-parent");
    const child = ThreadId.make("thread-child");
    const graph = deriveThreadRelationshipGraph({
      threads: [
        {
          id: child,
          title: "Active child",
          activityRunStatus: "running",
          status: "cancelled",
          forkedFrom: { type: "run", threadId: parent, runId: "run-parent" },
          lineage: {
            rootThreadId: parent,
            parentThreadId: parent,
            relationshipToParent: "subagent",
          },
        },
      ] as never,
      projection: null,
    });

    expect(graph.edges).toEqual([
      expect.objectContaining({ targetThreadId: child, status: "running" }),
    ]);
  });

  it("keeps missing parents and cycles navigable without recursive traversal", () => {
    const root = ThreadId.make("thread-root");
    const child = ThreadId.make("thread-child");
    const missing = ThreadId.make("thread-missing");
    const graph = deriveThreadRelationshipGraph({
      threads: [
        {
          id: root,
          title: "Root",
          status: "completed",
          forkedFrom: { type: "run", threadId: child, runId: "run-cycle" },
          lineage: { rootThreadId: root, parentThreadId: child, relationshipToParent: "fork" },
        },
        {
          id: child,
          title: "Child",
          status: "completed",
          forkedFrom: { type: "run", threadId: missing, runId: "run-missing" },
          lineage: { rootThreadId: root, parentThreadId: missing, relationshipToParent: "fork" },
        },
      ] as never,
      projection: null,
    });

    expect(graph.nodes.get(missing)?.missing).toBe(true);
    expect(relatedThreadIds(graph, root)).toEqual([child]);
    expect(relatedThreadIds(graph, child)).toEqual([root, missing]);
    expect(
      walkThreadRelationships(graph, root).map(({ threadId, depth }) => [threadId, depth]),
    ).toEqual([
      [child, 1],
      [missing, 2],
    ]);
    expect(immediateThreadRelationships(graph, root).map(({ threadId }) => threadId)).toEqual([
      child,
    ]);
  });

  it("combines subagent and transfer edges with archived shell state", () => {
    const parent = ThreadId.make("thread-parent");
    const child = ThreadId.make("thread-child");
    const transferTarget = ThreadId.make("thread-transfer");
    const graph = deriveThreadRelationshipGraph({
      threads: [
        {
          id: parent,
          title: "Parent",
          status: "completed",
          archivedAt: null,
          forkedFrom: null,
          lineage: { rootThreadId: parent, parentThreadId: null, relationshipToParent: null },
        },
        {
          id: child,
          title: "Subagent",
          status: "completed",
          archivedAt: "2026-06-24T00:00:00.000Z",
          forkedFrom: null,
          lineage: {
            rootThreadId: parent,
            parentThreadId: parent,
            relationshipToParent: "subagent",
          },
        },
      ] as never,
      projection: {
        thread: { id: parent },
        subagents: [{ childThreadId: child, status: "completed" }],
        contextTransfers: [
          {
            sourceThreadId: child,
            targetThreadId: transferTarget,
            status: "completed",
          },
        ],
      } as never,
    });

    expect(graph.nodes.get(child)?.thread?.archivedAt).not.toBeNull();
    expect(graph.nodes.get(transferTarget)?.missing).toBe(true);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceThreadId: parent,
          targetThreadId: child,
          kind: "subagent",
        }),
        expect.objectContaining({
          sourceThreadId: child,
          targetThreadId: transferTarget,
          kind: "transfer",
        }),
      ]),
    );
  });

  it("keeps the live shell when an archived snapshot contains the same thread id", () => {
    const parent = ThreadId.make("thread-parent");
    const staleParent = ThreadId.make("thread-stale-parent");
    const child = ThreadId.make("thread-child");
    const liveChild = {
      id: child,
      title: "Live child",
      status: "running",
      archivedAt: null,
      forkedFrom: { type: "run", threadId: parent, runId: "run-live" },
      lineage: {
        rootThreadId: parent,
        parentThreadId: parent,
        relationshipToParent: "fork",
      },
    } as const;
    const staleArchivedChild = {
      ...liveChild,
      title: "Stale archived child",
      status: "completed",
      archivedAt: "2026-06-24T00:00:00.000Z",
      forkedFrom: { type: "run", threadId: staleParent, runId: "run-stale" },
      lineage: {
        rootThreadId: staleParent,
        parentThreadId: staleParent,
        relationshipToParent: "fork",
      },
    } as const;

    const graph = deriveThreadRelationshipGraph({
      threads: [liveChild, staleArchivedChild] as never,
      projection: null,
    });

    expect(graph.nodes.get(child)?.thread).toMatchObject({
      title: "Live child",
      status: "running",
      archivedAt: null,
    });
    expect(graph.edges).toEqual([
      expect.objectContaining({
        sourceThreadId: parent,
        targetThreadId: child,
      }),
    ]);
    expect(graph.nodes.has(staleParent)).toBe(false);
  });

  it("resolves merge-back only for forks and prefers the recorded fork source", () => {
    const source = ThreadId.make("thread-source");
    const fallbackParent = ThreadId.make("thread-parent");
    const fork = ThreadId.make("thread-fork");

    expect(
      resolveMergeBackTargetThreadId({
        thread: {
          id: fork,
          forkedFrom: { type: "run", threadId: source, runId: "run-source" },
          lineage: {
            rootThreadId: source,
            parentThreadId: fallbackParent,
            relationshipToParent: "fork",
          },
        },
      } as never),
    ).toBe(source);
    expect(
      resolveMergeBackTargetThreadId({
        thread: {
          id: fork,
          forkedFrom: null,
          lineage: {
            rootThreadId: source,
            parentThreadId: fallbackParent,
            relationshipToParent: "fork",
          },
        },
      } as never),
    ).toBe(fallbackParent);
    expect(
      resolveMergeBackTargetThreadId({
        thread: {
          id: fork,
          forkedFrom: null,
          lineage: {
            rootThreadId: source,
            parentThreadId: fallbackParent,
            relationshipToParent: "subagent",
          },
        },
      } as never),
    ).toBeNull();
  });

  it("paginates lineage rows with exact hidden counts", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const page1 = resolveThreadLineageWindow(items, 6);
    expect(page1.visibleRows).toEqual([1, 2, 3, 4, 5, 6]);
    expect(page1.hiddenCount).toBe(4);

    const page2 = resolveThreadLineageWindow(items, 12);
    expect(page2.visibleRows).toEqual(items);
    expect(page2.hiddenCount).toBe(0);
  });
});
