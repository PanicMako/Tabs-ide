import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

/**
 * Client-side id for the first shell opened on a thread. Ids are uniformly
 * `term-N`; there's no "default" intrinsic. Kept as a named constant so callers
 * that want "the primary shell" don't hardcode `"term-1"`.
 */
export const DEFAULT_TERMINAL_ID = "term-1";

const TrimmedNonEmptyStringSchema = TrimmedNonEmptyString;
const TerminalColsSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(
  Schema.isLessThanOrEqualTo(1000),
);
const TerminalRowsSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(
  Schema.isLessThanOrEqualTo(500),
);
const TerminalIdSchema = TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(128));
const TerminalEnvKeySchema = Schema.String.check(
  Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/),
).check(Schema.isMaxLength(128));
const TerminalEnvValueSchema = Schema.String.check(Schema.isMaxLength(8_192));
const TerminalEnvSchema = Schema.Record(TerminalEnvKeySchema, TerminalEnvValueSchema).check(
  Schema.isMaxProperties(128),
);

export const TerminalThreadInput = Schema.Struct({
  threadId: TrimmedNonEmptyStringSchema,
});
export type TerminalThreadInput = typeof TerminalThreadInput.Type;

/** Terminal ids are ALWAYS chosen by the client and sent explicitly — no server-side allocation. */
const TerminalSessionInput = Schema.Struct({
  ...TerminalThreadInput.fields,
  terminalId: TerminalIdSchema,
});
export type TerminalSessionInput = Schema.Codec.Encoded<typeof TerminalSessionInput>;

export const TerminalOpenInput = Schema.Struct({
  ...TerminalSessionInput.fields,
  cwd: TrimmedNonEmptyStringSchema,
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyStringSchema)),
  cols: Schema.optional(TerminalColsSchema),
  rows: Schema.optional(TerminalRowsSchema),
  env: Schema.optional(TerminalEnvSchema),
  providerInstanceId: Schema.optional(ProviderInstanceId),
  stopOnSettle: Schema.optional(Schema.Boolean),
});
export type TerminalOpenInput = typeof TerminalOpenInput.Type;

export const TerminalAttachInput = Schema.Struct({
  ...TerminalSessionInput.fields,
  cwd: Schema.optional(TrimmedNonEmptyStringSchema),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyStringSchema)),
  cols: Schema.optional(TerminalColsSchema),
  rows: Schema.optional(TerminalRowsSchema),
  env: Schema.optional(TerminalEnvSchema),
  providerInstanceId: Schema.optional(ProviderInstanceId),
  stopOnSettle: Schema.optional(Schema.Boolean),
  restartIfNotRunning: Schema.optional(Schema.Boolean),
});
export type TerminalAttachInput = typeof TerminalAttachInput.Type;

export const TerminalWriteInput = Schema.Struct({
  ...TerminalSessionInput.fields,
  data: Schema.String.check(Schema.isNonEmpty()).check(Schema.isMaxLength(65_536)),
});
export type TerminalWriteInput = Schema.Codec.Encoded<typeof TerminalWriteInput>;

export const TerminalAgentInputRef = Schema.Struct({
  requestId: Schema.String.check(Schema.isUUID()),
});
export type TerminalAgentInputRef = typeof TerminalAgentInputRef.Type;

export const TerminalAgentInputText = Schema.String.check(Schema.isNonEmpty())
  .check(Schema.isMaxLength(4_096))
  .check(Schema.isPattern(/^[^\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]+(?![\s\S])/u));

export const TerminalAgentInputProposal = Schema.Struct({
  terminalId: TerminalIdSchema,
  instanceId: Schema.String.check(Schema.isUUID()),
  text: TerminalAgentInputText,
  pressEnter: Schema.optionalKey(Schema.Boolean),
});
export type TerminalAgentInputProposal = typeof TerminalAgentInputProposal.Type;

export const TerminalAgentInputResult = Schema.Struct({
  ...TerminalAgentInputRef.fields,
  status: Schema.Literals(["pending", "delivered", "declined", "expired", "uncertain"]),
});
export type TerminalAgentInputResult = typeof TerminalAgentInputResult.Type;

