import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DeviceId,
  DeviceOperationError,
  LOCAL_DEVICE_HOST_ID,
  ProviderInstanceId,
  ThreadId,
  type DeviceServiceState,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as ServerSettings from "../serverSettings.ts";
import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import * as DeviceHost from "./DeviceHost.ts";
import { NodeRuntimeUnavailableError } from "@tabs/shared/nodeRuntime";

import * as DeviceService from "./DeviceService.ts";
import type { AgentDeviceGrant } from "./AgentDeviceControl.ts";
import type { startAgentDeviceProxy } from "./AgentDeviceProxy.ts";

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const baseState: DeviceServiceState = {
  hosts: [],
  hostStatus: "idle",
  hostStatuses: {},
  devices: [],
  sessions: [],
  onboardingCompleted: false,
  agentAccessEnabled: false,
  hubBasePath: "/api/device-hub",
  revision: 0,
};

describe("DeviceService.stateStream", () => {
  it.effect("emits the current snapshot and then every published change", () =>
    Effect.gen(function* () {
      const pubsub = yield* PubSub.unbounded<DeviceServiceState>();
      const current = yield* Ref.make(baseState);
      const service: Pick<DeviceService.DeviceService["Service"], "state" | "subscribe"> = {
        state: Ref.get(current),
        subscribe: PubSub.subscribe(pubsub),
      };

      const collected = yield* DeviceService.stateStream(
        service as DeviceService.DeviceService["Service"],
      ).pipe(Stream.take(3), Stream.runCollect, Effect.forkChild);
      yield* Effect.yieldNow;
      for (const revision of [1, 2]) {
        const next = { ...baseState, revision, hostStatus: "ready" as const };
        yield* Ref.set(current, next);
        yield* PubSub.publish(pubsub, next);
      }
      const seen = yield* Fiber.join(collected);
      expect(seen.map((state) => state.revision)).toEqual([0, 1, 2]);
    }),
  );
});

const fixture = Effect.fn("fixture")(function* (
  onBoot: Effect.Effect<void> = Effect.void,
  bootError?: string,
  failListAfterShutdown = false,
  runtimeFailure?: NodeRuntimeUnavailableError | DeviceHost.DeviceHostError,
  inspectError = false,
  installTool?: Parameters<typeof DeviceService.makeWithHosts>[3],
) {
  const settingsService = yield* Effect.serviceOption(ServerSettings.ServerSettingsService);
  const settings = Option.isSome(settingsService)
    ? settingsService.value
    : yield* ServerSettings.ServerSettingsService.pipe(Effect.provide(ServerSettings.layerTest()));
  const starts: string[] = [];
  const agentStarts: string[] = [];
  const agentStops: string[] = [];
  const requests: string[] = [];
  const grants = new Map<
    string,
    {
      readonly grant: AgentDeviceGrant;
      readonly proxy: Parameters<typeof startAgentDeviceProxy>[0];
    }
  >();
  let booted = false;
  let shutDown = false;
  const ready: DeviceHost.DeviceHostReady = {
    nodePath: process.execPath,
    hub: { origin: "http://device.test" },
    helpers: { serveSimAxSettings: null, serveSimCli: null },
    run: () => Effect.succeed({ code: 0, stdout: "Pixel_API_35\n", stderr: "" }),
  };
  const host: DeviceHost.DeviceHost["Service"] = {
    ...(inspectError
      ? {
          inspect: Effect.fail(
            new DeviceHost.DeviceHostError({
              hostId: LOCAL_DEVICE_HOST_ID,
              step: "probe",
              cause: new Error("offline"),
            }),
          ),
        }
      : {}),
    id: LOCAL_DEVICE_HOST_ID,
    summary: Effect.succeed({
      id: LOCAL_DEVICE_HOST_ID,
      kind: "local",
      label: "Test server",
      platforms: [{ platform: "android", available: true }],
      hubInstalled: true,
      agentDeviceInstalled: false,
    }),
    platformAvailability: (platform) => Effect.succeed({ platform, available: true }),
    ensureReady: (onPhase) =>
      Effect.gen(function* () {
        if (runtimeFailure) return yield* runtimeFailure;
        starts.push("start");
        yield* onPhase("installing", "Updating device hub from 0.9.0 to 0.10.1…");
        return ready;
      }),
    ensureAgentReady: (onPhase) =>
      Effect.gen(function* () {
        if (runtimeFailure) return yield* runtimeFailure;
        agentStarts.push("start");
        yield* onPhase("starting");
        return {
          ...ready,
          agentDevice: { baseUrl: "http://agent.test", token: "test", entryPath: "/agent" },
        };
      }),
    current: Effect.sync(() => (starts.at(-1) === "start" ? ready : null)),
    stopAgent: Effect.sync(() => {
      agentStops.push("stop");
    }),
    stop: Effect.sync(() => {
      starts.push("stop");
    }),
  };
  const service = yield* DeviceService.makeWithHosts(
    new Map([[host.id, host]]),
    undefined,
    {
      providerActive: () => true,
      configForGrant: (grant, proxy) =>
        Effect.sync(() => {
          grants.set(grant.id, { grant, proxy });
          return { command: "agent-device", configPath: grant.id };
        }),
    },
    installTool,
  ).pipe(
    Effect.provideService(DeviceHost.DeviceHost, host),
    Effect.provideService(ServerSettings.ServerSettingsService, settings),
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.gen(function* () {
          requests.push(request.url);
          if (request.url.includes("/api/screenshot")) {
            return HttpClientResponse.fromWeb(
              request,
              new Response(new Uint8Array([137, 80, 78, 71])),
            );
          }
          if (request.url.endsWith("/shutdown")) {
            shutDown = true;
            booted = false;
            return HttpClientResponse.fromWeb(request, Response.json({ ok: true }));
          }
          if (shutDown && failListAfterShutdown) {
            return HttpClientResponse.fromWeb(
              request,
              new Response("Discovery busy", { status: 503 }),
            );
          }
          if (request.url.endsWith("/boot")) {
            yield* onBoot;
            booted = true;
            return HttpClientResponse.fromWeb(
              request,
              Response.json(
                bootError ? { ok: false, error: bootError } : { ok: true, serial: "emulator-5554" },
              ),
            );
          }
          return HttpClientResponse.fromWeb(
            request,
            Response.json({
              simulators: [],
              emulators: booted
                ? [
                    {
                      id: "emulator-5554",
                      name: "Pixel_API_35",
                      platform: "android",
                      version: "Android 15",
                      booted: true,
                      physical: false,
                    },
                  ]
                : [],
            }),
          );
        }),
      ),
    ),
  );
  return { service, starts, agentStarts, agentStops, requests, settings, grants };
});

