import { randomUUID } from "node:crypto";
import type {
  AuthSessionId,
  DeviceComparisonDifference,
  DeviceComparisonEvidenceApproval,
  DeviceComparisonEvidenceDestination,
  DeviceComparisonReport,
  DeviceComparisonScrollDirection,
  DeviceComparisonStatus,
  DeviceComparisonTarget,
  DeviceComparisonTotal,
  DeviceServiceState,
  ThreadId,
  DeviceSession,
} from "@tabs/contracts";
import { DeviceComparisonError } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import {
  looksLikeCurrencyAmount,
  normalizeLabel,
  type DeviceObservation,
  type observeTotal,
  type ObservedControl,
} from "./DeviceComparisonSemantics.ts";
import type { SemanticDevice } from "./DeviceSemanticDriver.ts";
import type { DeviceReplayCheckpoint } from "./DeviceComparisonStore.ts";
import { isLiveDeviceAttachment } from "./AgentDeviceControl.ts";
import { deviceKey as key } from "./DeviceIdentity.ts";
import type { McpThreadCaller } from "../mcp/McpInvocationContext.ts";

export type Device = DeviceComparisonReport["source"];
export type Target = Device & SemanticDevice & { readonly attachment: DeviceSession };
export type Phase = DeviceComparisonReport["phase"];
export type TotalCheckpoint = NonNullable<DeviceComparisonReport["totalVerification"]>["startsAt"];
export type ObservedTotal = NonNullable<ReturnType<typeof observeTotal>>;
export type ReplayControl = NonNullable<DeviceReplayCheckpoint["steps"][number]["expected"]>;

export interface Step {
  readonly action:
    | { readonly type: "tap"; readonly control: ObservedControl }
    | {
        readonly type: "scroll";
        readonly direction: DeviceComparisonScrollDirection;
      };
  readonly before: DeviceObservation;
  readonly after: DeviceObservation;
  readonly savedTotals?: { before?: ObservedTotal; after?: ObservedTotal };
  expected?: ObservedControl;
}

export interface ReplayReturn {
  readonly controlId: string;
  readonly sessionId: AuthSessionId;
  readonly stepCompleted: boolean;
  queued: boolean;
  queueing: boolean;
}

export interface Run {
  readonly id: string;
  readonly source: Target;
  readonly sourceSessionId?: AuthSessionId;
  target?: Target;
  approvalId?: string;
  readonly agentRecording?: {
    readonly caller: McpThreadCaller;
    readonly total?: DeviceComparisonTotal;
    readonly evidenceDestination?: DeviceComparisonEvidenceDestination;
  };
  approvedEvidence?: DeviceComparisonEvidenceApproval;
  phase: Phase;
  busy: boolean;
  settled?: Deferred.Deferred<void>;
  playing: boolean;
  steps: Step[];
  observation?: DeviceObservation;
  index: number;
  opened: boolean;
  sourceOpened?: boolean;
  sourceFramesStored?: boolean;
  applied: "no" | "yes" | "unknown";
  replayScroll?: NonNullable<DeviceReplayCheckpoint["scroll"]>;
  pendingSourceStep?: Pick<Step, "action" | "before"> & {
    readonly extendScroll?: Step;
  };
  uncertainPreviousApplied?: boolean;
  uncertainClearsBlocker?: boolean;
  needsPermissionHandoff?: boolean;
  observationCancellation?: Deferred.Deferred<void>;
  replayInterrupted?: boolean;
  requireConsequentialReview?: boolean;
  restoredSessionId?: AuthSessionId;
  restoredScreenKey?: string;
  pauseReason?: string;
  manualControl?: { readonly id: string; readonly sessionId: AuthSessionId };
  replayReturn?: ReplayReturn;
  difference?: DeviceComparisonDifference;
  evidence?: NonNullable<DeviceComparisonStatus["evidence"]>;
  total?: {
    readonly settings: DeviceComparisonTotal;
    readonly startsAt: TotalCheckpoint;
    pending?: TotalCheckpoint;
  };
}

