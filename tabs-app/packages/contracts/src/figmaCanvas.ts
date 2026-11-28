import * as Schema from "effect/Schema";

import { BrowserWorkflowTarget } from "./browserWorkflow.ts";
import { ThreadId } from "./baseSchemas.ts";

export const FigmaAttachmentId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u),
);
export const FigmaNodeId = Schema.String.check(Schema.isPattern(/^\d{1,16}:\d{1,16}$/u));
export const FigmaFileKey = Schema.String.check(Schema.isPattern(/^[\w-]{1,128}$/u));
export const FigmaOperationId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u));
const profile = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(300));
const size = Schema.Int.check(Schema.isBetween({ minimum: 24, maximum: 4096 }));

export const FigmaFrameSpec = Schema.Struct({
  name: Schema.String.check(Schema.isTrimmed(), Schema.isNonEmpty(), Schema.isMaxLength(120)),
  text: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(2000)),
  width: size,
  height: size,
});
export type FigmaFrameSpec = typeof FigmaFrameSpec.Type;

export const FigmaCanvasTarget = Schema.Struct({
  ...BrowserWorkflowTarget.fields,
  attachmentId: FigmaAttachmentId,
  mainFileKey: FigmaFileKey,
  fileKey: FigmaFileKey,
  nodeId: FigmaNodeId,
});
export type FigmaCanvasTarget = typeof FigmaCanvasTarget.Type;

export const FigmaCanvasWrite = Schema.Struct({
  target: FigmaCanvasTarget,
  operationId: FigmaOperationId,
  email: Schema.String.check(Schema.isMaxLength(254), Schema.isPattern(/^[^\s@]+@[^\s@]+$/u)),
  frame: FigmaFrameSpec,
});
export type FigmaCanvasWrite = typeof FigmaCanvasWrite.Type;

export const FigmaCanvasApproval = Schema.Struct({
  id: FigmaAttachmentId,
  ...FigmaCanvasWrite.fields,
});
export type FigmaCanvasApproval = typeof FigmaCanvasApproval.Type;

export const FigmaCanvasBrowserRequest = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("inspect"),
    attachmentId: FigmaAttachmentId,
    profileId: profile,
  }),
  Schema.Struct({ action: Schema.Literal("authorize"), ...FigmaCanvasWrite.fields }),
  Schema.Struct({ action: Schema.Literal("dispatch"), approval: FigmaCanvasApproval }),
]);
export type FigmaCanvasBrowserRequest = typeof FigmaCanvasBrowserRequest.Type;

export const FigmaCanvasAuthorization = Schema.Struct({
  status: Schema.Literals(["approval_required", "approved"]),
  approval: FigmaCanvasApproval,
});
export type FigmaCanvasAuthorization = typeof FigmaCanvasAuthorization.Type;

export const FigmaCanvasResultRef = Schema.Struct({ operationId: FigmaOperationId });
export type FigmaCanvasResultRef = typeof FigmaCanvasResultRef.Type;

export const FigmaCanvasResultInput = Schema.Struct({
  threadId: ThreadId,
  ...FigmaCanvasResultRef.fields,
});
export class FigmaCanvasResultError extends Schema.TaggedError<FigmaCanvasResultError>()(
  "FigmaCanvasResultError",
  { message: Schema.String },
) {}
export const FigmaCanvasReceipt = Schema.Struct({
  target: FigmaCanvasTarget,
  frameNodeId: FigmaNodeId,
  textNodeId: FigmaNodeId,
  verifiedAt: Schema.String,
});
export type FigmaCanvasReceipt = typeof FigmaCanvasReceipt.Type;