export const TerminalAgentInputReviewCommand = Schema.Struct({
  ...TerminalThreadInput.fields,
  ...TerminalAgentInputRef.fields,
  action: Schema.Literals(["review", "approve", "decline"]),
});
export type TerminalAgentInputReviewCommand = typeof TerminalAgentInputReviewCommand.Type;

export const TerminalAgentInputReview = Schema.Struct({
  ...TerminalAgentInputResult.fields,
  terminalId: TerminalIdSchema,
  instanceId: TerminalAgentInputProposal.fields.instanceId,
  cwd: Schema.String,
  /** Human label of the terminal when the request was made, for the approval card. */
  terminalTitle: Schema.optionalKey(Schema.String),
  /** The input text is visible to the approving user while the request is pending. */
  text: Schema.optionalKey(TerminalAgentInputText),
  pressEnter: Schema.Boolean,
});
export type TerminalAgentInputReview = typeof TerminalAgentInputReview.Type;

/** The user stopped agent control: every pending input request of the thread is declined. */
export const TerminalAgentInputDeclinePendingResult = Schema.Struct({
  declined: Schema.Array(Schema.String),
});
export type TerminalAgentInputDeclinePendingResult =
  typeof TerminalAgentInputDeclinePendingResult.Type;

export class TerminalAgentInputReviewUnavailableError extends Schema.TaggedError<TerminalAgentInputReviewUnavailableError>()(
  "TerminalAgentInputReviewUnavailableError",
  {},
) {
  override get message() {
    return "This terminal input request is unavailable.";
  }
}

export const TerminalResizeInput = Schema.Struct({
  ...TerminalSessionInput.fields,
  cols: TerminalColsSchema,
  rows: TerminalRowsSchema,
});
export type TerminalResizeInput = Schema.Codec.Encoded<typeof TerminalResizeInput>;

export const TerminalClearInput = TerminalSessionInput;
export type TerminalClearInput = Schema.Codec.Encoded<typeof TerminalClearInput>;

export const TerminalRestartInput = Schema.Struct({
  ...TerminalSessionInput.fields,
  cwd: TrimmedNonEmptyStringSchema,
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyStringSchema)),
  cols: TerminalColsSchema,
  rows: TerminalRowsSchema,
  env: Schema.optional(TerminalEnvSchema),
  providerInstanceId: Schema.optional(ProviderInstanceId),
});
export type TerminalRestartInput = typeof TerminalRestartInput.Type;

export const TerminalCloseInput = Schema.Struct({
  ...TerminalThreadInput.fields,
  terminalId: Schema.optional(TerminalIdSchema),
  deleteHistory: Schema.optional(Schema.Boolean),
});
export type TerminalCloseInput = typeof TerminalCloseInput.Type;

export const TerminalSessionStatus = Schema.Literals(["starting", "running", "exited", "error"]);
export type TerminalSessionStatus = typeof TerminalSessionStatus.Type;

