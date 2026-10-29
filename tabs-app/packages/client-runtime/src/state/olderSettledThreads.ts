import {
  isOlderSettledThreadShell,
  type EnvironmentId,
  type OrchestrationV2OlderSettledCursor,
  type OrchestrationV2ThreadFamily,
  type OrchestrationV2ThreadShell,
  type ProjectId,
  type ThreadId,
} from "@tabs/contracts";
import * as DateTime from "effect/DateTime";

// Rows per page of older settled threads: one "Show more" step of the Settled shelf.
export const OLDER_SETTLED_PAGE_SIZE = 25;

/** Where an environment's shell cut settled threads, and how many are older per project. */
export interface OlderSettled {
  readonly before: string;
  readonly beforeMs: number;
  readonly counts: ReadonlyMap<ProjectId, number>;
}

/** The scope's projects in one environment, or null for all of them. */
export interface OlderSettledScope {
  readonly environmentId: EnvironmentId;
  readonly projectIds: ReadonlyArray<ProjectId> | null;
}

/**
 * The pages read below an environment's cut. Everything at or above `frontier` is local: pages
 * hold the rows that were there when read, and shell deltas keep that range current. A null
 * frontier means no more can load: every older thread is loaded, or this session has no snapshot.
 */
export interface OlderSettledPages {
  readonly reads: ReadonlyArray<OrchestrationV2ThreadFamily>;
  readonly frontier: OrchestrationV2OlderSettledCursor | null;
  readonly status: "ready" | "pending" | "failed";
}

export const NO_PAGES: OlderSettledPages = { reads: [], frontier: null, status: "ready" };

export type OlderSettledRow = Pick<
  OrchestrationV2ThreadShell,
  "id" | "projectId" | "lineage" | "settledOverride" | "settledAt"
>;

export interface OlderSettledShelfEnvironment {
  readonly older: OlderSettled | null;
  readonly pages: OlderSettledPages;
}

/**
 * Changes whenever the older count can: any removal (by largest sequence, so a repeat counts), an
 * older row that arrives or changes, or an old row arriving outside the set (unsettled). Threads
 * created after the cut never enter it, as threads settle after creation. Archived-thread events
 * arrive as removals too, each costing one count read.
 */
export function olderSettledCountKey(
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
  beforeMs: number,
  removedAt: ReadonlyMap<ThreadId, number>,
): string {
  let lastRemoval = 0;
  for (const sequence of removedAt.values()) lastRemoval = Math.max(lastRemoval, sequence);
  const rows: string[] = [];
  for (const thread of threads) {
    if (thread.lineage.relationshipToParent === "subagent") continue;
    const older = isOlderSettledThreadShell(thread, beforeMs);
    if (older || DateTime.toEpochMillis(thread.createdAt) < beforeMs) {
      rows.push(`${thread.id}:${older ? 1 : 0}`);
    }
  }
  return `${lastRemoval}|${rows.sort().join(",")}`;
}

/** Whether a row sits at or above a page cursor in the server's order (settle time desc, id asc). */
export function atOrAboveCursor(
  thread: Pick<OrchestrationV2ThreadShell, "id" | "settledAt">,
  cursor: OrchestrationV2OlderSettledCursor,
): boolean {
  if (thread.settledAt === null) return true;
  const settledAt = DateTime.formatIso(thread.settledAt);
  return !(
    settledAt < cursor.settledAt ||
    (cursor.threadId !== undefined && settledAt === cursor.settledAt && thread.id > cursor.threadId)
  );
}

/**
 * Where a shelf over these environments stops listing: the highest frontier of any environment
 * that can still load older threads (its cut until its first page). Rows below it could sort under
 * rows not loaded yet, so the merged list is a correct prefix even while a page loads. A failed
 * environment holds no one back; its Retry rejoins it.
 */
export function settledShelfFrontier(
  environments: ReadonlyArray<OlderSettledShelfEnvironment>,
): OrchestrationV2OlderSettledCursor | null {
  let highest: OrchestrationV2OlderSettledCursor | null = null;
  for (const { older, pages } of environments) {
    if (older === null || pages.frontier === null || pages.status === "failed") continue;
    const frontier = pages.frontier;
    // On a settle-time tie, a cursor with an id stops above one without, and a smaller id higher.
    if (
      highest === null ||
      frontier.settledAt > highest.settledAt ||
      (frontier.settledAt === highest.settledAt &&
        frontier.threadId !== undefined &&
        (highest.threadId === undefined || frontier.threadId < highest.threadId))
    ) {
      highest = frontier;
    }
  }
  return highest;
}

/**
 * Whether the Settled shelf may list a row: at or above the shelf's frontier. So a row that turns
 * older mid-session (a backdated auto-settle, a snooze that ends, an unarchive) waits for the
 * range that holds it.
 */
export function isListedSettledThread(
  thread: Pick<OrchestrationV2ThreadShell, "id" | "settledAt">,
  frontier: OrchestrationV2OlderSettledCursor | null,
): boolean {
  return frontier === null || atOrAboveCursor(thread, frontier);
}

/**
 * Older settled threads in scope that this client does not hold: the server's counts minus the
 * older rows it has. Add it to the local rows for the Settled label or a project's thread count.
 */
export function unloadedOlderSettledCount(input: {
  readonly olderSettled: (environmentId: EnvironmentId) => OlderSettled | null;
  readonly scopes: ReadonlyArray<OlderSettledScope>;
  /** Every row the client holds in scope, in any section. */
  readonly threads: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly source: OlderSettledRow;
  }>;
}): number {
  let unloaded = 0;
  for (const scope of input.scopes) {
    const older = input.olderSettled(scope.environmentId);
    if (older === null) continue;
    if (scope.projectIds === null) {
      for (const count of older.counts.values()) unloaded += count;
    } else {
      for (const projectId of scope.projectIds) unloaded += older.counts.get(projectId) ?? 0;
    }
    for (const thread of input.threads) {
      if (
        thread.environmentId === scope.environmentId &&
        (scope.projectIds === null || scope.projectIds.includes(thread.source.projectId)) &&
        isOlderSettledThreadShell(thread.source, older.beforeMs)
      ) {
        unloaded -= 1;
      }
    }
  }
  return Math.max(0, unloaded);
}

/**
 * The pages each environment should read: while the shelf lists fewer than `visibleCount` rows,
 * one more for each environment whose frontier is the shelf's, once its pages have loaded. A
 * short page ends an environment's chain; counts can lag a backdated settle, so they do not gate.
 */
export function wantedOlderSettledPages(input: {
  readonly requested: ReadonlyMap<EnvironmentId, number>;
  readonly environments: ReadonlyMap<EnvironmentId, OlderSettledShelfEnvironment>;
  readonly listedCount: number;
  readonly visibleCount: number;
}): ReadonlyMap<EnvironmentId, number> {
  if (input.listedCount >= input.visibleCount) return input.requested;
  const frontier = settledShelfFrontier([...input.environments.values()]);
  if (frontier === null) return input.requested;
  let next: Map<EnvironmentId, number> | null = null;
  for (const [environmentId, { older, pages }] of input.environments) {
    if (older === null || pages.status !== "ready" || pages.frontier === null) continue;
    if (
      pages.frontier.settledAt !== frontier.settledAt ||
      pages.frontier.threadId !== frontier.threadId
    ) {
      continue;
    }
    next ??= new Map(input.requested);
    next.set(environmentId, (input.requested.get(environmentId) ?? 0) + 1);
  }
  return next ?? input.requested;
}
