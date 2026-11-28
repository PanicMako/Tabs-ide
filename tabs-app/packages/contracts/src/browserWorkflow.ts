import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";
import { PreviewTabId } from "./preview.ts";

const field = Schema.String.check(Schema.isTrimmed())
  .check(Schema.isNonEmpty())
  .check(Schema.isMaxLength(300));

export const BROWSER_WORKFLOW_UPLOAD_MAX_BYTES = 32 * 1024 * 1024;

export const BrowserWorkflowStage = Schema.Literals([
  "ready_to_upload",
  "uploaded",
  "submitted",
  "certified",
  "published",
]);
export type BrowserWorkflowStage = typeof BrowserWorkflowStage.Type;

const browserWorkflowLocation = {
  workflowId: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)),
  stage: BrowserWorkflowStage,
};

// Microsoft Store app submission resource statuses.
export const PartnerCenterSubmissionState = Schema.Literals([
  "None",
  "Canceled",
  "PendingCommit",
  "CommitStarted",
  "CommitFailed",
  "PendingPublication",
  "Publishing",
  "Published",
  "PublishFailed",
  "PreProcessing",
  "PreProcessingFailed",
  "Certification",
  "CertificationFailed",
  "Release",
  "ReleaseFailed",
]);
export type PartnerCenterSubmissionState = typeof PartnerCenterSubmissionState.Type;

export const PartnerCenterStatusRef = Schema.Struct({
  storeStatus: PartnerCenterSubmissionState,
  observedAt: Schema.String.check(
    Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u),
  ),
});

export const BrowserWorkflowResultRef = Schema.Struct({
  ...browserWorkflowLocation,
  pendingAction: Schema.optionalKey(Schema.Literals(["upload", "submit"])),
  submitRequiresUser: Schema.optionalKey(Schema.Literal(true)),
  partnerCenter: Schema.optionalKey(PartnerCenterStatusRef),
});
export type BrowserWorkflowResultRef = typeof BrowserWorkflowResultRef.Type;

export const BrowserWorkflowResultInput = Schema.Struct({
  threadId: ThreadId,
  ...browserWorkflowLocation,
  reconcileSubmission: Schema.optionalKey(Schema.Literal(true)),
  /**
   * User-only release of an uncertain pending Upload/Submit. The MCP agent tool never exposes
   * this. "confirmNotSent" = "It didn't send"; "confirmSent" = "It sent" (user attestation).
   */
  resolvePending: Schema.optionalKey(Schema.Literals(["confirmNotSent", "confirmSent"])),
});

export class BrowserWorkflowResultError extends Schema.TaggedError<BrowserWorkflowResultError>()(
  "BrowserWorkflowResultError",
  { message: Schema.String },
) {}

export const BrowserWorkflowDefinition = Schema.Struct({
  url: Schema.String.check(Schema.isMaxLength(2048)).annotate({
    description: "Exact HTTP(S) draft or status page URL used throughout this workflow.",
  }),
  identitySelector: field.annotate({ description: "CSS selector for the visible draft ID." }),
  resourceId: field.annotate({ description: "Exact visible ID for this draft." }),
  statusSelector: field.annotate({ description: "CSS selector for the visible lifecycle status." }),
  readOnly: Schema.optionalKey(Schema.Literal(true)).annotate({
    description: "Read and monitor this draft without any action selectors or breakpoint.",
  }),
  states: Schema.Struct({
    ready_to_upload: Schema.optionalKey(field),
    uploaded: Schema.optionalKey(field),
    submitted: Schema.optionalKey(field),
    certified: Schema.optionalKey(field),
    published: Schema.optionalKey(field),
  }).annotate({
    description:
      "Distinct, exact visible status labels. Read-only workflows map the visible stages to track. Guarded workflows require uploaded, submitted, certified and published, plus ready_to_upload when guarding Upload.",
  }),
  uploadSelector: Schema.optionalKey(
    field.annotate({
      description: "For a staged file, the unique HTML button that starts the upload.",
    }),
  ),
  uploadInputSelector: Schema.optionalKey(
    field.annotate({
      description:
        "For a site that uploads on file selection, the unique visible empty HTML file input. Use this instead of uploadSelector.",
    }),
  ),
  submitSelector: Schema.optionalKey(
    field.annotate({
      description: "A guarded workflow's unique, visible, enabled HTML submit button.",
    }),
  ),
  breakpoint: Schema.optionalKey(
    Schema.Struct({ selector: field, pauseText: field, clearText: field }).annotate({
      description:
        "A guarded workflow's visible condition. Exact pauseText pauses. Only exact clearText permits Upload or Submit.",
    }),
  ),
});
export type BrowserWorkflowDefinition = typeof BrowserWorkflowDefinition.Type;

