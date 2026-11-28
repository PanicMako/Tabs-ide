import { once } from "node:events";
import { createServer } from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { afterEach, describe, expect, it } from "vitest";
import {
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  AuthSessionId,
  LOCAL_DEVICE_HOST_ID,
  type AuthEnvironmentScope,
} from "@tabs/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
} from "effect/unstable/http";
import WebSocket, { WebSocketServer } from "ws";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as SessionStore from "../auth/SessionStore.ts";
import * as DeviceService from "./DeviceService.ts";
import * as DeviceHubProxy from "./DeviceHubProxy.ts";

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

const fixture = (
  scopes: ReadonlyArray<AuthEnvironmentScope>,
  fail = false,
  authError?: EnvironmentAuth.ServerAuthCredentialError | EnvironmentAuth.ServerAuthInternalError,
  streamInputAllowed: (hostId: string, deviceId?: string) => boolean = () => true,
  respond = () => new Response("frame"),
) => {
  const sessionId = AuthSessionId.make("test");
  const changes = Effect.runSync(PubSub.unbounded<SessionStore.SessionCredentialChange>());
  let finalized = 0;
  const requests: string[] = [];
  const client = HttpClient.make((request, _url, signal) =>
    Effect.gen(function* () {
      requests.push(request.url);
      signal.addEventListener("abort", () => {
        finalized++;
      });
      if (fail) return yield* Effect.die(new Error("upstream failed"));
      return HttpClientResponse.fromWeb(request, respond());
    }),
  );
  const { handler, dispose } = HttpRouter.toWebHandler(
    DeviceHubProxy.layer.pipe(
      Layer.provideMerge(
        Layer.succeed(EnvironmentAuth.EnvironmentAuth, {
          authenticateWebSocketUpgrade: () =>
            authError
              ? Effect.fail(authError)
              : Effect.succeed({
                  sessionId,
                  subject: "test",
                  method: "bearer-access-token",
                  scopes,
                }),
        } as unknown as EnvironmentAuth.EnvironmentAuth["Service"]),
      ),
      Layer.provideMerge(
        Layer.succeed(DeviceService.DeviceService, {
          streamInputAllowed: (hostId, deviceId) =>
            Effect.sync(() => streamInputAllowed(hostId, deviceId)),
          currentReadiness: () =>
            Effect.succeed({ hostId: LOCAL_DEVICE_HOST_ID, hub: { origin: "http://hub.test" } }),
        } as DeviceService.DeviceService["Service"]),
      ),
      Layer.provideMerge(
        Layer.succeed(SessionStore.SessionStore, {
          subscribeChanges: PubSub.subscribe(changes),
        } as SessionStore.SessionStore["Service"]),
      ),
      Layer.provideMerge(Layer.succeed(HttpClient.HttpClient, client)),
    ),
    { disableLogger: true },
  );
  disposers.push(dispose);
  return {
    handler,
    requests,
    finalized: () => finalized,
    revoke: (id = sessionId) =>
      Effect.runPromise(PubSub.publish(changes, { type: "clientRemoved", sessionId: id })),
  };
};

