import { randomUUID } from "node:crypto";
import {
  DeviceComparisonError,
  type DeviceComparisonScrollDirection,
  type DevicePlatform,
  type ThreadId,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { closeAgentDeviceSession } from "./AgentDeviceSessionCleanup.ts";
import { agentDeviceSession } from "./AgentDeviceTarget.ts";
import type { AgentDeviceEndpoint } from "./DeviceHost.ts";

const Node = Schema.Struct({
  index: Schema.Int,
  parentIndex: Schema.optional(Schema.Int),
  ref: Schema.String,
  identifier: Schema.optional(Schema.String),
  bundleId: Schema.optional(Schema.String),
  rect: Schema.optional(
    Schema.Struct({
      x: Schema.Number,
      y: Schema.Number,
      width: Schema.Number,
      height: Schema.Number,
    }),
  ),
  type: Schema.optional(Schema.String),
  role: Schema.optional(Schema.String),
  label: Schema.optional(Schema.String),
  value: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
  visibleToUser: Schema.optional(Schema.Boolean),
  hittable: Schema.optional(Schema.Boolean),
  focused: Schema.optional(Schema.Boolean),
  editable: Schema.optional(Schema.Boolean),
  password: Schema.optional(Schema.Boolean),
  interactionBlocked: Schema.optional(Schema.String),
});
export const SemanticSnapshotSchema = Schema.Struct({
  nodes: Schema.Array(Node),
  appBundleId: Schema.optional(Schema.String),
  truncated: Schema.optional(Schema.Boolean),
  refsGeneration: Schema.optional(Schema.Int),
  systemSurfaceOnly: Schema.optional(Schema.Boolean),
  androidSnapshot: Schema.optional(
    Schema.Struct({ systemSurfaceOnly: Schema.optional(Schema.Boolean) }),
  ),
});
export type SemanticSnapshot = typeof SemanticSnapshotSchema.Type;
export type SemanticNode = typeof Node.Type;

export interface SemanticDevice {
  readonly threadId: ThreadId;
  readonly hostId: string;
  readonly deviceId: string;
  readonly platform: DevicePlatform;
  readonly appId: string;
}

export interface SemanticDriver {
  readonly release?: (target: SemanticDevice) => Effect.Effect<void> | undefined;
  readonly open: (
    target: SemanticDevice,
    guard: Effect.Effect<void, DeviceComparisonError>,
  ) => Effect.Effect<void, DeviceComparisonError>;
  readonly snapshot: (
    target: SemanticDevice,
    guard?: Effect.Effect<void, DeviceComparisonError>,
    purpose?: "permissionEvidence",
  ) => Effect.Effect<SemanticSnapshot, DeviceComparisonError>;
  readonly press: (
    target: SemanticDevice,
    reference: string,
    guard: Effect.Effect<void, DeviceComparisonError>,
  ) => Effect.Effect<void | { readonly permissionDialog: true }, DeviceComparisonError>;
  readonly scroll: (
    target: SemanticDevice,
    direction: DeviceComparisonScrollDirection,
    guard: Effect.Effect<void, DeviceComparisonError>,
  ) => Effect.Effect<void, DeviceComparisonError>;
}

const RpcResponse = Schema.Struct({
  id: Schema.String,
  result: Schema.optional(
    Schema.Struct({ ok: Schema.Boolean, data: Schema.optional(Schema.Unknown) }),
  ),
});

const unavailable = (reason: string) => new DeviceComparisonError({ reason });

const permissionPackages = new Set([
  "com.android.permissioncontroller",
  "com.google.android.permissioncontroller",
  "com.android.packageinstaller",
  "com.google.android.packageinstaller",
]);

export function androidPermissionEvidenceBounds(
  snapshot: SemanticSnapshot,
  target: SemanticDevice,
) {
  if (
    target.platform !== "android" ||
    snapshot.appBundleId !== target.appId ||
    snapshot.truncated ||
    snapshot.systemSurfaceOnly ||
    snapshot.androidSnapshot?.systemSurfaceOnly
  )
    return undefined;

  const nodes = snapshot.nodes.filter((node) => node.visibleToUser === true);
  const messages = nodes.filter(
    ({ bundleId, identifier }) =>
      bundleId &&
      permissionPackages.has(bundleId) &&
      identifier === `${bundleId}:id/permission_message`,
  );
  const [message] = messages;
  if (messages.length !== 1 || !message) return undefined;
  const buttonPrefix = `${message.bundleId}:id/permission_`;
  const buttons = nodes.filter(
    ({ bundleId, identifier }) =>
      bundleId === message.bundleId &&
      identifier?.startsWith(buttonPrefix) &&
      /^(?:allow|deny)(?:_[a-z0-9]+)*_button$/u.test(identifier.slice(buttonPrefix.length)),
  );
  if (
    !buttons.some(({ identifier }) => identifier?.startsWith(`${buttonPrefix}allow`)) ||
    !buttons.some(({ identifier }) => identifier?.startsWith(`${buttonPrefix}deny`))
  )
    return undefined;
  const outer = nodes.filter(
    ({ bundleId, identifier }) =>
      bundleId === message.bundleId && identifier === `${bundleId}:id/grant_dialog`,
  );
  if (outer.length !== 1 || !outer[0]?.rect) return undefined;
  const dialog = outer[0].rect;
  const rects = [message, ...buttons].flatMap(({ rect }) => (rect ? [rect] : []));
  if (
    rects.length !== buttons.length + 1 ||
    rects.some(
      ({ x, y, width, height }) =>
        ![x, y, width, height].every(Number.isSafeInteger) ||
        x <= dialog.x ||
        y <= dialog.y ||
        width <= 0 ||
        height <= 0 ||
        x + width >= dialog.x + dialog.width ||
        y + height >= dialog.y + dialog.height,
    )
  )
    return undefined;

  // The system dialog can leave the app visible around it. Keep only its inner content.
  return {
    left: Math.min(...rects.map(({ x }) => x)),
    top: Math.min(...rects.map(({ y }) => y)),
    right: Math.max(...rects.map(({ x, width }) => x + width)),
    bottom: Math.max(...rects.map(({ y, height }) => y + height)),
  };
}

export function isDeviceSystemSurface(snapshot: SemanticSnapshot) {
  return (
    snapshot.systemSurfaceOnly === true ||
    snapshot.androidSnapshot?.systemSurfaceOnly === true ||
    snapshot.nodes.some((node) => {
      if (node.visibleToUser === false) return false;
      if (node.bundleId && permissionPackages.has(node.bundleId)) return true;
      const permission = /^([^:]+):id\/permission_[a-z0-9_]+$/u.exec(node.identifier ?? "");
      return permission !== null && permissionPackages.has(permission[1]!);
    })
  );
}

function openedAndroidPermissionDialog(data: unknown, target: SemanticDevice) {
  if (
    target.platform !== "android" ||
    !data ||
    typeof data !== "object" ||
    !("warning" in data) ||
    typeof data.warning !== "string"
  )
    return false;
  const match =
    /^press [\s\S]+ opened an Android permission dialog \(([a-zA-Z0-9_.]+)\) over ([a-zA-Z0-9_.]+)\. Use "alert get" to inspect it, then "alert accept" or "alert dismiss" to respond\.$/u.exec(
      data.warning,
    );
  return match !== null && permissionPackages.has(match[1]!) && match[2] === target.appId;
}

export const systemDeviceSurfaceReason =
  "A system screen is blocking replay. Choose My turn on the device, clear the prompt, then resume.";
export const systemDeviceSurface = () => unavailable(systemDeviceSurfaceReason);

/** The pinned agent-device daemon's JSON-RPC protocol, shared by local and SSH hosts. */
export function makeDeviceSemanticDriver(
  endpoint: (hostId: string) => Effect.Effect<AgentDeviceEndpoint, DeviceComparisonError>,
  fetchRpc: (url: string, init: RequestInit) => Promise<Response> = fetch,
): SemanticDriver {
  const sessions = new WeakMap<SemanticDevice, AgentDeviceEndpoint>();
  const command = Effect.fn("DeviceSemanticDriver.command")(function* (
    target: SemanticDevice,
    verb: "open" | "snapshot" | "press" | "scroll",
    positionals: string[],
    guard: Effect.Effect<void, DeviceComparisonError>,
  ): Effect.fn.Return<unknown, DeviceComparisonError> {
    const daemon = yield* endpoint(target.hostId);
    const id = randomUUID();
    const { platform, deviceId } = target;
    yield* guard;
    const data = yield* Effect.tryPromise({
      try: async (signal) => {
        if (verb === "open" || verb === "snapshot") sessions.set(target, daemon);
        const response = await fetchRpc(`${daemon.baseUrl.replace(/\/$/, "")}/rpc`, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(verb === "press" || verb === "scroll" ? 45_000 : 240_000),
          ]),
          headers: { authorization: `Bearer ${daemon.token}`, "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id,
            method: "agent_device.command",
            params: {
              session: agentDeviceSession(target.threadId, target.hostId, deviceId),
              command: verb,
              positionals,
              flags: {
                platform,
                ...(platform === "ios" ? { udid: deviceId } : { serial: deviceId }),
                noRecord: true,
                ...(verb === "press" || verb === "scroll" ? { settle: true } : {}),
              },
              meta: { sessionExplicit: true, requestId: id, responseLevel: "full" },
            },
          }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error("Device driver rejected the request");
        }
        const result = Schema.decodeUnknownSync(RpcResponse)(await response.json());
        if (result.id !== id || !result.result?.ok)
          throw new Error("Device driver did not confirm the request");
        return result.result.data;
      },
      catch: () =>
        unavailable(
          verb === "press"
            ? "The driver could not confirm the tap. Inspect the device before continuing."
            : verb === "scroll"
              ? "The driver could not confirm the scroll. Inspect the device before continuing."
              : verb === "open"
                ? "The driver could not open the selected app. Check that it is installed on this device."
                : "The driver could not read the app’s accessibility snapshot.",
        ),
    });
    return data;
  });

  return {
    release: (target) => {
      const daemon = sessions.get(target);
      if (!daemon) return undefined;
      sessions.delete(target);
      return closeAgentDeviceSession(
        daemon,
        agentDeviceSession(target.threadId, target.hostId, target.deviceId),
        target.platform,
        target.deviceId,
        fetchRpc,
      );
    },
    open: (target, guard) => command(target, "open", [target.appId], guard).pipe(Effect.asVoid),
    snapshot: (target, guard = Effect.void, purpose) =>
      command(target, "snapshot", [], guard).pipe(
        Effect.flatMap((data) =>
          Schema.decodeUnknownEffect(SemanticSnapshotSchema)(data).pipe(
            Effect.mapError(() =>
              unavailable("The driver could not read the app’s accessibility snapshot."),
            ),
          ),
        ),
        Effect.flatMap((snapshot) => {
          if (isDeviceSystemSurface(snapshot)) {
            return purpose === "permissionEvidence" &&
              androidPermissionEvidenceBounds(snapshot, target)
              ? Effect.succeed(snapshot)
              : Effect.fail(systemDeviceSurface());
          }
          if (snapshot.appBundleId === target.appId && !snapshot.truncated)
            return Effect.succeed(snapshot);
          return Effect.fail(
            unavailable(
              "The selected app is unavailable or its accessibility snapshot is incomplete.",
            ),
          );
        }),
      ),
    press: (target, reference, guard) =>
      command(target, "press", [reference], guard).pipe(
        Effect.map((data) =>
          openedAndroidPermissionDialog(data, target)
            ? { permissionDialog: true as const }
            : undefined,
        ),
      ),
    scroll: (target, direction, guard) =>
      command(target, "scroll", [direction, "0.65"], guard).pipe(Effect.asVoid),
  };
}
