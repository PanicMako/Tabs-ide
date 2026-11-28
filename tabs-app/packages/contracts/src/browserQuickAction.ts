import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { BrowserProfileId } from "./browserProfile.ts";
import { PreviewTabId } from "./preview.ts";

export const BROWSER_QUICK_ACTION_MAX_STEPS = 12;
export const BROWSER_QUICK_ACTION_FILENAME_MAX_LENGTH = 240;
export const BROWSER_QUICK_ACTION_MAX_FILE_BYTES = 16 * 1024 * 1024;

const bounded = (length: number) => TrimmedNonEmptyString.check(Schema.isMaxLength(length));
const selector = Schema.String.check(Schema.isMaxLength(240));

export const BROWSER_QUICK_ACTION_ROLES = [
  "button",
  "link",
  "textbox",
  "combobox",
  "checkbox",
  "radio",
  "status",
  "alert",
  "heading",
  "region",
] as const;

export const BrowserQuickActionSemantic = Schema.Struct({
  role: Schema.Literals(BROWSER_QUICK_ACTION_ROLES),
  name: bounded(80),
  group: Schema.optionalKey(bounded(80)),
});
export type BrowserQuickActionSemantic = typeof BrowserQuickActionSemantic.Type;

const browserTarget = {
  selector,
  semantic: Schema.optionalKey(BrowserQuickActionSemantic),
};

export const BrowserQuickActionStep = Schema.Struct({
  action: Schema.Literals(["click", "fill", "selectOption", "check", "uncheck"]),
  ...browserTarget,
  tag: Schema.optionalKey(bounded(40)),
  parameter: Schema.optionalKey(bounded(40)),
});
export type BrowserQuickActionStep = typeof BrowserQuickActionStep.Type;

export const BrowserQuickAction = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  label: bounded(80),
  origin: bounded(512),
  steps: Schema.Array(BrowserQuickActionStep).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(BROWSER_QUICK_ACTION_MAX_STEPS),
  ),
  outcome: Schema.Struct({
    ...browserTarget,
    description: bounded(200),
    filenamePattern: Schema.optionalKey(bounded(BROWSER_QUICK_ACTION_FILENAME_MAX_LENGTH)),
  }),
});
export type BrowserQuickAction = typeof BrowserQuickAction.Type;

// Desktop IPC metadata for committing a repair after its file is verified.
export const BrowserQuickActionVerifiedRepair = Schema.Struct({
  previous: BrowserQuickAction,
  replacement: BrowserQuickAction,
});
export type BrowserQuickActionVerifiedRepair = typeof BrowserQuickActionVerifiedRepair.Type;

export const BrowserQuickActionFileReceipt = Schema.Struct({
  filename: bounded(BROWSER_QUICK_ACTION_FILENAME_MAX_LENGTH),
  byteLength: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: BROWSER_QUICK_ACTION_MAX_FILE_BYTES }),
  ),
  sha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
});

export const BrowserQuickActionFileResultRef = Schema.Struct({
  resultId: Schema.String.check(Schema.isUUID()),
  tabId: PreviewTabId,
  profileId: BrowserProfileId,
  filename: BrowserQuickActionFileReceipt.fields.filename,
  restorable: Schema.optionalKey(Schema.Literal(true)),
});
export type BrowserQuickActionFileResultRef = typeof BrowserQuickActionFileResultRef.Type;

export const BrowserQuickActionPauseRef = Schema.Struct({
  pauseId: Schema.String.check(Schema.isUUID()),
  tabId: PreviewTabId,
  profileId: BrowserProfileId,
});
export type BrowserQuickActionPauseRef = typeof BrowserQuickActionPauseRef.Type;

const actionId = Schema.String.check(Schema.isUUID());
export const BrowserQuickActionRequestRef = Schema.Struct({
  actionId,
  pause: Schema.optionalKey(BrowserQuickActionPauseRef),
});
export type BrowserQuickActionRequestRef = typeof BrowserQuickActionRequestRef.Type;

export const BrowserQuickActionResult = Schema.Struct({
  status: Schema.Literals(["pass", "paused", "interrupted", "fail"]),
  completedSteps: Schema.Int,
  message: Schema.String,
  fileReceipt: Schema.optionalKey(BrowserQuickActionFileReceipt),
  fileResult: Schema.optionalKey(BrowserQuickActionFileResultRef),
  resumeRequest: Schema.optionalKey(Schema.Struct({ actionId, pause: BrowserQuickActionPauseRef })),
});
export type BrowserQuickActionResult = typeof BrowserQuickActionResult.Type;

export const BrowserQuickActionApprovalRequired = Schema.Struct({
  status: Schema.Literal("approval_required"),
  actionId,
});
export type BrowserQuickActionApprovalRequired = typeof BrowserQuickActionApprovalRequired.Type;

export const BrowserQuickActionRequestInput = Schema.Struct({
  actionName: TrimmedNonEmptyString.pipe(
    Schema.annotateEncoded({
      description: "Exact saved Quick Action name in this thread's project, ignoring case.",
    }),
  ),
}).annotate({ parseOptions: { onExcessProperty: "error" } });

export interface BrowserQuickActionTarget {
  readonly sessionId: string;
  readonly token: string;
  readonly profileId: string;
  readonly page: string;
  readonly visible: boolean;
  readonly assignedTaskId: string | null;
  readonly approval?: { readonly id: string; readonly taskId: string };
  readonly pausedAt?: number;
  readonly repairAt?: number;
  readonly lockedParameters?: readonly string[];
  readonly unconfirmedStepId?: string;
  readonly pauseOwner?: { readonly pauseId: string; readonly taskId: string };
  readonly running?: boolean;
}
