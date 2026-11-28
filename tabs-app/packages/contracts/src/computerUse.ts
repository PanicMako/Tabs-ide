import * as Schema from "effect/Schema";
import { ThreadId } from "./baseSchemas.ts";

export const NativeWindowFrame = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
});
export type NativeWindowFrame = typeof NativeWindowFrame.Type;

export const NativeComputerCapabilities = Schema.Struct({
  session: Schema.Literals(["macos", "windows", "x11", "wayland", "headless", "unsupported"]),
  windowSelection: Schema.Boolean,
  accessibilityActions: Schema.Boolean,
  windowCapture: Schema.Boolean,
  foregroundInput: Schema.Boolean,
  details: Schema.String,
});
export type NativeComputerCapabilities = typeof NativeComputerCapabilities.Type;

/** What the server can see about desktop control availability and platform permissions. */
export const ComputerUsePermissionStatus = Schema.Struct({
  /** False when computer use is unavailable on the current platform. */
  platformSupported: Schema.Boolean,
  accessibility: Schema.Boolean,
  /** Inferred, because macOS has no direct query a child process can make. */
  screenRecording: Schema.Literals(["granted", "denied", "unknown"]),
  capabilities: Schema.optionalKey(NativeComputerCapabilities),
  /** "preview" when this platform's control has not been verified on a live desktop. */
  maturity: Schema.optionalKey(Schema.Literals(["stable", "preview"])),
  /** User-facing explanation of the maturity, shown beside the capability. */
  maturityNote: Schema.optionalKey(Schema.String),
});
export type ComputerUsePermissionStatus = typeof ComputerUsePermissionStatus.Type;

export const NativeWindowChoice = Schema.Struct({
  id: Schema.String,
  app: Schema.String,
  title: Schema.String,
  pid: Schema.Number,
  frame: NativeWindowFrame,
});
export type NativeWindowChoice = typeof NativeWindowChoice.Type;

export const NativeWindowGrant = Schema.Struct({
  window: NativeWindowChoice,
  selector: Schema.String,
  mode: Schema.Literals(["agent", "user"]),
  foreground: Schema.Boolean,
  /** Identifies the latest user takeover and stays valid when control returns to the agent. */
  takeoverId: Schema.optionalKey(Schema.String),
});
export type NativeWindowGrant = typeof NativeWindowGrant.Type;

export const NativeComputerCommand = Schema.Union([
  Schema.Struct({ op: Schema.Literal("status"), threadId: ThreadId }),
  Schema.Struct({ op: Schema.Literal("list"), threadId: ThreadId }),
  Schema.Struct({
    op: Schema.Literal("attach"),
    threadId: ThreadId,
    windowId: Schema.String,
    foreground: Schema.Boolean,
  }),
  Schema.Struct({ op: Schema.Literal("reveal"), threadId: ThreadId, selector: Schema.String }),
  Schema.Struct({
    op: Schema.Literal("take"),
    threadId: ThreadId,
    selector: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    op: Schema.Literal("resume"),
    threadId: ThreadId,
    selector: Schema.optionalKey(Schema.String),
    takeoverId: Schema.optionalKey(Schema.String),
    meaning: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(320))),
  }),
  Schema.Struct({
    op: Schema.Literal("revoke"),
    threadId: ThreadId,
    selector: Schema.optionalKey(Schema.String),
  }),
]);
export type NativeComputerCommand = typeof NativeComputerCommand.Type;

export const NativeComputerState = Schema.Struct({
  grant: Schema.NullOr(NativeWindowGrant),
  /** Runtime activity for the current attached grant. */
  activity: Schema.optionalKey(
    Schema.Literals(["background", "checking_foreground", "needs_foreground", "foreground"]),
  ),
  /** Returned by a verified resume when there is a step to continue. */
  continuationId: Schema.optionalKey(Schema.String),
  windows: Schema.optionalKey(Schema.Array(NativeWindowChoice)),
  capabilities: Schema.optionalKey(NativeComputerCapabilities),
});
export type NativeComputerState = typeof NativeComputerState.Type;

export class NativeComputerError extends Schema.TaggedError<NativeComputerError>()(
  "NativeComputerError",
  { code: Schema.String, message: Schema.String },
) {}
