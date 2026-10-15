import {
  type WsPush,
  type WsPushChannel,
  type WsPushMessage,
  WebSocketResponse,
  type WsResponse as WsResponseMessage,
  WsResponse as WsResponseSchema,
} from "@tabs/contracts";
import { decodeUnknownJsonResult, formatSchemaError } from "@tabs/shared/schemaJson";
import { Result, Schema } from "effect";
import { acknowledgeRpcRequest, trackRpcRequest } from "./rpc/requestLatencyState";

type PushListener<C extends WsPushChannel> = (message: WsPushMessage<C>) => void;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout> | null;
  method: string;
  queuedAt: number;
  sentAt: number | null;
  coalesceKey?: string | undefined;
  onAbort?: (() => void) | undefined;
}

interface SubscribeOptions {
  readonly replayLatest?: boolean | undefined;
}

export interface RequestOptions {
  readonly timeoutMs?: number | null | undefined;
  readonly coalesceKey?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

interface QueuedOutboundMessage {
  readonly id: string;
  readonly method: string;
  readonly encoded: string;
  readonly coalesceKey?: string | undefined;
}

export interface WsTransportOptions {
  readonly url?: string;
  readonly environmentId?: string;
  readonly refreshUrl?: () => Promise<string>;
  readonly protocol?: "legacy" | "rpc";
}

interface RpcSubscription {
  requestId: string | null;
  readonly method: string;
  readonly input: () => unknown;
  readonly decode: (value: unknown) => unknown;
  readonly receive: (value: unknown) => void;
  readonly onError: (error: Error) => void;
}

type TransportState = "connecting" | "open" | "reconnecting" | "closed" | "disposed";

const REQUEST_TIMEOUT_MS = 60_000;
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000];
const rpcRequestId = Schema.Union([Schema.String, Schema.Number]);
const rpcCause = Schema.Union([
  Schema.TaggedStruct("Fail", { error: Schema.Unknown }),
  Schema.TaggedStruct("Die", { defect: Schema.Unknown }),
  Schema.TaggedStruct("Interrupt", { fiberId: Schema.optional(Schema.Number) }),
]);
const decodeRpcEnvelope = decodeUnknownJsonResult(
  Schema.Union([
    Schema.TaggedStruct("Ping", {}),
    Schema.TaggedStruct("Pong", {}),
    Schema.TaggedStruct("Chunk", {
      requestId: rpcRequestId,
      values: Schema.NonEmptyArray(Schema.Unknown),
    }),
    Schema.TaggedStruct("Exit", {
      requestId: rpcRequestId,
      exit: Schema.Union([
        Schema.TaggedStruct("Success", { value: Schema.Unknown }),
        Schema.TaggedStruct("Failure", { cause: Schema.Array(rpcCause) }),
      ]),
    }),
    Schema.TaggedStruct("Defect", { defect: Schema.Unknown }),
    Schema.TaggedStruct("ClientProtocolError", { error: Schema.Unknown }),
  ]),
);
const rpcError = (value: unknown, fallback: string): Error => {
  if (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string"
  ) {
    // Recovery must distinguish a definitive rejection from a lost ACK.
    // Keep the structured RPC tag/cause alongside the user-facing message.
    return Object.assign(new Error(value.message), value);
  }
  if (typeof value === "string") {
    return new Error(value);
  }
  if (typeof value === "object" && value !== null) {
    try {
      const serialized = JSON.stringify(value);
      if (serialized && serialized !== "{}") {
        return new Error(`${fallback}: ${serialized}`);
      }
    } catch {}
  }
  return new Error(fallback);
};
const decodeWsResponse = decodeUnknownJsonResult(WsResponseSchema);
const isWebSocketResponseEnvelope = Schema.is(WebSocketResponse);

const isWsPushMessage = (value: WsResponseMessage): value is WsPush =>
  "type" in value && value.type === "push";

