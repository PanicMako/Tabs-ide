import * as Schema from "effect/Schema";

/** What the server can see of the macOS permissions that desktop control needs. */
export const ComputerUsePermissionStatus = Schema.Struct({
  /** False off macOS: the computer_* tools are unavailable there. */
  platformSupported: Schema.Boolean,
  accessibility: Schema.Boolean,
  /** Inferred, because macOS has no direct query a child process can make. */
  screenRecording: Schema.Literals(["granted", "denied", "unknown"]),
});
export type ComputerUsePermissionStatus = typeof ComputerUsePermissionStatus.Type;
