import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  ApprovalRequestId,
  EventId,
  IsoDateTime,
  ProviderItemId,
  ThreadId,
  TurnId,
} from "./baseSchemas.ts";
import {
  ChatAttachment,
  ModelSelection,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ProviderApprovalDecision,
  ProviderApprovalPolicy,
  ProviderInteractionMode,
  ProviderRequestKind,
  ProviderSandboxMode,
  ProviderUserInputAnswers,
  RuntimeMode,
} from "./orchestration.ts";
import { ProviderOptionDescriptor } from "./model.ts";
import { ProviderInstanceId, ProviderDriverKind } from "./providerInstance.ts";

export const ProviderMentionReference = Schema.Struct({
  name: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
});
export type ProviderMentionReference = typeof ProviderMentionReference.Type;

export const ProviderAgentDescriptor = Schema.Struct({
  name: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  model: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderAgentDescriptor = typeof ProviderAgentDescriptor.Type;

export const ProviderListAgentsResult = Schema.Struct({
  agents: Schema.Array(ProviderAgentDescriptor),
  source: Schema.optional(TrimmedNonEmptyString),
  cached: Schema.optional(Schema.Boolean),
});
export type ProviderListAgentsResult = typeof ProviderListAgentsResult.Type;

export const ProviderNativeCommandDescriptor = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderNativeCommandDescriptor = typeof ProviderNativeCommandDescriptor.Type;

export const ProviderListCommandsResult = Schema.Struct({
  commands: Schema.Array(ProviderNativeCommandDescriptor),
  source: Schema.optional(TrimmedNonEmptyString),
  cached: Schema.optional(Schema.Boolean),
});
export type ProviderListCommandsResult = typeof ProviderListCommandsResult.Type;

export const ProviderReasoningEffortDescriptor = Schema.Struct({
  value: TrimmedNonEmptyString,
  label: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderReasoningEffortDescriptor = typeof ProviderReasoningEffortDescriptor.Type;

export const ProviderContextWindowDescriptor = Schema.Struct({
  value: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  isDefault: Schema.optional(Schema.Literal(true)),
});
export type ProviderContextWindowDescriptor = typeof ProviderContextWindowDescriptor.Type;

export const ProviderModelDescriptor = Schema.Struct({
  slug: TrimmedNonEmptyString,
  resolvedModel: Schema.optional(TrimmedNonEmptyString),
  name: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  upstreamProviderId: Schema.optional(TrimmedNonEmptyString),
  upstreamProviderName: Schema.optional(TrimmedNonEmptyString),
  optionDescriptors: Schema.optional(Schema.Array(ProviderOptionDescriptor)),
  supportedReasoningEfforts: Schema.optional(Schema.Array(ProviderReasoningEffortDescriptor)),
  defaultReasoningEffort: Schema.optional(TrimmedNonEmptyString),
  supportsFastMode: Schema.optional(Schema.Boolean),
  supportsThinkingToggle: Schema.optional(Schema.Boolean),
  supportsAutoMode: Schema.optional(Schema.Boolean),
  contextWindowOptions: Schema.optional(Schema.Array(ProviderContextWindowDescriptor)),
  defaultContextWindow: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderModelDescriptor = typeof ProviderModelDescriptor.Type;

export const ProviderListModelsResult = Schema.Struct({
  models: Schema.Array(ProviderModelDescriptor),
  source: Schema.optional(TrimmedNonEmptyString),
  cached: Schema.optional(Schema.Boolean),
});
export type ProviderListModelsResult = typeof ProviderListModelsResult.Type;

const ProviderSessionStatus = Schema.Literals([
  "connecting",
  "ready",
  "running",
  "error",
  "closed",
]);

export const ProviderSession = Schema.Struct({
  provider: ProviderDriverKind,
  // Optional during the driver/instance migration. Once every producer
  // populates it (post-slice-4), routing flips to instance-id-only and the
  // legacy `provider` field is removed.
  providerInstanceId: Schema.optional(ProviderInstanceId),
  status: ProviderSessionStatus,
  runtimeMode: RuntimeMode,
  cwd: Schema.optional(TrimmedNonEmptyString),
  model: Schema.optional(TrimmedNonEmptyString),
  threadId: ThreadId,
  resumeCursor: Schema.optional(Schema.Unknown),
  activeTurnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastError: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderSession = typeof ProviderSession.Type;

export const ProviderSessionStartInput = Schema.Struct({
  threadId: ThreadId,
  provider: Schema.optional(ProviderDriverKind),
  // See ProviderSession for the migration story.
  providerInstanceId: Schema.optional(ProviderInstanceId),
  cwd: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  resumeCursor: Schema.optional(Schema.Unknown),
  approvalPolicy: Schema.optional(ProviderApprovalPolicy),
  sandboxMode: Schema.optional(ProviderSandboxMode),
  runtimeMode: RuntimeMode,
});
export type ProviderSessionStartInput = typeof ProviderSessionStartInput.Type;

export const ProviderSendTurnInput = Schema.Struct({
  threadId: ThreadId,
  input: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)),
  ),
  attachments: Schema.optional(
    Schema.Array(ChatAttachment).check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS)),
  ),
  modelSelection: Schema.optional(ModelSelection),
  interactionMode: Schema.optional(ProviderInteractionMode),
});
export type ProviderSendTurnInput = typeof ProviderSendTurnInput.Type;

export const ProviderTurnStartResult = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  resumeCursor: Schema.optional(Schema.Unknown),
});
export type ProviderTurnStartResult = typeof ProviderTurnStartResult.Type;

export const ProviderInterruptTurnInput = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
});
export type ProviderInterruptTurnInput = typeof ProviderInterruptTurnInput.Type;

export const ProviderStopSessionInput = Schema.Struct({
  threadId: ThreadId,
});
export type ProviderStopSessionInput = typeof ProviderStopSessionInput.Type;

export const ProviderRespondToRequestInput = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
});
export type ProviderRespondToRequestInput = typeof ProviderRespondToRequestInput.Type;

export const ProviderRespondToUserInputInput = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
});
export type ProviderRespondToUserInputInput = typeof ProviderRespondToUserInputInput.Type;

const ProviderEventKind = Schema.Literals(["session", "notification", "request", "error"]);

export const ProviderEvent = Schema.Struct({
  id: EventId,
  kind: ProviderEventKind,
  provider: ProviderDriverKind,
  // See ProviderSession for the migration story.
  providerInstanceId: Schema.optional(ProviderInstanceId),
  threadId: ThreadId,
  createdAt: IsoDateTime,
  method: TrimmedNonEmptyString,
  message: Schema.optional(TrimmedNonEmptyString),
  turnId: Schema.optional(TurnId),
  itemId: Schema.optional(ProviderItemId),
  requestId: Schema.optional(ApprovalRequestId),
  requestKind: Schema.optional(ProviderRequestKind),
  textDelta: Schema.optional(Schema.String),
  payload: Schema.optional(Schema.Unknown),
});
export type ProviderEvent = typeof ProviderEvent.Type;
