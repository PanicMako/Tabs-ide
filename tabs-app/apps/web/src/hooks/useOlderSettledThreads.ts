import { useEffect, useCallback } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useQuery } from "@tanstack/react-query";
import type { EnvironmentId, ProjectId } from "@tabs/contracts";
import { environmentApi } from "../connection/environmentApiRegistry";
import { appAtomRegistry } from "../state/atomRegistry";
import { readModelStateAtom } from "../state/readModel";
import {
  applyOlderSettledCounts,
  applyOlderSettledPage,
  isOlderSettledClientThread,
  olderSettledPageState,
  updateOlderSettledPageState,
} from "../state/readModelTransitions";

const PAGE_SIZE = 25;

export async function loadOlderSettledThreads(environmentId: EnvironmentId, projectId: ProjectId) {
  const state = appAtomRegistry.get(readModelStateAtom);
  const history = state.environmentSnapshots?.[environmentId]?.olderSettled;
  const pageState = olderSettledPageState(state, environmentId, projectId);
  if (!history || !pageState?.cursor || pageState.loading) return;
  const generation = history.generation;
  const cursor = pageState.cursor;
  appAtomRegistry.update(readModelStateAtom, (current) =>
    updateOlderSettledPageState(current, environmentId, projectId, generation, {
      loading: true,
      error: null,
    }),
  );
  try {
    const api = await environmentApi(environmentId);
    const page = await api.orchestration.getOlderSettledThreads({
      before: cursor,
      projectIds: [projectId],
      limit: PAGE_SIZE,
    });
    appAtomRegistry.update(readModelStateAtom, (current) =>
      applyOlderSettledPage(current, {
        environmentId,
        projectId,
        generation,
        cursor,
        page,
        limit: PAGE_SIZE,
      }),
    );
  } catch (cause) {
    appAtomRegistry.update(readModelStateAtom, (current) =>
      updateOlderSettledPageState(current, environmentId, projectId, generation, {
        loading: false,
        error: cause instanceof Error ? cause.message : String(cause),
      }),
    );
  }
}

export function useOlderSettledThreads(
  environmentId: EnvironmentId | undefined,
  projectId: ProjectId,
  search = "",
) {
  const state = useAtomValue(readModelStateAtom);
  const history = environmentId
    ? state.environmentSnapshots?.[environmentId]?.olderSettled
    : undefined;
  const generation = history?.generation;
  const revision = history?.countRevision;
  const countsPending = history !== undefined && history.countsRevision !== history.countRevision;
  const counts = useQuery({
    queryKey: ["older-settled-counts", environmentId, generation, revision],
    enabled: Boolean(environmentId && history && countsPending),
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      if (!environmentId || !history) throw new Error("Conversation history is unavailable.");
      const api = await environmentApi(environmentId);
      return api.orchestration.getOlderSettledThreads({
        before: { settledAt: history.before },
        limit: 0,
      });
    },
  });
  const countsSnapshotTooOld =
    counts.data !== undefined &&
    generation !== undefined &&
    counts.data.snapshotSequence < generation;
  useEffect(() => {
    if (
      !countsPending ||
      !counts.data ||
      countsSnapshotTooOld ||
      !environmentId ||
      generation === undefined ||
      revision === undefined
    )
      return;
    const refreshed = counts.data.counts;
    appAtomRegistry.update(readModelStateAtom, (current) =>
      applyOlderSettledCounts(current, environmentId, generation, revision, refreshed),
    );
  }, [counts.data, countsPending, countsSnapshotTooOld, environmentId, generation, revision]);
  const page = environmentId ? olderSettledPageState(state, environmentId, projectId) : null;
  const loaded = history
    ? state.threads.filter(
        (thread) =>
          thread.environmentId === environmentId &&
          thread.projectId === projectId &&
          isOlderSettledClientThread(thread, history.before),
      ).length
    : 0;
  const unloaded = Math.max(
    0,
    (history?.counts.find((entry) => entry.projectId === projectId)?.count ?? 0) - loaded,
  );
  const loadMore = useCallback(() => {
    if (environmentId) void loadOlderSettledThreads(environmentId, projectId);
  }, [environmentId, projectId]);
  // Searching needs every metadata row. Read bounded pages on demand and report
  // progress until the search covers the entire project; no transcript bodies are read.
  useEffect(() => {
    if (
      search.trim() &&
      unloaded > 0 &&
      page?.cursor &&
      !page.loading &&
      !page.error &&
      !countsPending
    )
      loadMore();
  }, [search, unloaded, page?.cursor, page?.loading, page?.error, countsPending, loadMore]);
  return {
    unloaded,
    loading: page?.loading ?? false,
    hasMore: page?.cursor != null && unloaded > 0,
    error:
      page?.error ??
      (countsPending && (counts.isError || countsSnapshotTooOld)
        ? "Could not refresh history counts."
        : null),
    countsPending,
    loadMore,
    retry: () => (countsPending ? void counts.refetch() : loadMore()),
  };
}
