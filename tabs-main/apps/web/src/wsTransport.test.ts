import { WS_CHANNELS } from "@tabs/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WsTransport } from "./wsTransport";

type WsEventType = "open" | "message" | "close" | "error";
type WsListener = (event?: { data?: unknown }) => void;

const sockets: MockWebSocket[] = [];

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  readonly sent: string[] = [];
  private readonly listeners = new Map<WsEventType, Set<WsListener>>();

  constructor(readonly url: string) {
    sockets.push(this);
  }

  addEventListener(type: WsEventType, listener: WsListener) {
    const listeners = this.listeners.get(type) ?? new Set<WsListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close");
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open");
  }

  serverMessage(data: unknown) {
    this.emit("message", { data });
  }

  error() {
    this.emit("error", { data: undefined });
  }

  private emit(type: WsEventType, event?: { data?: unknown }) {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    for (const listener of listeners) {
      listener(event);
    }
  }
}

const originalWebSocket = globalThis.WebSocket;

function getSocket(): MockWebSocket {
  const socket = sockets.at(-1);
  if (!socket) {
    throw new Error("Expected a websocket instance");
  }
  return socket;
}

beforeEach(() => {
  sockets.length = 0;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { hostname: "localhost", port: "3020" },
      desktopBridge: undefined,
    },
  });

  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  vi.restoreAllMocks();
});