interface WsRequestEnvelope {
  id: string;
  body: {
    _tag: string;
    [key: string]: unknown;
  };
}

function asError(value: unknown, fallback: string): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(fallback);
}

function resolveWsUrlFromLocation(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    const candidate = params.get("tabsWsUrl")?.trim() || null;
    return candidate && candidate.length > 0 ? candidate : null;
  } catch {
    return null;
  }
}

export class WsTransport {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Map<string, Set<(message: WsPush) => void>>();
  private readonly latestPushByChannel = new Map<string, WsPush>();
  private readonly openListeners = new Set<() => void>();
  private readonly outboundQueue: QueuedOutboundMessage[] = [];
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private state: TransportState = "connecting";
  private url: string;
  private readonly configuredUrl: string | undefined;
  public readonly environmentId: string | undefined;
  private readonly refreshUrl: (() => Promise<string>) | undefined;
  private refreshingRemoteTicket = false;
  private readonly protocol: "legacy" | "rpc";
  private readonly rpcSubscriptions = new Set<RpcSubscription>();
  private readonly rpcSubscriptionsById = new Map<string, RpcSubscription>();

  constructor(input?: string | WsTransportOptions) {
    const options = typeof input === "string" ? { url: input } : (input ?? {});
    this.configuredUrl = options.url;
    this.environmentId = options.environmentId;
    this.refreshUrl = options.refreshUrl;
    this.protocol = options.protocol ?? "rpc";
    this.url = this.resolveUrl(options.url);
    this.connect();
  }

  /** Resolve signed assets against the connected server, including remote environments. */
  resolveHttpUrl(relativeUrl: string): string {
    const origin = new URL(this.url);
    origin.protocol = origin.protocol === "wss:" ? "https:" : "http:";
    return new URL(relativeUrl, origin).href;
  }

  private resolveUrl(explicitUrl?: string): string {
    if (explicitUrl && explicitUrl.length > 0) {
      return explicitUrl;
    }

    const locationUrl = resolveWsUrlFromLocation();
    if (locationUrl) {
      return locationUrl;
    }

    const bridgeUrl = window.desktopBridge?.getWsUrl();
    if (bridgeUrl && bridgeUrl.length > 0) {
      return bridgeUrl;
    }

    const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
    if (envUrl && envUrl.length > 0) {
      return envUrl;
    }

    return `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:${window.location.port}`;
  }

  async request<T = unknown>(
    method: string,
    params?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    if (typeof method !== "string" || method.length === 0) {
      throw new Error("Request method is required");
    }

    if (options?.signal?.aborted) {
      throw new Error("Request aborted");
    }

    const id = String(this.nextId++);
    const body = params != null ? { ...params, _tag: method } : { _tag: method };
    const message =
      this.protocol === "rpc"
        ? { _tag: "Request", id, tag: method, payload: params ?? {}, headers: [] }
        : ({ id, body } satisfies WsRequestEnvelope);
    const encoded = JSON.stringify(message);

    return new Promise<T>((resolve, reject) => {
      const timeoutMs = options?.timeoutMs === undefined ? REQUEST_TIMEOUT_MS : options.timeoutMs;
      const timeout =
        timeoutMs === null
          ? null
          : setTimeout(() => {
              this.pending.delete(id);
              this.interruptRpcRequest(id);
              pendingEntry.onAbort?.();
              this.removeFromOutboundQueue(id);
              acknowledgeRpcRequest(id);
              reject(new Error(`Request timed out: ${method}`));
            }, timeoutMs);

      const pendingEntry: PendingRequest = {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout,
        method,
        queuedAt: Date.now(),
        sentAt: null,
      };

      if (options?.signal) {
        const onAbort = () => {
          if (timeout !== null) clearTimeout(timeout);
          this.pending.delete(id);
          this.interruptRpcRequest(id);
          pendingEntry.onAbort?.();
          this.removeFromOutboundQueue(id);
          acknowledgeRpcRequest(id);
          reject(new Error("Request aborted"));
        };
        options.signal.addEventListener("abort", onAbort, { once: true });
        pendingEntry.onAbort = () => options.signal?.removeEventListener("abort", onAbort);
      }

      this.pending.set(id, pendingEntry);

      if (timeoutMs !== null) {
        trackRpcRequest(id, method, () => (pendingEntry.sentAt ? "in-flight" : "transport-queued"));
      }

      this.send({
        id,
        method,
        encoded,
        coalesceKey: options?.coalesceKey,
      });
    });
  }