describe("device hub proxy", () => {
  it("releases the upstream response after forwarding its body and strips tickets", async () => {
    const { handler, requests, finalized } = fixture([AuthOrchestrationReadScope]);
    const response = await handler(
      new Request("http://t3.test/api/device-hub/api/devices?wsTicket=secret"),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("frame");
    expect(requests).toEqual(["http://hub.test/api/devices"]);
    expect(finalized()).toBe(1);
  });

  it("releases resources when upstream acquisition fails", async () => {
    const { handler, finalized } = fixture([AuthOrchestrationReadScope], true);
    const response = await handler(new Request("http://t3.test/api/device-hub/api/devices"));
    expect(response.status).toBe(500);
    expect(finalized()).toBe(1);
  });

  it("ends a live HTTP stream and releases its upstream response on session revocation", async () => {
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    const firstFrame = encoder.encode("first frame");
    const secondFrame = encoder.encode("second frame");
    const { handler, finalized, revoke } = fixture(
      [AuthOrchestrationReadScope],
      false,
      undefined,
      () => true,
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              upstream = controller;
              controller.enqueue(firstFrame);
            },
          }),
          { headers: { "Content-Type": "multipart/x-mixed-replace; boundary=fixture" } },
        ),
    );
    const response = await handler(
      new Request("http://t3.test/api/device-hub/vendor/serve-sim/helper/fixture/stream.mjpeg"),
    );
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    try {
      expect(await reader.read()).toEqual({ value: firstFrame, done: false });
      await revoke(AuthSessionId.make("other"));
      upstream.enqueue(secondFrame);
      expect(await reader.read()).toEqual({ value: secondFrame, done: false });
      const read = reader.read();
      await revoke();
      expect(await read).toEqual({ value: undefined, done: true });
      expect(finalized()).toBe(1);
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  });

  it.each(["/vendor/serve-sim/helper/ws", "/vendor/serve-emu/ws"])(
    "rejects input socket %s for a read-only session",
    async (path) => {
      const { handler, requests } = fixture([AuthOrchestrationReadScope]);
      const response = await handler(
        new Request(`http://t3.test/api/device-hub${path}`, { headers: { upgrade: "websocket" } }),
      );
      expect(response.status).toBe(403);
      expect(requests).toEqual([]);
    },
  );

  it("closes an open device socket when its session is revoked and keeps another session connected", async () => {
    const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    const firstSession = AuthSessionId.make("first");
    const secondSession = AuthSessionId.make("second");
    const frame = Buffer.from([0x82, 0x7b, 0x7d]);
    try {
      await once(upstream, "listening");
      const upstreamAddress = upstream.address();
      if (!upstreamAddress || typeof upstreamAddress === "string") {
        throw new Error("Expected a loopback WebSocket listener.");
      }
      upstream.on("connection", (socket) => {
        socket.send(frame);
        socket.on("message", (message, binary) => socket.send(message, { binary }));
      });
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const changes = yield* PubSub.unbounded<SessionStore.SessionCredentialChange>();
            const server = yield* Layer.build(
              NodeHttpServer.layer(createServer, { host: "127.0.0.1", port: 0 }),
            );
            const address = Context.get(server, HttpServer.HttpServer).address;
            if (address._tag !== "TcpAddress") throw new Error("Expected a TCP proxy listener.");
            const services = Layer.mergeAll(
              Layer.succeed(EnvironmentAuth.EnvironmentAuth, {
                authenticateWebSocketUpgrade: (request) =>
                  Effect.succeed({
                    sessionId:
                      request.headers["x-fixture-session"] === "first"
                        ? firstSession
                        : secondSession,
                    subject: "fixture",
                    method: "bearer-access-token",
                    scopes: [AuthOrchestrationOperateScope],
                  }),
              } satisfies Pick<
                EnvironmentAuth.EnvironmentAuth["Service"],
                "authenticateWebSocketUpgrade"
              > as unknown as EnvironmentAuth.EnvironmentAuth["Service"]),
              Layer.succeed(SessionStore.SessionStore, {
                subscribeChanges: PubSub.subscribe(changes),
              } as SessionStore.SessionStore["Service"]),
              Layer.succeed(DeviceService.DeviceService, {
                streamInputAllowed: () => Effect.succeed(true),
                currentReadiness: () =>
                  Effect.succeed({
                    hostId: LOCAL_DEVICE_HOST_ID,
                    hub: { origin: `http://127.0.0.1:${upstreamAddress.port}` },
                  }),
              } as unknown as DeviceService.DeviceService["Service"]),
              FetchHttpClient.layer,
            );
            yield* Layer.build(
              HttpRouter.serve(DeviceHubProxy.layer, {
                disableLogger: true,
                disableListenLog: true,
              }),
            ).pipe(Effect.provide(services), Effect.provide(server));
            const socketUrl = `ws://127.0.0.1:${address.port}/api/device-hub/vendor/serve-sim/helper/ws?device=fixture`;
            const connect = (sessionId: AuthSessionId) =>
              new WebSocket(socketUrl, {
                headers: { "x-fixture-session": sessionId },
                handshakeTimeout: 2000,
              });
            const first = connect(firstSession);
            const second = connect(secondSession);
            const signal = AbortSignal.timeout(3000);
            try {
              const frames = yield* Effect.promise(() =>
                Promise.all([
                  once(first, "message", { signal }),
                  once(second, "message", { signal }),
                ]),
              );
              expect(frames.map(([bytes]) => bytes)).toEqual([frame, frame]);
              const firstClosed = once(first, "close", { signal });
              yield* PubSub.publish(changes, { type: "clientRemoved", sessionId: firstSession });
              yield* Effect.promise(() => firstClosed);
              const echo = once(second, "message", { signal });
              second.send(frame);
              const [bytes] = yield* Effect.promise(() => echo);
              expect(bytes).toEqual(frame);
            } finally {
              first.terminate();
              second.terminate();
            }
          }),
        ),
      );
    } finally {
      for (const socket of upstream.clients) socket.terminate();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  }, 10_000);

  it("requires operate scope for stream tuning", async () => {
    const readOnly = fixture([AuthOrchestrationReadScope]);
    const path = "http://t3.test/api/device-hub/vendor/serve-emu/api/stream-settings";
    expect((await readOnly.handler(new Request(path, { method: "POST" }))).status).toBe(403);
    const operator = fixture([AuthOrchestrationOperateScope]);
    const response = await operator.handler(new Request(path, { method: "POST" }));
    expect(response.status).toBe(200);
    await response.text();
  });

  it("reads Android fold state but requires operate scope to change it", async () => {
    const path = "http://t3.test/api/device-hub/vendor/serve-emu/api/fold?device=emulator-5554";
    const reader = fixture([AuthOrchestrationReadScope]);
    const read = await reader.handler(new Request(path));
    expect(read.status).toBe(200);
    await read.text();
    expect(reader.requests).toEqual([
      "http://hub.test/vendor/serve-emu/api/fold?device=emulator-5554",
    ]);
    const denied = await reader.handler(
      new Request(path, { method: "POST", body: '{"posture":"closed"}' }),
    );
    expect(denied.status).toBe(403);
    expect(reader.requests).toHaveLength(1);

    const operator = fixture([AuthOrchestrationOperateScope]);
    const changed = await operator.handler(
      new Request(path, { method: "POST", body: '{"posture":"closed"}' }),
    );
    expect(changed.status).toBe(200);
    await changed.text();
    expect(operator.requests).toEqual([
      "http://hub.test/vendor/serve-emu/api/fold?device=emulator-5554",
    ]);
  });

  it("blocks input changes on a managed device while allowing screenshots and other hosts", async () => {
    const { handler, requests } = fixture(
      [AuthOrchestrationOperateScope, AuthOrchestrationReadScope],
      false,
      undefined,
      (hostId, deviceId) => hostId !== "managed-host" || deviceId !== "pixel",
    );
    const base = "http://t3.test/api/device-hub/vendor/serve-emu/api";
    const update = (url: string) => handler(new Request(url, { method: "POST" }));
    expect((await update(`${base}/fold?hostId=managed-host&device=pixel`)).status).toBe(409);
    expect(
      (await update(`${base}/fold?hostId=managed-host&device=pixel&device=other`)).status,
    ).toBe(400);
    expect(await (await update(`${base}/fold?hostId=another-host&device=pixel`)).text()).toBe(
      "frame",
    );
    expect(await (await update(`${base}/screenshot?hostId=managed-host&device=pixel`)).text()).toBe(
      "frame",
    );
    expect(requests).toHaveLength(2);
  });

  it("never forwards the vendor shell endpoint", async () => {
    const { handler, requests } = fixture([AuthOrchestrationOperateScope]);
    expect(
      (
        await handler(
          new Request("http://t3.test/api/device-hub/vendor/serve-sim/exec", { method: "POST" }),
        )
      ).status,
    ).toBe(404);
    expect(requests).toEqual([]);
  });
});