export const BrowserWorkflowTarget = Schema.Struct({
  projectId: field,
  tabId: PreviewTabId,
  profileId: field,
  hostKey: field,
});
export type BrowserWorkflowTarget = typeof BrowserWorkflowTarget.Type;

export const BrowserWorkflowSavedResult = Schema.Struct({
  target: BrowserWorkflowTarget,
  definition: BrowserWorkflowDefinition,
  stage: BrowserWorkflowStage,
  pendingAction: BrowserWorkflowResultRef.fields.pendingAction,
  submitRequiresUser: BrowserWorkflowResultRef.fields.submitRequiresUser,
});
export type BrowserWorkflowSavedResult = typeof BrowserWorkflowSavedResult.Type;

export const BrowserWorkflowReceipt = Schema.Struct({
  target: BrowserWorkflowTarget,
  stage: BrowserWorkflowStage,
  statusText: field,
  /** Visible draft ID text read with the status, when the host can read it. */
  identityText: Schema.optionalKey(field),
  /** When the host read the status. Must not predate the dispatched action. */
  observedAt: Schema.optionalKey(Schema.String),
});
export type BrowserWorkflowReceipt = typeof BrowserWorkflowReceipt.Type;

export const BrowserWorkflowBrowserRequest = Schema.Struct({
  phase: Schema.Literals(["inspect", "upload", "submit", "enter", "refresh", "monitor"]),
  profileId: field,
  definition: BrowserWorkflowDefinition,
  target: Schema.optional(BrowserWorkflowTarget),
  workflowId: Schema.optional(BrowserWorkflowResultRef.fields.workflowId),
  statusOnly: Schema.optional(Schema.Boolean),
  refresh: Schema.optional(Schema.Boolean),
  lastVerifiedStage: Schema.optional(BrowserWorkflowStage),
});
export type BrowserWorkflowBrowserRequest = typeof BrowserWorkflowBrowserRequest.Type;

export const BrowserWorkflowObservation = Schema.Struct({
  stage: BrowserWorkflowStage,
  statusText: field,
  breakpoint: Schema.Literals(["clear", "matched", "unobservable", "irrelevant"]),
  submitAvailable: Schema.Boolean,
  submitRequiresUser: BrowserWorkflowResultRef.fields.submitRequiresUser,
  uploadAvailable: Schema.optionalKey(Schema.Boolean),
  /** Visible draft ID text read with the status, when the host can read it. */
  identityText: Schema.optionalKey(field),
});
export type BrowserWorkflowObservation = typeof BrowserWorkflowObservation.Type;

const pageResultFields = {
  disposition: Schema.Literals(["observed", "dispatched", "unobservable"]),
  observation: Schema.optional(BrowserWorkflowObservation),
  reason: Schema.optional(Schema.String),
};

export const BrowserWorkflowPageResult = Schema.Struct({
  ...pageResultFields,
  submitControlBinding: Schema.optional(Schema.Literals(["retained", "bound"])),
  submitControlLabel: Schema.optional(field),
  siteSubmissionKey: Schema.optionalKey(Schema.Literal(true)),
  chooseUploadFile: Schema.optionalKey(Schema.Literal(true)),
  uploadFile: Schema.optional(
    Schema.Struct({ name: field, size: Schema.Int.check(Schema.isGreaterThan(0)) }),
  ),
});
export type BrowserWorkflowPageResult = typeof BrowserWorkflowPageResult.Type;

export const BrowserWorkflowHostResult = Schema.Struct({
  ...pageResultFields,
  target: BrowserWorkflowTarget,
  resolvedDraftUrl: Schema.optionalKey(BrowserWorkflowDefinition.fields.url),
  submissionApproved: Schema.optional(Schema.Boolean),
});
export type BrowserWorkflowHostResult = typeof BrowserWorkflowHostResult.Type;

export const BrowserWorkflowResultLocation = Schema.Struct({
  tabId: PreviewTabId,
  projectId: field,
  profileId: field,
  url: BrowserWorkflowDefinition.fields.url,
  resourceId: field,
  readOnly: BrowserWorkflowDefinition.fields.readOnly,
});
export type BrowserWorkflowResultLocation = typeof BrowserWorkflowResultLocation.Type;

