import * as Schema from "effect/Schema";

export const NotificationToastTypeSchema = Schema.Literals([
  "loading",
  "success",
  "error",
  "warning",
  "info",
]);
export type NotificationToastType = typeof NotificationToastTypeSchema.Type;

export const NotificationToastActionSchema = Schema.Struct({
  actionId: Schema.String,
  label: Schema.String,
});
export type NotificationToastAction = typeof NotificationToastActionSchema.Type;

export const NotificationToastPayloadSchema = Schema.Struct({
  id: Schema.String,
  type: NotificationToastTypeSchema,
  title: Schema.String,
  description: Schema.optionalKey(Schema.String),
  duration: Schema.optionalKey(Schema.Number),
  action: Schema.optionalKey(NotificationToastActionSchema),
  createdAt: Schema.Number,
  tooltipStyle: Schema.optionalKey(Schema.Boolean),
  interactive: Schema.optionalKey(Schema.Boolean),
  threadId: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type NotificationToastPayload = typeof NotificationToastPayloadSchema.Type;

export const NotificationOverlayBoundsSchema = Schema.Struct({
  width: Schema.Number,
  height: Schema.Number,
});
export type NotificationOverlayBounds = typeof NotificationOverlayBoundsSchema.Type;

export const NotificationOverlayThemeSchema = Schema.Struct({
  themeId: Schema.String,
  isDark: Schema.Boolean,
});
export type NotificationOverlayTheme = typeof NotificationOverlayThemeSchema.Type;

export const NotificationOverlayActionDispatchSchema = Schema.Struct({
  toastId: Schema.String,
  actionId: Schema.String,
});
export type NotificationOverlayActionDispatch = typeof NotificationOverlayActionDispatchSchema.Type;

export const NotificationOverlayDismissDispatchSchema = Schema.Struct({
  toastId: Schema.String,
});
export type NotificationOverlayDismissDispatch =
  typeof NotificationOverlayDismissDispatchSchema.Type;
