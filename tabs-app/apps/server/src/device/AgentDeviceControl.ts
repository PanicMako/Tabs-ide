import { randomBytes, randomUUID } from "node:crypto";

import {
  DeviceComparisonAppId,
  DeviceComparisonError,
  type DeviceAppApproval,
  type AuthSessionId,
  type DeviceComparisonTarget,
  type DeviceServiceState,
  type DeviceSession,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { McpThreadCaller } from "../mcp/McpInvocationContext.ts";
import type { SemanticSnapshot } from "./DeviceSemanticDriver.ts";
import { agentDeviceSession } from "./AgentDeviceTarget.ts";
import { comparisonScreenKey } from "./DeviceComparisonSemantics.ts";
import type { AgentDeviceEndpoint } from "./DeviceHost.ts";
import { deviceKey as key, sameCaller, sameDeviceIdentity } from "./DeviceIdentity.ts";

export interface AgentDeviceGrant {
  readonly id: string;
  readonly token: string;
  readonly caller: McpThreadCaller;
  readonly attachment: DeviceSession;
  readonly daemonSession: string;
  readonly uploads: Set<string>;
  readonly artifacts: Set<string>;
  readonly resumedApp?: { readonly appId: string; readonly endpoint: AgentDeviceEndpoint };
  readonly approvedApp?: DeviceAppApproval & { readonly endpoint: AgentDeviceEndpoint };
  appOpenDispatched?: boolean;
  lastSnapshot?: SemanticSnapshot;
  /** Set once a verb that can change the screen ran after `lastSnapshot` was taken. */
  snapshotStale?: boolean;
  /** Screen identity (field values excluded) of the raw snapshot behind `lastSnapshot`. */
  snapshotScreenKey?: string;
  uncertain?: boolean;
  readonly createdAt: number;
  /** Last time the agent issued a command through this grant. */
  lastCommandAt?: number;
}

export interface RequiredDeviceAppAccess {
  readonly appId?: string | undefined;
  readonly approvalId?: string | undefined;
  readonly endpoint: AgentDeviceEndpoint;
}

interface SessionAccess {
  readonly endpoint: AgentDeviceEndpoint;
  readonly close: Effect.Effect<void>;
  readonly observe: (
    grant: AgentDeviceGrant,
    appId: string,
    current: () => boolean,
  ) => Effect.Effect<SemanticSnapshot, DeviceComparisonError>;
}

interface Correction {
  readonly appId: string;
  readonly sessionId: AuthSessionId;
  before?: string;
}

export interface DeviceReturnReceipt {
  readonly id: string;
  readonly threadId: DeviceSession["threadId"];
  readonly target: DeviceComparisonTarget;
  readonly appId: string;
  readonly comparisonRunId?: string;
  readonly changed: boolean | undefined;
  readonly meaning: string;
}

export type DispatchDeviceReturn = (
  receipt: DeviceReturnReceipt,
  isCurrent: () => boolean,
) => Effect.Effect<void, DeviceComparisonError>;

interface Control {
  grant: AgentDeviceGrant;
  phase: "agent" | "stopping" | "manual" | "stopped";
  busy: boolean;
  handoff?: { attachment: DeviceSession; phase: "manual" | "stopped"; correction?: Correction };
  access?: SessionAccess;
  returned?: {
    readonly controlId: string;
    readonly sessionId: AuthSessionId;
    readonly receipt: DeviceReturnReceipt;
    queued: boolean;
    queueing: boolean;
  };
}

const error = (reason: string) => new DeviceComparisonError({ reason });
const isAppId = Schema.is(DeviceComparisonAppId);
const correctionScreenKey = (snapshot: SemanticSnapshot) =>
  comparisonScreenKey({
    ...snapshot,
    nodes: snapshot.nodes.map(({ value: _value, ...node }) => node),
  });

const newGrant = (
  attachment: DeviceSession,
  caller: McpThreadCaller,
  previous?: {
    readonly daemonSession: string;
    readonly resumedApp: NonNullable<AgentDeviceGrant["resumedApp"]>;
  },
  approvedApp?: AgentDeviceGrant["approvedApp"],
  createdAt = Date.now(),
): AgentDeviceGrant => ({
  id: randomUUID(),
  token: randomBytes(32).toString("base64url"),
  caller,
  attachment,
  daemonSession:
    previous?.daemonSession ??
    agentDeviceSession(caller.threadId, attachment.hostId, attachment.deviceId, randomUUID()),
  ...(previous ? { resumedApp: previous.resumedApp } : {}),
  ...(approvedApp ? { approvedApp } : {}),
  uploads: new Set(),
  artifacts: new Set(),
  createdAt,
});

export const isLiveDeviceAttachment = (state: DeviceServiceState, attachment: DeviceSession) =>
  state.agentAccessEnabled &&
  state.hostStatus !== "disabled" &&
  state.sessions.includes(attachment) &&
  state.devices.some(
    (device) =>
      device.hostId === attachment.hostId &&
      device.id === attachment.deviceId &&
      device.platform === attachment.platform &&
      device.booted &&
      // A reused Android serial can point at a different emulator than the one attached.
      sameDeviceIdentity(attachment, device),
  );

/** Shared with comparison and direct panel input. Control is exclusive per host and device. */
export const AGENT_DEVICE_IDLE_TIMEOUT_MS = 30 * 60_000;

export function makeAgentDeviceControl(
  providerActive: (caller: McpThreadCaller) => boolean,
  options: { readonly idleTimeoutMs?: number; readonly now?: () => number } = {},
) {
  const idleTimeoutMs = options.idleTimeoutMs ?? AGENT_DEVICE_IDLE_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const controls = new Map<string, Control>();
  const grants = new Map<string, AgentDeviceGrant>();
  const approvals = new Map<
    DeviceSession,
    {
      readonly request: DeviceAppApproval;
      readonly caller: McpThreadCaller;
      readonly deadline: number;
      approved: boolean;
    }
  >();
  const liveApproval = (attachment: DeviceSession) => {
    const approval = approvals.get(attachment);
    if (!approval) return;
    if (approval.deadline <= Date.now() || !providerActive(approval.caller)) {
      approvals.delete(attachment);
      return;
    }
    return approval;
  };

  const settle = (control: Control) => {
    control.busy = false;
    if (control.phase === "agent") return;
    const correction = control.handoff?.correction;
    const { grant, access } = control;
    // A lost command reply cannot establish that the retained session is idle.
    if (correction && access && !grant.uncertain && providerActive(grant.caller)) {
      const current = () =>
        controls.get(key(grant.attachment)) === control &&
        control.handoff?.correction === correction &&
        providerActive(grant.caller);
      control.busy = true;
      Effect.runFork(
        access.observe(grant, correction.appId, current).pipe(
          Effect.map(correctionScreenKey),
          Effect.timeout("1 second"),
          Effect.orElseSucceed(() => undefined),
          Effect.map((before) => {
            control.busy = false;
            if (current()) {
              if (before) correction.before = before;
              control.phase = "manual";
            } else {
              if (control.handoff) delete control.handoff.correction;
              settle(control);
            }
          }),
        ),
      );
      return;
    }
    if (control.handoff) delete control.handoff.correction;
    if (control.access) {
      const { close } = control.access;
      delete control.access;
      control.busy = true;
      Effect.runFork(close.pipe(Effect.ensuring(Effect.sync(() => settle(control)))));
      return;
    }
    if (control.handoff) control.phase = control.handoff.phase;
    else controls.delete(key(control.grant.attachment));
  };

  const stop = (control: Control) => {
    if (controls.get(key(control.grant.attachment)) !== control) return;
    grants.delete(control.grant.token);
    control.phase = "stopping";
    if (!control.busy) settle(control);
  };

  /** Revoke agent grants that have issued no command for the idle timeout. */
  const expireIdle = () => {
    for (const control of controls.values()) {
      const { grant } = control;
      if (
        control.phase === "agent" &&
        !control.busy &&
        now() - (grant.lastCommandAt ?? grant.createdAt) > idleTimeoutMs
      )
        stop(control);
    }
  };

  const reconcile = (state: DeviceServiceState) => {
    expireIdle();
    for (const attachment of approvals.keys()) {
      if (!isLiveDeviceAttachment(state, attachment)) approvals.delete(attachment);
      else liveApproval(attachment);
    }
    for (const control of controls.values()) {
      if (control.handoff && !isLiveDeviceAttachment(state, control.handoff.attachment)) {
        delete control.handoff;
        stop(control);
      } else if (
        control.phase === "agent" &&
        !isLiveDeviceAttachment(state, control.grant.attachment)
      ) {
        stop(control);
      }
    }
  };

  const refresh = (target: DeviceComparisonTarget) => {
    const control = controls.get(key(target));
    if (!control || providerActive(control.grant.caller)) return;
    if (control.phase === "agent" || control.handoff?.correction) {
      if (control.handoff) delete control.handoff.correction;
      stop(control);
    }
  };

  const inputBlocked = (control: Control | undefined) =>
    control?.phase === "agent" || control?.phase === "stopping" || control?.busy === true;

  return {
    reconcile,
    refresh,
    revoke: () => {
      approvals.clear();
      for (const control of controls.values()) {
        delete control.handoff;
        stop(control);
      }
    },
    inputAllowed: (hostId: string, deviceId?: string) =>
      deviceId === undefined
        ? ![...controls.values()].some(
            (control) => control.grant.attachment.hostId === hostId && inputBlocked(control),
          )
        : !inputBlocked(controls.get(key({ hostId, deviceId }))),
    blocksComparison: (target: DeviceComparisonTarget) => controls.has(key(target)),
    requestApp: (attachment: DeviceSession, caller: McpThreadCaller, appId: string) => {
      if (controls.has(key(attachment)))
        return Effect.fail(
          error(
            "Device control is active. Reuse its launcher or release it before requesting another app.",
          ),
        );
      const existing = liveApproval(attachment);
      if (existing && sameCaller(existing.caller, caller) && existing.request.appId === appId)
        return Effect.succeed(existing.request);
      const request = { id: randomUUID(), appId };
      approvals.set(attachment, {
        request,
        caller,
        deadline: Date.now() + 5 * 60_000,
        approved: false,
      });
      return Effect.succeed(request);
    },
    pendingApp: (attachment: DeviceSession) => {
      return liveApproval(attachment)?.request;
    },
    reviewApp: (attachment: DeviceSession, approvalId: string, approved: boolean) => {
      const proposal = liveApproval(attachment);
      if (proposal?.request.id !== approvalId || controls.has(key(attachment)))
        return Effect.fail(
          error("The app approval changed. Ask the thread to make a fresh request."),
        );
      if (approved) proposal.approved = true;
      else approvals.delete(attachment);
      return Effect.succeed(proposal.request);
    },
    permitsApp: (
      attachment: DeviceSession,
      caller: McpThreadCaller,
      appId?: string,
      approvalId?: string,
    ) => {
      const active = controls.get(key(attachment));
      if (active) {
        const grant = active.grant;
        const scope = grant.resumedApp ?? grant.approvedApp;
        return (
          active.phase === "agent" &&
          grant.attachment === attachment &&
          sameCaller(grant.caller, caller) &&
          !!scope &&
          (!appId || appId === scope.appId) &&
          (!approvalId || approvalId === grant.approvedApp?.id)
        );
      }
      const proposal = liveApproval(attachment);
      return (
        proposal?.approved === true &&
        sameCaller(proposal.caller, caller) &&
        proposal.request.id === approvalId &&
        proposal.request.appId === appId
      );
    },
    status: (
      target: DeviceComparisonTarget,
      threadId?: DeviceSession["threadId"],
      sessionId?: AuthSessionId,
    ) => {
      const control = controls.get(key(target));
      if (!control) return undefined;
      const correction = control.handoff?.correction;
      const returned = control.returned;
      return {
        id: control.grant.id,
        phase: control.phase,
        threadId: control.handoff?.attachment.threadId ?? control.grant.attachment.threadId,
        ...(threadId === control.grant.attachment.threadId &&
        sessionId !== undefined &&
        control.phase === "manual" &&
        correction?.sessionId === sessionId
          ? { returnToApp: { appId: correction.appId } }
          : {}),
        ...(threadId === control.grant.attachment.threadId &&
        sessionId !== undefined &&
        control.phase === "agent" &&
        returned?.sessionId === sessionId &&
        !returned.queued
          ? { pendingReturn: { appId: returned.receipt.appId, controlId: returned.controlId } }
          : {}),
      };
    },
    claim: (
      attachment: DeviceSession,
      caller: McpThreadCaller,
      access?: RequiredDeviceAppAccess,
    ) => {
      expireIdle();
      const id = key(attachment);
      const existing = controls.get(id);
      if (existing) {
        const { grant } = existing;
        if (
          existing.phase === "agent" &&
          grant.attachment === attachment &&
          sameCaller(grant.caller, caller)
        )
          return grant;
        return undefined;
      }
      const proposal = access ? liveApproval(attachment) : undefined;
      const approved = proposal?.request;
      if (
        access &&
        (!proposal?.approved ||
          !sameCaller(proposal.caller, caller) ||
          approved?.id !== access.approvalId ||
          approved?.appId !== access.appId)
      )
        return undefined;
      const grant = newGrant(
        attachment,
        caller,
        undefined,
        approved && access ? { ...approved, endpoint: access.endpoint } : undefined,
        now(),
      );
      if (approved) approvals.delete(attachment);
      controls.set(id, { grant, phase: "agent", busy: false });
      grants.set(grant.token, grant);
      return grant;
    },
    lookup: (token: string) => {
      expireIdle();
      return grants.get(token);
    },
    expireIdle,
    currentGrant: (attachment: DeviceSession, caller: McpThreadCaller) => {
      expireIdle();
      const control = controls.get(key(attachment));
      return control?.phase === "agent" &&
        control.grant.attachment === attachment &&
        sameCaller(control.grant.caller, caller)
        ? control.grant
        : undefined;
    },
    release: (grant: AgentDeviceGrant) => {
      const control = controls.get(key(grant.attachment));
      if (control?.grant === grant && control.phase === "agent") stop(control);
    },
    userAction: (
      attachment: DeviceSession,
      controlId: string,
      action: "takeoverAgentControl" | "stopAgentControl" | "allowAgentControl",
      sessionId?: AuthSessionId,
    ) =>
      Effect.suspend(() => {
        const control = controls.get(key(attachment));
        if (control?.grant.id !== controlId)
          return Effect.fail(error("Device control changed. Refresh the Device panel."));
        if (action === "allowAgentControl") {
          if (control.busy || (control.phase !== "manual" && control.phase !== "stopped"))
            return Effect.fail(error("Wait for the current device command to finish."));
          if (
            control.handoff?.correction &&
            (control.handoff.attachment !== attachment ||
              control.handoff.correction.sessionId !== sessionId)
          )
            return Effect.fail(
              error("Return or release this handoff from the device tab that took control."),
            );
          delete control.handoff;
          stop(control);
          return Effect.void;
        }
        if (control.phase !== "agent")
          return Effect.fail(error("Agent control is already ending."));
        delete control.returned;
        const { grant } = control;
        const baseline = grant.lastSnapshot;
        const appId = grant.resumedApp?.appId ?? grant.approvedApp?.appId ?? baseline?.appBundleId;
        const correction =
          action === "takeoverAgentControl" &&
          attachment === grant.attachment &&
          sessionId &&
          control.access &&
          !grant.uncertain &&
          isAppId(appId) &&
          baseline?.appBundleId === appId &&
          providerActive(grant.caller)
            ? { appId, sessionId }
            : undefined;
        control.handoff = {
          attachment,
          phase: action === "takeoverAgentControl" ? "manual" : "stopped",
          ...(correction ? { correction } : {}),
        };
        stop(control);
        return Effect.void;
      }),
    returnControl: (
      attachment: DeviceSession,
      controlId: string,
      appId: string,
      meaning: string,
      sessionId: AuthSessionId,
      dispatch: DispatchDeviceReturn,
    ) =>
      Effect.gen(function* () {
        const id = key(attachment);
        const control = controls.get(id);
        if (
          !control ||
          control.grant.attachment !== attachment ||
          !providerActive(control.grant.caller)
        )
          return yield* error(
            "The original device or conversation changed. Refresh the Device panel.",
          );
        let returned = control.returned;
        if (control.phase === "manual") {
          const correction = control.handoff?.correction;
          const { grant, access } = control;
          if (
            control.busy ||
            !access ||
            !correction ||
            correction.sessionId !== sessionId ||
            controlId !== grant.id ||
            correction.appId !== appId
          )
            return yield* error("The device handoff changed. Refresh the Device panel.");
          const current = () =>
            controls.get(id) === control &&
            control.phase === "manual" &&
            control.handoff?.correction === correction &&
            providerActive(grant.caller);
          control.busy = true;
          returned = yield* access.observe(grant, appId, current).pipe(
            Effect.flatMap((snapshot) => {
              if (!current())
                return Effect.fail(error("The device handoff changed. Refresh the Device panel."));
              const after = correctionScreenKey(snapshot);
              const next = newGrant(
                attachment,
                grant.caller,
                {
                  daemonSession: grant.daemonSession,
                  resumedApp: { appId, endpoint: access.endpoint },
                },
                undefined,
                now(),
              );
              const committed = {
                controlId,
                sessionId,
                receipt: {
                  id: randomUUID(),
                  threadId: attachment.threadId,
                  target: { hostId: attachment.hostId, deviceId: attachment.deviceId },
                  appId,
                  changed: correction.before && after ? correction.before !== after : undefined,
                  meaning,
                },
                queued: false,
                queueing: false,
              };
              control.grant = next;
              control.phase = "agent";
              control.returned = committed;
              delete control.handoff;
              grants.set(next.token, next);
              return Effect.succeed(committed);
            }),
            Effect.ensuring(
              Effect.sync(() => {
                control.busy = false;
                if (control.phase === "stopping") settle(control);
              }),
            ),
          );
        }
        if (
          !returned ||
          control.phase !== "agent" ||
          returned.controlId !== controlId ||
          returned.sessionId !== sessionId ||
          returned.receipt.appId !== appId
        )
          return yield* error("The device handoff changed. Refresh the Device panel.");
        if (returned.queued) return;
        if (returned.queueing)
          return yield* error("The continuation is being queued. Check the Device panel again.");
        const receipt = returned;
        const current = () =>
          controls.get(id) === control &&
          control.phase === "agent" &&
          control.returned === receipt &&
          providerActive(control.grant.caller);
        receipt.queueing = true;
        yield* dispatch(receipt.receipt, current).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              receipt.queued = true;
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              receipt.queueing = false;
            }),
          ),
        );
      }),
    dispatch: <A, E>(
      grant: AgentDeviceGrant,
      operation: Effect.Effect<A, E>,
      access?: SessionAccess,
    ): Effect.Effect<A, E | DeviceComparisonError> =>
      Effect.suspend<A, E | DeviceComparisonError, never>(() => {
        const control = controls.get(key(grant.attachment));
        if (control?.grant !== grant || control.phase !== "agent")
          return Effect.fail(error("Device control ended. Call device_open to request it again."));
        if (control.busy)
          return Effect.fail(error("Wait for the current device command before retrying."));
        control.busy = true;
        grant.lastCommandAt = now();
        if (access) control.access = access;
        // The response body is consumed before ownership can pass to another controller.
        return operation.pipe(Effect.ensuring(Effect.sync(() => settle(control))));
      }),
  };
}