it.each([
  [new EnvironmentAuth.ServerAuthMissingCredentialError({}), 401],
  [
    new EnvironmentAuth.ServerAuthSessionCredentialValidationError({
      cause: new Error("private credential diagnostic"),
    }),
    500,
  ],
] as const)("translates authentication failure to HTTP %s", async (error, status) => {
  const { handler, requests } = fixture([], false, error);
  const response = await handler(new Request("http://t3.test/api/device-hub/api/devices"));
  expect(response.status).toBe(status);
  expect(await response.text()).not.toContain("private credential diagnostic");
  expect(requests).toEqual([]);
});

it.each([1, 3])(
  "forwards fixed Duo display %s through the authenticated read proxy",
  async (panel) => {
    const { handler, requests } = fixture([AuthOrchestrationReadScope]);
    const route = `/vendor/serve-sim/helper/duo/panel/${panel}/stream.avcc`;
    const response = await handler(
      new Request(`http://t3.test/api/device-hub${route}?wsTicket=secret`),
    );
    expect(response.status).toBe(200);
    await response.text();
    expect(requests).toEqual([`http://hub.test${route}`]);
  },
);

it.each(["/panel/2/stream.avcc", "/panel/1/webrtc/offer", "/panel/3/exec"])(
  "rejects unsupported Duo route %s",
  async (route) => {
    const { handler, requests } = fixture([AuthOrchestrationReadScope]);
    const response = await handler(
      new Request(`http://t3.test/api/device-hub/vendor/serve-sim/helper/duo${route}`),
    );
    expect(response.status).toBe(404);
    expect(requests).toEqual([]);
  },
);
