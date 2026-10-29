import { useQuery } from "@tanstack/react-query";
import { gitResolvePullRequestQueryOptions } from "../lib/gitReactQuery";
/** Share one cached branch lookup between the composer and workspace card.
 * A checkout can have a PR even when the lightweight Git status omits it. */
export function useCheckoutPullRequest(
  cwd: string | null,
  branch: string | null,
  environmentId?: string,
) {
  return useQuery({
    ...gitResolvePullRequestQueryOptions({ cwd, reference: branch, environmentId }),
    retry: false,
    staleTime: 60_000,
  });
}
