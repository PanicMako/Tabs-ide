import { NonNegativeInt, ThreadId, type VcsError } from "@tabs/contracts";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../persistence/Errors.ts";

export const CheckpointDiffOperation = Schema.Literals([
  "CheckpointDiffQuery.getTurnDiff",
  "CheckpointDiffQuery.getFullThreadDiff",
]);
export type CheckpointDiffOperation = typeof CheckpointDiffOperation.Type;

/** The computed result does not satisfy the checkpoint RPC contract. */
export class CheckpointDiffResultInvalidError extends Schema.TaggedError<CheckpointDiffResultInvalidError>()(
  "CheckpointDiffResultInvalidError",
  {
    operation: CheckpointDiffOperation,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    const result =
      this.operation === "CheckpointDiffQuery.getTurnDiff" ? "turn diff" : "full thread diff";
    return `Checkpoint invariant violation in ${this.operation}: Computed ${result} result does not satisfy contract schema.`;
  }
}

/** Projection state no longer contains the requested checkpoint thread. */
export class CheckpointThreadNotFoundError extends Schema.TaggedError<CheckpointThreadNotFoundError>()(
  "CheckpointThreadNotFoundError",
  {
    operation: CheckpointDiffOperation,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return `Checkpoint invariant violation in ${this.operation}: Thread '${this.threadId}' not found.`;
  }
}

/** The checkpoint thread has no workspace path from which to compute a diff. */
export class CheckpointWorkspacePathMissingError extends Schema.TaggedError<CheckpointWorkspacePathMissingError>()(
  "CheckpointWorkspacePathMissingError",
  {
    operation: CheckpointDiffOperation,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    const diff =
      this.operation === "CheckpointDiffQuery.getTurnDiff" ? "turn diff" : "full thread diff";
    return `Checkpoint invariant violation in ${this.operation}: Workspace path missing for thread '${this.threadId}' when computing ${diff}.`;
  }
}

/** The requested turn lies beyond the latest available checkpoint. */
export class CheckpointTurnRangeUnavailableError extends Schema.TaggedError<CheckpointTurnRangeUnavailableError>()(
  "CheckpointTurnRangeUnavailableError",
  {
    operation: CheckpointDiffOperation,
    threadId: ThreadId,
    requestedTurnCount: NonNegativeInt,
    availableTurnCount: NonNegativeInt,
  },
) {
  override get message(): string {
    return `Checkpoint unavailable for thread ${this.threadId} turn ${this.requestedTurnCount}: Turn diff range exceeds current turn count: requested ${this.requestedTurnCount}, current ${this.availableTurnCount}.`;
  }
}

/** Expected checkpoint metadata does not contain the requested Git ref. */
export class CheckpointRefUnavailableError extends Schema.TaggedError<CheckpointRefUnavailableError>()(
  "CheckpointRefUnavailableError",
  {
    operation: CheckpointDiffOperation,
    threadId: ThreadId,
    turnCount: NonNegativeInt,
    checkpoint: Schema.Literals(["from", "to"]),
  },
) {
  override get message(): string {
    return `Checkpoint unavailable for thread ${this.threadId} turn ${this.turnCount}: Checkpoint ref is unavailable for turn ${this.turnCount}.`;
  }
}

export class CheckpointInvariantError extends Schema.TaggedError<CheckpointInvariantError>()(
  "CheckpointInvariantError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {
  override get message(): string {
    return `Checkpoint invariant violation in ${this.operation}: ${this.detail}`;
  }
}

export class CheckpointUnavailableError extends Schema.TaggedError<CheckpointUnavailableError>()(
  "CheckpointUnavailableError",
  {
    threadId: ThreadId,
    turnCount: Schema.Number,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Checkpoint unavailable for thread ${this.threadId} turn ${this.turnCount}: ${this.detail}`;
  }
}

import type { GitCommandError } from "../git/Errors.ts";

export type CheckpointStoreError = VcsError | GitCommandError | CheckpointInvariantError;

export type CheckpointServiceError =
  | CheckpointStoreError
  | ProjectionRepositoryError
  | CheckpointDiffResultInvalidError
  | CheckpointThreadNotFoundError
  | CheckpointWorkspacePathMissingError
  | CheckpointTurnRangeUnavailableError
  | CheckpointRefUnavailableError
  | CheckpointInvariantError
  | CheckpointUnavailableError;
