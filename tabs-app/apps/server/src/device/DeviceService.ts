/**
 * Device discovery, per-thread device sessions, and the state stream clients
 * render the Device panel from.
 *
 * Discovery and boot go through expo-device-hub's JSON API rather than
 * shelling out to simctl and adb here: the hub already normalizes both
 * platforms into one device shape and is the process that has to know a
 * device is booted before it can stream it. Sessions are the server's own
 * bookkeeping for which thread is looking at which device. A user attachment
 * in the Device panel authorizes device tools in that thread.
 */
import {
  type AuthSessionId,
  type DeviceActionInput,
  type DeviceCloseInput,
  type DeviceConfigureInput,
  type DeviceDetail,
  type DeviceDetailInput,
  type DeviceError,
  type DeviceHostId,
  type DeviceId,
  DeviceBootError,
  DeviceHostUnavailableError,
  DeviceNotFoundError,
  DeviceOperationError,
  type DeviceOpenInput,
  type DevicePlatform,
  DevicePlatformUnavailableError,
  type DeviceServiceState,
  type DeviceSession,
  DeviceComparisonError,
  type DeviceComparisonFrame,
  type DeviceComparisonInput,
  type DeviceComparisonRecording,
  type DeviceComparisonStatus,
  type DeviceShutdownInput,
  type DeviceSummary,
  type SshDeviceHostConfig,
  type DeviceHostSummary,
  type ServerSettings as ServerSettingsSnapshot,
  LOCAL_DEVICE_HOST_ID,
  type ThreadId,
} from "@tabs/contracts";
import * as FileSystem from "effect/FileSystem";
import { resolveNodeExecutable, nodeRuntimeUnavailableMessage } from "@tabs/shared/nodeRuntime";
import * as Path from "effect/Path";
import { ensureAgentDevice, ensureDeviceHub } from "./DeviceToolchain.ts";
import * as ServerConfig from "../config.ts";
import {
  agentDeviceGrantDirectory,
  legacyAgentDeviceConfigPath,
  writeAgentDeviceConfig,
} from "./AgentDeviceTarget.ts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import * as ServerSettings from "../serverSettings.ts";
import { isLocalSshDeviceHost, remoteSshDeviceHosts } from "./localSshDeviceHost.ts";

import { readDeviceDetail, runDeviceAction } from "./DeviceActions.ts";
import { runIosDeviceInput } from "./DeviceIosInput.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as DeviceHost from "./DeviceHost.ts";
import * as SshDeviceHost from "./SshDeviceHost.ts";
import * as Exit from "effect/Exit";
import * as LocalDeviceHost from "./LocalDeviceHost.ts";
import { makeDeviceComparison } from "./DeviceComparison.ts";
import { makeDeviceComparisonStore, type DeviceComparisonStore } from "./DeviceComparisonStore.ts";
import {
  isLiveDeviceAttachment,
  type AgentDeviceGrant,
  type DispatchDeviceReturn,
} from "./AgentDeviceControl.ts";
import { startAgentDeviceProxy } from "./AgentDeviceProxy.ts";
import { rememberDeviceIdentity, sameDeviceIdentity } from "./DeviceIdentity.ts";
import { ensureAgentDeviceShim } from "./AgentDeviceShim.ts";
import { checkDeviceScreen } from "./AgentDevicePrivacy.ts";
import { closeAgentDeviceSession } from "./AgentDeviceSessionCleanup.ts";
import type { McpThreadCaller } from "../mcp/McpInvocationContext.ts";
import { hasActiveMcpDeviceSession } from "../mcp/McpSessionRegistry.ts";
import { makeDeviceSemanticDriver } from "./DeviceSemanticDriver.ts";

/** Origin-relative prefix the hub is proxied under. See DeviceHubProxy. */
export const DEVICE_HUB_ROUTE_PREFIX = "/api/device-hub";

const BOOT_TIMEOUT = Duration.minutes(3);
const SCREENSHOT_TIMEOUT = Duration.seconds(20);

const HubDevice = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  version: Schema.String,
  platform: Schema.Literals(["ios", "android"]),
  booted: Schema.Boolean,
  physical: Schema.Boolean,
});
const HubDeviceList = Schema.Struct({
  simulators: Schema.Array(HubDevice),
  emulators: Schema.Array(HubDevice),
  errors: Schema.optional(Schema.Array(Schema.Struct({ message: Schema.String }))),
});
const HubActionResult = Schema.Struct({
  ok: Schema.Boolean,
  id: Schema.optional(Schema.String),
  serial: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
});

export interface DeviceScreenshot {
  readonly device: DeviceSummary;
  readonly png: Uint8Array;
}

export interface DeviceReadiness extends DeviceHost.DeviceHostReady {
  readonly hostId: DeviceHostId;
}

export interface DeviceAgentReadiness extends DeviceReadiness {
  readonly agentDevice: DeviceHost.AgentDeviceEndpoint;
}

export class DeviceService extends Context.Service<
  DeviceService,
  {
    readonly agentCli: Effect.Effect<string, DeviceError>;
    readonly testHost: (
      config: SshDeviceHostConfig,
    ) => Effect.Effect<DeviceHostSummary, DeviceError>;
    readonly agentTarget: (
      attachment: DeviceSession,
      caller: McpThreadCaller,
      entryPath: string,
      access?: { readonly appId?: string; readonly approvalId?: string },
    ) => Effect.Effect<
      {
        command: string;
        configPath: string;
        session: string;
        appId?: string;
        approvedAppId?: string;
      },
      DeviceError
    >;
    readonly state: Effect.Effect<DeviceServiceState>;
    readonly subscribe: Effect.Effect<PubSub.Subscription<DeviceServiceState>, never, Scope.Scope>;
    readonly configure: (
      input: DeviceConfigureInput,
    ) => Effect.Effect<DeviceServiceState, DeviceError>;
    /** Refreshes devices only after device support has been enabled. */
    readonly list: Effect.Effect<DeviceServiceState, DeviceError>;
    readonly updateTool: (tool: "hub" | "agent") => Effect.Effect<DeviceServiceState, DeviceError>;
    readonly inspect: Effect.Effect<DeviceServiceState>;
    readonly retryHost: (hostId: DeviceHostId) => Effect.Effect<DeviceServiceState, DeviceError>;
    readonly open: (input: DeviceOpenInput) => Effect.Effect<DeviceSession, DeviceError>;
    readonly close: (input: DeviceCloseInput) => Effect.Effect<void, DeviceError>;
    readonly shutdown: (input: DeviceShutdownInput) => Effect.Effect<void, DeviceError>;
    /** Current settings and foreground app for one device. */
    readonly detail: (input: DeviceDetailInput) => Effect.Effect<DeviceDetail, DeviceError>;
    /** Runs one action, then returns the refreshed detail. */
    readonly action: (input: DeviceActionInput) => Effect.Effect<DeviceDetail, DeviceError>;
    readonly screenshot: (input: {
      readonly hostId?: DeviceHostId | undefined;
      readonly deviceId: DeviceId;
    }) => Effect.Effect<DeviceScreenshot, DeviceError>;
    readonly agentScreenshot: (
      attachment: DeviceSession,
      caller: McpThreadCaller,
    ) => Effect.Effect<DeviceScreenshot, DeviceError>;
    readonly authorizeScreenshotTransfer: (
      caller: McpThreadCaller,
      source?:
        | { readonly kind: "live" | "comparison"; readonly attachment: DeviceSession }
        | {
            readonly kind: "firstDifference";
            readonly frame: DeviceComparisonFrame;
            readonly hostId: DeviceHostId;
            readonly deviceId: DeviceId;
            readonly tabId: string;
            readonly grantId: string;
          },
    ) => Effect.Effect<() => boolean, DeviceComparisonError>;
    /** Host endpoints for the proxy and the provider environment. */
    readonly readiness: (hostId?: DeviceHostId) => Effect.Effect<DeviceReadiness, DeviceError>;
    /**
     * `readiness` only when the host can run at least one platform; a machine
     * with no simulator toolchain never installs or starts anything.
     */
    readonly readinessIfSupported: (
      hostId?: DeviceHostId,
    ) => Effect.Effect<DeviceReadiness | null, DeviceError>;
    readonly agentReadinessIfSupported: (
      hostId?: DeviceHostId,
    ) => Effect.Effect<DeviceAgentReadiness | null, DeviceError>;
    readonly currentReadiness: (hostId?: DeviceHostId) => Effect.Effect<DeviceReadiness | null>;
    readonly comparison: (
      input: DeviceComparisonInput,
      sessionId?: AuthSessionId,
      caller?: McpThreadCaller,
      dispatchReturn?: DispatchDeviceReturn,
    ) => Effect.Effect<DeviceComparisonStatus, DeviceComparisonError>;
    readonly comparisonRecording: (
      input: DeviceComparisonRecording,
      caller: McpThreadCaller,
    ) => Effect.Effect<DeviceComparisonStatus, DeviceComparisonError>;
    readonly streamInputAllowed: (hostId: string, deviceId?: string) => Effect.Effect<boolean>;
    readonly sessionsForThread: (threadId: ThreadId) => Effect.Effect<ReadonlyArray<DeviceSession>>;
  }