  subscribe<C extends WsPushChannel>(
    channel: C,
    listener: PushListener<C>,
    options?: SubscribeOptions,
  ): () => void {
    let channelListeners = this.listeners.get(channel);
    if (!channelListeners) {
      channelListeners = new Set<(message: WsPush) => void>();
      this.listeners.set(channel, channelListeners);
    }

    const wrappedListener = (message: WsPush) => {
      listener(message as WsPushMessage<C>);
    };
    channelListeners.add(wrappedListener);

    if (options?.replayLatest) {
      const latest = this.latestPushByChannel.get(channel);
      if (latest) {
        wrappedListener(latest);
      }
    }

    return () => {
      channelListeners?.delete(wrappedListener);
      if (channelListeners?.size === 0) {
        this.listeners.delete(channel);
      }
    };
  }

  /** Resumes streams using caller-owned sequence watermarks after a new connection. */
  subscribeRpc<T>(
    method: string,
    input: () => unknown,
    decode: (value: unknown) => T,
    callback: (value: T) => void,
    onError: (error: Error) => void,
  ): () => void {
    const subscription: RpcSubscription = {
      requestId: null,
      method,
      input,
      decode,
      receive: (value) => callback(value as T),
      onError,
    };
    this.rpcSubscriptions.add(subscription);
    if (this.state === "open") this.startRpcSubscription(subscription);
    return () => {
      this.rpcSubscriptions.delete(subscription);
      if (subscription.requestId !== null) {
        this.rpcSubscriptionsById.delete(subscription.requestId);
        this.interruptRpcRequest(subscription.requestId);
        subscription.requestId = null;
      }
    };
  }

  private interruptRpcRequest(requestId: string): void {
    if (
      this.protocol === "rpc" &&
      this.state === "open" &&
      this.ws?.readyState === WebSocket.OPEN
    ) {
      this.ws.send(JSON.stringify({ _tag: "Interrupt", requestId }));
    }
  }

  private startRpcSubscription(subscription: RpcSubscription): void {
    const id = String(this.nextId++);
    try {
      const payload = subscription.input();
      subscription.requestId = id;
      this.rpcSubscriptionsById.set(id, subscription);
      this.ws?.send(
        JSON.stringify({ _tag: "Request", id, tag: subscription.method, payload, headers: [] }),
      );
    } catch (cause) {
      this.rpcSubscriptionsById.delete(id);
      subscription.requestId = null;
      subscription.onError(asError(cause, "Could not subscribe to server stream."));
    }
  }

  getLatestPush<C extends WsPushChannel>(channel: C): WsPushMessage<C> | null {
    const latest = this.latestPushByChannel.get(channel);
    return latest ? (latest as WsPushMessage<C>) : null;
  }

  getState(): TransportState {
    return this.state;
  }

  onOpen(listener: () => void): () => void {
    this.openListeners.add(listener);
    if (this.state === "open") listener();
    return () => this.openListeners.delete(listener);
  }

  reconnectAfterSystemResume(): void {
    if (this.disposed) return;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.ws;
    if (socket !== null) {
      socket.close();
      return;
    }
    this.reconnectAttempt = 0;
    this.connect();
  }