export const focused = (target: Target): Device => ({
  hostId: target.hostId,
  deviceId: target.deviceId,
  name: target.name,
  platform: target.platform,
  appId: target.appId,
});
export const error = (reason: string) => new DeviceComparisonError({ reason });
export const reject = (reason: string) => Effect.fail(error(reason));
export const MAX_STEPS = 12;

export function sourceTapObservation(
  run: Run | undefined,
  device: DeviceComparisonTarget | undefined,
  sessionId: AuthSessionId | undefined,
) {
  if (
    !run ||
    !device ||
    !sessionId ||
    run.sourceSessionId !== sessionId ||
    key(device) !== key(run.source) ||
    run.phase !== "recording" ||
    run.busy ||
    run.manualControl ||
    run.applied !== "no" ||
    run.steps.length >= MAX_STEPS
  )
    return undefined;
  const last = run.steps.at(-1);
  if (last?.action.type === "scroll" && !last.expected) return undefined;
  return run.observation?.sourceTap ? run.observation : undefined;
}
export const MAX_SESSIONS = 4;
export const active = (run: Run) =>
  run.phase === "running" || run.phase === "paused" || run.phase === "recording";
export const replaceable = (run: Run) =>
  !active(run) && !run.busy && run.phase !== "awaiting_approval";
export const canRestore = (run: Run | undefined, runId: string) =>
  !run || (run.id === runId && run.phase === "stopped" && run.replayInterrupted && !run.busy);

export const sameEvidenceApproval = (
  first: DeviceComparisonEvidenceApproval | undefined,
  second: DeviceComparisonEvidenceApproval | undefined,
) =>
  first === second ||
  (first !== undefined &&
    second !== undefined &&
    first.tabId === second.tabId &&
    first.grantIds[0] === second.grantIds[0] &&
    first.grantIds[1] === second.grantIds[1]);

export const savedControl = ({ label, role, context }: ObservedControl): ReplayControl => ({
  label,
  role,
  ...(context === undefined ? {} : { context }),
});

export const restoreSteps = (checkpoint: DeviceReplayCheckpoint): Step[] =>
  checkpoint.steps.map(({ action, expected, beforeTotal, afterTotal }) => {
    const restoreControl = (control: ReplayControl): ObservedControl => ({
      ...control,
      id: randomUUID(),
      ref: "",
      canTap: false,
      parentIndex: undefined,
      amountValue: undefined,
    });
    const identifier = action.type === "tap" ? action.uniqueIdentifier : undefined;
    const before = {
      controls: [],
      identifierCounts: new Map(identifier ? [[identifier, 1]] : []),
    };
    return {
      action:
        action.type === "scroll"
          ? action
          : {
              type: "tap",
              control: {
                ...restoreControl(action.control),
                ...(identifier && { identifier }),
              },
            },
      before,
      after: { controls: [], identifierCounts: new Map() },
      savedTotals: {
        ...(beforeTotal && { before: beforeTotal }),
        ...(afterTotal && { after: afterTotal }),
      },
      ...(expected && { expected: restoreControl(expected) }),
    };
  });

export const totalCheckFor = (run: Run): DeviceComparisonReport["totalCheck"] =>
  run.total || run.agentRecording?.total
    ? "configured"
    : run.agentRecording ||
        run.phase === "running" ||
        run.phase === "paused" ||
        run.phase === "completed"
      ? "none"
      : undefined;

// Recorded screens that show an amount are a hint that the agent should configure a total check.
export const suggestsTotalCheck = (run: Run) =>
  totalCheckFor(run) === "none" &&
  (run.phase === "awaiting_approval" || run.phase === "recording" || run.phase === "ready") &&
  run.steps.some((step) =>
    [step.before, step.after].some((frame) =>
      frame.controls.some(
        (control) =>
          looksLikeCurrencyAmount(control.label) || looksLikeCurrencyAmount(control.amountValue),
      ),
    ),
  );

