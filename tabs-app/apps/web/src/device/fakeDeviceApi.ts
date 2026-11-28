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

export function fakeIosMjpegUrl(hubBasePath: string, hostId: string, deviceId: string): string {
  const url = new URL(
    `${hubBasePath}/vendor/serve-sim/helper/${encodeURIComponent(deviceId)}/stream.mjpeg`,
    window.location.origin,
  );
  url.searchParams.set("hostId", hostId);
  return url.href;
}

export async function fakeDeviceJpeg(
  width: number,
  height: number,
  color = "black",
): Promise<Uint8Array<ArrayBuffer>> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
  const jpeg = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not encode the device fixture as JPEG."));
    }, "image/jpeg");
  });
  return new Uint8Array(await jpeg.arrayBuffer());
}

export function createFakeMjpegStream() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(stream) {
      controller = stream;
    },
  });
  return {
    response: new Response(body, {
      headers: { "Content-Type": "multipart/x-mixed-replace; boundary=frame" },
    }),
    writeFrame(jpeg: Uint8Array) {
      controller.enqueue(
        encoder.encode(
          `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.byteLength}\r\n\r\n`,
        ),
      );
      controller.enqueue(jpeg);
      controller.enqueue(encoder.encode("\r\n"));
    },
    close() {
      controller.close();
    },
  };
}

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
    comparison: (input) => record("comparison", input, {}),
    subscribe: (callback) => {
      listeners.add(callback);
      callback(state);
      return () => listeners.delete(callback);
    },
  };
  return { api, calls, push };
}
