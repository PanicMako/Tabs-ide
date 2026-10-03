import { useDebouncedValue } from "@tanstack/react-pacer";
import { useQuery } from "@tanstack/react-query";
import type { EnvironmentId, ProjectContentMatch } from "@tabs/contracts";
import { projectSearchContentsQueryOptions } from "../lib/projectReactQuery";

export const PROJECT_CONTENT_SEARCH_DEBOUNCE_MS = 120;
export const PROJECT_CONTENT_SEARCH_LIMIT = 500;
const EMPTY_CONTENT_MATCHES: ReadonlyArray<ProjectContentMatch> = [];

export interface ProjectContentSearchTarget {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly useRegex: boolean;
}

export function useProjectContentSearch(target: ProjectContentSearchTarget) {
  const query = target.query;
  const hasQuery = query.trim().length > 0;
  const [debouncedQuery, debouncer] = useDebouncedValue(
    query,
    { wait: PROJECT_CONTENT_SEARCH_DEBOUNCE_MS },
    (state) => ({ isPending: state.isPending }),
  );

  const shouldFetch = target.cwd !== null && hasQuery && debouncedQuery.trim().length > 0;

  const searchQuery = useQuery(
    projectSearchContentsQueryOptions({
      environmentId: target.environmentId,
      cwd: target.cwd,
      query: debouncedQuery,
      caseSensitive: target.caseSensitive,
      wholeWord: target.wholeWord,
      useRegex: target.useRegex,
      limit: PROJECT_CONTENT_SEARCH_LIMIT,
      enabled: shouldFetch,
    }),
  );

  return {
    matches: searchQuery.data?.matches ?? EMPTY_CONTENT_MATCHES,
    error: searchQuery.error ? ((searchQuery.error as Error).message ?? "Search failed") : null,
    isPending: hasQuery && (debouncer.state.isPending || searchQuery.isFetching),
    hasQuery,
    truncated: searchQuery.data?.truncated ?? false,
    invalidRegex: target.useRegex && searchQuery.data?.regexFallbackError !== undefined,
  };
}
