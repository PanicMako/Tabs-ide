import type { NativeApi, PullRequestFilesViewedResult, PullRequestRef } from "@tabs/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import {
  isFileViewed,
  isStaleViewedState,
  toFileViewedStates,
  withFileViewed,
} from "./pullRequestFilesViewed.logic";

export interface PullRequestFilesViewedView {
  /** False where the host cannot record views, so the page draws no boxes at all. */
  readonly enabled: boolean;
  readonly isViewed: (path: string) => boolean;
  readonly isStale: (path: string) => boolean;
  readonly setViewed: (path: string, viewed: boolean) => void;
  readonly truncated: boolean;
  readonly states: ReturnType<typeof toFileViewedStates>;
}

/**
 * T3's "viewed" ticks on a pull request's files. The host is the source of truth; a press shows
 * at once and is put back if the host refuses it.
 */
export function usePullRequestFilesViewed(input: {
  readonly api: NativeApi | null;
  readonly reference: PullRequestRef | null;
  readonly enabled: boolean;
}): PullRequestFilesViewedView {
  const { api, reference, enabled } = input;
  const queryClient = useQueryClient();
  const key = useMemo(
    () => [
      "git",
      "files-viewed",
      reference?.projectId ?? null,
      reference?.host ?? null,
      reference?.repository ?? null,
      reference?.number ?? null,
    ],
    [reference],
  );
  const query = useQuery({
    queryKey: key,
    enabled: enabled && api !== null && reference !== null,
    queryFn: () => api!.pullRequests.filesViewed(reference!),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: (press: { path: string; viewed: boolean }) =>
      api!.pullRequests.setFilesViewed({ ...reference!, files: [press] }),
    onMutate: async (press) => {
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<PullRequestFilesViewedResult>(key, (held) =>
        withFileViewed(held, press.path, press.viewed),
      );
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
  const states = useMemo(() => toFileViewedStates(query.data), [query.data]);
  const setViewed = useCallback(
    (path: string, viewed: boolean) => {
      if (api === null || reference === null) return;
      mutation.mutate({ path, viewed });
    },
    [api, reference, mutation],
  );
  return {
    // A host that errors on the read (no such store, no permission) shows no boxes.
    enabled: enabled && query.data !== undefined,
    isViewed: (path) => isFileViewed(path, states),
    isStale: (path) => isStaleViewedState(states?.get(path)),
    setViewed,
    truncated: query.data?.truncated === true,
    states,
  };
}