describe("device settings revocation", () => {
  const liveSettings = ServerSettings.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        ServerConfig.layerTest(process.cwd(), { prefix: "tabs-device-settings-test-" }),
        SqlitePersistence.layerMemory,
        Layer.succeed(ServerSecretStore, {
          get: () => Effect.succeed(Option.none()),
          set: () => Effect.die("Unexpected secret write"),
          create: () => Effect.die("Unexpected secret creation"),
          getOrCreateRandom: () => Effect.die("Unexpected secret generation"),
          remove: () => Effect.void,
        }),
      ),
    ),
    Layer.provide(NodeServices.layer),
  );

  it.effect.each(["agent", "support"] as const)(
    "revokes %s access before general settings returns and keeps old grants revoked after re-enable",
    (permission) =>
      Effect.gen(function* () {
        const { service, settings, starts, agentStops, grants } = yield* fixture();
        const caller = {
          threadId: ThreadId.make("settings-revocation"),
          providerInstanceId: ProviderInstanceId.make("codex"),
          providerSessionId: "provider-session",
        };
        const open = (deviceId: DeviceId) =>
          service.open({
            threadId: caller.threadId,
            platform: "android",
            deviceId,
          });
        yield* service.configure({ enabled: true, agentAccessEnabled: true });
        const attachment = yield* open(DeviceId.make("Pixel_API_35"));
        const { configPath } = yield* service.agentTarget(attachment, caller, "/agent");
        const { grant, proxy } = grants.get(configPath)!;
        const checkAccess = yield* service.authorizeScreenshotTransfer(caller);
        const checkLive = yield* service.authorizeScreenshotTransfer(caller, {
          kind: "live",
          attachment,
        });
        const checkComparison = yield* service.authorizeScreenshotTransfer(caller, {
          kind: "comparison",
          attachment,
        });
        expect(proxy.lookup(grant.token)).toBe(grant);
        expect(yield* service.streamInputAllowed(attachment.hostId, attachment.deviceId)).toBe(
          false,
        );
        const states = yield* service.subscribe;

        // Keep host cleanup and its published state behind the lifecycle lock.
        const acquired = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const locked = yield* service
          .withLifecycleLock(
            Deferred.succeed(acquired, undefined).pipe(Effect.andThen(Deferred.await(release))),
          )
          .pipe(Effect.forkChild);
        yield* Deferred.await(acquired);
        const persistedFlag =
          permission === "agent" ? "enableAgentDeviceAccess" : "enableDeviceSupport";
        if (permission === "agent") {
          yield* settings.updateSettings({ [persistedFlag]: false });
        } else {
          yield* settings.updateProviderInstance(
            { operation: "remove", instanceId: ProviderInstanceId.make("unused-test-provider") },
            { [persistedFlag]: false },
          );
        }

        expect((yield* service.state).agentAccessEnabled).toBe(true);
        expect((yield* service.state).sessions).toEqual([attachment]);
        expect(proxy.lookup(grant.token)).toBeUndefined();
        expect(
          (yield* Effect.result(
            proxy.dispatch(grant, () => Effect.die("Revoked grant reached the host"), false),
          ))._tag,
        ).toBe("Failure");
        expect(checkAccess()).toBe(false);
        expect(checkLive()).toBe(false);
        expect(checkComparison()).toBe(false);
        expect(
          (yield* Effect.result(
            service.comparison(
              {
                action: "requestDeviceApp",
                threadId: caller.threadId,
                device: attachment,
                appId: "com.example.app",
              },
              undefined,
              caller,
            ),
          ))._tag,
        ).toBe("Failure");
        const manualAllowed = permission === "agent";
        expect(yield* service.streamInputAllowed(attachment.hostId, attachment.deviceId)).toBe(
          manualAllowed,
        );
        expect((yield* service.currentReadiness(attachment.hostId)) !== null).toBe(manualAllowed);
        expect(agentStops).toEqual([]);
        expect(starts).not.toContain("stop");

        yield* settings.updateSettings({ [persistedFlag]: true });
        expect(proxy.lookup(grant.token)).toBeUndefined();
        expect(checkAccess()).toBe(false);
        expect((yield* Effect.result(service.authorizeScreenshotTransfer(caller)))._tag).toBe(
          "Failure",
        );
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(locked);
        const disabled = yield* PubSub.take(states);
        const reenabled = yield* PubSub.take(states);
        expect(disabled.agentAccessEnabled).toBe(!manualAllowed);
        expect(disabled.hostStatus === "disabled").toBe(!manualAllowed);
        expect(disabled.sessions).toEqual(manualAllowed ? [attachment] : []);
        expect(reenabled.agentAccessEnabled).toBe(true);
        expect(reenabled.hostStatus).not.toBe("disabled");
        expect(reenabled.sessions).toEqual(disabled.sessions);
        const state = yield* service.configure({ onboardingCompleted: true });
        expect(state.onboardingCompleted).toBe(true);
        expect(state.sessions).toEqual(manualAllowed ? [attachment] : []);
        expect(agentStops).toEqual(manualAllowed ? ["stop"] : []);
        expect(starts.filter((entry) => entry === "stop")).toHaveLength(manualAllowed ? 0 : 1);
        expect(checkLive()).toBe(false);
        expect(checkComparison()).toBe(false);
        const freshCheck = yield* service.authorizeScreenshotTransfer(caller);
        expect(freshCheck()).toBe(true);

        const freshAttachment = manualAllowed ? attachment : yield* open(attachment.deviceId);
        const fresh = yield* service.agentTarget(freshAttachment, caller, "/agent");
        expect(grants.get(fresh.configPath)?.grant.token).not.toBe(grant.token);
        expect(proxy.lookup(grant.token)).toBeUndefined();

        const disable = permission === "agent" ? { agentAccessEnabled: false } : { enabled: false };
        yield* service.configure(disable);
        yield* service.configure(disable);
        expect(agentStops).toHaveLength(manualAllowed ? 2 : 0);
        expect(starts.filter((entry) => entry === "stop")).toHaveLength(manualAllowed ? 0 : 2);
      }).pipe(Effect.provide(liveSettings), Effect.scoped),
  );
});

