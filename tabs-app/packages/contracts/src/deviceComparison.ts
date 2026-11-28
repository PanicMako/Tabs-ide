import * as Schema from "effect/Schema";
import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { BrowserProfileId } from "./browserProfile.ts";
import {
  DeviceAppApproval,
  DeviceAppId,
  DeviceHostId,
  DeviceId,
  DevicePlatform,
} from "./device.ts";
import { PreviewTabId } from "./preview.ts";

export const DeviceComparisonTarget = Schema.Struct({ hostId: DeviceHostId, deviceId: DeviceId });
export type DeviceComparisonTarget = typeof DeviceComparisonTarget.Type;

const Label = TrimmedNonEmptyString.check(Schema.isMaxLength(180));
const RunId = Schema.String.check(Schema.isUUID());

export const DeviceComparisonRequestRef = Schema.Struct({ runId: RunId });
export type DeviceComparisonRequestRef = typeof DeviceComparisonRequestRef.Type;
export const DeviceAppRequestRef = Schema.Struct({
  ...DeviceComparisonTarget.fields,
  approvalId: RunId,
});
export type DeviceAppRequestRef = typeof DeviceAppRequestRef.Type;
export const DeviceAccessRequestRef = Schema.Union([
  DeviceComparisonRequestRef,
  DeviceAppRequestRef,
]);
export type DeviceAccessRequestRef = typeof DeviceAccessRequestRef.Type;

export const DeviceComparisonResultRef = Schema.Struct({
  ...DeviceComparisonRequestRef.fields,
  step: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type DeviceComparisonResultRef = typeof DeviceComparisonResultRef.Type;

export type DeviceComparisonViewRef = DeviceComparisonRequestRef & { readonly step?: number };

export const DeviceComparisonFrame = Schema.Struct({
  ...DeviceComparisonResultRef.fields,
  side: Schema.Literals(["source", "target"]),
});
export type DeviceComparisonFrame = typeof DeviceComparisonFrame.Type;

export const DeviceComparisonFirstDifference = Schema.Struct({
  ...DeviceComparisonRequestRef.fields,
  side: DeviceComparisonFrame.fields.side,
});
export type DeviceComparisonFirstDifference = typeof DeviceComparisonFirstDifference.Type;

export const DeviceComparisonEvidenceDestination = Schema.Struct({
  tabId: PreviewTabId,
  profileId: BrowserProfileId,
  pageRef: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  instanceId: RunId,
});
export type DeviceComparisonEvidenceDestination = typeof DeviceComparisonEvidenceDestination.Type;

export const DeviceComparisonEvidenceApproval = Schema.Struct({
  tabId: PreviewTabId,
  grantIds: Schema.Tuple([RunId, RunId]),
});
export type DeviceComparisonEvidenceApproval = typeof DeviceComparisonEvidenceApproval.Type;

export const DeviceComparisonTotal = Schema.Struct({
  sourceLabel: Label,
  targetLabel: Label,
  currency: Schema.Literals(["USD", "EUR", "GBP"]),
});
export type DeviceComparisonTotal = typeof DeviceComparisonTotal.Type;

/** Whether a replay compares totals: "none" means no total check was configured. */
export const DeviceComparisonTotalCheck = Schema.Literals(["configured", "none"]);
export type DeviceComparisonTotalCheck = typeof DeviceComparisonTotalCheck.Type;

export const DeviceComparisonReplay = Schema.Struct({
  runId: RunId,
  approvalId: RunId,
  total: Schema.optional(DeviceComparisonTotal),
});
export type DeviceComparisonReplay = typeof DeviceComparisonReplay.Type;

export const DeviceComparisonAppId = DeviceAppId;
const AppId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(255),
  Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9_-]*(?:\.[a-zA-Z0-9_-]+)+$/),
);
export const DeviceComparisonScrollDirection = Schema.Literals(["up", "down"]);
export type DeviceComparisonScrollDirection = typeof DeviceComparisonScrollDirection.Type;
const Scroll = Schema.Struct({
  action: Schema.Literal("scroll"),
  runId: RunId,
  direction: DeviceComparisonScrollDirection,
});
export const DeviceComparisonRecording = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("propose"),
    source: Schema.Struct({ ...DeviceComparisonTarget.fields, appId: AppId }),
    target: Schema.Struct({ ...DeviceComparisonTarget.fields, appId: AppId }),
    total: Schema.optional(DeviceComparisonTotal),
    evidenceDestination: Schema.optional(DeviceComparisonEvidenceDestination),
  }),
  Schema.Struct({
    action: Schema.Literals(["inspect", "finish"]),
    runId: RunId,
  }),
  Schema.Struct({
    action: Schema.Literals(["tap", "expect"]),
    runId: RunId,
    controlId: RunId,
  }),
  Scroll,
]);
export type DeviceComparisonRecording = typeof DeviceComparisonRecording.Type;

