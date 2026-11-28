// Minimal device stream client. iOS shows serve-sim's MJPEG feed and sends input over its
// tagged-JSON socket; Android polls still frames and sends input over serve-emu's JSON socket.
// WebCodecs/AVCC video, WebRTC and the 3D/Duo viewers are not ported yet.
import type { DeviceComparisonGesture, DevicePlatform } from "@tabs/contracts";

export interface DeviceHubAccess {
  readonly httpBase: string;
  readonly wsBase: string;
  readonly query: Readonly<Record<string, string>>;
  readonly credentials: boolean;
  readonly authorize?: ((url: string) => Promise<string>) | undefined;
}

/** Same-origin access: the page is served by the environment server, so cookies authenticate. */
export function sameOriginHubAccess(
  location: { origin: string },
  hubBasePath: string,
  hostId?: string,
): DeviceHubAccess {
  const httpBase = `${location.origin}${hubBasePath}`;
  return {
    httpBase,
    wsBase: httpBase.replace(/^http/, "ws"),
    query: hostId === undefined ? {} : { hostId },
    credentials: true,
  };
}

export const withHubQuery = (url: string, access: DeviceHubAccess): string => {
  const entries = Object.entries(access.query);
  if (entries.length === 0) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${new URLSearchParams(entries).toString()}`;
};

const vendorFor = (platform: DevicePlatform) =>
  platform === "ios" ? "/vendor/serve-sim" : "/vendor/serve-emu";

export const IOS_MSG_TOUCH = 0x03;
export const IOS_MSG_BUTTON = 0x04;
export const IOS_MSG_KEY = 0x06;
export const IOS_MSG_ORIENTATION = 0x07;
const IOS_MSG_SCREEN_CONFIG = 0x82;

export type DeviceButton = "home" | "back" | "recents" | "power";
export type DeviceTouchPhase = "begin" | "move" | "end";

const encoder = new TextEncoder();

export function taggedJson(tag: number, payload: unknown): Uint8Array<ArrayBuffer> {
  const json = encoder.encode(JSON.stringify(payload));
  const out = new Uint8Array(1 + json.length);
  out[0] = tag;
  out.set(json, 1);
  return out;
}

/** Wire message for a touch point (x, y normalized 0..1) on each platform. */
export function touchMessage(
  platform: DevicePlatform,
  phase: DeviceTouchPhase,
  x: number,
  y: number,
): Uint8Array<ArrayBuffer> | string {
  if (platform === "ios") return taggedJson(IOS_MSG_TOUCH, { type: phase, x, y });
  const action = phase === "begin" ? "down" : phase === "move" ? "move" : "up";
  return JSON.stringify({ type: "touch", action, x, y });
}

export function buttonMessage(
  platform: DevicePlatform,
  button: DeviceButton,
): Uint8Array<ArrayBuffer> | string | null {
  if (platform === "ios") {
    const name =
      button === "home"
        ? "home"
        : button === "recents"
          ? "app_switcher"
          : button === "power"
            ? "lock"
            : null;
    return name ? taggedJson(IOS_MSG_BUTTON, { button: name }) : null;
  }
  return JSON.stringify({ type: button });
}

const IOS_ORIENTATIONS = ["portrait", "landscape_left", "portrait_upside_down", "landscape_right"];
export const nextIosOrientation = (current: string) =>
  IOS_ORIENTATIONS[(IOS_ORIENTATIONS.indexOf(current) + 1) % IOS_ORIENTATIONS.length]!;

type AndroidKeycode = Extract<DeviceComparisonGesture, { type: "key" }>["keycode"];

const ANDROID_KEYCODES: Readonly<Partial<Record<string, AndroidKeycode>>> = {
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,
  Tab: 61,
  Enter: 66,
  Backspace: 67,
  Delete: 112,
};

/** Text and key messages for the Android input socket. */
export function androidKeyMessage(event: { key: string; metaKey?: boolean; ctrlKey?: boolean }) {
  const gesture = deviceKeyGesture("android", event);
  return gesture ? JSON.stringify(gesture) : null;
}

export function deviceKeyGesture(
  platform: DevicePlatform,
  event: { key: string; metaKey?: boolean; ctrlKey?: boolean },
): DeviceComparisonGesture | null {
  if (event.key === "Escape")
    return platform === "ios" ? { type: "key", keycode: 111 } : { type: "back" };
  const keycode = ANDROID_KEYCODES[event.key];
  if (keycode !== undefined) return { type: "key", keycode };
  if (event.key.length === 1 && !event.metaKey && !event.ctrlKey)
    return { type: "text", text: event.key };
  return null;
}

export interface DeviceStreamHandle {
  /** MJPEG url for iOS; null on Android, which uses `stillUrl`. */
  readonly videoUrl: string | null;
  readonly stillUrl: string;
  readonly screenshotUrl: string;
  readonly send: (message: string | Uint8Array<ArrayBuffer>) => void;
  readonly sendTouch: (phase: DeviceTouchPhase, x: number, y: number) => void;
  readonly pressButton: (button: DeviceButton) => void;
  readonly sendKey: (event: { key: string; metaKey?: boolean; ctrlKey?: boolean }) => void;
  readonly rotate: (current: string) => void;
  readonly close: () => void;
}

export interface DeviceStreamOptions {
  readonly platform: DevicePlatform;
  readonly deviceId: string;
  readonly access: DeviceHubAccess;
  readonly onInputConnected: (connected: boolean) => void;
  readonly createSocket?: (url: string) => WebSocket;
}

const RETRY_MS = 1_000;

/** Opens the input socket (reconnecting until closed) and returns the media URLs. */
export function createDeviceStream(options: DeviceStreamOptions): DeviceStreamHandle {
  const { platform, deviceId, access } = options;
  const device = encodeURIComponent(deviceId);
  const vendor = vendorFor(platform);
  const http = (path: string) => withHubQuery(`${access.httpBase}${vendor}${path}`, access);
  const wsUrl = withHubQuery(
    platform === "ios"
      ? `${access.wsBase}${vendor}/helper/ws?device=${device}`
      : `${access.wsBase}${vendor}/ws?device=${device}&video=0`,
    access,
  );
  let socket: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    if (closed) return;
    if (access.authorize) {
      void access
        .authorize(wsUrl)
        .then(open)
        .catch(() => {
          options.onInputConnected(false);
          if (!closed) retry = setTimeout(connect, RETRY_MS);
        });
    } else open(wsUrl);
  };
  const open = (url: string) => {
    if (closed) return;
    const ws = (options.createSocket ?? ((value) => new WebSocket(value)))(url);
    ws.binaryType = "arraybuffer";
    socket = ws;
    ws.onopen = () => {
      if (platform === "android" && socket === ws) options.onInputConnected(true);
    };
    ws.onmessage = (event) => {
      // The serve-sim HID socket sends its screen config once the helper is ready.
      if (platform === "ios" && socket === ws && event.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(event.data);
        if (bytes[0] === IOS_MSG_SCREEN_CONFIG) options.onInputConnected(true);
      }
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      options.onInputConnected(false);
      if (!closed) retry = setTimeout(connect, RETRY_MS);
    };
    ws.onerror = () => ws.close();
  };
  connect();
  const send = (message: string | Uint8Array<ArrayBuffer>) => {
    if (socket?.readyState === 1) socket.send(message);
  };
  return {
    videoUrl: platform === "ios" ? http(`/helper/${device}/stream.mjpeg`) : null,
    stillUrl: http(`/api/screenshot?device=${device}`),
    screenshotUrl: http(`/api/screenshot?device=${device}`),
    send,
    sendTouch: (phase, x, y) => send(touchMessage(platform, phase, x, y)),
    pressButton: (button) => {
      const message = buttonMessage(platform, button);
      if (message) send(message);
    },
    sendKey: (event) => {
      if (platform !== "android") return;
      const message = androidKeyMessage(event);
      if (message) send(message);
    },
    rotate: (current) => {
      if (platform === "ios")
        send(taggedJson(IOS_MSG_ORIENTATION, { orientation: nextIosOrientation(current) }));
    },
    close: () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
      socket = null;
    },
  };
}

/** Fetches a PNG of the device screen through the hub. */
export async function captureDeviceScreenshot(
  stream: Pick<DeviceStreamHandle, "screenshotUrl">,
  access: DeviceHubAccess,
  signal?: AbortSignal,
): Promise<Blob> {
  const url = access.authorize
    ? await access.authorize(stream.screenshotUrl)
    : stream.screenshotUrl;
  const response = await fetch(url, {
    method: "POST",
    credentials: access.credentials ? "include" : "omit",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`Screenshot capture failed (${response.status}). Try again.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  // The hub may prefix the PNG with metadata; keep from the PNG signature on.
  const signature = [0x89, 0x50, 0x4e, 0x47];
  let start = 0;
  for (; start + 4 <= bytes.length; start++) {
    if (signature.every((value, offset) => bytes[start + offset] === value)) break;
  }
  if (start + 4 > bytes.length) throw new Error("The device returned an incomplete screenshot.");
  return new Blob([bytes.subarray(start)], { type: "image/png" });
}
