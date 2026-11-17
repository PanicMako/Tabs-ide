import type { DeviceServiceState, NativeApi } from "@tabs/contracts";
import { create } from "zustand";

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

export const useDeviceStore = create<DeviceStoreState>()((set) => ({
  state: null,
  error: null,
  refreshing: false,
  setState: (state) => set({ state, error: null }),
  setError: (error) => set({ error }),
  setRefreshing: (refreshing) => set({ refreshing }),
}));

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Device request failed.";

/** Newer revisions win; a replayed older snapshot never overwrites a newer one. */
export function acceptDeviceState(next: DeviceServiceState): void {
  const current = useDeviceStore.getState().state;
  if (current && next.revision < current.revision) return;
  useDeviceStore.getState().setState(next);
}

/** Starts streaming device state. Does not boot, install or start anything. */
export function startDeviceStateSubscription(api: DeviceApi): () => void {
  return api.subscribe(acceptDeviceState, (error) =>
    useDeviceStore.getState().setError(errorMessage(error)),
  );
}

/** Runs a device command, folding its result into the store and surfacing failure text. */
async function run<T>(task: () => Promise<T>): Promise<T | null> {
  try {
    const result = await task();
    useDeviceStore.getState().setError(null);
    return result;
  } catch (error) {
    useDeviceStore.getState().setError(errorMessage(error));
    return null;
  }
}

/** Reads inventory only; never installs tools or starts helpers. */
export async function inspectDevices(api: DeviceApi): Promise<void> {
  useDeviceStore.getState().setRefreshing(true);
  const result = await run(() => api.list({ inspectOnly: true }));
  if (result) acceptDeviceState(result);
  useDeviceStore.getState().setRefreshing(false);
}

export async function refreshDevices(api: DeviceApi): Promise<void> {
  useDeviceStore.getState().setRefreshing(true);
  const result = await run(() => api.list({}));
  if (result) acceptDeviceState(result);
  useDeviceStore.getState().setRefreshing(false);
}

export async function configureDevices(
  api: DeviceApi,
  input: Parameters<DeviceApi["configure"]>[0],
): Promise<boolean> {
  const result = await run(() => api.configure(input));
  if (result) acceptDeviceState(result);
  return result !== null;
}

export function openDevice(api: DeviceApi, input: Parameters<DeviceApi["open"]>[0]) {
  return run(() => api.open(input));
}

export function closeDevice(api: DeviceApi, input: Parameters<DeviceApi["close"]>[0]) {
  return run(() => api.close(input));
}

export function shutdownDevice(api: DeviceApi, input: Parameters<DeviceApi["shutdown"]>[0]) {
  return run(() => api.shutdown(input));
}

export function readDeviceDetail(api: DeviceApi, input: Parameters<DeviceApi["detail"]>[0]) {
  return run(() => api.detail(input));
}

export function runDeviceAction(api: DeviceApi, input: Parameters<DeviceApi["action"]>[0]) {
  return run(() => api.action(input));
}