const run = { runId: RunId };
const thread = { threadId: ThreadId };
const Coordinate = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }));
const DisplaySize = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 16_384 }));
const ScreenViewport = Schema.Struct({ width: DisplaySize, height: DisplaySize });
const Viewport = Schema.optional(ScreenViewport);
export const DeviceComparisonGesture = Schema.Union([
  Schema.Struct({ type: Schema.Literal("tap"), x: Coordinate, y: Coordinate, viewport: Viewport }),
  Schema.Struct({
    type: Schema.Literal("swipe"),
    x1: Coordinate,
    y1: Coordinate,
    x2: Coordinate,
    y2: Coordinate,
    durationMs: Schema.Int.check(Schema.isBetween({ minimum: 50, maximum: 1500 })),
    viewport: Viewport,
  }),
  Schema.Struct({
    type: Schema.Literal("text"),
    text: Schema.String.check(Schema.isMaxLength(64)),
  }),
  Schema.Struct({
    type: Schema.Literal("key"),
    keycode: Schema.Literals([19, 20, 21, 22, 61, 66, 67, 111, 112]),
  }),
  Schema.Struct({ type: Schema.Literals(["back", "home", "recents"]) }),
]);
export type DeviceComparisonGesture = typeof DeviceComparisonGesture.Type;

export const DeviceComparisonInput = Schema.Union([
  Schema.Struct({
    ...thread,
    action: Schema.Literal("status"),
    device: Schema.optional(DeviceComparisonTarget),
    runId: Schema.optional(RunId),
    waitForCheckpoint: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    ...thread,
    action: Schema.Literals(["takeoverAgentControl", "stopAgentControl", "allowAgentControl"]),
    device: DeviceComparisonTarget,
    controlId: RunId,
  }),
  Schema.Struct({
    ...thread,
    action: Schema.Literal("approveDeviceApp"),
    device: DeviceComparisonTarget,
    approvalId: RunId,
  }),
  Schema.Struct({
    ...thread,
    action: Schema.Literal("declineDeviceApp"),
    device: DeviceComparisonTarget,
    approvalId: RunId,
  }),
  Schema.Struct({
    ...thread,
    action: Schema.Literal("requestDeviceApp"),
    device: DeviceComparisonTarget,
    appId: DeviceAppId,
  }),
  Schema.Struct({
    ...thread,
    action: Schema.Literal("returnAgentControl"),
    device: DeviceComparisonTarget,
    controlId: RunId,
    appId: AppId,
    meaning: Schema.optional(Schema.String.check(Schema.isMaxLength(300))),
  }),
  Schema.Struct({
    ...thread,
    action: Schema.Literal("start"),
    device: DeviceComparisonTarget,
    appId: AppId,
  }),
  Schema.Struct({
    ...thread,
    ...run,
    action: Schema.Literal("approve"),
    target: DeviceComparisonTarget,
    appId: AppId,
  }),
  Schema.Struct({
    ...thread,
    ...run,
    action: Schema.Literal("approveAgentRecording"),
    approvalRequestId: Schema.optional(RunId),
    evidence: Schema.optional(DeviceComparisonEvidenceApproval),
  }),
  Schema.Struct({ ...thread, ...run, action: Schema.Literal("inspect") }),
  Schema.Struct({ ...thread, ...Scroll.fields }),
  Schema.Struct({
    ...thread,
    ...run,
    action: Schema.Literal("tap"),
    controlId: RunId,
    clearsBlocker: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    ...thread,
    ...run,
    action: Schema.Literal("sourceTap"),
    device: DeviceComparisonTarget,
    observationId: RunId,
    x: Coordinate,
    y: Coordinate,
    viewport: ScreenViewport,
  }),
  Schema.Struct({ ...thread, ...run, action: Schema.Literal("expect"), controlId: RunId }),
  Schema.Struct({ ...thread, ...run, action: Schema.Literal("finish") }),
  Schema.Struct({ ...thread, action: Schema.Literal("replay"), ...DeviceComparisonReplay.fields }),
  Schema.Struct({
    ...thread,
    ...run,
    action: Schema.Literal("takeover"),
    liveInput: Schema.optional(Schema.Boolean),
    device: Schema.optional(DeviceComparisonTarget),
  }),
  Schema.Struct({
    ...thread,
    ...run,
    action: Schema.Literal("manualInput"),
    controlId: RunId,
    gesture: DeviceComparisonGesture,
  }),
  Schema.Struct({
    ...thread,
    ...run,
    action: Schema.Literal("resume"),
    controlId: Schema.optional(RunId),
    stepCompleted: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    ...thread,
    ...run,
    action: Schema.Literal("restoreReplay"),
    device: DeviceComparisonTarget,
    appId: AppId,
  }),
  Schema.Struct({
    ...thread,
    ...run,
    action: Schema.Literal("resolve"),
    controlId: Schema.optional(RunId),
    applied: Schema.Boolean,
  }),
  Schema.Struct({ ...thread, ...run, action: Schema.Literal("stop") }),
  Schema.Struct({ ...thread, ...run, action: Schema.Literal("evidence") }),
]);
export type DeviceComparisonInput = typeof DeviceComparisonInput.Type;

