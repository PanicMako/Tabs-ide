import { randomUUID } from "node:crypto";

import { DeviceComparisonError } from "@tabs/contracts";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";

import type { AgentDeviceGrant } from "./AgentDeviceControl.ts";
import type { AgentDeviceEndpoint } from "./DeviceHost.ts";
import { agentDeviceObject, type managedAgentDeviceRpc } from "./AgentDeviceCommand.ts";
import { comparisonScreenKey, needsPrivateDeviceInput } from "./DeviceComparisonSemantics.ts";
import {
  SemanticSnapshotSchema,
  isDeviceSystemSurface,
  type SemanticSnapshot,
  type SemanticNode,
} from "./DeviceSemanticDriver.ts";

export type ManagedDeviceRpc = NonNullable<ReturnType<typeof managedAgentDeviceRpc>>;

export const privateDeviceScreen = () =>
  new DeviceComparisonError({
    reason:
      "The current screen could contain private input. Use My turn in the Device panel to complete this step, then allow agent control.",
  });

const decodeSnapshot = Schema.decodeUnknownOption(SemanticSnapshotSchema);
export const safeDeviceSnapshot = (
  data: unknown,
  blockPopulatedFields = true,
  appId?: string,
): SemanticSnapshot => {
  const snapshot = decodeSnapshot(data);
  if (
    snapshot._tag === "None" ||
    snapshot.value.truncated ||
    (appId !== undefined && snapshot.value.appBundleId !== appId) ||
    isDeviceSystemSurface(snapshot.value) ||
    snapshot.value.nodes.length === 0 ||
    needsPrivateDeviceInput(snapshot.value, { blockPopulatedFields })
  )
    throw privateDeviceScreen();
  return snapshot.value;
};

const noSnapshotRequired = new Set([
  "apps",
  "capabilities",
  "close",
  "install",
  "open",
  "reinstall",
]);
export const needsDeviceSnapshot = (command: ManagedDeviceRpc) =>
  !noSnapshotRequired.has(command.params.command);

export function privacySnapshotCommand(grant: AgentDeviceGrant) {
  const id = randomUUID();
  const { platform, deviceId } = grant.attachment;
  return {
    jsonrpc: "2.0",
    id,
    method: "agent_device.command",
    params: {
      session: grant.daemonSession,
      command: "snapshot",
      positionals: [],
      flags: {
        platform,
        [platform === "ios" ? "udid" : "serial"]: deviceId,
        snapshotForceFull: true,
        noRecord: true,
      },
      meta: { sessionExplicit: true, lockPolicy: "reject", requestId: id, responseLevel: "full" },
    },
  };
}

/** Verbs that can change what is on screen, so refs from an earlier snapshot stop being trustworthy. */
export const mutatingDeviceVerbs = new Set([
  "back",
  "click",
  "fill",
  "gesture",
  "home",
  "keyboard",
  "longpress",
  "press",
  "scroll",
  "swipe",
  "type",
  "app-switcher",
  "focus",
]);

/** Screen identity that ignores text-field values (those change as the agent types). */
export const deviceScreenKey = (snapshot: SemanticSnapshot) =>
  comparisonScreenKey({
    ...snapshot,
    nodes: snapshot.nodes.map(({ value: _value, ...node }) => node),
  });

const inputWithReference = new Set(["click", "fill", "longpress", "press"]);
const numeric = /^-?\d+(?:\.\d+)?$/;
const coordinateVerbs = new Set(["click", "longpress", "press", "swipe"]);

/**
 * Approved-app grants may only act on snapshot refs. Raw coordinates bypass the control
 * the user approved, so they are refused with a message that tells the agent what to do.
 */
export function assertNoCoordinates(command: ManagedDeviceRpc, grant: AgentDeviceGrant) {
  if (!grant.approvedApp && !grant.resumedApp) return;
  const { command: verb, positionals } = command.params;
  if (verb === "gesture" || (coordinateVerbs.has(verb) && positionals.some((p) => numeric.test(p))))
    throw new DeviceComparisonError({
      reason:
        "Coordinate input is not allowed for an approved app. Run snapshot and target a control by its ref.",
    });
}
const reference = /^@?(e\d+)(?:~s(\d+))?$/;
const nodeReference = (node: SemanticNode) => reference.exec(node.ref)?.[1];
const sameControl = (before: SemanticNode, after: SemanticNode) =>
  before.type === after.type &&
  before.role === after.role &&
  (before.identifier
    ? before.identifier === after.identifier
    : Boolean(before.label && before.label === after.label));