export const reportFor = (run: Run, includeEvidenceDestination = true): DeviceComparisonReport => ({
  runId: run.id,
  phase: run.phase,
  source: focused(run.source),
  ...(run.target === undefined ? {} : { target: focused(run.target) }),
  ...(run.approvalId === undefined ? {} : { approvalId: run.approvalId }),
  ...(run.agentRecording && {
    agentRecording: {
      manual: run.phase === "recording" && run.manualControl !== undefined,
      ...(run.agentRecording.total && { total: run.agentRecording.total }),
      totalCheck: run.agentRecording.total ? "configured" : "none",
      ...(includeEvidenceDestination &&
        run.agentRecording.evidenceDestination && {
          evidenceDestination: run.agentRecording.evidenceDestination,
        }),
    },
  }),
  ...(totalCheckFor(run) && { totalCheck: totalCheckFor(run) }),
  ...(suggestsTotalCheck(run) && { suggestTotalCheck: true as const }),
  busy: run.busy,
  playing: run.playing,
  completedSteps: run.index,
  steps: run.steps.map(({ action, expected }) => ({
    ...(action.type === "tap"
      ? { label: action.control.label }
      : {
          label: `Scroll ${action.direction}`,
          scrollDirection: action.direction,
        }),
    ...(expected === undefined ? {} : { expected: expected.label }),
  })),
  ...(run.total && {
    totalVerification: {
      startsAt: run.total.startsAt,
      ...(run.total.pending && { pending: run.total.pending }),
    },
  }),
  ...(run.difference === undefined ? {} : { firstDifference: run.difference }),
  ...(run.evidence === undefined
    ? {}
    : {
        availableEvidence: {
          source: !!run.evidence.sourcePng,
          target: !!run.evidence.targetPng,
        },
      }),
  ...(run.pauseReason === undefined ? {} : { pauseReason: run.pauseReason }),
  canResume:
    !run.busy &&
    !run.playing &&
    run.applied !== "unknown" &&
    ((run.phase === "recording" && !!run.agentRecording && !!run.manualControl) ||
      (run.phase === "paused" && (!run.needsPermissionHandoff || !!run.manualControl))),
  uncertainTap: run.applied === "unknown",
});

// Effect steps can yield to a user takeover even inside a running-phase loop.
export const statusPhase = (run: Run) => run.phase;

export const resolveTarget = (
  state: DeviceServiceState,
  threadId: ThreadId,
  target: DeviceComparisonTarget,
  appId: string,
): Target | undefined => {
  const attachment = state.sessions.find(
    (session) => session.threadId === threadId && key(session) === key(target),
  );
  if (!attachment || !isLiveDeviceAttachment(state, attachment)) return;
  const device = state.devices.find(
    (candidate) => candidate.hostId === target.hostId && candidate.id === target.deviceId,
  );
  if (device?.booted !== true) return;
  return {
    hostId: target.hostId,
    deviceId: target.deviceId,
    platform: device.platform,
    name: device.name,
    threadId,
    appId,
    attachment,
  };
};

export const createRun = (source: Target, sourceSessionId?: AuthSessionId): Run => ({
  id: randomUUID(),
  source,
  ...(sourceSessionId === undefined ? {} : { sourceSessionId }),
  phase: "recording",
  busy: false,
  playing: false,
  steps: [],
  index: 0,
  applied: "no",
  opened: false,
});

export const visibleLabelCount = (observation: DeviceObservation, label: string) =>
  observation.controls.filter((node) => normalizeLabel(node.label) === normalizeLabel(label))
    .length;

export const cancelObservation = (run: Run) => {
  if (run.observationCancellation) Deferred.doneUnsafe(run.observationCancellation, Effect.void);
};

export const pauseReplay = (run: Run, reason: string) => {
  if (run.phase !== "running") return;
  run.phase = "paused";
  run.pauseReason = reason;
  delete run.observation;
};

export const completeSourceStep = (run: Run, after: DeviceObservation) => {
  const pending = run.pendingSourceStep;
  if (!pending) return;
  delete run.pendingSourceStep;
  run.applied = "no";
  const { action, before, extendScroll } = pending;
  if (action.type === "scroll" && (!after.screenKey || before.screenKey === after.screenKey))
    return "The scroll revealed no observable change. Check the live screen.";
  const step = { action, before: extendScroll?.before ?? before, after };
  if (extendScroll) run.steps[run.steps.length - 1] = step;
  else run.steps.push(step);
};
