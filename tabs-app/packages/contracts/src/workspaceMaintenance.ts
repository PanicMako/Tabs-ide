import * as Schema from "effect/Schema";

export const StorageCategory = Schema.Literals(["logs", "browser-artifacts"]);
export const StorageCandidate = Schema.Struct({
  id: Schema.String,
  category: StorageCategory,
  name: Schema.String,
  bytes: Schema.Number,
  modifiedAt: Schema.Number,
});
export const StorageInventory = Schema.Struct({
  totalBytes: Schema.Number,
  reclaimableBytes: Schema.Number,
  candidates: Schema.Array(StorageCandidate),
  warnings: Schema.Array(Schema.String),
});
export type StorageInventory = typeof StorageInventory.Type;
export const StorageCleanInput = Schema.Struct({ ids: Schema.Array(Schema.String) });
export const StorageCleanResult = Schema.Struct({
  deletedBytes: Schema.Number,
  deletedCount: Schema.Number,
  errors: Schema.Array(Schema.String),
});
export type StorageCleanResult = typeof StorageCleanResult.Type;
export const ManagedWorktree = Schema.Struct({
  path: Schema.String,
  branch: Schema.NullOr(Schema.String),
  head: Schema.String,
  main: Schema.Boolean,
  locked: Schema.Boolean,
  prunable: Schema.Boolean,
  dirty: Schema.Boolean,
  ignored: Schema.Boolean,
  protected: Schema.Boolean,
  threadCount: Schema.Number,
  error: Schema.NullOr(Schema.String),
});
export const WorktreeInventory = Schema.Array(ManagedWorktree);
export type ManagedWorktree = typeof ManagedWorktree.Type;
