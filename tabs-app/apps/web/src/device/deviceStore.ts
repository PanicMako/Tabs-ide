import type { DeviceServiceState, NativeApi } from "@tabs/contracts";
import { create, useStore } from "zustand";

type DeviceApi = NativeApi["device"];

interface DeviceStoreState {
  /** Latest server snapshot; null until the first one arrives. */
  readonly state: DeviceServiceState | null;
  readonly error: string | null;
  readonly refreshing: boolean;
  readonly setState: (state: DeviceServiceState) => void;
  readonly setError: (error: string | null) => void;
  readonly setRefreshing: (refreshing: boolean) => void;
}

const createDeviceStore = () =>
  create<DeviceStoreState>()((set) => ({
    state: null,
    error: null,
    refreshing: false,
    setState: (state) => set({ state, error: null }),
    setError: (error) => set({ error }),
    setRefreshing: (refreshing) => set({ refreshing }),
  }));

export const useDeviceStore = createDeviceStore();
const environmentStores = new WeakMap<DeviceApi, typeof useDeviceStore>();

function storeFor(api?: DeviceApi | null) {
  if (!api?.mediaOrigin) return useDeviceStore;
  let store = environmentStores.get(api);
  if (!store) {
    store = createDeviceStore();
    environmentStores.set(api, store);
  }
  return store;
}

export function useDeviceState<T>(
  api: DeviceApi | null | undefined,
  select: (state: DeviceStoreState) => T,
): T {
  return useStore(storeFor(api), select);
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Device request failed.";

/** Newer revisions win; a replayed older snapshot never overwrites a newer one. */
export function acceptDeviceState(next: DeviceServiceState, api?: DeviceApi): void {
  const current = storeFor(api).getState().state;
  if (current && next.revision < current.revision) return;
  storeFor(api).getState().setState(next);
}

/** Starts streaming device state. Does not boot, install or start anything. */
export function startDeviceStateSubscription(api: DeviceApi): () => void {
  return api.subscribe(
    (next) => acceptDeviceState(next, api),
    (error) => storeFor(api).getState().setError(errorMessage(error)),
  );
}

/** Runs a device command, folding its result into the store and surfacing failure text. */
async function run<T>(api: DeviceApi, task: () => Promise<T>): Promise<T | null> {
  try {
    const result = await task();
    storeFor(api).getState().setError(null);
    return result;
  } catch (error) {
    storeFor(api).getState().setError(errorMessage(error));
    return null;
  }
}

/** Reads inventory only; never installs tools or starts helpers. */
export async function inspectDevices(api: DeviceApi): Promise<void> {
  storeFor(api).getState().setRefreshing(true);
  const result = await run(api, () => api.list({ inspectOnly: true }));
  if (result) acceptDeviceState(result, api);
  storeFor(api).getState().setRefreshing(false);
}

export async function refreshDevices(api: DeviceApi): Promise<void> {
  storeFor(api).getState().setRefreshing(true);
  const result = await run(api, () => api.list({}));
  if (result) acceptDeviceState(result, api);
  storeFor(api).getState().setRefreshing(false);
}

export async function configureDevices(
  api: DeviceApi,
  input: Parameters<DeviceApi["configure"]>[0],
): Promise<boolean> {
  const result = await run(api, () => api.configure(input));
  if (result) acceptDeviceState(result, api);
  return result !== null;
}

export function openDevice(api: DeviceApi, input: Parameters<DeviceApi["open"]>[0]) {
  return run(api, () => api.open(input));
}

export function closeDevice(api: DeviceApi, input: Parameters<DeviceApi["close"]>[0]) {
  return run(api, () => api.close(input));
}

export function shutdownDevice(api: DeviceApi, input: Parameters<DeviceApi["shutdown"]>[0]) {
  return run(api, () => api.shutdown(input));
}

export function readDeviceDetail(api: DeviceApi, input: Parameters<DeviceApi["detail"]>[0]) {
  return run(api, () => api.detail(input));
}

export function runDeviceAction(api: DeviceApi, input: Parameters<DeviceApi["action"]>[0]) {
  return run(api, () => api.action(input));
}
