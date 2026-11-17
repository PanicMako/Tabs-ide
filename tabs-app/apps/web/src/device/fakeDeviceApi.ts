import type {
  DeviceDetail,
  DeviceHostId,
  DeviceServiceState,
  DeviceSummary,
  NativeApi,
} from "@tabs/contracts";

type DeviceApi = NativeApi["device"];

const host = (id: string, label: string) => ({
  id: id as DeviceHostId,
  kind: "local" as const,
  label,
  platforms: [
    { platform: "ios" as const, available: true },
    { platform: "android" as const, available: false, reason: "No Android SDK found." },
  ],
  hubInstalled: true,
  agentDeviceInstalled: false,
});

export const fakeDevice = (overrides: Partial<DeviceSummary> = {}): DeviceSummary =>
  ({
    hostId: "local",
    id: "SIM-1",
    platform: "ios",
    name: "iPhone 16",
    version: "iOS 18.0",
    booted: true,
    physical: false,
    ...overrides,
  }) as DeviceSummary;

export const fakeDeviceState = (overrides: Partial<DeviceServiceState> = {}): DeviceServiceState =>
  ({
    hosts: [host("local", "This machine")],
    hostStatus: "ready",
    hostStatuses: {},
    devices: [fakeDevice()],
    sessions: [],
    onboardingCompleted: true,
    agentAccessEnabled: false,
    hubBasePath: "/device-hub",
    revision: 1,
    ...overrides,
  }) as DeviceServiceState;

export const fakeDeviceDetail = (overrides: Partial<DeviceDetail> = {}): DeviceDetail =>
  ({
    hostId: "local",
    deviceId: "SIM-1",
    settings: { appearance: "light", textSize: "default" },
    foregroundApp: null,
    readAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }) as DeviceDetail;

/** A recording fake for the device API. Never touches a real simulator. */
export function createFakeDeviceApi(initial: DeviceServiceState = fakeDeviceState()) {
  let state = initial;
  const listeners = new Set<(state: DeviceServiceState) => void>();
  const calls: Array<{ method: string; input: unknown }> = [];
  const record = <T>(method: string, input: unknown, value: T) => {
    calls.push({ method, input });
    return Promise.resolve(value);
  };
  const push = (next: DeviceServiceState) => {
    state = next;
    for (const listener of listeners) listener(state);
  };
  const api: DeviceApi = {
    list: (input) => record("list", input, state),
    configure: (input) => {
      calls.push({ method: "configure", input });
      push({ ...state, ...input, revision: state.revision + 1 } as DeviceServiceState);
      return Promise.resolve(state);
    },
    testHost: (input) => record("testHost", input, state.hosts[0]!),
    open: (input) =>
      record("open", input, {
        threadId: input.threadId,
        hostId: (input.hostId ?? "local") as DeviceHostId,
        deviceId: input.deviceId,
        platform: input.platform,
        openedAt: "2026-01-01T00:00:00.000Z",
      } as Awaited<ReturnType<DeviceApi["open"]>>),
    close: (input) => record("close", input, undefined),
    shutdown: (input) => record("shutdown", input, undefined),
    detail: (input) => record("detail", input, fakeDeviceDetail({ deviceId: input.deviceId })),
    action: (input) => record("action", input, fakeDeviceDetail({ deviceId: input.deviceId })),
    subscribe: (callback) => {
      listeners.add(callback);
      callback(state);
      return () => listeners.delete(callback);
    },
  };
  return { api, calls, push };
}