describe("device setup consent", () => {
  it.effect(
    "preserves missing-runtime guidance and causes through manual and agent readiness",
    () =>
      Effect.gen(function* () {
        const underlying = new Error("private lookup diagnostics");
        const runtimeFailure = new NodeRuntimeUnavailableError({
          feature: "Local device support",
          cause: underlying,
        });
        const { service, settings, requests } = yield* fixture(
          Effect.void,
          undefined,
          false,
          runtimeFailure,
        );
        yield* settings.updateSettings({
          enableDeviceSupport: true,
          enableAgentDeviceAccess: true,
        });
        for (const readiness of [service.readiness(), service.agentReadinessIfSupported()]) {
          const error = yield* readiness.pipe(Effect.flip);
          expect(error).toMatchObject({
            _tag: "DeviceHostUnavailableError",
            reason: expect.stringContaining("Install Node.js"),
            cause: runtimeFailure,
          });
          expect(error.message).not.toContain(underlying.message);
        }
        expect((yield* service.state).hostStatuses[LOCAL_DEVICE_HOST_ID]).toMatchObject({
          status: "failed",
          detail: expect.stringContaining("Install Node.js"),
        });
        expect(requests).toEqual([]);
      }).pipe(Effect.scoped),
  );

  it.effect("listing and provider startup do not start helpers before consent", () =>
    Effect.gen(function* () {
      const { service, starts, requests } = yield* fixture();
      expect((yield* service.list).hostStatus).toBe("disabled");
      expect(yield* service.readinessIfSupported()).toBeNull();
      const readiness = yield* service.readiness().pipe(Effect.result);
      expect(readiness._tag).toBe("Failure");
      expect(starts).toEqual([]);
      expect(requests).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "explicit setup discovers never-booted AVDs; disabling stops helpers and blocks agents",
    () =>
      Effect.gen(function* () {
        const { service, starts, settings } = yield* fixture();
        const state = yield* service.configure({ enabled: true });
        expect((yield* settings.getSettings).enableDeviceSupport).toBe(true);
        expect(state.devices.map((device) => [device.id, device.booted])).toEqual([
          ["Pixel_API_35", false],
        ]);
        expect(starts).toEqual(["start"]);
        const disabled = yield* service.configure({ enabled: false });
        expect(disabled.hostStatus).toBe("disabled");
        expect(disabled.devices).toEqual([]);
        expect((yield* settings.getSettings).enableDeviceSupport).toBe(false);
        expect(yield* service.readinessIfSupported()).toBeNull();
        expect(starts).toEqual(["start", "stop"]);
      }).pipe(Effect.scoped),
  );

  it.effect("boots a stopped Android AVD and uses its emulator serial without duplicating it", () =>
    Effect.gen(function* () {
      const { service, requests } = yield* fixture();
      yield* service.configure({ enabled: true });
      const session = yield* service.open({
        threadId: ThreadId.make("thread-1"),
        deviceId: "Pixel_API_35",
        platform: "android",
      });
      expect(session.deviceId).toBe("emulator-5554");
      expect(requests.filter((url) => url.endsWith("/boot"))).toHaveLength(1);
      const state = yield* service.state;
      expect(state.devices.map((device) => device.id)).toEqual(["emulator-5554"]);
      expect(state.bootingDevices).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.effect("installs agent support only after the separate agent permission", () =>
    Effect.gen(function* () {
      const { service, agentStarts, agentStops, settings } = yield* fixture();
      yield* service.configure({ enabled: true });
      expect(agentStarts).toEqual([]);
      expect(yield* service.agentReadinessIfSupported()).toBeNull();

      yield* service.configure({ agentAccessEnabled: true });
      expect(agentStarts).toEqual(["start"]);
      expect((yield* settings.getSettings).enableAgentDeviceAccess).toBe(true);
      expect((yield* service.state).agentAccessEnabled).toBe(true);

      yield* service.configure({ agentAccessEnabled: false, onboardingCompleted: true });
      expect(agentStops).toEqual(["stop"]);
      expect((yield* service.state).onboardingCompleted).toBe(true);
      expect((yield* settings.getSettings).deviceOnboardingCompleted).toBe(true);
    }).pipe(Effect.scoped),
  );

  it.effect("shares the exact running view and reuses it without touching the hub", () =>
    Effect.gen(function* () {
      const { service, requests, agentStarts } = yield* fixture();
      yield* service.configure({ enabled: true });
      const source = yield* service.open({
        threadId: ThreadId.make("source"),
        deviceId: "Pixel_API_35",
        platform: "android",
      });
      const threadId = ThreadId.make("checkout");
      const input = {
        threadId,
        fromThreadId: source.threadId,
        hostId: source.hostId,
        deviceId: source.deviceId,
        platform: source.platform,
        boot: false,
      } as const;
      const before = requests.length;
      const [copy, retry] = yield* Effect.all([service.open(input), service.open(input)], {
        concurrency: 2,
      });
      expect(copy).toMatchObject({
        threadId,
        hostId: source.hostId,
        deviceId: source.deviceId,
        platform: source.platform,
      });
      expect(retry).toEqual(copy);
      expect((yield* service.state).sessions).toEqual([source, copy]);
      expect(requests).toHaveLength(before);
      expect(agentStarts).toEqual([]);
      expect(yield* Effect.flip(service.open({ ...input, platform: "ios" }))).toMatchObject({
        _tag: "DeviceNotFoundError",
      });
      yield* service.close({
        threadId: source.threadId,
        hostId: source.hostId,
        deviceId: source.deviceId,
      });
      expect(yield* Effect.flip(service.open(input))).toMatchObject({
        _tag: "DeviceNotFoundError",
      });
      expect((yield* service.state).sessions).toEqual([copy]);
      expect(requests).toHaveLength(before);
    }).pipe(Effect.scoped),
  );
});

it.effect.each(["disabled", "quickly re-enabled"] as const)(
  "publishes boot progress and discards the old open after support is %s",
  (outcome) =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      const { service, settings } = yield* fixture(
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(finish))),
      );
      yield* service.configure({ enabled: true });
      const opening = yield* service
        .open({
          threadId: ThreadId.make("thread-1"),
          deviceId: "Pixel_API_35",
          platform: "android",
        })
        .pipe(Effect.result, Effect.forkChild);
      yield* Deferred.await(started);
      expect((yield* service.state).bootingDevices?.map((device) => device.name)).toEqual([
        "Pixel_API_35",
      ]);
      if (outcome === "disabled") {
        yield* service.configure({ enabled: false });
      } else {
        yield* settings.updateSettings({ enableDeviceSupport: false });
        yield* settings.updateSettings({ enableDeviceSupport: true });
        yield* service.configure({});
      }
      yield* Deferred.succeed(finish, undefined);
      expect((yield* Fiber.join(opening))._tag).toBe("Failure");
      const state = yield* service.state;
      expect(state.hostStatus).toBe(outcome === "disabled" ? "disabled" : "ready");
      expect(state.devices.some((device) => device.booted)).toBe(false);
      expect(state.sessions).toEqual([]);
      expect(state.bootingDevices).toEqual([]);
    }).pipe(Effect.scoped),
);

describe("device discovery after server restart", () => {
  it.effect("captures an explicit device before any client lists devices", () =>
    Effect.gen(function* () {
      const { service, settings, requests } = yield* fixture();
      yield* settings.updateSettings({ enableDeviceSupport: true });
      expect((yield* service.state).devices).toEqual([]);
      const capture = yield* service.screenshot({ deviceId: DeviceId.make("Pixel_API_35") });
      expect(capture.device.id).toBe("Pixel_API_35");
      expect(Array.from(capture.png)).toEqual([137, 80, 78, 71]);
      expect(requests.some((url) => url.endsWith("/api/devices"))).toBe(true);
    }).pipe(Effect.scoped),
  );
});

it.effect.each([
  {
    diagnostic: "Insufficient disk space at /private/user/path",
    reason: "disk_space",
    message: "not enough free disk space",
  },
  {
    diagnostic: "Timed out spawning /private/user/command",
    reason: "timeout",
    message: "did not become ready in time",
  },
  {
    diagnostic: "Unexpected failure: secret-token",
    reason: "launch_failed",
    message: "could not start",
  },
] as const)("normalizes boot failure: $reason", ({ diagnostic, message }) =>
  Effect.gen(function* () {
    const { service } = yield* fixture(Effect.void, diagnostic);
    yield* service.configure({ enabled: true });
    const error = yield* service
      .open({
        threadId: ThreadId.make("boot-failure"),
        deviceId: "Pixel_API_35",
        platform: "android",
      })
      .pipe(Effect.flip);
    expect(error._tag).toBe("DeviceBootError");
    expect(error.message).toContain(message);
    expect(error.message).not.toContain(diagnostic);
    expect((yield* service.state).bootingDevices).toEqual([]);
  }).pipe(Effect.scoped),
);

it.effect("keeps shutdown successful when subsequent discovery fails", () =>
  Effect.gen(function* () {
    const { service } = yield* fixture(Effect.void, undefined, true);
    yield* service.configure({ enabled: true });
    const threadId = ThreadId.make("shutdown-refresh");
    const session = yield* service.open({
      threadId,
      deviceId: "Pixel_API_35",
      platform: "android",
    });
    yield* service.close({ threadId, deviceId: session.deviceId, shutdown: true });
    const state = yield* service.state;
    expect(state.sessions).toEqual([]);
    expect(state.devices.find((device) => device.id === session.deviceId)?.booted).toBe(false);
  }).pipe(Effect.scoped),
);

it.effect.each(["shutdown", "close"] as const)(
  "%s releases iOS capture so reopening uses a fresh session",
  (operation) =>
    Effect.gen(function* () {
      const deviceId = DeviceId.make("11111111-1111-1111-1111-111111111111");
      const threadId = ThreadId.make("capture-recovery");
      let booted = true;
      let capture: number | null = null;
      let generation = 0;
      const ready: DeviceHost.DeviceHostReady = {
        nodePath: process.execPath,
        hub: { origin: "http://device.test" },
        helpers: { serveSimAxSettings: null, serveSimCli: null },
        run: () => Effect.succeed({ code: 0, stdout: "", stderr: "" }),
      };
      const host: DeviceHost.DeviceHost["Service"] = {
        id: LOCAL_DEVICE_HOST_ID,
        summary: Effect.succeed({
          id: LOCAL_DEVICE_HOST_ID,
          kind: "local",
          label: "Simulator host",
          platforms: [{ platform: "ios", available: true }],
          hubInstalled: true,
          agentDeviceInstalled: false,
        }),
        platformAvailability: (platform) => Effect.succeed({ platform, available: true }),
        ensureReady: () => Effect.succeed(ready),
        ensureAgentReady: () => Effect.die("Agent access is not used in this test"),
        current: Effect.succeed(ready),
        stopAgent: Effect.void,
        stop: Effect.void,
      };
      const http = HttpClient.make((request) =>
        Effect.sync(() => {
          const path = new URL(request.url).pathname;
          if (path === "/api/devices") {
            return HttpClientResponse.fromWeb(
              request,
              Response.json({
                emulators: [],
                simulators: [
                  {
                    id: deviceId,
                    name: "iPhone",
                    platform: "ios",
                    version: "26",
                    physical: false,
                    booted,
                  },
                ],
              }),
            );
          }
          if (path === "/vendor/serve-sim/grid/api/start") capture ??= ++generation;
          else if (path === "/vendor/serve-sim/grid/api/shutdown") {
            if (request.body._tag !== "Uint8Array") throw new Error("Missing shutdown body");
            expect(decodeJson(new TextDecoder().decode(request.body.body))).toEqual({
              udid: deviceId,
            });
            capture = null;
            booted = false;
          } else if (path === "/api/devices/shutdown") {
            // This route powers off without releasing serve-sim's cached capture.
            booted = false;
          } else if (path === "/api/devices/boot") booted = true;
          else throw new Error(`Unexpected hub path: ${path}`);
          return HttpClientResponse.fromWeb(request, Response.json({ ok: true, id: deviceId }));
        }),
      );
      const service = yield* DeviceService.makeWithHosts(new Map([[host.id, host]])).pipe(
        Effect.provideService(HttpClient.HttpClient, http),
      );
      const input = { threadId, deviceId, platform: "ios" as const };
      yield* service.open(input);
      expect(capture).toBe(1);
      if (operation === "shutdown") yield* service.shutdown(input);
      else yield* service.close({ threadId, deviceId, shutdown: true });
      expect(capture).toBeNull();
      expect((yield* service.state).sessions).toEqual([]);
      yield* service.open(input);
      expect(capture).toBe(2);
      expect((yield* service.state).sessions).toHaveLength(1);
    }).pipe(Effect.provide(ServerSettings.layerTest({ enableDeviceSupport: true })), Effect.scoped),
);

it.effect.each([
  { hubReports: "off", outcome: "succeeds" },
  { hubReports: "booted", outcome: "fails" },
  { hubReports: "missing", outcome: "fails" },
] as const)(
  "iOS shutdown $outcome when serve-sim rejects it and the hub reports the simulator $hubReports",
  ({ hubReports, outcome }) =>
    Effect.gen(function* () {
      const deviceId = DeviceId.make("22222222-2222-2222-2222-222222222222");
      const paths: string[] = [];
      // The device list is stale until shutdown re-reads it from the hub.
      let listed: "booted" | "off" | "missing" = "booted";
      const ready: DeviceHost.DeviceHostReady = {
        nodePath: process.execPath,
        hub: { origin: "http://device.test" },
        helpers: { serveSimAxSettings: null, serveSimCli: null },
        run: () => Effect.succeed({ code: 0, stdout: "", stderr: "" }),
      };
      const host: DeviceHost.DeviceHost["Service"] = {
        id: LOCAL_DEVICE_HOST_ID,
        summary: Effect.succeed({
          id: LOCAL_DEVICE_HOST_ID,
          kind: "local",
          label: "Simulator host",
          platforms: [{ platform: "ios", available: true }],
          hubInstalled: true,
          agentDeviceInstalled: false,
        }),
        platformAvailability: (platform) => Effect.succeed({ platform, available: true }),
        ensureReady: () => Effect.succeed(ready),
        ensureAgentReady: () => Effect.die("Agent access is not used in this test"),
        current: Effect.succeed(ready),
        stopAgent: Effect.void,
        stop: Effect.void,
      };
      const http = HttpClient.make((request) =>
        Effect.sync(() => {
          const path = new URL(request.url).pathname;
          paths.push(path);
          if (path === "/api/devices") {
            return HttpClientResponse.fromWeb(
              request,
              Response.json({
                emulators: [],
                simulators:
                  listed === "missing"
                    ? []
                    : [
                        {
                          id: deviceId,
                          name: "iPhone",
                          platform: "ios",
                          version: "26",
                          physical: false,
                          booted: listed === "booted",
                        },
                      ],
                // A partial listing still decodes; it must not read as "off".
                errors: listed === "missing" ? [{ message: "simctl list failed" }] : [],
              }),
            );
          }
          if (path === "/vendor/serve-sim/grid/api/shutdown") {
            // serve-sim runs `simctl shutdown` bare and returns its failure as-is.
            listed = hubReports;
            return HttpClientResponse.fromWeb(
              request,
              Response.json(
                { ok: false, error: "Unable to shutdown device in current state: Shutdown" },
                { status: 500 },
              ),
            );
          }
          throw new Error(`Unexpected hub path: ${path}`);
        }),
      );
      const service = yield* DeviceService.makeWithHosts(new Map([[host.id, host]])).pipe(
        Effect.provideService(HttpClient.HttpClient, http),
      );
      yield* service.list;
      const exit = yield* Effect.exit(service.shutdown({ deviceId, platform: "ios" }));
      expect(paths.filter((path) => path.endsWith("shutdown"))).toEqual([
        "/vendor/serve-sim/grid/api/shutdown",
      ]);
      if (outcome === "succeeds") {
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(
          (yield* service.state).devices.find((device) => device.id === deviceId)?.booted,
        ).toBe(false);
      } else {
        expect(Exit.isFailure(exit)).toBe(true);
        expect(
          (yield* service.state).devices.find((device) => device.id === deviceId)?.booted,
        ).toBe(true);
      }
    }).pipe(Effect.provide(ServerSettings.layerTest({ enableDeviceSupport: true })), Effect.scoped),
);

it.effect("retry keeps device and agent consent unchanged", () =>
  Effect.gen(function* () {
    const { service, starts, agentStarts } = yield* fixture();
    yield* service.retryHost(LOCAL_DEVICE_HOST_ID);
    expect(starts).toEqual([]);
    expect(agentStarts).toEqual([]);
    yield* service.configure({ enabled: true });
    yield* service.retryHost(LOCAL_DEVICE_HOST_ID);
    expect(agentStarts).toEqual([]);
    yield* service.configure({ agentAccessEnabled: true });
    const before = agentStarts.length;
    yield* service.retryHost(LOCAL_DEVICE_HOST_ID);
    expect(agentStarts.length).toBe(before + 1);
  }).pipe(Effect.scoped),
);

it.effect("publishes update detail for the correct host", () =>
  Effect.gen(function* () {
    const { service } = yield* fixture();
    const changes = yield* service.subscribe;
    yield* service.configure({ enabled: true });
    const states = yield* PubSub.takeAll(changes);
    expect(
      states.some(
        (state) => state.hostStatuses.local?.detail === "Updating device hub from 0.9.0 to 0.10.1…",
      ),
    ).toBe(true);
  }).pipe(Effect.scoped),
);

it.effect("host retry exposes actionable failure without internal IDs or diagnostics", () =>
  Effect.gen(function* () {
    const { service, settings } = yield* fixture(
      Effect.void,
      undefined,
      false,
      new DeviceHost.DeviceHostError({
        hostId: LOCAL_DEVICE_HOST_ID,
        step: "probe",
        cause: "private diagnostics",
      }),
    );
    yield* settings.updateSettings({ enableDeviceSupport: true });
    const state = yield* service.retryHost(LOCAL_DEVICE_HOST_ID);
    expect(state.supportsHostRetry).toBe(true);
    expect(state.hostStatuses[LOCAL_DEVICE_HOST_ID]).toEqual({
      status: "failed",
      detail: "Could not connect to this host over SSH.",
    });
  }).pipe(Effect.scoped),
);

it.effect("version discovery does not grant consent or start device tools", () =>
  Effect.gen(function* () {
    const { service, starts, agentStarts, requests } = yield* fixture();
    const state = yield* service.inspect;
    expect(state.supportsToolInspection).toBe(true);
    expect(state.hostStatus).toBe("disabled");
    expect(state.hosts).toHaveLength(1);
    expect(starts).toEqual([]);
    expect(agentStarts).toEqual([]);
    expect(requests).toEqual([]);
  }).pipe(Effect.scoped),
);

it.effect("failed read-only discovery preserves lifecycle status and installed inventory", () =>
  Effect.gen(function* () {
    const { service, starts } = yield* fixture(Effect.void, undefined, false, undefined, true);
    const state = yield* service.inspect;
    expect(state.supportsToolInspection).toBe(true);
    expect(state.hostStatus).toBe("disabled");
    expect(state.hosts[0]?.hubInstalled).toBe(true);
    expect(state.hosts[0]?.toolInspectionError).toContain("Reconnect the host");
    expect(starts).toEqual([]);
  }).pipe(Effect.scoped),
);

it.effect(
  "manual updates install only the selected tool without enabling access or starting helpers",
  () =>
    Effect.gen(function* () {
      const installed: string[] = [];
      const { service, starts, agentStarts, requests } = yield* fixture(
        Effect.void,
        undefined,
        false,
        undefined,
        false,
        (tool) =>
          Effect.sync(() => {
            installed.push(tool);
          }),
      );
      const before = yield* service.state;
      const state = yield* service.updateTool("agent");
      expect(installed).toEqual(["agent"]);
      expect(state.supportsToolUpdate).toBe(true);
      expect(state.hostStatus).toBe(before.hostStatus);
      expect(state.agentAccessEnabled).toBe(before.agentAccessEnabled);
      expect(state.revision).toBeGreaterThan(before.revision);
      expect(starts).toEqual([]);
      expect(agentStarts).toEqual([]);
      expect(requests).toEqual([]);
      yield* service.updateTool("hub");
      expect(installed).toEqual(["agent", "hub"]);
    }).pipe(Effect.scoped),
);

it.effect("failed manual installation leaves lifecycle state unchanged and can be retried", () =>
  Effect.gen(function* () {
    let attempts = 0;
    const { service, starts, agentStarts } = yield* fixture(
      Effect.void,
      undefined,
      false,
      undefined,
      false,
      () =>
        Effect.suspend(() =>
          ++attempts === 1
            ? Effect.fail(
                new DeviceOperationError({
                  operation: "update device tool",
                  reason: "command_failed",
                  cause: new Error("offline"),
                }),
              )
            : Effect.void,
        ),
    );
    const before = yield* service.state;
    const result = yield* service.updateTool("agent").pipe(Effect.result);
    expect(result._tag).toBe("Failure");
    expect(yield* service.state).toEqual(before);
    yield* service.updateTool("agent");
    expect(attempts).toBe(2);
    expect(starts).toEqual([]);
    expect(agentStarts).toEqual([]);
  }).pipe(Effect.scoped),
);
