import { GitResolvePullRequestResult } from "@tabs/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const PullRequestReadCacheScope = Schema.Struct({
  provider: Schema.String,
  account: Schema.String,
  environmentId: Schema.String,
  repository: Schema.String,
  prIdentity: Schema.String,
});
export type PullRequestReadCacheScope = typeof PullRequestReadCacheScope.Type;

export const CachedPullRequestRead = Schema.Struct({
  version: Schema.Literal(1),
  scope: PullRequestReadCacheScope,
  data: GitResolvePullRequestResult,
  cachedAt: Schema.Number,
  expiresAt: Schema.Number,
});
export type CachedPullRequestRead = typeof CachedPullRequestRead.Type;

export interface PullRequestReadCacheShape {
  /**
   * Get fresh cached pull request resolution if valid and not expired.
   */
  readonly get: (
    scope: PullRequestReadCacheScope,
  ) => Effect.Effect<GitResolvePullRequestResult | null>;

  /**
   * Get cached entry (even if expired/stale) for graceful degradation fallback.
   */
  readonly getEntry: (
    scope: PullRequestReadCacheScope,
  ) => Effect.Effect<CachedPullRequestRead | null>;

  /**
   * Store pull request resolution in persistent cache with TTL.
   */
  readonly set: (
    scope: PullRequestReadCacheScope,
    data: GitResolvePullRequestResult,
    ttlMs?: number,
  ) => Effect.Effect<void>;

  /**
   * Read from cache or execute live fetch. Handles rate limiting, caching, and graceful stale fallback.
   */
  readonly readOrFetch: <E, R>(
    scope: PullRequestReadCacheScope,
    fetch: Effect.Effect<GitResolvePullRequestResult, E, R>,
    options?: {
      readonly ttlMs?: number;
      readonly allowStaleOnFailure?: boolean;
      readonly maxStaleMs?: number;
    },
  ) => Effect.Effect<GitResolvePullRequestResult, E, R>;

  /**
   * Invalidate cached entries matching the provided filter criteria.
   */
  readonly invalidate: (filter?: Partial<PullRequestReadCacheScope>) => Effect.Effect<number>;

  /**
   * Invalidate all cached entries.
   */
  readonly invalidateAll: Effect.Effect<void>;

  /**
   * Mark provider/account as rate limited until a given timestamp.
   */
  readonly markRateLimited: (
    provider: string,
    account: string,
    retryAfterMs?: number,
  ) => Effect.Effect<void>;

  /**
   * Check if provider/account is currently rate limited.
   */
  readonly isRateLimited: (provider: string, account: string) => Effect.Effect<boolean>;
}

export class PullRequestReadCache extends Context.Service<
  PullRequestReadCache,
  PullRequestReadCacheShape
>()("tabs/git/Services/PullRequestReadCache") {}
