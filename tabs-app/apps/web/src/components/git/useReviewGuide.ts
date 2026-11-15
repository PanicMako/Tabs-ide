import type { NativeApi, PullRequestRef, PullRequestReviewGuideResult } from "@tabs/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

const POLL_WHILE_WRITING_MS = 3_000;

/**
 * A pull request's review guide: what is stored, whether one is being written, and the press
 * that starts a run. While a run is going the read repeats until the guide lands or the run fails.
 */
export function useReviewGuide(input: {
  readonly api: NativeApi | null;
  readonly reference: PullRequestRef | null;
  readonly enabled: boolean;
}) {
  const { api, reference, enabled } = input;
  const queryClient = useQueryClient();
  const key = useMemo(
    () => [
      "git",
      "review-guide",
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
    queryFn: () => api!.pullRequests.reviewGuide(reference!),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: false,
    refetchInterval: (current) =>
      current.state.data?.run?._tag === "Running" ? POLL_WHILE_WRITING_MS : false,
  });
  const generate = useMutation({
    mutationFn: () => api!.pullRequests.generateReviewGuide(reference!),
    onSuccess: (result) => queryClient.setQueryData<PullRequestReviewGuideResult>(key, result),
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error ?? generate.error,
    writing: generate.isPending || query.data?.run?._tag === "Running",
    write: () => {
      if (api !== null && reference !== null) generate.mutate();
    },
  };
}