/** Where a stage was learned: a visible page label, a connector API read, or the user's word. */
export const BrowserWorkflowEvidenceSource = Schema.Literals(["pageLabel", "connector", "user"]);
export type BrowserWorkflowEvidenceSource = typeof BrowserWorkflowEvidenceSource.Type;

export const BrowserWorkflowEvidence = Schema.Struct({
  stage: BrowserWorkflowStage,
  observedAt: Schema.String,
  statusSelector: field,
  statusText: field,
  source: Schema.optionalKey(BrowserWorkflowEvidenceSource),
});
export type BrowserWorkflowEvidence = typeof BrowserWorkflowEvidence.Type;

export const BrowserWorkflowReport = Schema.Struct({
  workflowId: field,
  phase: Schema.Literals([
    "ready",
    "approval_required",
    "manual_submit",
    "paused",
    "unobservable",
    "uncertain",
    "verified",
    "watching",
    "watch_stopped",
  ]),
  result: BrowserWorkflowResultLocation,
  lastVerified: BrowserWorkflowEvidence,
  /** How lastVerified was learned. "verified" phase from a page label means "observed on the page". */
  evidence: Schema.optional(BrowserWorkflowEvidenceSource),
  /** Set when an Upload/Submit may have reached the site and only the user can release it. */
  pendingAction: Schema.optional(Schema.Literals(["upload", "submit"])),
  watchUntil: Schema.optional(BrowserWorkflowStage),
  breakpoint: Schema.optional(
    Schema.Struct({
      selector: field,
      observedText: field,
      observedAt: Schema.String,
    }),
  ),
  reason: Schema.optional(Schema.String),
});
export type BrowserWorkflowReport = typeof BrowserWorkflowReport.Type;

export const StoreApplicationId = Schema.String.check(Schema.isPattern(/^[\w-]{1,128}$/u));
export const StoreSubmissionId = StoreApplicationId;
export const PartnerCenterRegistrationId = Schema.String.check(
  Schema.isPattern(/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu),
);

/** Only the server can combine a saved browser workflow with a configured connector. */
export const PartnerCenterStatusRequest = Schema.Struct({
  workflowId: BrowserWorkflowResultRef.fields.workflowId,
  target: BrowserWorkflowTarget,
  definition: BrowserWorkflowDefinition,
  applicationId: StoreApplicationId,
  tenantId: PartnerCenterRegistrationId,
  clientId: PartnerCenterRegistrationId,
  verifyApprovalId: Schema.optionalKey(PartnerCenterRegistrationId),
});
export type PartnerCenterStatusRequest = typeof PartnerCenterStatusRequest.Type;

export const PartnerCenterStatusApproval = Schema.Struct({
  id: PartnerCenterRegistrationId,
  workflowId: BrowserWorkflowResultRef.fields.workflowId,
  applicationId: StoreApplicationId,
  submissionId: StoreSubmissionId,
  tenantId: PartnerCenterRegistrationId,
  clientId: PartnerCenterRegistrationId,
});
export type PartnerCenterStatusApproval = typeof PartnerCenterStatusApproval.Type;

export const PartnerCenterStatusAuthorization = Schema.Struct({
  approval: PartnerCenterStatusApproval,
  status: Schema.Literals(["approval_required", "approved"]),
});
export type PartnerCenterStatusAuthorization = typeof PartnerCenterStatusAuthorization.Type;

export const PartnerCenterConnection = Schema.Struct({
  tenantId: PartnerCenterRegistrationId,
  clientId: PartnerCenterRegistrationId,
  clientSecret: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
});
export type PartnerCenterConnection = typeof PartnerCenterConnection.Type;

export const PartnerCenterConnectionInput = Schema.Union([
  Schema.Struct({ action: Schema.Literals(["read", "clear"]) }),
  Schema.Struct({
    action: Schema.Literal("configure"),
    connection: PartnerCenterConnection.mapFields((fields) => ({
      ...fields,
      clientSecret: Schema.RedactedFromValue(fields.clientSecret),
    })),
  }),
]);

export const PartnerCenterConnectionStatus = Schema.Struct({ configured: Schema.Boolean });
export type PartnerCenterConnectionStatus = typeof PartnerCenterConnectionStatus.Type;