export function refreshDeviceReference(
  command: ManagedDeviceRpc,
  previous: SemanticSnapshot | undefined,
  snapshot: SemanticSnapshot,
  fresh: { readonly stale?: boolean; readonly screenKey?: string } = {},
) {
  const { positionals } = command.params;
  const ref = inputWithReference.has(command.params.command)
    ? reference.exec(positionals[0] ?? "")
    : null;
  if (!ref) return command;
  // A ref is only valid against the latest snapshot: no verb that can change the screen
  // may have run since, and the screen must still be the one that snapshot described.
  if (
    fresh.stale ||
    (fresh.screenKey !== undefined && fresh.screenKey !== deviceScreenKey(snapshot))
  )
    throw new DeviceComparisonError({
      reason: "The screen may have changed since the last snapshot. Run snapshot again.",
    });

  const original = previous?.nodes.find((node) => nodeReference(node) === ref[1]);
  const matches = original ? snapshot.nodes.filter((node) => sameControl(original, node)) : [];
  const current = matches.length === 1 ? nodeReference(matches[0]!) : undefined;
  if (
    !current ||
    (ref[2] !== undefined && Number(ref[2]) !== previous?.refsGeneration) ||
    snapshot.refsGeneration === undefined
  ) {
    throw new DeviceComparisonError({
      reason: "This device control could not be verified. Run snapshot again before retrying.",
    });
  }
  return {
    ...command,
    params: {
      ...command.params,
      positionals: [`@${current}~s${snapshot.refsGeneration}`, ...positionals.slice(1)],
    },
  };
}

export function deviceRpcData(payload: unknown) {
  const result = agentDeviceObject(agentDeviceObject(payload).result);
  return result.ok === true ? agentDeviceObject(result.data) : undefined;
}

export const checkDeviceScreen = (
  endpoint: AgentDeviceEndpoint,
  grant: AgentDeviceGrant,
  canDispatch: () => boolean,
  appId = (grant.resumedApp ?? grant.approvedApp)?.appId,
  blockPopulatedFields = true,
) =>
  Effect.tryPromise({
    try: async (signal) => {
      if (!canDispatch()) throw privateDeviceScreen();
      const command = privacySnapshotCommand(grant);
      const response = await fetch(`${endpoint.baseUrl.replace(/\/$/, "")}/rpc`, {
        method: "POST",
        headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" },
        redirect: "error",
        signal,
        body: JSON.stringify(command),
      });
      const reply: unknown = await response.json();
      if (!response.ok || agentDeviceObject(reply).id !== command.id) throw privateDeviceScreen();
      return safeDeviceSnapshot(deviceRpcData(reply), blockPopulatedFields, appId);
    },
    catch: privateDeviceScreen,
  });

/** Return the CLI's snapshot and artifact dialect and suppress unneeded daemon output. */
export function safeDeviceResult(
  command: ManagedDeviceRpc,
  payload: unknown,
  grant: AgentDeviceGrant,
) {
  const { id } = command;
  const { command: verb } = command.params;
  const data = deviceRpcData(payload);
  if (!data) {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        ok: false,
        error: { code: "COMMAND_FAILED", message: "The device could not complete this command." },
      },
    } as const;
  }
  let safeData: Record<string, unknown> = {};
  if (verb === "snapshot") {
    const snapshot = safeDeviceSnapshot(
      data,
      false,
      (grant.resumedApp ?? grant.approvedApp)?.appId,
    );
    const nodes = snapshot.nodes.flatMap(({ value, ...node }) => {
      if (node.visibleToUser === false || node.password) return [];
      const role = node.type ?? node.role ?? "";
      if (value?.trim() && (node.editable || /edittext|textfield|textinput/i.test(role))) {
        const { label: _label, ...editableNode } = node;
        return [editableNode];
      }
      return [node];
    });
    grant.lastSnapshot = { ...snapshot, nodes };
    grant.snapshotStale = false;
    const screenKey = deviceScreenKey(snapshot);
    if (screenKey) grant.snapshotScreenKey = screenKey;
    else delete grant.snapshotScreenKey;
    safeData = { ...grant.lastSnapshot };
  } else if (verb === "screenshot") {
    safeData = {
      path: data.path,
      artifacts: Array.isArray(data.artifacts)
        ? data.artifacts.flatMap((artifact) => {
            const { field, artifactId, localPath, fileName } = agentDeviceObject(artifact);
            return field === "path" && typeof artifactId === "string"
              ? [{ field, artifactId, localPath, fileName, artifactType: "screenshot" }]
              : [];
          })
        : [],
    };
  } else if (verb === "apps" || verb === "capabilities") {
    safeData = data;
  } else if (verb === "install" || verb === "reinstall") {
    safeData = {
      app: data.app,
      appPath: data.appPath,
      platform: grant.attachment.platform,
      bundleId: data.bundleId,
      package: data.package,
    };
  } else if (verb === "open") {
    safeData = { appBundleId: data.appBundleId };
  } else if (verb === "is" || verb === "wait" || verb === "find") {
    safeData = Object.fromEntries(
      Object.entries(data).filter(([, value]) => typeof value === "boolean"),
    );
  }
  if (verb === "close" || verb === "open") {
    delete grant.lastSnapshot;
    delete grant.snapshotScreenKey;
  }
  return { jsonrpc: "2.0", id, result: { ok: true, data: safeData } } as const;
}