  dispose() {
    this.disposed = true;
    this.state = "disposed";
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connectionTimeoutTimer !== null) {
      clearTimeout(this.connectionTimeoutTimer);
      this.connectionTimeoutTimer = null;
    }
    for (const pending of this.pending.values()) {
      if (pending.timeout !== null) {
        clearTimeout(pending.timeout);
      }
      pending.onAbort?.();
      pending.reject(new Error("Transport disposed"));
    }
    for (const id of this.pending.keys()) acknowledgeRpcRequest(id);
    this.pending.clear();
    this.rpcSubscriptions.clear();
    this.rpcSubscriptionsById.clear();
    this.outboundQueue.length = 0;
    this.ws?.close();
    this.ws = null;
  }

  private connect() {
    if (this.disposed) {
      return;
    }

    const environmentId =
      this.environmentId ??
      (this.configuredUrl === undefined && typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("tabsEnvironmentId")
        : null);
    if (this.reconnectAttempt > 0 && environmentId && !this.refreshingRemoteTicket) {
      this.refreshingRemoteTicket = true;
      const refresh =
        this.refreshUrl ??
        (() =>
          import("./connection/manualConnections").then(({ resolveManualConnectionSocketUrl }) =>
            resolveManualConnectionSocketUrl(environmentId),
          ));
      void refresh()
        .then((socketUrl) => {
          this.url = socketUrl;
          this.refreshingRemoteTicket = false;
          this.openSocket(true);
        })
        .catch((error) => {
          this.refreshingRemoteTicket = false;
          console.warn("Failed to refresh the remote WebSocket ticket", { error });
          this.scheduleReconnect();
        });
      return;
    }

    const desktopUrl =
      this.configuredUrl === undefined && typeof window !== "undefined"
        ? window.desktopBridge?.getWsUrl()
        : undefined;
    if (this.protocol === "rpc" && desktopUrl && new URL(desktopUrl).searchParams.has("token")) {
      if (this.refreshingRemoteTicket) return;
      this.refreshingRemoteTicket = true;
      void import("./desktopWebSocketAuth")
        .then(({ authorizeDesktopWebSocket }) => authorizeDesktopWebSocket(desktopUrl))
        .then((url) => {
          this.refreshingRemoteTicket = false;
          this.url = url;
          this.openSocket(true);
        })
        .catch((error) => {
          this.refreshingRemoteTicket = false;
          console.warn(
            "Desktop authentication exchange failed; falling back to direct token upgrade",
            { error },
          );
          this.url = desktopUrl;
          this.openSocket(true);
        });
      return;
    }
    this.openSocket();
  }

  private openSocket(useCurrentUrl = false) {
    if (this.disposed) return;

    this.state = this.reconnectAttempt > 0 ? "reconnecting" : "connecting";
    // Resolving the URL (a sync IPC to the desktop main) or constructing the
    // socket can throw — e.g. during a fresh `dev:desktop` launch when the
    // backend hasn't started yet. Those throw OUTSIDE the socket's event
    // listeners, so without this guard `scheduleReconnect` (only called from the
    // `close` listener below) would never run and the reconnect loop would die
    // permanently — leaving the renderer stuck until a manual refresh.
    let ws: WebSocket;
    try {
      if (!useCurrentUrl) {
        this.url = this.resolveUrl(this.configuredUrl);
      }
      ws = new WebSocket(this.url);
    } catch {
      console.warn("WebSocket failed to initialize; scheduling reconnect");
      this.scheduleReconnect();
      return;
    }

    this.connectionTimeoutTimer = setTimeout(() => {
      console.warn("WebSocket connection timed out; forcefully closing");
      this.connectionTimeoutTimer = null;
      ws.close();
    }, 5000);

    ws.addEventListener("open", () => {
      if (this.connectionTimeoutTimer !== null) {
        clearTimeout(this.connectionTimeoutTimer);
        this.connectionTimeoutTimer = null;
      }
      this.ws = ws;
      this.state = "open";
      this.reconnectAttempt = 0;
      this.flushQueue();
      for (const listener of this.openListeners) listener();
      for (const subscription of this.rpcSubscriptions) this.startRpcSubscription(subscription);
    });

    ws.addEventListener("message", (event) => {
      this.handleMessage(event.data);
    });

    ws.addEventListener("close", () => {
      if (this.connectionTimeoutTimer !== null) {
        clearTimeout(this.connectionTimeoutTimer);
        this.connectionTimeoutTimer = null;
      }
      if (this.ws === ws) {
        this.ws = null;
        this.outboundQueue.length = 0;
        this.rpcSubscriptionsById.clear();
        for (const subscription of this.rpcSubscriptions) subscription.requestId = null;
        for (const [id, pending] of this.pending.entries()) {
          if (pending.timeout !== null) {
            clearTimeout(pending.timeout);
          }
          pending.onAbort?.();
          this.pending.delete(id);
          acknowledgeRpcRequest(id);
          pending.reject(new Error("WebSocket connection closed."));
        }
      }
      if (this.disposed) {
        this.state = "disposed";
        return;
      }
      this.state = "closed";
      this.scheduleReconnect();
    });

    ws.addEventListener("error", (event) => {
      // Log WebSocket errors for debugging. A `close` normally follows and
      // drives the reconnect, but a failed connection doesn't always deliver a
      // reliable `close` in every runtime — so schedule a reconnect here too.
      // `scheduleReconnect` is idempotent (guards on an in-flight timer), so the
      // subsequent `close` (if any) won't double-connect.
      console.warn("WebSocket connection error", { type: event.type });
      if (this.ws !== ws && !this.disposed) {
        this.scheduleReconnect();
      }
    });
  }

  private handleMessage(raw: unknown) {
    if (this.protocol === "rpc") {
      this.handleRpcMessage(raw);
      return;
    }
    const result = decodeWsResponse(raw);
    if (Result.isFailure(result)) {
      console.warn("Dropped inbound WebSocket envelope", formatSchemaError(result.failure));
      return;
    }

    const message = result.success;
    if (isWsPushMessage(message)) {
      this.latestPushByChannel.set(message.channel, message);
      const channelListeners = this.listeners.get(message.channel);
      if (channelListeners) {
        for (const listener of channelListeners) {
          try {
            listener(message);
          } catch {
            // Swallow listener errors
          }
        }
      }
      return;
    }

    if (!isWebSocketResponseEnvelope(message)) {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    if (pending.timeout !== null) {
      clearTimeout(pending.timeout);
    }
    pending.onAbort?.();
    this.pending.delete(message.id);
    acknowledgeRpcRequest(message.id);

    if (message.error) {
      const err = new Error(message.error.message);
      if ("phase" in message.error && message.error.phase) {
        (err as any).phase = message.error.phase;
      }
      if ("createdCommitSha" in message.error && message.error.createdCommitSha) {
        (err as any).createdCommitSha = message.error.createdCommitSha;
      }
      pending.reject(err);
      return;
    }

    pending.resolve(message.result);
  }

  private handleRpcMessage(raw: unknown): void {
    try {
      const decoded = decodeRpcEnvelope(typeof raw === "string" ? raw : String(raw));
      if (Result.isFailure(decoded)) throw new Error(formatSchemaError(decoded.failure));
      const message = decoded.success;
      if (message._tag === "Ping") {
        this.ws?.send(JSON.stringify({ _tag: "Pong" }));
        return;
      }
      if (message._tag === "Defect" || message._tag === "ClientProtocolError") {
        const error = rpcError(
          message._tag === "Defect" ? message.defect : message.error,
          "Server RPC protocol failed.",
        );
        for (const [id, pending] of this.pending) {
          if (pending.timeout !== null) clearTimeout(pending.timeout);
          pending.onAbort?.();
          acknowledgeRpcRequest(id);
          pending.reject(error);
        }
        this.pending.clear();
        this.outboundQueue.length = 0;
        for (const subscription of this.rpcSubscriptionsById.values()) {
          subscription.requestId = null;
          subscription.onError(error);
        }
        this.rpcSubscriptionsById.clear();
        return;
      }
      if (message._tag === "Pong") return;
      const id = String(message.requestId);
      const subscription = this.rpcSubscriptionsById.get(id);
      if (message._tag === "Chunk" && Array.isArray(message.values) && subscription) {
        try {
          // Validate the entire chunk before callbacks advance the resume watermark.
          const values = message.values.map(subscription.decode);
          for (const value of values) subscription.receive(value);
          this.ws?.send(JSON.stringify({ _tag: "Ack", requestId: message.requestId }));
        } catch (cause) {
          this.rpcSubscriptionsById.delete(id);
          subscription.requestId = null;
          this.ws?.send(JSON.stringify({ _tag: "Interrupt", requestId: message.requestId }));
          subscription.onError(asError(cause, "Invalid server stream item."));
        }
        return;
      }
      if (message._tag !== "Exit" || !message.exit || typeof message.exit !== "object") return;
      const error =
        message.exit._tag === "Failure"
          ? rpcError(
              message.exit.cause
                .map((entry) =>
                  entry._tag === "Fail"
                    ? entry.error
                    : entry._tag === "Die"
                      ? entry.defect
                      : undefined,
                )
                .find((value) => value !== undefined),
              "Server request failed.",
            )
          : null;
      if (subscription) {
        this.rpcSubscriptionsById.delete(id);
        subscription.requestId = null;
        if (error) subscription.onError(error);
        return;
      }
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (pending.timeout !== null) clearTimeout(pending.timeout);
      pending.onAbort?.();
      acknowledgeRpcRequest(id);
      if (error) pending.reject(error);
      else if (message.exit._tag === "Success") pending.resolve(message.exit.value);
      else pending.reject(new Error("Invalid server RPC exit."));
    } catch (cause) {
      console.warn("Dropped inbound RPC envelope", asError(cause, "Invalid RPC envelope.").message);
    }
  }

  private send(queuedMessage: QueuedOutboundMessage) {
    if (this.disposed) {
      return;
    }

    if (queuedMessage.coalesceKey) {
      const existingIdx = this.outboundQueue.findIndex(
        (msg) => msg.coalesceKey === queuedMessage.coalesceKey,
      );
      if (existingIdx !== -1) {
        const existing = this.outboundQueue[existingIdx]!;
        this.outboundQueue.splice(existingIdx, 1);
        const oldPending = this.pending.get(existing.id);
        if (oldPending) {
          if (oldPending.timeout !== null) clearTimeout(oldPending.timeout);
          oldPending.onAbort?.();
          this.pending.delete(existing.id);
          acknowledgeRpcRequest(existing.id);
          oldPending.resolve(undefined);
        }
      }
    }

    this.outboundQueue.push(queuedMessage);
    try {
      this.flushQueue();
    } catch {
      // Swallow: flushQueue has queued the message for retry on reconnect
    }
  }

  private removeFromOutboundQueue(id: string) {
    const idx = this.outboundQueue.findIndex((item) => item.id === id);
    if (idx !== -1) {
      this.outboundQueue.splice(idx, 1);
    }
  }

  private flushQueue() {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    while (this.outboundQueue.length > 0) {
      const message = this.outboundQueue.shift();
      if (!message) {
        continue;
      }
      try {
        const pending = this.pending.get(message.id);
        if (pending) {
          pending.sentAt = Date.now();
        }
        this.ws.send(message.encoded);
      } catch (error) {
        this.outboundQueue.unshift(message);
        throw asError(error, "Failed to send WebSocket request.");
      }
    }
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer !== null) {
      return;
    }

    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)] ??
      RECONNECT_DELAYS_MS[0]!;

    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