describe("WsTransport", () => {
  it("notifies connection listeners after every successful open", () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const transport = new WsTransport("ws://remote.example.test/ws");
    const unsubscribe = transport.onOpen(listener);
    getSocket().open();
    expect(listener).toHaveBeenCalledTimes(1);

    getSocket().close();
    vi.advanceTimersByTime(500);
    getSocket().open();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    transport.dispose();
    vi.useRealTimers();
  });

  it("reconnects its configured endpoint after system resume", () => {
    vi.useFakeTimers();
    const transport = new WsTransport("ws://remote.example.test/ws");
    const socket = getSocket();
    socket.open();

    transport.reconnectAfterSystemResume();
    vi.advanceTimersByTime(500);

    expect(sockets).toHaveLength(2);
    expect(getSocket().url).toBe("ws://remote.example.test/ws");
    transport.dispose();
    vi.useRealTimers();
  });

  it("refreshes an environment ticket before reconnecting", async () => {
    vi.useFakeTimers();
    const refreshUrl = vi.fn(async () => "ws://remote.example.test/fresh-ticket");
    const transport = new WsTransport({
      url: "ws://remote.example.test/initial-ticket",
      environmentId: "environment-remote",
      refreshUrl,
    });
    getSocket().open();
    getSocket().close();

    await vi.advanceTimersByTimeAsync(500);

    expect(refreshUrl).toHaveBeenCalledOnce();
    expect(getSocket().url).toBe("ws://remote.example.test/fresh-ticket");
    transport.dispose();
    vi.useRealTimers();
  });

  it("routes valid push envelopes to channel listeners", () => {
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();
    socket.open();

    const listener = vi.fn();
    transport.subscribe(WS_CHANNELS.serverConfigUpdated, listener);

    socket.serverMessage(
      JSON.stringify({
        type: "push",
        sequence: 1,
        channel: WS_CHANNELS.serverConfigUpdated,
        data: { issues: [], providers: [] },
      }),
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: "push",
      sequence: 1,
      channel: WS_CHANNELS.serverConfigUpdated,
      data: { issues: [], providers: [] },
    });

    transport.dispose();
  });

  it("resolves pending requests for valid response envelopes", async () => {
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();
    socket.open();

    const requestPromise = transport.request("projects.list");
    const sent = socket.sent.at(-1);
    if (!sent) {
      throw new Error("Expected request envelope to be sent");
    }

    const requestEnvelope = JSON.parse(sent) as { id: string };
    socket.serverMessage(
      JSON.stringify({
        id: requestEnvelope.id,
        result: { projects: [] },
      }),
    );

    await expect(requestPromise).resolves.toEqual({ projects: [] });

    transport.dispose();
  });

  it("drops malformed envelopes without crashing transport", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();
    socket.open();

    const listener = vi.fn();
    transport.subscribe(WS_CHANNELS.serverConfigUpdated, listener);

    socket.serverMessage("{ invalid-json");
    socket.serverMessage(
      JSON.stringify({
        type: "push",
        sequence: 2,
        channel: 42,
        data: { bad: true },
      }),
    );
    socket.serverMessage(
      JSON.stringify({
        type: "push",
        sequence: 3,
        channel: WS_CHANNELS.serverConfigUpdated,
        data: { issues: [], providers: [] },
      }),
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: "push",
      sequence: 3,
      channel: WS_CHANNELS.serverConfigUpdated,
      data: { issues: [], providers: [] },
    });
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenNthCalledWith(
      1,
      "Dropped inbound WebSocket envelope",
      expect.stringContaining("Expected property name or '}'"),
    );
    expect(warnSpy).toHaveBeenNthCalledWith(
      2,
      "Dropped inbound WebSocket envelope",
      expect.stringContaining('Expected "server.configUpdated"'),
    );

    transport.dispose();
  });

  it("queues requests until the websocket opens", async () => {
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();

    const requestPromise = transport.request("projects.list");
    expect(socket.sent).toHaveLength(0);

    socket.open();
    expect(socket.sent).toHaveLength(1);
    const requestEnvelope = JSON.parse(socket.sent[0] ?? "{}") as { id: string };
    socket.serverMessage(
      JSON.stringify({
        id: requestEnvelope.id,
        result: { projects: [] },
      }),
    );

    await expect(requestPromise).resolves.toEqual({ projects: [] });
    transport.dispose();
  });

  it("does not create a timeout for requests with timeoutMs null", async () => {
    const transport = new WsTransport("ws://localhost:3020");
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const socket = getSocket();
    socket.open();

    const requestPromise = transport.request(
      "git.runStackedAction",
      { cwd: "/repo" },
      { timeoutMs: null },
    );
    const sent = socket.sent.at(-1);
    if (!sent) {
      throw new Error("Expected request envelope to be sent");
    }
    const requestEnvelope = JSON.parse(sent) as { id: string };

    socket.serverMessage(
      JSON.stringify({
        id: requestEnvelope.id,
        result: { ok: true },
      }),
    );

    await expect(requestPromise).resolves.toEqual({ ok: true });
    expect(timeoutSpy.mock.calls.some(([callback]) => typeof callback === "function")).toBe(false);

    transport.dispose();
  });

  it("rejects pending requests when the websocket closes", async () => {
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();
    socket.open();

    const requestPromise = transport.request(
      "git.runStackedAction",
      { cwd: "/repo" },
      { timeoutMs: null },
    );

    socket.close();

    await expect(requestPromise).rejects.toThrow("WebSocket connection closed.");
    transport.dispose();
  });

  it("coalesces outbound requests with the same coalesceKey while disconnected", async () => {
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();

    const first = transport.request(
      "server.reportClientActivity",
      { step: 1 },
      { coalesceKey: "client-1" },
    );
    const second = transport.request(
      "server.reportClientActivity",
      { step: 2 },
      { coalesceKey: "client-1" },
    );
    const third = transport.request(
      "server.reportClientActivity",
      { step: 3 },
      { coalesceKey: "client-1" },
    );

    // Superseded requests resolve cleanly without hanging
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();

    // Socket opens
    socket.open();
    expect(socket.sent).toHaveLength(1);

    const sent = JSON.parse(socket.sent[0]!) as { body: { step: number }; id: string };
    expect(sent.body.step).toBe(3);

    socket.serverMessage(
      JSON.stringify({
        id: sent.id,
        result: { ok: true },
      }),
    );

    await expect(third).resolves.toEqual({ ok: true });
    transport.dispose();
  });

  it("supports request cancellation via AbortSignal without leaking pending requests", async () => {
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();
    const controller = new AbortController();

    const requestPromise = transport.request(
      "server.reportClientActivity",
      {},
      { signal: controller.signal },
    );

    controller.abort();
    await expect(requestPromise).rejects.toThrow("Request aborted");

    socket.open();
    expect(socket.sent).toHaveLength(0);

    transport.dispose();
  });

  it("times out slow requests at bounded timeoutMs and removes them from queue", async () => {
    vi.useFakeTimers();
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();

    const requestPromise = transport.request(
      "server.reportClientActivity",
      {},
      { timeoutMs: 5_000 },
    );

    const assertion = expect(requestPromise).rejects.toThrow(
      "Request timed out: server.reportClientActivity",
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;

    socket.open();
    expect(socket.sent).toHaveLength(0);

    transport.dispose();
    vi.useRealTimers();
  });
});

it("does not log the authenticated WebSocket URL on connection failure", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const transport = new WsTransport({ url: "ws://localhost:3020/?token=private-credential" });
  getSocket().error();
  expect(warn).toHaveBeenCalled();
  expect(JSON.stringify(warn.mock.calls)).not.toContain("private-credential");
  expect(JSON.stringify(warn.mock.calls)).not.toContain("token=");
  transport.dispose();
  warn.mockRestore();
});
