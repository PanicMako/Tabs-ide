import type { EnvironmentId, NativeApi, ServerConfig } from "@tabs/contracts";

import { createWsNativeApi } from "../wsNativeApi";
import { WsTransport } from "../wsTransport";
import { ensureNativeApi } from "../nativeApi";
import { resolveManualConnectionSocketUrl } from "./manualConnections";

interface EnvironmentApiEntry {
  readonly api: NativeApi;
  readonly transport: WsTransport | null;
  config: ServerConfig;
}

export type EnvironmentApiRegistryEvent =
  | {
      readonly type: "connected";
      readonly environmentId: EnvironmentId;
      readonly api: NativeApi;
      readonly primary: boolean;
    }
  | { readonly type: "disconnected"; readonly environmentId: EnvironmentId };

const entries = new Map<string, EnvironmentApiEntry>();
const listeners = new Set<(event: EnvironmentApiRegistryEvent) => void>();
let primaryEnvironmentId: string | null = null;

function emit(event: EnvironmentApiRegistryEvent): void {
  for (const listener of listeners) listener(event);
}

export function onEnvironmentApiRegistryEvent(
  listener: (event: EnvironmentApiRegistryEvent) => void,
): () => void {
  listeners.add(listener);
  for (const [environmentId, entry] of entries) {
    listener({
      type: "connected",
      environmentId: environmentId as EnvironmentId,
      api: entry.api,
      primary: environmentId === primaryEnvironmentId,
    });
  }
  return () => listeners.delete(listener);
}

export async function initializePrimaryEnvironmentApi(): Promise<EnvironmentId> {
  const api = ensureNativeApi();
  const config = await api.server.getConfig();
  const environmentId = config.environment.environmentId;
  primaryEnvironmentId = environmentId;
  entries.set(environmentId, { api, transport: null, config });
  emit({ type: "connected", environmentId, api, primary: true });
  return environmentId;
}

export async function connectEnvironmentApi(environmentId: string): Promise<NativeApi> {
  const existing = entries.get(environmentId);
  if (existing) return existing.api;
  const refreshUrl = () => resolveManualConnectionSocketUrl(environmentId);
  const transport = new WsTransport({
    url: await refreshUrl(),
    environmentId,
    refreshUrl,
  });
  const api = createWsNativeApi({ transport, singleton: false });
  const config = await api.server.getConfig();
  if (config.environment.environmentId !== environmentId) {
    transport.dispose();
    throw new Error(
      `Environment identity mismatch: expected ${environmentId}, received ${config.environment.environmentId}.`,
    );
  }
  entries.set(environmentId, { api, transport, config });
  emit({ type: "connected", environmentId: environmentId as EnvironmentId, api, primary: false });
  return api;
}

export async function environmentApi(environmentId?: string | null): Promise<NativeApi> {
  const target = environmentId ?? primaryEnvironmentId ?? (await initializePrimaryEnvironmentApi());
  return entries.get(target)?.api ?? connectEnvironmentApi(target);
}

export function environmentConfig(environmentId: string): ServerConfig | null {
  return entries.get(environmentId)?.config ?? null;
}

export function connectedEnvironmentIds(): ReadonlyArray<string> {
  return [...entries.keys()];
}

export function isPrimaryEnvironment(environmentId?: string): boolean {
  return (
    environmentId === undefined ||
    (primaryEnvironmentId !== null && environmentId === primaryEnvironmentId)
  );
}

export function disconnectEnvironmentApi(environmentId: string): void {
  if (environmentId === primaryEnvironmentId) return;
  const entry = entries.get(environmentId);
  entry?.transport?.dispose();
  entries.delete(environmentId);
  emit({ type: "disconnected", environmentId: environmentId as EnvironmentId });
}