export const TerminalSessionSnapshot = Schema.Struct({
  threadId: Schema.String.check(Schema.isNonEmpty()),
  terminalId: Schema.String.check(Schema.isNonEmpty()),
  cwd: Schema.String.check(Schema.isNonEmpty()),
  worktreePath: Schema.NullOr(TrimmedNonEmptyStringSchema),
  status: TerminalSessionStatus,
  pid: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  instanceId: Schema.optionalKey(Schema.String),
  history: Schema.String,
  exitCode: Schema.NullOr(Schema.Int),
  exitSignal: Schema.NullOr(Schema.Int),
  /** Server-computed display title (idle shell vs subprocess command). */
  label: Schema.String.check(Schema.isMaxLength(128)),
  updatedAt: Schema.String,
  sequence: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type TerminalSessionSnapshot = typeof TerminalSessionSnapshot.Type;

export const TerminalSummary = Schema.Struct({
  threadId: Schema.String.check(Schema.isNonEmpty()),
  terminalId: Schema.String.check(Schema.isNonEmpty()),
  cwd: Schema.String.check(Schema.isNonEmpty()),
  worktreePath: Schema.NullOr(TrimmedNonEmptyStringSchema),
  status: TerminalSessionStatus,
  pid: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  instanceId: Schema.optionalKey(Schema.String),
  exitCode: Schema.NullOr(Schema.Int),
  exitSignal: Schema.NullOr(Schema.Int),
  hasRunningSubprocess: Schema.Boolean,
  /** Server-computed display title (idle shell vs subprocess command). */
  label: Schema.String.check(Schema.isMaxLength(128)),
  updatedAt: Schema.String,
});
export type TerminalSummary = typeof TerminalSummary.Type;

const TerminalMetadataSnapshotEvent = Schema.Struct({
  type: Schema.Literal("snapshot"),
  terminals: Schema.Array(TerminalSummary),
});

const TerminalMetadataUpsertEvent = Schema.Struct({
  type: Schema.Literal("upsert"),
  terminal: TerminalSummary,
});

const TerminalMetadataRemoveEvent = Schema.Struct({
  type: Schema.Literal("remove"),
  threadId: Schema.String.check(Schema.isNonEmpty()),
  terminalId: Schema.String.check(Schema.isNonEmpty()),
});

export const TerminalMetadataStreamEvent = Schema.Union([
  TerminalMetadataSnapshotEvent,
  TerminalMetadataUpsertEvent,
  TerminalMetadataRemoveEvent,
]);
export type TerminalMetadataStreamEvent = typeof TerminalMetadataStreamEvent.Type;

const TerminalEventBaseSchema = Schema.Struct({
  threadId: Schema.String.check(Schema.isNonEmpty()),
  terminalId: Schema.String.check(Schema.isNonEmpty()),
  sequence: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});

const TerminalStartedEvent = Schema.Struct({
  ...TerminalEventBaseSchema.fields,
  type: Schema.Literal("started"),
  snapshot: TerminalSessionSnapshot,
});

const TerminalOutputEvent = Schema.Struct({
  ...TerminalEventBaseSchema.fields,
  type: Schema.Literal("output"),
  instanceId: Schema.optionalKey(Schema.String),
  data: Schema.String,
});

const TerminalExitedEvent = Schema.Struct({
  ...TerminalEventBaseSchema.fields,
  type: Schema.Literal("exited"),
  exitCode: Schema.NullOr(Schema.Int),
  exitSignal: Schema.NullOr(Schema.Int),
});

const TerminalClosedEvent = Schema.Struct({
  ...TerminalEventBaseSchema.fields,
  type: Schema.Literal("closed"),
});

const TerminalErrorEvent = Schema.Struct({
  ...TerminalEventBaseSchema.fields,
  type: Schema.Literal("error"),
  message: Schema.String.check(Schema.isNonEmpty()),
});

const TerminalClearedEvent = Schema.Struct({
  ...TerminalEventBaseSchema.fields,
  type: Schema.Literal("cleared"),
});

const TerminalRestartedEvent = Schema.Struct({
  ...TerminalEventBaseSchema.fields,
  type: Schema.Literal("restarted"),
  snapshot: TerminalSessionSnapshot,
});

const TerminalActivityEvent = Schema.Struct({
  ...TerminalEventBaseSchema.fields,
  type: Schema.Literal("activity"),
  hasRunningSubprocess: Schema.Boolean,
  label: Schema.String.check(Schema.isMaxLength(128)),
});

export const TerminalEvent = Schema.Union([
  TerminalStartedEvent,
  TerminalOutputEvent,
  TerminalExitedEvent,
  TerminalClosedEvent,
  TerminalErrorEvent,
  TerminalClearedEvent,
  TerminalRestartedEvent,
  TerminalActivityEvent,
]);
export type TerminalEvent = typeof TerminalEvent.Type;

const TerminalAttachSnapshotEvent = Schema.Struct({
  type: Schema.Literal("snapshot"),
  snapshot: TerminalSessionSnapshot,
});

export const TerminalAttachStreamEvent = Schema.Union([
  TerminalAttachSnapshotEvent,
  TerminalOutputEvent,
  TerminalExitedEvent,
  TerminalClosedEvent,
  TerminalErrorEvent,
  TerminalClearedEvent,
  TerminalRestartedEvent,
  TerminalActivityEvent,
]);
export type TerminalAttachStreamEvent = typeof TerminalAttachStreamEvent.Type;

export class TerminalCwdNotFoundError extends Schema.TaggedError<TerminalCwdNotFoundError>()(
  "TerminalCwdNotFoundError",
  {
    cwd: Schema.String,
  },
) {
  override get message() {
    return `Terminal cwd does not exist: ${this.cwd}`;
  }
}

export class TerminalCwdNotDirectoryError extends Schema.TaggedError<TerminalCwdNotDirectoryError>()(
  "TerminalCwdNotDirectoryError",
  {
    cwd: Schema.String,
  },
) {
  override get message() {
    return `Terminal cwd is not a directory: ${this.cwd}`;
  }
}

export class TerminalCwdStatError extends Schema.TaggedError<TerminalCwdStatError>()(
  "TerminalCwdStatError",
  {
    cwd: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return `Failed to access terminal cwd: ${this.cwd}`;
  }
}

export const TerminalCwdError = Schema.Union([
  TerminalCwdNotFoundError,
  TerminalCwdNotDirectoryError,
  TerminalCwdStatError,
]);
export type TerminalCwdError = typeof TerminalCwdError.Type;

export class TerminalHistoryError extends Schema.TaggedError<TerminalHistoryError>()(
  "TerminalHistoryError",
  {
    operation: Schema.Literals(["read", "truncate", "migrate"]),
    threadId: Schema.String,
    terminalId: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return `Failed to ${this.operation} terminal history for thread: ${this.threadId}, terminal: ${this.terminalId}`;
  }
}

export class TerminalSessionLookupError extends Schema.TaggedError<TerminalSessionLookupError>()(
  "TerminalSessionLookupError",
  {
    threadId: Schema.String,
    terminalId: Schema.String,
  },
) {
  override get message() {
    return `Unknown terminal thread: ${this.threadId}, terminal: ${this.terminalId}`;
  }
}

export class TerminalProviderInstanceNotFoundError extends Schema.TaggedError<TerminalProviderInstanceNotFoundError>()(
  "TerminalProviderInstanceNotFoundError",
  {
    providerInstanceId: ProviderInstanceId,
  },
) {
  override get message() {
    return `Provider instance is not available: ${this.providerInstanceId}`;
  }
}

export class TerminalProviderEnvironmentError extends Schema.TaggedError<TerminalProviderEnvironmentError>()(
  "TerminalProviderEnvironmentError",
  {
    providerInstanceId: ProviderInstanceId,
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return `Could not prepare the terminal environment for provider instance: ${this.providerInstanceId}`;
  }
}

export class TerminalNotRunningError extends Schema.TaggedError<TerminalNotRunningError>()(
  "TerminalNotRunningError",
  {
    threadId: Schema.String,
    terminalId: Schema.String,
  },
) {
  override get message() {
    return `Terminal is not running for thread: ${this.threadId}, terminal: ${this.terminalId}`;
  }
}

export class TerminalWriteError extends Schema.TaggedError<TerminalWriteError>()(
  "TerminalWriteError",
  {
    threadId: Schema.String,
    terminalId: Schema.String,
    terminalPid: Schema.Number,
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return `Failed to write to terminal for thread: ${this.threadId}, terminal: ${this.terminalId}, PID: ${this.terminalPid}`;
  }
}

export class TerminalResizeError extends Schema.TaggedError<TerminalResizeError>()(
  "TerminalResizeError",
  {
    threadId: Schema.String,
    terminalId: Schema.String,
    terminalPid: Schema.Number,
    cols: TerminalColsSchema,
    rows: TerminalRowsSchema,
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return `Failed to resize terminal for thread: ${this.threadId}, terminal: ${this.terminalId}, PID: ${this.terminalPid} to ${this.cols}x${this.rows}`;
  }
}

export const TerminalError = Schema.Union([
  TerminalCwdError,
  TerminalHistoryError,
  TerminalSessionLookupError,
  TerminalProviderInstanceNotFoundError,
  TerminalProviderEnvironmentError,
  TerminalNotRunningError,
  TerminalWriteError,
  TerminalResizeError,
]);
export type TerminalError = typeof TerminalError.Type;