>()("t3/device/DeviceService") {}

interface ServiceState {
  readonly state: DeviceServiceState;
}

const vendorPrefix = (platform: DevicePlatform) =>
  platform === "ios" ? "/vendor/serve-sim" : "/vendor/serve-emu";

const deviceSettings = (settings: ServerSettingsSnapshot) => ({
  enabled: settings.enableDeviceSupport,
  agentAccessEnabled: settings.enableAgentDeviceAccess,
  onboardingCompleted: settings.deviceOnboardingCompleted,
});

export const makeWithHosts = Effect.fn("DeviceService.makeWithHosts")(function* (
  hosts: ReadonlyMap<DeviceHostId, DeviceHost.DeviceHost["Service"]>,
  testHost: DeviceService["Service"]["testHost"] = (host) =>
    Effect.fail(
      new DeviceHostUnavailableError({
        hostId: host.id,
        reason: "SSH probing is unavailable in this device service.",
      }),
    ),
  agentControl?: {
    readonly providerActive: (caller: McpThreadCaller) => boolean;
    readonly configForGrant: (
      grant: AgentDeviceGrant,
      proxy: Parameters<typeof startAgentDeviceProxy>[0],
      entryPath: string,
    ) => Effect.Effect<{ command: string; configPath: string }, DeviceError>;
  },
  installTool?: (tool: "hub" | "agent") => Effect.Effect<unknown, DeviceError>,
  comparisonStore?: DeviceComparisonStore,
) {
  const settings = yield* ServerSettings.ServerSettingsService;
  const settingsScope = yield* Effect.serviceOption(Scope.Scope);
  const observeSettings = Option.isSome(settingsScope) ? settings.observeCommits : undefined;
  const lifecycleLock = yield* Semaphore.make(1);
  const readPersistedDeviceSettings = settings.getSettings.pipe(
    Effect.map(deviceSettings),
    Effect.mapError(
      (cause) =>
        new DeviceOperationError({ operation: "settings", reason: "settings_failed", cause }),
    ),
  );
  const initialSettings = yield* readPersistedDeviceSettings;
  let committedSettings = initialSettings;
  let supportEpoch = 0;
  let accessEpoch = 0;
  let pendingHostStops = 0;
  let pendingAgentStops = 0;
  const supportAllowed = () => committedSettings.enabled && pendingHostStops === 0;
  const agentAccessAllowed = () =>
    supportAllowed() && committedSettings.agentAccessEnabled && pendingAgentStops === 0;
  const readDeviceSettings = observeSettings
    ? Effect.sync(() => ({
        ...committedSettings,
        enabled: supportAllowed(),
        agentAccessEnabled: agentAccessAllowed(),
      }))
    : readPersistedDeviceSettings;

  const controlState = (state: DeviceServiceState): DeviceServiceState => ({
    ...state,
    hostStatus: supportAllowed() ? state.hostStatus : "disabled",
    agentAccessEnabled: agentAccessAllowed(),
  });

  const httpClient = (yield* HttpClient.HttpClient).pipe(HttpClient.withScope);
  const statePubSub = yield* PubSub.unbounded<DeviceServiceState>();
  const initialHosts = yield* Effect.forEach(hosts.values(), (host) => host.summary);
  let publishedHosts = new Map(hosts);
  const stateRef = yield* SynchronizedRef.make<ServiceState>({
    state: {
      supportsHostRetry: true,
      supportsToolUpdate: installTool !== undefined,
      supportsToolInspection: true,
      hosts: initialHosts,
      hostStatus: initialSettings.enabled ? "idle" : "disabled",
      hostStatuses: {},
      devices: [],
      sessions: [],
      onboardingCompleted: initialSettings.onboardingCompleted,
      agentAccessEnabled: initialSettings.agentAccessEnabled,
      hubBasePath: DEVICE_HUB_ROUTE_PREFIX,
      revision: 0,
    },
  });

  const publishSnapshot = (state: DeviceServiceState, revision: number) => {
    const next = { ...state, revision };
    comparison.reconcile(controlState(next));
    return PubSub.publish(statePubSub, next).pipe(Effect.as({ state: next }));
  };

  const publish = (update: (state: DeviceServiceState) => DeviceServiceState) =>
    SynchronizedRef.updateAndGetEffect(stateRef, ({ state }) =>
      publishSnapshot(update(state), state.revision + 1),
    ).pipe(Effect.map(({ state }) => state));

  const resolveHost = (hostId: DeviceHostId | undefined) =>
    Effect.gen(function* () {
      const id = hostId ?? LOCAL_DEVICE_HOST_ID;
      const host = hosts.get(id);
      if (!host) {
        return yield* new DeviceHostUnavailableError({ hostId: id, reason: "Unknown host." });
      }
      return host;
    });

  const setHostStatus = (
    hostId: DeviceHostId,
    status: DeviceServiceState["hostStatuses"][string],
  ) =>
    Effect.suspend(() =>
      !hosts.has(hostId)
        ? SynchronizedRef.get(stateRef).pipe(Effect.map(({ state }) => state))
        : publish((state) => ({
            ...state,
            ...(hostId === LOCAL_DEVICE_HOST_ID
              ? { hostStatus: status.status, hostStatusDetail: status.detail }
              : {}),
            hostStatuses: { ...state.hostStatuses, [hostId]: status },
          })),
    );

  const readiness: DeviceService["Service"]["readiness"] = Effect.fn("DeviceService.readiness")(
    function* (hostId) {
      const epoch = supportEpoch;
      const host = yield* resolveHost(hostId);
      if (!(yield* readDeviceSettings).enabled) {
        return yield* new DeviceHostUnavailableError({
          hostId: host.id,
          reason:
            "Device support is off. Enable it in the Device panel before installing or starting device tools.",
        });
      }
      const ready = yield* host
        .ensureReady((status, detail) =>
          setHostStatus(host.id, { status, detail }).pipe(Effect.asVoid),
        )
        .pipe(
          Effect.tapError((error) =>
            setHostStatus(host.id, { status: "failed", detail: error.message }),
          ),
          Effect.mapError(
            (error) =>
              new DeviceHostUnavailableError({
                hostId: host.id,
                reason:
                  error._tag === "NodeRuntimeUnavailableError"
                    ? nodeRuntimeUnavailableMessage("Local device support")
                    : error.step === "probe"
                      ? "Could not connect to this host over SSH."
                      : `Device support failed during ${error.step}.`,
                cause: error,
              }),
          ),
        );
      if (hosts.get(host.id) !== host)
        return yield* new DeviceHostUnavailableError({
          hostId: host.id,
          reason: "Host configuration changed. Retry the operation.",
        });
      const { state } = yield* SynchronizedRef.get(stateRef);
      if (state.hostStatuses[host.id]?.status !== "ready") {
        yield* setHostStatus(host.id, { status: "ready" });
      }
      if (epoch !== supportEpoch)
        return yield* new DeviceHostUnavailableError({
          hostId: host.id,
          reason: "Device support was turned off while the device host was starting.",
        });
      return { hostId: host.id, ...ready };
    },
    lifecycleLock.withPermit,
  );

  const readinessIfSupported: DeviceService["Service"]["readinessIfSupported"] = Effect.fn(
    "DeviceService.readinessIfSupported",
  )(function* (hostId) {
    if (!(yield* readDeviceSettings).enabled) return null;
    const host = yield* resolveHost(hostId);
    const summary = yield* host.summary;
    if (summary.kind === "local" && !summary.platforms.some((platform) => platform.available))
      return null;
    return yield* readiness(host.id);
  });

  const agentReadinessIfSupported: DeviceService["Service"]["agentReadinessIfSupported"] =
    Effect.fn("DeviceService.agentReadinessIfSupported")(function* (hostId) {
      const epoch = accessEpoch;
      const deviceSettings = yield* readDeviceSettings;
      if (!deviceSettings.enabled || !deviceSettings.agentAccessEnabled) return null;
      const host = yield* resolveHost(hostId);
      const summary = yield* host.summary;
      if (summary.kind === "local" && !summary.platforms.some((platform) => platform.available))
        return null;
      const ready = yield* host
        .ensureAgentReady((phase, detail) =>
          setHostStatus(host.id, { status: phase, detail }).pipe(Effect.asVoid),
        )
        .pipe(
          Effect.tapError((error) =>
            setHostStatus(host.id, { status: "failed", detail: error.message }),
          ),
          Effect.mapError(
            (error) =>
              new DeviceHostUnavailableError({
                hostId: host.id,
                reason:
                  error._tag === "NodeRuntimeUnavailableError"
                    ? nodeRuntimeUnavailableMessage("Local device support")
                    : error._tag === "DeviceHostTimeoutError"
                      ? `Agent tools did not start within ${error.timeoutMs} ms.`
                      : error.step === "probe"
                        ? "Could not connect to this host over SSH."
                        : `Device support failed during ${error.step}.`,
                cause: error,
              }),
          ),
        );
      if (epoch !== accessEpoch) return null;
      const hostSummaries = yield* Effect.forEach(hosts.values(), (candidate) => candidate.summary);
      yield* publish((state) => ({ ...state, hosts: hostSummaries }));
      yield* setHostStatus(host.id, { status: "ready" });
      return epoch === accessEpoch ? { hostId: host.id, ...ready } : null;
    }, lifecycleLock.withPermit);

  const currentReadiness: DeviceService["Service"]["currentReadiness"] = (hostId) =>
    Effect.gen(function* () {
      const epoch = supportEpoch;
      if (!(yield* readDeviceSettings).enabled) return null;
      const host = yield* resolveHost(hostId);
      const ready = yield* host.current;
      return ready && (yield* readDeviceSettings).enabled && epoch === supportEpoch
        ? { hostId: host.id, ...ready }
        : null;
    }).pipe(Effect.orElseSucceed(() => null));

  const hubJson = <A, I>(
    request: HttpClientRequest.HttpClientRequest,
    schema: Schema.Codec<A, I>,
    operation: string,
    timeout: Duration.Input = Duration.seconds(15),
  ) =>
    httpClient.execute(request).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
      Effect.scoped,
      Effect.timeout(timeout),
      Effect.mapError(
        (cause) =>
          new DeviceOperationError({
            operation,
            reason: "request_failed",
            cause,
          }),
      ),
    );

  const fetchDevices = Effect.fn("DeviceService.fetchDevices")(function* (ready: DeviceReadiness) {
    const list = yield* hubJson(
      HttpClientRequest.get(`${ready.hub.origin}/api/devices`),
      HubDeviceList,
      "list",
    );
    const toSummary = (device: typeof HubDevice.Type): DeviceSummary => ({
      hostId: ready.hostId,
      id: device.id,
      platform: device.platform,
      name: device.name,
      version: device.version,
      booted: device.booted,
      physical: device.physical,
    });
    const devices = [...list.simulators, ...list.emulators].map(toSummary);
    const host = yield* resolveHost(ready.hostId);
    if ((yield* host.platformAvailability("android")).available) {
      const avds = yield* ready.run("emulator", ["-list-avds"]);
      if (avds.code !== 0) {
        return yield* new DeviceOperationError({
          operation: "list",
          reason: "command_failed",
          exitCode: avds.code,
          cause: avds,
        });
      }
      for (const name of avds.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)) {
        if (!devices.some((device) => device.platform === "android" && device.name === name)) {
          devices.push({
            hostId: ready.hostId,
            id: name,
            name,
            platform: "android",
            version: "Android",
            booted: false,
            physical: false,
          });
        }
      }
    }
    return { devices, detail: list.errors?.map((error) => error.message).join("\n") || undefined };
  });

  const refresh = Effect.fn("DeviceService.refresh")(function* (
    ready: DeviceReadiness,
    epoch = supportEpoch,
  ) {
    const host = hosts.get(ready.hostId);
    const { devices, detail } = yield* fetchDevices(ready);
    const hostSummaries = yield* Effect.forEach(hosts.values(), (host) => host.summary);
    return yield* lifecycleLock.withPermit(
      Effect.gen(function* () {
        if (
          !(yield* readDeviceSettings).enabled ||
          epoch !== supportEpoch ||
          !host ||
          hosts.get(ready.hostId) !== host
        )
          return (yield* SynchronizedRef.get(stateRef)).state;
        return yield* publish((state) => ({
          ...state,
          hosts: hostSummaries,
          ...(ready.hostId === LOCAL_DEVICE_HOST_ID ? { hostStatusDetail: detail } : {}),
          devices: [
            ...state.devices.filter((device) => device.hostId !== ready.hostId),
            ...devices,
          ],
          // A device that vanished (or whose serial now belongs to another device) cannot
          // keep a session; publishing the pruned state also revokes its agent grants.
          sessions: state.sessions.filter(
            (session) =>
              session.hostId !== ready.hostId ||
              devices.some(
                (device) =>
                  device.id === session.deviceId &&
                  device.platform === session.platform &&
                  sameDeviceIdentity(session, device),
              ),
          ),
          hostStatuses: {
            ...state.hostStatuses,
            [ready.hostId]: { status: "ready", ...(detail ? { detail } : {}) },
          },
        }));
      }),
    );
  });

  const list: DeviceService["Service"]["list"] = Effect.gen(function* () {
    if (!(yield* readDeviceSettings).enabled) return (yield* SynchronizedRef.get(stateRef)).state;
    yield* Effect.forEach(
      hosts.values(),
      (host) =>
        Effect.gen(function* () {
          const ready = yield* readinessIfSupported(host.id);
          if (ready) yield* refresh(ready);
        }).pipe(
          Effect.catch((error) =>
            setHostStatus(host.id, {
              status: "failed",
              detail: error._tag === "DeviceHostUnavailableError" ? error.reason : error.message,
            }),
          ),
        ),
      { concurrency: 4 },
    );
    return (yield* SynchronizedRef.get(stateRef)).state;
  }).pipe(Effect.withSpan("DeviceService.list"));

  const inspect = Effect.gen(function* () {
    yield* Effect.forEach(
      hosts.values(),
      (host) =>
        Effect.gen(function* () {
          const result = yield* (host.inspect ?? host.summary).pipe(Effect.result);
          if (hosts.get(host.id) !== host) return;
          if (result._tag === "Failure") {
            yield* publish((state) => ({
              ...state,
              hosts: state.hosts.map((value) =>
                value.id === host.id
                  ? {
                      ...value,
                      toolInspectionError:
                        "Cannot check versions. Reconnect the host and check again. Installed tools have not been changed.",
                    }
                  : value,
              ),
            }));
            return;
          }
          yield* publish((state) => ({
            ...state,
            hosts: state.hosts.map((value) => (value.id === host.id ? result.success : value)),
          }));
        }),
      { concurrency: 4 },
    );
    return (yield* SynchronizedRef.get(stateRef)).state;
  });

  const retryHost: DeviceService["Service"]["retryHost"] = Effect.fn("DeviceService.retryHost")(
    function* (hostId) {
      yield* resolveHost(hostId);
      if (!(yield* readDeviceSettings).enabled) return (yield* SynchronizedRef.get(stateRef)).state;
      yield* Effect.gen(function* () {
        const ready =
          (yield* agentReadinessIfSupported(hostId)) ?? (yield* readinessIfSupported(hostId));
        if (ready) yield* refresh(ready);
      }).pipe(
        Effect.catch((error) =>
          setHostStatus(hostId, {
            status: "failed",
            detail: error._tag === "DeviceHostUnavailableError" ? error.reason : error.message,
          }),
        ),
      );
      return (yield* SynchronizedRef.get(stateRef)).state;
    },
  );

  const configure: DeviceService["Service"]["configure"] = Effect.fn("DeviceService.configure")(
    function* (input) {
      const updated = yield* settings
        .updateSettings({
          ...(input.enabled === undefined ? {} : { enableDeviceSupport: input.enabled }),
          ...(input.agentAccessEnabled === undefined
            ? {}
            : { enableAgentDeviceAccess: input.agentAccessEnabled }),
          ...(input.onboardingCompleted === undefined
            ? {}
            : { deviceOnboardingCompleted: input.onboardingCompleted }),
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new DeviceOperationError({
                operation: "configure",
                reason: "settings_failed",
                cause,
              }),
          ),
        );
      if (!observeSettings) onSettingsCommit(updated);
      yield* applySettingsChanges;
      if (input.agentAccessEnabled === true) yield* agentReadinessIfSupported();
      return yield* list;
    },
  );

  const findDevice = (
    state: DeviceServiceState,
    hostId: DeviceHostId,
    deviceId: DeviceId,
  ): DeviceSummary | undefined =>
    state.devices.find((device) => device.hostId === hostId && device.id === deviceId);

  const ensurePlatform = Effect.fn("DeviceService.ensurePlatform")(function* (
    host: DeviceHost.DeviceHost["Service"],
    platform: DevicePlatform,
  ) {
    const availability = yield* host.platformAvailability(platform);
    if (!availability.available) {
      return yield* new DevicePlatformUnavailableError({
        hostId: host.id,
        platform,
        reason: availability.reason ?? "Platform toolchain missing.",
      });
    }
  });

  /**
   * Boot through the hub so its device list and the streaming helper both see
   * the device come up. Android AVDs change id when they boot (AVD name to
   * emulator serial), so the returned id is authoritative.
   */
  const boot = Effect.fn("DeviceService.boot")(function* (
    ready: DeviceReadiness,
    device: DeviceSummary,
  ) {
    const result = yield* HttpClientRequest.post(`${ready.hub.origin}/api/devices/boot`).pipe(
      HttpClientRequest.bodyJson({ platform: device.platform, id: device.id, name: device.name }),
      Effect.mapError(
        (cause) =>
          new DeviceOperationError({ operation: "boot", reason: "invalid_payload", cause }),
      ),
      Effect.flatMap((request) => hubJson(request, HubActionResult, "boot", BOOT_TIMEOUT)),
    );
    if (!result.ok) {
      return yield* new DeviceBootError({
        hostId: ready.hostId,
        deviceId: device.id,
        reason: /insufficient.*(?:disk|space)|not enough.*(?:disk|space)|no space left/i.test(
          result.error ?? "",
        )
          ? "disk_space"
          : /timed? out|timeout/i.test(result.error ?? "")
            ? "timeout"
            : "launch_failed",
        cause: result,
      });
    }
    if (device.platform === "ios") {
      // Booting alone does not attach a serve-sim helper; the grid start
      // does both and is idempotent for a booted simulator.
      yield* HttpClientRequest.post(
        `${ready.hub.origin}${vendorPrefix("ios")}/grid/api/start`,
      ).pipe(
        HttpClientRequest.bodyJson({ udid: device.id }),
        Effect.mapError(
          (cause) =>
            new DeviceOperationError({ operation: "boot", reason: "invalid_payload", cause }),
        ),
        Effect.flatMap((request) =>
          hubJson(request, HubActionResult, "attach stream", BOOT_TIMEOUT),
        ),
      );
    }
    return result.serial ?? result.id ?? device.id;
  });

  const open: DeviceService["Service"]["open"] = Effect.fn("DeviceService.open")(function* (input) {
    const epoch = supportEpoch;
    const host = yield* resolveHost(input.hostId);
    const checkSupport = Effect.gen(function* () {
      if (!(yield* readDeviceSettings).enabled || epoch !== supportEpoch)
        return yield* new DeviceHostUnavailableError({
          hostId: host.id,
          reason: "Device support was turned off while the device was opening.",
        });
    });
    if (input.fromThreadId !== undefined) {
      return yield* lifecycleLock.withPermit(
        Effect.gen(function* () {
          yield* checkSupport;
          if (hosts.get(host.id) !== host)
            return yield* new DeviceHostUnavailableError({
              hostId: host.id,
              reason: "Device support or the host configuration changed.",
            });
          return yield* SynchronizedRef.modifyEffect(stateRef, (snapshot) =>
            Effect.gen(function* () {
              const { state } = snapshot;
              const device = findDevice(state, host.id, input.deviceId);
              const matches = (session: DeviceSession) =>
                session.hostId === host.id &&
                session.deviceId === input.deviceId &&
                session.platform === input.platform;
              if (
                !device?.booted ||
                device.platform !== input.platform ||
                !state.sessions.some(
                  (session) => session.threadId === input.fromThreadId && matches(session),
                )
              )
                return yield* new DeviceNotFoundError({
                  hostId: host.id,
                  deviceId: input.deviceId,
                });
              const existing = state.sessions.find(
                (session) => session.threadId === input.threadId && matches(session),
              );
              if (existing) return [existing, snapshot] as const;
              const session: DeviceSession = rememberDeviceIdentity(
                {
                  threadId: input.threadId,
                  hostId: host.id,
                  deviceId: device.id,
                  platform: device.platform,
                  openedAt: DateTime.formatIso(yield* DateTime.now),
                },
                device,
              );
              yield* checkSupport;
              const next = yield* publishSnapshot(
                { ...state, sessions: [...state.sessions, session] },
                state.revision + 1,
              );
              return [session, next] as const;
            }),
          );
        }),
      );
    }
    yield* ensurePlatform(host, input.platform);
    const ready = yield* readiness(host.id);
    let state = yield* refresh(ready, epoch);
    yield* checkSupport;
    let device = findDevice(state, host.id, input.deviceId);
    if (!device) {
      return yield* new DeviceNotFoundError({ hostId: host.id, deviceId: input.deviceId });
    }
    if (!device.booted && input.boot !== false) {
      const booting = { ...device, threadId: input.threadId };
      yield* publish((current) => ({
        ...current,
        bootingDevices: [
          ...(current.bootingDevices ?? []).filter(
            (entry) => entry.hostId !== booting.hostId || entry.id !== booting.id,
          ),
          booting,
        ],
      }));
      const bootedId = yield* boot(ready, device).pipe(
        Effect.ensuring(
          publish((current) => ({
            ...current,
            bootingDevices: (current.bootingDevices ?? []).filter(
              (entry) => entry.hostId !== booting.hostId || entry.id !== booting.id,
            ),
          })),
        ),
      );
      yield* checkSupport;
      state = yield* refresh(ready, epoch);
      device = findDevice(state, host.id, bootedId) ?? findDevice(state, host.id, device.id);
      if (!device) {
        return yield* new DeviceNotFoundError({ hostId: host.id, deviceId: bootedId });
      }
    } else if (device.platform === "ios" && device.booted) {
      // A simulator booted outside T3 has no helper attached yet.
      yield* HttpClientRequest.post(
        `${ready.hub.origin}${vendorPrefix("ios")}/grid/api/start`,
      ).pipe(
        HttpClientRequest.bodyJson({ udid: device.id }),
        Effect.mapError(
          (cause) =>
            new DeviceOperationError({ operation: "open", reason: "invalid_payload", cause }),
        ),
        Effect.flatMap((request) =>
          hubJson(request, HubActionResult, "attach stream", BOOT_TIMEOUT),
        ),
      );
    }
    if (hosts.get(host.id) !== host)
      return yield* new DeviceHostUnavailableError({
        hostId: host.id,
        reason: "Host configuration changed. Retry the operation.",
      });
    const openedAt = DateTime.formatIso(yield* DateTime.now);
    const session: DeviceSession = rememberDeviceIdentity(
      {
        threadId: input.threadId,
        hostId: host.id,
        deviceId: device.id,
        platform: device.platform,
        openedAt,
      },
      device,
    );
    yield* lifecycleLock.withPermit(
      Effect.gen(function* () {
        yield* checkSupport;
        yield* publish((current) => ({
          ...current,
          sessions: [
            ...current.sessions.filter(
              (existing) =>
                !(
                  existing.threadId === session.threadId &&
                  existing.hostId === session.hostId &&
                  existing.deviceId === session.deviceId
                ),
            ),
            session,
          ],
        }));
      }),
    );
    return session;
  });

  const shutdownDevice = Effect.fn("DeviceService.shutdownDevice")(function* (
    hostId: DeviceHostId,
    deviceId: DeviceId,
    platform: DevicePlatform,
  ) {
    const ready = yield* readiness(hostId);
    const postShutdown = (path: string, body: Record<string, string>) =>
      HttpClientRequest.post(`${ready.hub.origin}${path}`).pipe(
        HttpClientRequest.bodyJson(body),
        Effect.mapError(
          (cause) =>
            new DeviceOperationError({ operation: "shutdown", reason: "invalid_payload", cause }),
        ),
        Effect.flatMap((request) => hubJson(request, HubActionResult, "shutdown")),
        Effect.flatMap((result) =>
          result.ok
            ? Effect.void
            : Effect.fail(
                new DeviceOperationError({
                  operation: "shutdown",
                  reason: "hub_rejected",
                  cause: result,
                }),
              ),
        ),
      );
    // serve-sim's shutdown closes its in-process capture session before it runs
    // `simctl shutdown`; the hub's generic shutdown can leave that session cached
    // across a reboot. serve-sim runs simctl bare, though, so a simulator that is
    // already off fails there. Accept that failure only when the hub confirms
    // the simulator is off; a failure on a running one still surfaces.
    yield* platform === "ios"
      ? postShutdown(`${vendorPrefix("ios")}/grid/api/shutdown`, { udid: deviceId }).pipe(
          Effect.catch((cause) =>
            fetchDevices(ready).pipe(
              Effect.flatMap(({ devices }) =>
                devices.find((device) => device.id === deviceId)?.booted === false
                  ? Effect.logInfo("iOS simulator was already shut down", { deviceId })
                  : Effect.fail(cause),
              ),
            ),
          ),
        )
      : postShutdown("/api/devices/shutdown", { platform, id: deviceId });
    yield* publish((state) => ({
      ...state,
      devices: state.devices.map((device) =>
        device.hostId === ready.hostId && device.id === deviceId
          ? { ...device, booted: false }
          : device,
      ),
      sessions: state.sessions.filter(
        (session) => !(session.hostId === ready.hostId && session.deviceId === deviceId),
      ),
    }));
    // Discovery can stall while an emulator saves its snapshot. A failed
    // refresh must not turn an accepted shutdown into an action failure.
    yield* refresh(ready).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Device discovery unavailable after shutdown", { cause }),
      ),
    );
  });

  const close: DeviceService["Service"]["close"] = Effect.fn("DeviceService.close")(
    function* (input) {
      const { state } = yield* SynchronizedRef.get(stateRef);
      const closing = state.sessions.filter(
        (session) =>
          session.threadId === input.threadId &&
          (input.hostId === undefined || session.hostId === input.hostId) &&
          (input.deviceId === undefined || session.deviceId === input.deviceId),
      );
      if (closing.length === 0) return;
      if (
        input.shutdown &&
        closing.some((session) => !comparison.inputAllowed(session.hostId, session.deviceId))
      ) {
        return yield* comparisonDeviceError(
          new DeviceComparisonError({
            reason: "Stop the managed comparison before shutting down this device.",
          }),
        );
      }
      yield* publish((current) => ({
        ...current,
        sessions: current.sessions.filter((session) => !closing.includes(session)),
      }));
      if (input.shutdown) {
        yield* Effect.forEach(
          closing,
          (session) =>
            comparison
              .manual(session, shutdownDevice(session.hostId, session.deviceId, session.platform))
              .pipe(Effect.mapError(mapComparisonDeviceError)),
          { discard: true },
        );
      }
    },
  );

  const shutdown: DeviceService["Service"]["shutdown"] = Effect.fn("DeviceService.shutdown")(
    function* (input) {
      const host = yield* resolveHost(input.hostId);
      yield* comparison
        .manual(
          { hostId: host.id, deviceId: input.deviceId },
          shutdownDevice(host.id, input.deviceId, input.platform),
        )
        .pipe(Effect.mapError(mapComparisonDeviceError));
      // Sessions on a powered-off device are stale in every thread.
      yield* publish((current) => ({
        ...current,
        sessions: current.sessions.filter(
          (session) => !(session.hostId === host.id && session.deviceId === input.deviceId),
        ),
      }));
    },
  );

  const captureScreenshot = <E>(
    input: Parameters<DeviceService["Service"]["screenshot"]>[0],
    guard: Effect.Effect<void, E>,
  ) =>
    Effect.gen(function* () {
      const { ready, device } = yield* resolveDevice(input.hostId, input.deviceId);
      const url = `${ready.hub.origin}${vendorPrefix(device.platform)}/api/screenshot?device=${encodeURIComponent(device.id)}`;
      yield* guard;
      const png = yield* httpClient.execute(HttpClientRequest.post(url)).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.arrayBuffer),
        Effect.map((buffer) => new Uint8Array(buffer)),
        Effect.scoped,
        Effect.timeout(SCREENSHOT_TIMEOUT),
        Effect.mapError(
          (cause) =>
            new DeviceOperationError({
              operation: "screenshot",
              reason: "request_failed",
              cause,
            }),
        ),
      );
      return { device, png };
    }).pipe(Effect.withSpan("DeviceService.screenshot"));

  const screenshot: DeviceService["Service"]["screenshot"] = (input) =>
    captureScreenshot(input, Effect.void);

  const resolveDevice = Effect.fn("DeviceService.resolveDevice")(function* (
    hostId: DeviceHostId | undefined,
    deviceId: DeviceId,
  ) {
    const host = yield* resolveHost(hostId);
    const ready = yield* readiness(host.id);
    const { state } = yield* SynchronizedRef.get(stateRef);
    const device =
      findDevice(state, host.id, deviceId) ?? findDevice(yield* refresh(ready), host.id, deviceId);
    if (!device) return yield* new DeviceNotFoundError({ hostId: host.id, deviceId });
    return { ready, device };
  });

  const detail: DeviceService["Service"]["detail"] = Effect.fn("DeviceService.detail")(
    function* (input) {
      const { ready, device } = yield* resolveDevice(input.hostId, input.deviceId);
      const read = yield* readDeviceDetail(ready, device.platform, device.id);
      return {
        hostId: ready.hostId,
        deviceId: device.id,
        settings: read.settings,
        foregroundApp: read.foregroundApp,
        readAt: DateTime.formatIso(yield* DateTime.now),
      };
    },
  );

  const action: DeviceService["Service"]["action"] = Effect.fn("DeviceService.action")(
    function* (input) {
      const { ready, device } = yield* resolveDevice(input.hostId, input.deviceId);
      yield* comparison
        .manual(
          { hostId: ready.hostId, deviceId: device.id },
          runDeviceAction(ready, device.platform, input),
        )
        .pipe(Effect.mapError(mapComparisonDeviceError));
      return yield* detail({ hostId: ready.hostId, deviceId: device.id });
    },
  );

  const comparisonDeviceError = (cause: DeviceComparisonError) =>
    new DeviceOperationError({ operation: cause.reason, reason: "hub_rejected", cause });
  const mapComparisonDeviceError = (cause: DeviceError | DeviceComparisonError) =>
    cause._tag === "DeviceComparisonError" ? comparisonDeviceError(cause) : cause;
  const providerActive = agentControl?.providerActive ?? (() => false);
  const comparison = makeDeviceComparison({
    providerActive,
    ...(comparisonStore === undefined ? {} : { store: comparisonStore }),
    state: SynchronizedRef.get(stateRef).pipe(Effect.map(({ state }) => controlState(state))),
    driver: makeDeviceSemanticDriver((hostId) =>
      agentReadinessIfSupported(hostId).pipe(
        Effect.mapError(
          () =>
            new DeviceComparisonError({ reason: "Device automation is unavailable on this host." }),
        ),
        Effect.flatMap((ready) =>
          ready
            ? Effect.succeed(ready.agentDevice)
            : Effect.fail(
                new DeviceComparisonError({
                  reason: "Agent device access is off or unavailable on this host.",
                }),
              ),
        ),
      ),
    ),
    screenshot: (target, guard) =>
      captureScreenshot(target, guard).pipe(
        Effect.map((capture) => capture.png),
        Effect.orElseSucceed(() => undefined),
      ),
    manualInput: (target, gesture, guard) =>
      Effect.gen(function* () {
        const ready = yield* currentReadiness(target.hostId);
        if (!ready)
          return yield* new DeviceComparisonError({ reason: "Live device input is unavailable." });
        if (target.platform === "ios")
          return yield* runIosDeviceInput(ready, target.deviceId, gesture, guard);
        const button =
          gesture.type === "back" || gesture.type === "home" || gesture.type === "recents";
        const endpoint = button ? "key" : gesture.type;
        const body = button ? { key: gesture.type } : { ...gesture };
        if ("viewport" in body) delete body.viewport;
        const url = `${ready.hub.origin}/vendor/serve-emu/api/${endpoint}?device=${encodeURIComponent(target.deviceId)}`;
        const request = yield* HttpClientRequest.bodyJson(HttpClientRequest.post(url), {
          ...body,
          record: false,
        }).pipe(
          Effect.mapError(() => new DeviceComparisonError({ reason: "Invalid device input." })),
        );
        yield* guard;
        const failed = () =>
          new DeviceComparisonError({
            reason:
              "The device did not confirm the input. Check the live screen before continuing.",
          });
        const result = yield* hubJson(request, HubActionResult, "manual input").pipe(
          Effect.mapError(failed),
        );
        if (!result.ok) return yield* failed();
      }),
  });

  const controlError = (reason: string) => new DeviceComparisonError({ reason });
  const grantEnded = () =>
    controlError("Device access ended. Open the device again from its thread.");
  const grantIsCurrent = (grant: AgentDeviceGrant) => {
    if (comparison.agent.lookup(grant.token) !== grant) return false;
    return (
      providerActive(grant.caller) &&
      isLiveDeviceAttachment(
        controlState(SynchronizedRef.getUnsafe(stateRef).state),
        grant.attachment,
      )
    );
  };
  const checkGrant = (grant: AgentDeviceGrant) =>
    Effect.suspend(() => {
      if (grantIsCurrent(grant)) return Effect.void;
      comparison.agent.release(grant);
      return Effect.fail(grantEnded());
    });

  const dispatch: Parameters<typeof startAgentDeviceProxy>[0]["dispatch"] = (
    grant,
    operation,
    usesSession,
  ) =>
    Effect.gen(function* () {
      yield* checkGrant(grant);
      const host = hosts.get(grant.attachment.hostId);
      const ready = yield* agentReadinessIfSupported(grant.attachment.hostId).pipe(
        Effect.mapError(() =>
          controlError("Device automation is unavailable on the selected host."),
        ),
      );
      if (!ready || !host) return yield* grantEnded();
      yield* checkGrant(grant);
      const sameEndpoint = (endpoint: DeviceHost.AgentDeviceEndpoint) =>
        endpoint.baseUrl === ready.agentDevice.baseUrl &&
        endpoint.token === ready.agentDevice.token;
      const scope = grant.resumedApp ?? grant.approvedApp;
      if (scope && !sameEndpoint(scope.endpoint)) {
        comparison.agent.release(grant);
        return yield* grantEnded();
      }
      return yield* comparison.agent.dispatch(
        grant,
        operation(
          ready.agentDevice,
          () => hosts.get(grant.attachment.hostId) === host && grantIsCurrent(grant),
        ),
        usesSession
          ? {
              endpoint: ready.agentDevice,
              close: closeAgentDeviceSession(
                ready.agentDevice,
                grant.daemonSession,
                grant.attachment.platform,
                grant.attachment.deviceId,
              ),
              observe: (retained, appId, current) =>
                Effect.gen(function* () {
                  const live = yield* agentReadinessIfSupported(host.id).pipe(
                    Effect.mapError(grantEnded),
                  );
                  const valid = () =>
                    current() &&
                    hosts.get(host.id) === host &&
                    isLiveDeviceAttachment(
                      controlState(SynchronizedRef.getUnsafe(stateRef).state),
                      retained.attachment,
                    );
                  if (!live || !sameEndpoint(live.agentDevice) || !valid())
                    return yield* grantEnded();
                  return yield* checkDeviceScreen(
                    live.agentDevice,
                    retained,
                    valid,
                    appId,
                    false,
                  ).pipe(
                    Effect.mapError(() =>
                      controlError(
                        `Open ${appId} on the device and finish any protected prompts before returning control.`,
                      ),
                    ),
                  );
                }).pipe(
                  Effect.timeoutOrElse({
                    duration: "10 seconds",
                    orElse: () =>
                      Effect.fail(
                        controlError(
                          "Could not verify the current app. Check the live device and try again.",
                        ),
                      ),
                  }),
                ),
            }
          : undefined,
      );
    });

  const agentTarget: DeviceService["Service"]["agentTarget"] = Effect.fn(
    "DeviceService.agentTarget",
  )(function* (attachment, caller, entryPath, access) {
    if (!agentControl || caller.threadId !== attachment.threadId || !agentAccessAllowed())
      return yield* comparisonDeviceError(grantEnded());
    const epoch = accessEpoch;
    const checkApproval = () =>
      !access || comparison.agent.permitsApp(attachment, caller, access.appId, access.approvalId);
    if (!checkApproval())
      return yield* comparisonDeviceError(
        controlError("Request approval for the exact app from the Device panel."),
      );
    const host = yield* resolveHost(attachment.hostId);
    const ready = yield* agentReadinessIfSupported(host.id);
    if (!ready) return yield* comparisonDeviceError(grantEnded());
    return yield* lifecycleLock.withPermit(
      Effect.gen(function* () {
        comparison.agent.refresh(attachment);
        if (!providerActive(caller) || hosts.get(host.id) !== host)
          return yield* comparisonDeviceError(grantEnded());
        if (
          epoch !== accessEpoch ||
          !isLiveDeviceAttachment(
            controlState(SynchronizedRef.getUnsafe(stateRef).state),
            attachment,
          )
        )
          return yield* comparisonDeviceError(grantEnded());
        if (!checkApproval())
          return yield* comparisonDeviceError(
            controlError("The app approval changed. Request it again."),
          );
        const grant = comparison.claimAgent(
          attachment,
          caller,
          access && { ...access, endpoint: ready.agentDevice },
        );
        if (!grant)
          return yield* comparisonDeviceError(
            controlError(
              "The device is busy or controlled from its Device panel. Stop or hand back control first.",
            ),
          );
        const config = yield* agentControl
          .configForGrant(grant, { lookup: comparison.agent.lookup, dispatch }, entryPath)
          .pipe(
            Effect.onExit((exit) =>
              Exit.isSuccess(exit)
                ? Effect.void
                : Effect.sync(() => comparison.agent.release(grant)),
            ),
          );
        yield* checkGrant(grant).pipe(Effect.mapError(comparisonDeviceError));
        return {
          ...config,
          session: grant.daemonSession,
          ...(grant.resumedApp ? { appId: grant.resumedApp.appId } : {}),
          ...(grant.approvedApp ? { approvedAppId: grant.approvedApp.appId } : {}),
        };
      }),
    );
  });

  const agentScreenshot: DeviceService["Service"]["agentScreenshot"] = (attachment, caller) =>
    Effect.gen(function* () {
      const grant = comparison.agent.currentGrant(attachment, caller);
      if (!grant || ((grant.resumedApp || grant.approvedApp) && !grant.lastSnapshot))
        return yield* comparisonDeviceError(
          controlError("Call device_open and open the app before capturing its screen."),
        );
      return yield* dispatch(
        grant,
        (endpoint, canDispatch) =>
          Effect.gen(function* () {
            yield* checkDeviceScreen(endpoint, grant, canDispatch);
            yield* checkGrant(grant);
            const shot = yield* captureScreenshot(attachment, checkGrant(grant)).pipe(
              Effect.mapError((cause) =>
                cause._tag === "DeviceComparisonError"
                  ? cause
                  : controlError("The device could not capture its screen."),
              ),
            );
            yield* checkDeviceScreen(endpoint, grant, canDispatch);
            yield* checkGrant(grant);
            return shot;
          }),
        false,
      ).pipe(Effect.mapError(comparisonDeviceError));
    });

  const authorizeScreenshotTransfer: DeviceService["Service"]["authorizeScreenshotTransfer"] = (
    caller,
    source,
  ) =>
    Effect.suspend(() => {
      const epoch = accessEpoch;
      const grant =
        source?.kind === "live"
          ? comparison.agent.currentGrant(source.attachment, caller)
          : undefined;
      const isCurrent = () => {
        const state = controlState(SynchronizedRef.getUnsafe(stateRef).state);
        if (epoch !== accessEpoch || !state.agentAccessEnabled || !providerActive(caller))
          return false;
        if (!source) return true;
        if (source.kind === "firstDifference")
          return comparison.approvedScreenshotIsCurrent(state, caller, source);
        return (
          source.attachment.threadId === caller.threadId &&
          isLiveDeviceAttachment(state, source.attachment) &&
          (source.kind !== "live" || (grant !== undefined && grantIsCurrent(grant)))
        );
      };
      return isCurrent() ? Effect.succeed(isCurrent) : Effect.fail(grantEnded());
    });

  const sessionsForThread: DeviceService["Service"]["sessionsForThread"] = (threadId) =>
    SynchronizedRef.get(stateRef).pipe(
      Effect.map(({ state }) => state.sessions.filter((session) => session.threadId === threadId)),
    );

  const settingsChanged = yield* Queue.sliding<void>(1);
  const settingsChanges: Array<{
    readonly next: ReturnType<typeof deviceSettings>;
    readonly supportChanged: boolean;
    readonly stop: "host" | "agent" | undefined;
  }> = [];
  const onSettingsCommit = (settings: ServerSettingsSnapshot) => {
    const previous = committedSettings;
    const next = deviceSettings(settings);
    const supportChanged = previous.enabled !== next.enabled;
    if (
      !supportChanged &&
      previous.agentAccessEnabled === next.agentAccessEnabled &&
      previous.onboardingCompleted === next.onboardingCompleted
    )
      return;
    committedSettings = next;
    if (previous.enabled && !next.enabled) supportEpoch++;
    const wasAllowed = previous.enabled && previous.agentAccessEnabled;
    const isAllowed = next.enabled && next.agentAccessEnabled;
    if (wasAllowed && !isAllowed) {
      accessEpoch++;
      comparison.revoke();
    } else if (!wasAllowed && isAllowed) {
      comparison.allowSavedResults();
    }
    const stop = !previous.enabled
      ? undefined
      : !next.enabled
        ? "host"
        : previous.agentAccessEnabled && !next.agentAccessEnabled
          ? "agent"
          : undefined;
    if (stop === "host") pendingHostStops++;
    if (stop === "agent") pendingAgentStops++;
    settingsChanges.push({ next, supportChanged, stop });
    Queue.offerUnsafe(settingsChanged, undefined);
  };
  const applySettingsChanges = lifecycleLock.withPermit(
    Effect.gen(function* () {
      for (let change = settingsChanges.shift(); change; change = settingsChanges.shift()) {
        const { next, supportChanged, stop } = change;
        if (stop) {
          yield* Effect.forEach(
            hosts.values(),
            (host) => (stop === "host" ? host.stop : host.stopAgent),
            { discard: true },
          );
        }
        yield* publish((state) => ({
          ...state,
          ...(supportChanged
            ? {
                hostStatus: next.enabled ? "idle" : "disabled",
                hostStatusDetail: undefined,
                hostStatuses: {},
              }
            : {}),
          ...(!next.enabled ? { devices: [], sessions: [], bootingDevices: [] } : {}),
          agentAccessEnabled: next.agentAccessEnabled,
          onboardingCompleted: next.onboardingCompleted,
        }));
        if (stop === "host") pendingHostStops--;
        if (stop === "agent") pendingAgentStops--;
      }
    }).pipe(Effect.uninterruptible),
  );

  // Commits invalidate control synchronously. The worker can wait for device
  // operations and stop helpers without holding the settings write lock.
  if (observeSettings && Option.isSome(settingsScope)) {
    yield* observeSettings(onSettingsCommit).pipe(
      Effect.provideService(Scope.Scope, settingsScope.value),
    );
    yield* Queue.take(settingsChanged).pipe(
      Effect.andThen(applySettingsChanges),
      Effect.forever,
      Effect.forkIn(settingsScope.value),
    );
  }

  return {
    ...DeviceService.of({
      testHost,
      updateTool: (tool) =>
        lifecycleLock.withPermit(
          Effect.gen(function* () {
            if (!installTool)
              return yield* new DeviceOperationError({
                operation: "update device tool",
                reason: "request_failed",
                cause: new Error("Tool installation is unavailable in this device service."),
              });
            yield* installTool(tool);
            return yield* inspect;
          }),
        ),
      retryHost,
      inspect,
      agentCli: Effect.fail(
        new DeviceHostUnavailableError({
          hostId: LOCAL_DEVICE_HOST_ID,
          reason: "Agent CLI installation is unavailable in this device service.",
        }),
      ),
      agentTarget,
      state: SynchronizedRef.get(stateRef).pipe(Effect.map(({ state }) => state)),
      subscribe: PubSub.subscribe(statePubSub),
      configure,
      list,
      open,
      close,
      shutdown,
      detail,
      action,
      screenshot,
      agentScreenshot,
      authorizeScreenshotTransfer,
      readiness,
      readinessIfSupported,
      agentReadinessIfSupported,
      currentReadiness,
      comparison: comparison.invoke,
      comparisonRecording: comparison.record,
      streamInputAllowed: (hostId, deviceId) =>
        readDeviceSettings.pipe(
          Effect.map(({ enabled }) => enabled && comparison.inputAllowed(hostId, deviceId)),
          Effect.orElseSucceed(() => false),
        ),
      sessionsForThread,
    }),
    setHostStatus,
    withLifecycleLock: lifecycleLock.withPermit,
    refreshHosts: Effect.gen(function* () {
      const summaries = yield* Effect.forEach(hosts.values(), (host) => host.summary);
      const unchanged = (id: DeviceHostId) =>
        hosts.has(id) && hosts.get(id) === publishedHosts.get(id);
      yield* publish((state) => ({
        ...state,
        hosts: summaries,
        hostStatuses: Object.fromEntries(
          Object.entries(state.hostStatuses).filter(([id]) => unchanged(id)),
        ),
        devices: state.devices.filter((device) => unchanged(device.hostId)),
        sessions: state.sessions.filter((session) => unchanged(session.hostId)),
      }));
      publishedHosts = new Map(hosts);
    }),
  };
});

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const localHost = yield* DeviceHost.DeviceHost;
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runner = yield* ProcessRunner.ProcessRunner;
  const settings = yield* ServerSettings.ServerSettingsService;
  const scope = yield* Scope.Scope;
  const hosts = new Map<DeviceHostId, DeviceHost.DeviceHost["Service"]>([
    [localHost.id, localHost],
  ]);
  const clearLegacyConfig = (hostId: DeviceHostId) =>
    fs
      .remove(legacyAgentDeviceConfigPath(config.stateDir, hostId, path), { force: true })
      .pipe(Effect.ignore);
  yield* clearLegacyConfig(localHost.id);
  const comparisonDeviceErrorForConfig = (hostId: DeviceHostId) =>
    new DeviceHostUnavailableError({ hostId, reason: "Could not prepare device control." });
  let proxyConfig:
    | { readonly origin: string; readonly directory: string; command?: string }
    | undefined;
  const configForGrant: NonNullable<Parameters<typeof makeWithHosts>[2]>["configForGrant"] = (
    grant,
    proxy,
    entryPath,
  ) =>
    Effect.gen(function* () {
      if (!proxyConfig) {
        const root = agentDeviceGrantDirectory(config.stateDir, path);
        yield* fs.makeDirectory(root, { recursive: true, mode: 0o700 });
        const directory = yield* fs.makeTempDirectoryScoped({ directory: root, prefix: "grants-" });
        const { origin } = yield* startAgentDeviceProxy(proxy);
        proxyConfig = { origin, directory };
      }
      const configPath = path.join(proxyConfig.directory, `${grant.id}.json`);
      yield* writeAgentDeviceConfig(configPath, {
        baseUrl: proxyConfig.origin,
        token: grant.token,
      });
      proxyConfig.command ??= yield* ensureAgentDeviceShim({
        entryPath,
        configDirectory: proxyConfig.directory,
        proxyOrigin: proxyConfig.origin,
      });
      return { command: proxyConfig.command, configPath };
    }).pipe(
      Effect.provideService(Scope.Scope, scope),
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError(() => comparisonDeviceErrorForConfig(grant.attachment.hostId)),
    );
  const probeContext =
    yield* Effect.context<Effect.Services<ReturnType<typeof SshDeviceHost.probe>>>();
  const localTargetContext =
    yield* Effect.context<Effect.Services<ReturnType<typeof isLocalSshDeviceHost>>>();
  const service = yield* makeWithHosts(
    hosts,
    (host) =>
      Effect.gen(function* () {
        if (yield* isLocalSshDeviceHost(host).pipe(Effect.provide(localTargetContext))) {
          return yield* localHost.summary;
        }
        return yield* SshDeviceHost.probe(host).pipe(Effect.provide(probeContext));
      }).pipe(
        Effect.mapError(
          (error) =>
            new DeviceOperationError({
              operation: "probe host",
              reason: "request_failed",
              cause: error,
            }),
        ),
      ),
    { configForGrant, providerActive: hasActiveMcpDeviceSession },
    (tool) =>
      (tool === "hub" ? ensureDeviceHub(config.baseDir) : ensureAgentDevice(config.baseDir)).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.provideService(ProcessRunner.ProcessRunner, runner),
        Effect.mapError(
          (cause) =>
            new DeviceOperationError({
              operation: "update device tool",
              reason: "command_failed",
              cause,
            }),
        ),
      ),
    makeDeviceComparisonStore(config.stateDir),
  );
  const hostContext =
    yield* Effect.context<Effect.Services<ReturnType<typeof SshDeviceHost.make>>>();
  const configured = new Map<string, { config: SshDeviceHostConfig; scope: Scope.Closeable }>();
  const reconcile = (configuredHosts: ReadonlyArray<SshDeviceHostConfig>) =>
    Effect.gen(function* () {
      const next = yield* remoteSshDeviceHosts(configuredHosts).pipe(
        Effect.provide(localTargetContext),
      );
      const removed = yield* service.withLifecycleLock(
        Effect.gen(function* () {
          const removed: Array<{ id: string; scope: Scope.Closeable }> = [];
          for (const [id, previous] of configured) {
            if (
              next.some(
                (host) =>
                  host.id === id &&
                  host.label === previous.config.label &&
                  host.target === previous.config.target &&
                  host.port === previous.config.port &&
                  host.identityFile === previous.config.identityFile,
              )
            )
              continue;
            hosts.delete(id);
            configured.delete(id);
            removed.push({ id, scope: previous.scope });
          }
          yield* service.refreshHosts;
          return removed;
        }),
      );
      // Stop old writers before deleting config files or publishing replacements, without blocking healthy hosts.
      yield* Effect.forEach(
        removed,
        ({ id, scope }) =>
          Effect.gen(function* () {
            yield* Scope.close(scope, Exit.void);
            yield* clearLegacyConfig(id);
          }),
        { concurrency: 4, discard: true },
      );
      yield* service.withLifecycleLock(
        Effect.gen(function* () {
          for (const host of next) {
            if (configured.has(host.id)) continue;
            yield* clearLegacyConfig(host.id);
            const hostScope = yield* Scope.fork(scope);
            const instance = yield* SshDeviceHost.make(host, undefined, (status, detail) =>
              service
                .setHostStatus(host.id, { status, ...(detail ? { detail } : {}) })
                .pipe(Effect.asVoid),
            ).pipe(Effect.provideService(Scope.Scope, hostScope), Effect.provide(hostContext));
            hosts.set(host.id, instance);
            configured.set(host.id, { config: host, scope: hostScope });
          }
          yield* service.refreshHosts;
        }),
      );
    });
  const changes = yield* settings.subscribeChanges;
  yield* reconcile((yield* settings.getSettings).deviceHosts);
  yield* changes.pipe(
    Stream.runForEach((value) => reconcile(value.deviceHosts)),
    Effect.forkIn(scope),
  );
  yield* Effect.addFinalizer(() =>
    Effect.forEach(configured.values(), (value) => Scope.close(value.scope, Exit.void), {
      discard: true,
      concurrency: 4,
    }),
  );
  return {
    ...service,
    agentCli: resolveNodeExecutable("Device automation").pipe(
      Effect.andThen(ensureAgentDevice(config.baseDir)),
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.provideService(ProcessRunner.ProcessRunner, runner),
      Effect.map((tool) => tool.entryPath),
      Effect.mapError((error) =>
        error._tag === "NodeRuntimeUnavailableError"
          ? new DeviceHostUnavailableError({
              hostId: LOCAL_DEVICE_HOST_ID,
              reason: nodeRuntimeUnavailableMessage("Device automation"),
              cause: error,
            })
          : new DeviceOperationError({
              operation: "install agent CLI",
              reason: "command_failed",
              cause: error,
            }),
      ),
    ),
  };
});

export const layer = Layer.effect(DeviceService, make).pipe(Layer.provide(LocalDeviceHost.layer));

/** State stream for WS subscribers: current snapshot first, then every change. */
export const stateStream = (service: DeviceService["Service"]): Stream.Stream<DeviceServiceState> =>
  Stream.unwrap(
    Effect.gen(function* () {
      // Subscribe before reading the snapshot so no change between the two
      // is lost; the scope lives as long as the stream does.
      const subscription = yield* service.subscribe;
      const initial = yield* service.state;
      return Stream.concat(Stream.make(initial), Stream.fromSubscription(subscription));
    }),
  ).pipe(Stream.scoped);
