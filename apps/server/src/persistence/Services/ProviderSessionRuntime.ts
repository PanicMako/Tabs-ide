import * as Context from "effect/Context";
/**
 * ProviderSessionRuntimeRepository - Repository interface for provider runtime sessions.
 *
 * Owns persistence operations for provider runtime metadata and resume cursors.
 *
 * @module ProviderSessionRuntimeRepository
 */
import {
  AgentSessionImportSource,
  IsoDateTime,
  ProviderInstanceId,
  ProviderSessionRuntimeStatus,
  RuntimeMode,
  ThreadId,
} from "@tabs/contracts";
import { Option, Schema } from "effect";
import type { Effect } from "effect";

import type { ProviderSessionRuntimeRepositoryError } from "../Errors.ts";

export const ProviderSessionRuntime = Schema.Struct({
  threadId: ThreadId,
  providerName: Schema.String,
  // Routing key for the configured provider instance. Nullable for rows
  // written before the driver/instance split; promoted to a default instance
  // id on read (see ProviderSessionDirectory).
  providerInstanceId: Schema.NullOr(ProviderInstanceId),
  adapterKey: Schema.String,
  runtimeMode: RuntimeMode,
  status: ProviderSessionRuntimeStatus,
  lastSeenAt: IsoDateTime,
  resumeCursor: Schema.NullOr(Schema.Unknown),
  runtimePayload: Schema.NullOr(Schema.Unknown),
});
export type ProviderSessionRuntime = typeof ProviderSessionRuntime.Type;

export const GetProviderSessionRuntimeInput = Schema.Struct({ threadId: ThreadId });
export type GetProviderSessionRuntimeInput = typeof GetProviderSessionRuntimeInput.Type;

export const DeleteProviderSessionRuntimeInput = Schema.Struct({ threadId: ThreadId });
export type DeleteProviderSessionRuntimeInput = typeof DeleteProviderSessionRuntimeInput.Type;

export interface ProviderSessionRuntimeUpsertOptions {
  readonly onConflict?: "update" | "ignore";
}

/**
 * ProviderSessionRuntimeRepositoryShape - Service API for provider runtime records.
 */
export interface ProviderSessionRuntimeRepositoryShape {
  /**
   * Insert or replace a provider runtime row.
   *
   * Upserts by canonical `threadId`, including JSON payload/cursor fields.
   */
  readonly upsert: (
    runtime: ProviderSessionRuntime,
    options?: ProviderSessionRuntimeUpsertOptions,
  ) => Effect.Effect<void, ProviderSessionRuntimeRepositoryError>;

  readonly recordImportedTranscript: (input: {
    readonly threadId: ThreadId;
    readonly source: AgentSessionImportSource;
  }) => Effect.Effect<void, ProviderSessionRuntimeRepositoryError>;

  /**
   * Read provider runtime state by canonical thread id.
   */
  readonly getByThreadId: (
    input: GetProviderSessionRuntimeInput,
  ) => Effect.Effect<Option.Option<ProviderSessionRuntime>, ProviderSessionRuntimeRepositoryError>;

  /**
   * List all provider runtime rows.
   *
   * Returned in ascending last-seen order.
   */
  readonly list: () => Effect.Effect<
    ReadonlyArray<ProviderSessionRuntime>,
    ProviderSessionRuntimeRepositoryError
  >;

  /**
   * Delete provider runtime state by canonical thread id.
   */
  readonly deleteByThreadId: (
    input: DeleteProviderSessionRuntimeInput,
  ) => Effect.Effect<void, ProviderSessionRuntimeRepositoryError>;
}

/**
 * ProviderSessionRuntimeRepository - Service tag for provider runtime persistence.
 */
export class ProviderSessionRuntimeRepository extends Context.Service<
  ProviderSessionRuntimeRepository,
  ProviderSessionRuntimeRepositoryShape
>()("tabs/persistence/Services/ProviderSessionRuntime/ProviderSessionRuntimeRepository") {}
