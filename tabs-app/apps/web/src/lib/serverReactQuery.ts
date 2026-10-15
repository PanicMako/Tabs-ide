import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";
import { environmentApi } from "~/connection/environmentApiRegistry";

export const serverQueryKeys = {
  all: ["server"] as const,
  config: (environmentId?: string) =>
    environmentId
      ? (["server", "config", environmentId] as const)
      : (["server", "config"] as const),
};

/**
 * Server config query options.
 *
 * `staleTime` is kept short so that push-driven `invalidateQueries` calls in
 * the EventRouter always trigger a refetch, and so the query re-fetches when
 * the component re-mounts (e.g. navigating away from settings and back).
 */
export function serverConfigQueryOptions(environmentId?: string) {
  return queryOptions({
    queryKey: serverQueryKeys.config(environmentId),
    queryFn: async () => {
      const api = environmentId ? await environmentApi(environmentId) : ensureNativeApi();
      return api.server.getConfig();
    },
  });
}
