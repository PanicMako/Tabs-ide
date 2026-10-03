import { Schema } from "effect";

export const DesktopCapturePermissionStatusSchema = Schema.Literals([
  "granted",
  "denied",
  "restricted",
  "not-determined",
  "unknown",
]);
export type DesktopCapturePermissionStatus = typeof DesktopCapturePermissionStatusSchema.Type;

export const DesktopCaptureOptionsSchema = Schema.Struct({
  target: Schema.optional(Schema.Literals(["screen", "window"])),
  thumbnailWidth: Schema.optional(Schema.Number),
  thumbnailHeight: Schema.optional(Schema.Number),
});
export type DesktopCaptureOptions = typeof DesktopCaptureOptionsSchema.Type;

export const DesktopCaptureResultSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  mimeType: Schema.String,
  dataUrl: Schema.String,
  sizeBytes: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
export type DesktopCaptureResult = typeof DesktopCaptureResultSchema.Type;
