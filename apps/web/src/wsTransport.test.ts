import { WS_CHANNELS } from "@tabs/contracts";
import * as Schema from "effect/Schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./desktopWebSocketAuth", () => ({ authorizeDesktopWebSocket: vi.fn() }));
import { authorizeDesktopWebSocket } from "./desktopWebSocketAuth";
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
  vi.mocked(authorizeDesktopWebSocket).mockReset();

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
  it("re-resolves the desktop backend after it becomes available during startup", () => {
    vi.useFakeTimers();
    const transport = new WsTransport();
    const initialSocket = getSocket();
    Object.assign(window, {
      desktopBridge: { getWsUrl: () => "ws://localhost:4050/ws?orchestrationProtocol=2" },
    });
    initialSocket.close();
    vi.advanceTimersByTime(500);
    expect(getSocket().url).toBe("ws://localhost:4050/ws?orchestrationProtocol=2");
    transport.dispose();
    vi.useRealTimers();
  });

  it("retries a booting desktop loopback server promptly, then restores outage backoff", () => {
    vi.useFakeTimers();
    Object.assign(window, { desktopBridge: { getWsUrl: () => "ws://127.0.0.1:4050/ws" } });
    const transport = new WsTransport("ws://127.0.0.1:4050/ws");
    getSocket().close();
    vi.advanceTimersByTime(99);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    getSocket().open();
    getSocket().close();
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    transport.dispose();
    vi.useRealTimers();
  });

  it("bounds fast startup retries and keeps remote endpoints on normal backoff", () => {
    vi.useFakeTimers();
    Object.assign(window, { desktopBridge: { getWsUrl: () => "ws://127.0.0.1:4050/ws" } });
    const local = new WsTransport("ws://127.0.0.1:4050/ws");
    vi.setSystemTime(Date.now() + 5_000);
    getSocket().close();
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    local.dispose();
    const remote = new WsTransport("wss://remote.example.test/ws");
    getSocket().close();
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(4);
    remote.dispose();
    vi.useRealTimers();
  });

  it("holds authentication until the desktop backend starts listening", async () => {
    let ready!: () => void;
    const listening = new Promise<void>((resolve) => {
      ready = resolve;
    });
    Object.assign(window, {
      desktopBridge: {
        getWsUrl: () => "ws://127.0.0.1:4050/ws?token=bootstrap",
        waitForBackendReady: () => listening,
      },
    });
    vi.mocked(authorizeDesktopWebSocket).mockResolvedValue("ws://127.0.0.1:4050/ws?wsTicket=ready");
    const transport = new WsTransport();
    await vi.dynamicImportSettled();
    expect(authorizeDesktopWebSocket).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(0);
    ready();
    await vi.dynamicImportSettled();
    expect(sockets).toHaveLength(1);
    expect(getSocket().url).toContain("wsTicket=ready");
    transport.dispose();
  });

  it("waits for desktop authentication instead of creating failed sockets during backend boot", async () => {
    vi.useFakeTimers();
    Object.assign(window, {
      desktopBridge: { getWsUrl: () => "ws://127.0.0.1:4050/ws?token=bootstrap" },
    });
    vi.mocked(authorizeDesktopWebSocket)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce("ws://127.0.0.1:4050/ws?wsTicket=once");
    const transport = new WsTransport();
    await vi.dynamicImportSettled();
    expect(sockets).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(100);
    await vi.dynamicImportSettled();
    expect(sockets).toHaveLength(1);
    expect(getSocket().url).toContain("wsTicket=once");
    expect(getSocket().url).not.toContain("token=bootstrap");
    transport.dispose();
    vi.useRealTimers();
  });

  it.each([401, 404, 405])(
    "uses legacy socket fallback only for unsupported auth endpoints (HTTP %s)",
    async (status) => {
      vi.useFakeTimers();
      Object.assign(window, {
        desktopBridge: { getWsUrl: () => "ws://127.0.0.1:4050/ws?token=bootstrap" },
      });
      vi.mocked(authorizeDesktopWebSocket).mockRejectedValue(
        Object.assign(new Error("auth response"), { status }),
      );
      const transport = new WsTransport();
      await vi.dynamicImportSettled();
      expect(sockets).toHaveLength(status === 401 ? 0 : 1);
      transport.dispose();
      vi.useRealTimers();
    },
  );
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

  it("defaults to rpc protocol when unspecified", async () => {
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();
    socket.open();
    const promise = transport.request("probe", { ping: true });
    const sent = JSON.parse(socket.sent.at(-1)!);
    expect(sent).toMatchObject({ _tag: "Request", tag: "probe", payload: { ping: true } });
    socket.serverMessage(
      JSON.stringify({
        _tag: "Exit",
        requestId: sent.id,
        exit: { _tag: "Success", value: { pong: true } },
      }),
    );
    await expect(promise).resolves.toEqual({ pong: true });
    transport.dispose();
  });

  it("routes valid push envelopes to channel listeners", () => {
    const transport = new WsTransport({ url: "ws://localhost:3020", protocol: "legacy" });
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
    const transport = new WsTransport({ url: "ws://localhost:3020", protocol: "legacy" });
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
    const transport = new WsTransport({ url: "ws://localhost:3020", protocol: "legacy" });
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
      expect.any(String),
    );
    expect(warnSpy).toHaveBeenNthCalledWith(
      2,
      "Dropped inbound WebSocket envelope",
      expect.stringContaining("Missing key"),
    );

    transport.dispose();
  });

  it("queues requests until the websocket opens", async () => {
    const transport = new WsTransport({ url: "ws://localhost:3020", protocol: "legacy" });
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
    const transport = new WsTransport({ url: "ws://localhost:3020", protocol: "legacy" });
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
    const transport = new WsTransport({ url: "ws://localhost:3020", protocol: "legacy" });
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
    const transport = new WsTransport({ url: "ws://localhost:3020", protocol: "legacy" });
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

it("omits credentials from initialization errors and connection timeouts", () => {
  vi.useFakeTimers();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const transport = new WsTransport({ url: "ws://localhost:3020/?token=private-credential" });
  vi.advanceTimersByTime(5000);
  transport.dispose();
  globalThis.WebSocket = class {
    constructor() {
      throw new Error("ws://localhost/?token=private-credential");
    }
  } as unknown as typeof WebSocket;
  const failing = new WsTransport({ url: "ws://localhost:3020/?token=private-credential" });
  expect(warn.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(JSON.stringify(warn.mock.calls)).not.toContain("private-credential");
  failing.dispose();
  warn.mockRestore();
  vi.useRealTimers();
});

it("resolves signed media URLs against the selected environment's HTTP origin", () => {
  const transport = new WsTransport("wss://remote.example.test/ws?ticket=secret");
  expect(transport.resolveHttpUrl("/api/assets/file?signature=signed")).toBe(
    "https://remote.example.test/api/assets/file?signature=signed",
  );
  transport.dispose();
});

it("sends RPC unary requests and settles typed success and failure exits", async () => {
  const transport = new WsTransport({ url: "ws://localhost/ws", protocol: "rpc" });
  const socket = getSocket();
  socket.open();
  const success = transport.request("server.getConfig", {});
  const request = JSON.parse(socket.sent[0]!);
  expect(request).toEqual({
    _tag: "Request",
    id: "1",
    tag: "server.getConfig",
    payload: {},
    headers: [],
  });
  socket.serverMessage(
    JSON.stringify({
      _tag: "Exit",
      requestId: "1",
      exit: { _tag: "Success", value: { ready: true } },
    }),
  );
  await expect(success).resolves.toEqual({ ready: true });
  const failure = transport.request("orchestrationV2.dispatchCommand", {});
  socket.serverMessage(
    JSON.stringify({
      _tag: "Exit",
      requestId: "2",
      exit: {
        _tag: "Failure",
        cause: [
          {
            _tag: "Fail",
            error: {
              _tag: "OrchestratorCommandRejectedError",
              message: "Thread no longer exists.",
              cause: { reason: "missing" },
            },
          },
        ],
      },
    }),
  );
  await expect(failure).rejects.toThrow("Thread no longer exists.");
  await expect(failure).rejects.toMatchObject({
    _tag: "OrchestratorCommandRejectedError",
    cause: { reason: "missing" },
  });
  transport.dispose();
});

it("acknowledges decoded stream chunks and resumes from the last watermark after reconnect", () => {
  vi.useFakeTimers();
  const transport = new WsTransport({ url: "ws://localhost/ws", protocol: "rpc" });
  let sequence = 0;
  const received: number[] = [];
  const error = vi.fn();
  const unsubscribe = transport.subscribeRpc(
    "orchestrationV2.subscribeShell",
    () => ({ afterSequence: sequence }),
    Schema.decodeUnknownSync(Schema.Number),
    (value) => {
      sequence = value;
      received.push(value);
    },
    error,
  );
  getSocket().open();
  const first = getSocket();
  first.serverMessage(JSON.stringify({ _tag: "Chunk", requestId: "1", values: [1, 2] }));
  expect(received).toEqual([1, 2]);
  expect(JSON.parse(first.sent.at(-1)!)).toEqual({ _tag: "Ack", requestId: "1" });
  first.close();
  vi.advanceTimersByTime(500);
  getSocket().open();
  expect(JSON.parse(getSocket().sent[0]!)).toMatchObject({
    _tag: "Request",
    payload: { afterSequence: 2 },
  });
  const secondId = JSON.parse(getSocket().sent[0]!).id;
  unsubscribe();
  expect(JSON.parse(getSocket().sent.at(-1)!)).toEqual({ _tag: "Interrupt", requestId: secondId });
  expect(error).not.toHaveBeenCalled();
  transport.dispose();
  vi.useRealTimers();
});

it("interrupts malformed stream data without acknowledging or advancing it", () => {
  const transport = new WsTransport({ url: "ws://localhost/ws", protocol: "rpc" });
  const received = vi.fn();
  const error = vi.fn();
  transport.subscribeRpc(
    "stream",
    () => ({}),
    Schema.decodeUnknownSync(Schema.Number),
    received,
    error,
  );
  const socket = getSocket();
  socket.open();
  socket.serverMessage(JSON.stringify({ _tag: "Chunk", requestId: "1", values: ["wrong"] }));
  expect(received).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledTimes(1);
  expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ _tag: "Interrupt", requestId: "1" });
  expect(socket.sent.some((frame) => JSON.parse(frame)._tag === "Ack")).toBe(false);
  transport.dispose();
});

it("acknowledges finite operation chunks and waits for the successful exit", async () => {
  const transport = new WsTransport({ url: "ws://localhost/ws", protocol: "rpc" });
  const socket = getSocket();
  socket.open();
  const onChunk = vi.fn();
  const operation = transport.request("git.runStackedAction", {}, { onChunk });
  socket.serverMessage(
    JSON.stringify({ _tag: "Chunk", requestId: "1", values: [{ kind: "phase_started" }] }),
  );
  expect(onChunk).toHaveBeenCalledWith([{ kind: "phase_started" }]);
  expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ _tag: "Ack", requestId: "1" });
  socket.serverMessage(JSON.stringify({ _tag: "Exit", requestId: "1", exit: { _tag: "Success" } }));
  await expect(operation).resolves.toBeUndefined();
  transport.dispose();
});

it("interrupts malformed finite operation chunks without acknowledging them", async () => {
  const transport = new WsTransport({ url: "ws://localhost/ws", protocol: "rpc" });
  const socket = getSocket();
  socket.open();
  const operation = transport.request(
    "git.runStackedAction",
    {},
    {
      onChunk: () => {
        throw Error("Invalid progress");
      },
    },
  );
  socket.serverMessage(JSON.stringify({ _tag: "Chunk", requestId: "1", values: [{}] }));
  await expect(operation).rejects.toThrow("Invalid progress");
  expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ _tag: "Interrupt", requestId: "1" });
  transport.dispose();
});

it("settles void Git mutation responses whose JSON omits the undefined value", async () => {
  const transport = new WsTransport({ url: "ws://localhost/ws", protocol: "rpc" });
  const socket = getSocket();
  socket.open();
  const operation = transport.request("git.stageFiles", { cwd: "/repo", paths: ["file.ts"] });
  socket.serverMessage(JSON.stringify({ _tag: "Exit", requestId: "1", exit: { _tag: "Success" } }));
  await expect(operation).resolves.toBeUndefined();
  transport.dispose();
});
