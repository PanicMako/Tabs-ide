import { useQuery } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export function useSourceControlDiscovery() {
  return useQuery({
    queryKey: ["source-control-discovery"],
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.discoverSourceControl();
    },
    staleTime: 30_000,
  });
}