const Device = Schema.Struct({
  ...DeviceComparisonTarget.fields,
  name: Schema.String,
  platform: DevicePlatform,
  appId: AppId,
});

const Control = Schema.Struct({
  id: RunId,
  label: Label,
  role: Schema.String,
  context: Schema.optional(Label),
  canTap: Schema.Boolean,
});
export type DeviceComparisonControl = typeof Control.Type;

const Difference = Schema.Struct({
  step: Schema.Int,
  kind: Schema.Literals(["control", "outcome", "total", "unobservable", "driver"]),
  reason: Schema.String,
  sourceTotal: Schema.optional(Schema.String),
  targetTotal: Schema.optional(Schema.String),
});
export type DeviceComparisonDifference = typeof Difference.Type;

const TotalCheckpoint = Schema.Struct({
  step: Schema.Int.check(Schema.isGreaterThan(0)),
  timing: Schema.Literals(["before", "after"]),
});

export const DeviceComparisonReport = Schema.Struct({
  runId: RunId,
  phase: Schema.Literals([
    "awaiting_approval",
    "recording",
    "ready",
    "running",
    "paused",
    "completed",
    "stopped",
  ]),
  source: Device,
  target: Schema.optional(Device),
  approvalId: Schema.optional(RunId),
  agentRecording: Schema.optional(
    Schema.Struct({
      manual: Schema.Boolean,
      total: Schema.optional(DeviceComparisonTotal),
      totalCheck: Schema.optional(DeviceComparisonTotalCheck),
      evidenceDestination: Schema.optional(DeviceComparisonEvidenceDestination),
    }),
  ),
  totalCheck: Schema.optional(DeviceComparisonTotalCheck),
  /** The recorded screens show a currency amount but no total check is configured. */
  suggestTotalCheck: Schema.optional(Schema.Literal(true)),
  busy: Schema.Boolean,
  playing: Schema.Boolean,
  completedSteps: Schema.Int,
  steps: Schema.Array(
    Schema.Struct({
      label: Label,
      expected: Schema.optional(Label),
      scrollDirection: Schema.optional(DeviceComparisonScrollDirection),
    }),
  ),
  totalVerification: Schema.optional(
    Schema.Struct({ startsAt: TotalCheckpoint, pending: Schema.optional(TotalCheckpoint) }),
  ),
  firstDifference: Schema.optional(Difference),
  availableEvidence: Schema.optional(
    Schema.Struct({ source: Schema.Boolean, target: Schema.Boolean }),
  ),
  savedAt: Schema.optional(Schema.String),
  pauseReason: Schema.optional(Schema.String),
  canResume: Schema.Boolean,
  uncertainTap: Schema.Boolean,
});
export type DeviceComparisonReport = typeof DeviceComparisonReport.Type;

export class DeviceComparisonError extends Schema.TaggedError<DeviceComparisonError>()(
  "DeviceComparisonError",
  { reason: Schema.String },
) {
  override get message() {
    return this.reason;
  }
}

export const DeviceComparisonStatus = Schema.Struct({
  pendingAppApproval: Schema.optional(DeviceAppApproval),
  approvedApp: Schema.optional(DeviceAppApproval),
  ownerThreadId: Schema.optional(ThreadId),
  manualControlId: Schema.optional(RunId),
  sourceTapId: Schema.optional(RunId),
  canRestoreReplay: Schema.optional(Schema.Literal(true)),
  pendingReplayReturn: Schema.optional(
    Schema.Struct({ controlId: RunId, stepCompleted: Schema.Boolean }),
  ),
  agentControl: Schema.optional(
    Schema.Struct({
      id: RunId,
      phase: Schema.Literals(["agent", "stopping", "manual", "stopped"]),
      threadId: ThreadId,
      returnToApp: Schema.optional(Schema.Struct({ appId: AppId })),
      pendingReturn: Schema.optional(Schema.Struct({ appId: AppId, controlId: RunId })),
    }),
  ),
  run: Schema.optional(DeviceComparisonReport),
  totalCheck: Schema.optional(DeviceComparisonTotalCheck),
  liveTargetAvailable: Schema.optional(Schema.Literal(true)),
  controls: Schema.optional(Schema.Array(Control)),
  approvedEvidence: Schema.optional(DeviceComparisonEvidenceApproval),
  evidence: Schema.optional(
    Schema.Struct({
      sourcePng: Schema.optional(Schema.String),
      targetPng: Schema.optional(Schema.String),
      /** Saved before result images carried a digest, so their bytes could not be verified. */
      unverified: Schema.optional(Schema.Literal(true)),
      /** An image failed its saved digest and was withheld. */
      unavailableReason: Schema.optional(Schema.String),
    }),
  ),
});
export type DeviceComparisonStatus = typeof DeviceComparisonStatus.Type;
