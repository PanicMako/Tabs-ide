import {
  CONFIGURED_LOCAL_SERVER_URLS_MAX_ITEMS,
  PREVIEW_URL_MAX_LENGTH,
  type DiscoveredLocalServer,
  type DiscoveredLocalServerList,
  type EnvironmentId,
  type ThreadId,
} from "@tabs/contracts";
import { isLoopbackHost } from "@tabs/shared/preview";
import { useEffect, useMemo, useState } from "react";
import { readNativeApi } from "./nativeApi";

const EMPTY_PORTS: ReadonlyArray<DiscoveredLocalServer> = Object.freeze([]);

export interface DiscoveredPortsState {
  readonly servers: ReadonlyArray<DiscoveredLocalServer>;
  readonly configuredUrlProbing: boolean;
}

export function boundConfiguredLocalServerUrls(
  urls: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> {
  const bounded: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls ?? []) {
    if (raw.length === 0 || raw.length > PREVIEW_URL_MAX_LENGTH || raw.trim().length !== raw.length)
      continue;
    try {
      const url = new URL(raw);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      if (!isLoopbackHost(url.hostname) || url.href.length > PREVIEW_URL_MAX_LENGTH) continue;
      url.hash = "";
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      bounded.push(url.href);
      if (bounded.length >= CONFIGURED_LOCAL_SERVER_URLS_MAX_ITEMS) break;
    } catch {
      // Invalid and non-local project preview URLs are not discovery candidates.
    }
  }
  return bounded;
}

export function useDiscoveredPortsState(
  _environmentId: EnvironmentId | null,
  _configuredUrls?: ReadonlyArray<string>,
): DiscoveredPortsState {
  const [state, setState] = useState<DiscoveredLocalServerList>({
    servers: [],
    scannedAt: "",
    configuredUrlProbing: true,
  });

  useEffect(() => {
    const api = readNativeApi();
    if (!api?.preview?.subscribePorts) return;

    const unsubscribe = api.preview.subscribePorts((snapshot) => {
      setState(snapshot);
    });

    return unsubscribe;
  }, []);

  return useMemo(
    () => ({
      servers: state.servers ?? EMPTY_PORTS,
      configuredUrlProbing: state.configuredUrlProbing === true,
    }),
    [state.configuredUrlProbing, state.servers],
  );
}

export function useDiscoveredPorts(
  environmentId: EnvironmentId | null,
  configuredUrls?: ReadonlyArray<string>,
): ReadonlyArray<DiscoveredLocalServer> {
  return useDiscoveredPortsState(environmentId, configuredUrls).servers;
}

export function useThreadDiscoveredPorts(input: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
}): ReadonlyArray<DiscoveredLocalServer> {
  const ports = useDiscoveredPorts(input.environmentId);
  return useMemo(
    () =>
      input.threadId
        ? ports.filter((port) => port.terminal?.threadId === input.threadId)
        : EMPTY_PORTS,
    [input.threadId, ports],
  );
}
