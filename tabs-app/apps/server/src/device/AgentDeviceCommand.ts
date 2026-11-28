import type { AgentDeviceGrant } from "./AgentDeviceControl.ts";

// Commands with one device scope. Server/lease lifecycle, connection management and
// composite scripts have their own targeting rules and cannot use a device grant.
export const managedAgentDeviceCommands = [
  "action-button",
  "app-switcher",
  "apps",
  "appstate",
  "back",
  "capabilities",
  "click",
  "close",
  "fill",
  "find",
  "focus",
  "fold",
  "gesture",
  "home",
  "install",
  "is",
  "keyboard",
  "longpress",
  "open",
  "orientation",
  "press",
  "push",
  "react-native",
  "reinstall",
  "screenshot",
  "scroll",
  "settings",
  "snapshot",
  "swipe",
  "trigger-app-event",
  "tv-remote",
  "type",
  "wait",
] as const;

const commands = new Set<string>(managedAgentDeviceCommands);
const resumedAppCommands = new Set([
  "back",
  "click",
  "fill",
  "find",
  "focus",
  "is",
  "keyboard",
  "longpress",
  "press",
  "screenshot",
  "scroll",
  "snapshot",
  "swipe",
  "type",
  "wait",
]);
export const managedAgentDeviceOverride =
  /^(?:-v$|--(?:config|session|daemon(?:-|$)|state-dir|cloud(?:-|$)|connection(?:-|$)|provider(?:-|$)|lease(?:-|$)|tenant(?:=|$)|run-id|device(?:=|$)|device-key|simulator-set-path|ios-simulator-device-set|android-device-allowlist|target(?:=|$)|kind(?:=|$)|apple-os|record(?:[=-]|$)|save-script|debug(?:=|$)|verbose(?:=|$)))/;

export function agentDeviceObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function managedAgentDeviceRpc(payload: unknown, grant: AgentDeviceGrant) {
  const { jsonrpc, id, method, params } = agentDeviceObject(payload);
  const {
    session,
    command,
    positionals,
    flags: rawFlags,
    meta: rawMeta,
  } = agentDeviceObject(params);
  const flags = agentDeviceObject(rawFlags);
  const meta = agentDeviceObject(rawMeta);
  const { platform, deviceId } = grant.attachment;
  const selector = platform === "ios" ? "udid" : "serial";
  if (
    jsonrpc !== "2.0" ||
    method !== "agent_device.command" ||
    session !== grant.daemonSession ||
    typeof command !== "string" ||
    !commands.has(command) ||
    !Array.isArray(positionals) ||
    positionals.some((arg: unknown) => typeof arg !== "string") ||
    flags.platform !== platform ||
    flags[selector] !== deviceId ||
    (flags.session !== undefined && flags.session !== session)
  )
    return undefined;
  if (grant.approvedApp) {
    if (command === "open") {
      if (
        grant.appOpenDispatched ||
        positionals.length !== 1 ||
        positionals[0] !== grant.approvedApp.appId
      )
        return undefined;
    } else if (
      !grant.appOpenDispatched ||
      !resumedAppCommands.has(command) ||
      (!grant.lastSnapshot && command !== "snapshot")
    )
      return undefined;
  }
  if (
    grant.resumedApp &&
    (!resumedAppCommands.has(command) || (!grant.lastSnapshot && command !== "snapshot"))
  )
    return undefined;

  const upload = meta.uploadedArtifactId;
  if (
    (command === "install" || command === "reinstall") &&
    (typeof upload !== "string" || !grant.uploads.has(upload))
  )
    return undefined;

  // Keep the command's native flags, with all routing fields supplied by Tabs.
  const commandFlags = Object.fromEntries(
    Object.entries(flags).filter(
      ([flag]) =>
        !/^(?:daemon|provider|lease|cloud|connection|stateDir|device|simulatorSetPath|iosSimulatorDeviceSet|androidDeviceAllowlist|appleOs|kind|target|tenant|runId|platform|serial|udid|session|shutdown|record|noRecord|saveScript|debug|verbose|settle|verify|snapshotDiff)/.test(
          flag,
        ),
    ),
  );
  // Web URLs can select the web backend independently of a device's selectors.
  if (command === "open" && /^https?:\/\//i.test(positionals[0] ?? "")) return undefined;

  return {
    jsonrpc,
    id,
    method,
    params: {
      session,
      command,
      positionals,
      flags: {
        ...(grant.resumedApp || grant.approvedApp ? {} : commandFlags),
        platform,
        [selector]: deviceId,
        session,
        noRecord: true,
        ...(command === "snapshot" ? { snapshotForceFull: true } : {}),
      },
      meta: {
        sessionExplicit: true,
        lockPolicy: "reject",
        lockPlatform: platform,
        requestId: meta.requestId,
        responseLevel: "full",
        includeCost: meta.includeCost,
        clientArtifactPaths: meta.clientArtifactPaths,
        ...(typeof upload === "string" && grant.uploads.has(upload)
          ? { uploadedArtifactId: upload }
          : {}),
      },
    },
  };
}
