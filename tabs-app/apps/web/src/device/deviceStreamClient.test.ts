import { describe, expect, it, vi } from "vitest";
import {
  androidKeyMessage,
  buttonMessage,
  createDeviceStream,
  deviceKeyGesture,
  nextIosOrientation,
  sameOriginHubAccess,
  taggedJson,
  touchMessage,
  withHubQuery,
} from "./deviceStreamClient";

class FakeSocket {
  static last: FakeSocket | null = null;
  readyState = 1;
  binaryType = "";
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe("device stream wire format", () => {
  it("encodes iOS touch and buttons as tagged JSON and Android as plain JSON", () => {
    const ios = touchMessage("ios", "begin", 0.5, 0.25) as Uint8Array;
    expect(ios[0]).toBe(0x03);
    expect(JSON.parse(new TextDecoder().decode(ios.subarray(1)))).toEqual({
      type: "begin",
      x: 0.5,
      y: 0.25,
    });
    expect(JSON.parse(touchMessage("android", "end", 0.1, 0.2) as string)).toEqual({
      type: "touch",
      action: "up",
      x: 0.1,
      y: 0.2,
    });
    expect(buttonMessage("android", "back")).toBe('{"type":"back"}');
    expect(buttonMessage("ios", "back")).toBeNull();
    expect(taggedJson(1, {})[0]).toBe(1);
  });

  it("maps typed keys for Android and cycles iOS orientation", () => {
    expect(androidKeyMessage({ key: "Enter" })).toBe('{"type":"key","keycode":66}');
    expect(androidKeyMessage({ key: "a" })).toBe('{"type":"text","text":"a"}');
    expect(androidKeyMessage({ key: "a", metaKey: true })).toBeNull();
    expect(nextIosOrientation("portrait")).toBe("landscape_left");
  });

  it("uses Escape as a keyboard key during iOS takeover", () => {
    expect(deviceKeyGesture("ios", { key: "Escape" })).toEqual({ type: "key", keycode: 111 });
    expect(deviceKeyGesture("android", { key: "Escape" })).toEqual({ type: "back" });
  });

  it("builds hub URLs and appends ticket queries", () => {
    const access = sameOriginHubAccess({ origin: "http://localhost:3773" }, "/device-hub");
    expect(access.wsBase).toBe("ws://localhost:3773/device-hub");
    expect(withHubQuery("http://x/a?b=1", { ...access, query: { wsTicket: "t" } })).toBe(
      "http://x/a?b=1&wsTicket=t",
    );
  });
});

describe("createDeviceStream", () => {
  it.each(["ios", "android"] as const)(
    "pins every %s stream request to the selected host",
    (platform) => {
      for (const hostId of ["local", "lab / east"]) {
        const stream = createDeviceStream({
          platform,
          deviceId: "same-id",
          access: sameOriginHubAccess({ origin: "http://localhost:1" }, "/hub", hostId),
          onInputConnected: vi.fn(),
          createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
        });
        const urls = [stream.screenshotUrl, stream.stillUrl, FakeSocket.last!.url];
        if (stream.videoUrl) urls.push(stream.videoUrl);
        for (const url of urls) expect(new URL(url).searchParams.get("hostId")).toBe(hostId);
        stream.close();
      }
    },
  );

  it("opens the platform socket, reports input admission, and sends through it", () => {
    const connected = vi.fn();
    const stream = createDeviceStream({
      platform: "ios",
      deviceId: "UDID 1",
      access: sameOriginHubAccess({ origin: "http://localhost:1" }, "/hub"),
      onInputConnected: connected,
      createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
    });
    const socket = FakeSocket.last!;
    expect(socket.url).toBe("ws://localhost:1/hub/vendor/serve-sim/helper/ws?device=UDID%201");
    expect(stream.videoUrl).toContain("/helper/UDID%201/stream.mjpeg");
    socket.onopen?.();
    socket.onmessage?.({ data: new Uint8Array([0x83]).buffer });
    expect(connected).not.toHaveBeenCalled();
    socket.onmessage?.({
      data: taggedJson(0x82, { width: 1178, height: 2556, orientation: "portrait" }).buffer,
    });
    expect(connected).toHaveBeenLastCalledWith(true);
    stream.pressButton("home");
    expect(socket.sent).toHaveLength(1);
    stream.close();
    expect(connected).toHaveBeenLastCalledWith(false);
    socket.onmessage?.({ data: new Uint8Array([0x82]).buffer });
    expect(connected).toHaveBeenLastCalledWith(false);
  });
});
