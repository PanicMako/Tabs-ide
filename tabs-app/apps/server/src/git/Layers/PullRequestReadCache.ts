import { createHash } from "node:crypto";
import { GitResolvePullRequestResult } from "@tabs/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { writeFileStringAtomically } from "../../atomicWrite";
import { ServerConfig } from "../../config";
import {
  CachedPullRequestRead,
  PullRequestReadCache,
  type PullRequestReadCacheScope,
  type PullRequestReadCacheShape,
} from "../Services/PullRequestReadCache";

export const DEFAULT_CACHE_TTL_MS = 60_000; // 1 minute
export const DEFAULT_MAX_STALE_MS = 24 * 60 * 60_000; // 24 hours fallback
export const DEFAULT_MAX_ENTRIES = 128;
export const DEFAULT_RATE_LIMIT_BACKOFF_MS = 60_000; // 1 minute

export function buildPullRequestCacheKey(scope: PullRequestReadCacheScope): string {
  return [
    scope.provider.trim().toLowerCase(),
    scope.account.trim().toLowerCase(),
    scope.environmentId.trim(),
    scope.repository.trim().toLowerCase(),
    scope.prIdentity.trim().toLowerCase().replace(/^#/, ""),
  ].join("::");
}

function computeHash(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function safeJsonParse(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isMatchingFilter(
  scope: PullRequestReadCacheScope,
  filter?: Partial<PullRequestReadCacheScope>,
): boolean {
  if (!filter) return true;
  if (
    filter.provider !== undefined &&
    filter.provider.toLowerCase() !== scope.provider.toLowerCase()
  ) {
    return false;
  }
  if (
    filter.account !== undefined &&
    filter.account.toLowerCase() !== scope.account.toLowerCase()
  ) {
    return false;
  }
  if (filter.environmentId !== undefined && filter.environmentId !== scope.environmentId) {
    return false;
  }
  if (
    filter.repository !== undefined &&
    filter.repository.toLowerCase() !== scope.repository.toLowerCase()
  ) {
    return false;
  }
  if (filter.prIdentity !== undefined) {
    const normalizedFilterPr = filter.prIdentity.toLowerCase().replace(/^#/, "");
    const normalizedScopePr = scope.prIdentity.toLowerCase().replace(/^#/, "");
    if (normalizedFilterPr !== normalizedScopePr) {
      return false;
    }
  }
  return true;
}

const decodeCachedPullRequestRead = Schema.decodeUnknownEffect(CachedPullRequestRead);

export const makePullRequestReadCache = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;

  const cacheDir = config.pullRequestsCacheDir;

  // In-memory cache holding entries with their file paths
  const memoryCache = new Map<string, { entry: CachedPullRequestRead; filePath: string }>();
  // Rate limit tracking: "provider:account" -> resetAtMs
  const rateLimits = new Map<string, number>();

  // Initialize directory and hydrate existing valid cache files
  yield* fs.makeDirectory(cacheDir, { recursive: true }).pipe(Effect.orElseSucceed(() => void 0));

  const existingFiles = yield* fs
    .readDirectory(cacheDir)
    .pipe(Effect.orElseSucceed(() => [] as string[]));

  for (const filename of existingFiles) {
    if (!filename.endsWith(".json")) continue;
    const filePath = path.join(cacheDir, filename);
    const content = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""));
    const parsed = safeJsonParse(content);
    if (!parsed) {
      yield* fs.remove(filePath).pipe(Effect.orElseSucceed(() => void 0));
      continue;
    }

    const decoded = yield* decodeCachedPullRequestRead(parsed).pipe(
      Effect.matchCauseEffect({
        onFailure: (cause) =>
          Effect.logWarning("failed to decode cached PR read, discarding", {
            filePath,
            cause: Cause.pretty(cause),
          }).pipe(
            Effect.andThen(fs.remove(filePath).pipe(Effect.orElseSucceed(() => void 0))),
            Effect.as(null),
          ),
        onSuccess: (val) => Effect.succeed(val),
      }),
    );

    if (decoded) {
      const key = buildPullRequestCacheKey(decoded.scope);
      memoryCache.set(key, { entry: decoded, filePath });
    }
  }

  // Evict oldest if initially over capacity
  while (memoryCache.size > DEFAULT_MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [k, v] of memoryCache.entries()) {
      if (v.entry.cachedAt < oldestAt) {
        oldestAt = v.entry.cachedAt;
        oldestKey = k;
      }
    }
    if (oldestKey) {
      const item = memoryCache.get(oldestKey);
      memoryCache.delete(oldestKey);
      if (item) {
        yield* fs.remove(item.filePath).pipe(Effect.orElseSucceed(() => void 0));
      }
    } else {
      break;
    }
  }

  const getEntry: PullRequestReadCacheShape["getEntry"] = (scope) =>
    Effect.gen(function* () {
      const key = buildPullRequestCacheKey(scope);
      const inMemory = memoryCache.get(key);
      if (inMemory) {
        // Enforce account isolation
        if (inMemory.entry.scope.account.toLowerCase() !== scope.account.toLowerCase()) {
          return null;
        }
        return inMemory.entry;
      }

      // If not in memory, try disk
      const hash = computeHash(key);
      const filePath = path.join(cacheDir, `${hash}.json`);
      const exists = yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
      if (!exists) return null;

      const content = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""));
      const parsed = safeJsonParse(content);
      if (!parsed) {
        yield* fs.remove(filePath).pipe(Effect.orElseSucceed(() => void 0));
        return null;
      }

      const decoded = yield* decodeCachedPullRequestRead(parsed).pipe(
        Effect.matchCauseEffect({
          onFailure: () =>
            fs.remove(filePath).pipe(
              Effect.orElseSucceed(() => void 0),
              Effect.as(null),
            ),
          onSuccess: (val) => Effect.succeed(val),
        }),
      );

      if (decoded) {
        if (decoded.scope.account.toLowerCase() !== scope.account.toLowerCase()) {
          return null;
        }
        memoryCache.set(key, { entry: decoded, filePath });
        return decoded;
      }
      return null;
    });

  const get: PullRequestReadCacheShape["get"] = (scope) =>
    Effect.gen(function* () {
      const entry = yield* getEntry(scope);
      if (!entry) return null;
      const now = Date.now();
      if (now <= entry.expiresAt) {
        return entry.data;
      }
      return null;
    });

  const set: PullRequestReadCacheShape["set"] = (scope, data, ttlMs) =>
    Effect.gen(function* () {
      const key = buildPullRequestCacheKey(scope);
      const cachedAt = Date.now();
      const expiresAt = cachedAt + (ttlMs ?? DEFAULT_CACHE_TTL_MS);

      const entry: CachedPullRequestRead = {
        version: 1,
        scope,
        data,
        cachedAt,
        expiresAt,
      };

      const hash = computeHash(key);
      const filePath = path.join(cacheDir, `${hash}.json`);

      // Evict if over capacity
      if (memoryCache.size >= DEFAULT_MAX_ENTRIES && !memoryCache.has(key)) {
        let oldestKey: string | null = null;
        let oldestAt = Infinity;
        for (const [k, v] of memoryCache.entries()) {
          if (v.entry.cachedAt < oldestAt) {
            oldestAt = v.entry.cachedAt;
            oldestKey = k;
          }
        }
        if (oldestKey) {
          const item = memoryCache.get(oldestKey);
          memoryCache.delete(oldestKey);
          if (item) {
            yield* fs.remove(item.filePath).pipe(Effect.orElseSucceed(() => void 0));
          }
        }
      }

      memoryCache.set(key, { entry, filePath });

      yield* writeFileStringAtomically({
        filePath,
        contents: `${JSON.stringify(entry, null, 2)}\n`,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.orElseSucceed(() => void 0),
      );
    });

  const markRateLimited: PullRequestReadCacheShape["markRateLimited"] = (
    provider,
    account,
    retryAfterMs,
  ) =>
    Effect.sync(() => {
      const rateLimitKey = `${provider.toLowerCase()}::${account.toLowerCase()}`;
      rateLimits.set(rateLimitKey, Date.now() + (retryAfterMs ?? DEFAULT_RATE_LIMIT_BACKOFF_MS));
    });

  const isRateLimited: PullRequestReadCacheShape["isRateLimited"] = (provider, account) =>
    Effect.sync(() => {
      const rateLimitKey = `${provider.toLowerCase()}::${account.toLowerCase()}`;
      const resetAt = rateLimits.get(rateLimitKey);
      if (resetAt !== undefined) {
        if (Date.now() < resetAt) {
          return true;
        }
        rateLimits.delete(rateLimitKey);
      }
      return false;
    });

  const clearRateLimit = (provider: string, account: string) =>
    Effect.sync(() => {
      rateLimits.delete(`${provider.toLowerCase()}::${account.toLowerCase()}`);
    });

  const readOrFetch: PullRequestReadCacheShape["readOrFetch"] = (scope, fetch, options) =>
    Effect.gen(function* () {
      const maxStaleMs = options?.maxStaleMs ?? DEFAULT_MAX_STALE_MS;
      const rateLimited = yield* isRateLimited(scope.provider, scope.account);

      if (rateLimited) {
        const staleEntry = yield* getEntry(scope);
        if (staleEntry && Date.now() - staleEntry.cachedAt <= maxStaleMs) {
          yield* Effect.logWarning(
            `Serving cached pull request read due to active provider rate limit (${scope.provider})`,
            {
              repository: scope.repository,
              prIdentity: scope.prIdentity,
              account: scope.account,
            },
          );
          return staleEntry.data;
        }
      }

      // Check fresh cache
      const fresh = yield* get(scope);
      if (fresh !== null) {
        return fresh;
      }

      // Attempt live fetch
      const result = yield* fetch.pipe(
        Effect.tap((data) => set(scope, data, options?.ttlMs)),
        Effect.tap(() => clearRateLimit(scope.provider, scope.account)),
        Effect.catch((error) =>
          Effect.gen(function* () {
            const errorString = String(
              error && typeof error === "object" && "message" in error
                ? (error as { message: unknown }).message
                : JSON.stringify(error),
            ).toLowerCase();

            const isRateLimitError =
              errorString.includes("rate limit") ||
              errorString.includes("rate-limited") ||
              errorString.includes("429") ||
              errorString.includes("too many requests");

            if (isRateLimitError) {
              yield* markRateLimited(scope.provider, scope.account, DEFAULT_RATE_LIMIT_BACKOFF_MS);
            }

            if (options?.allowStaleOnFailure !== false) {
              const stale = yield* getEntry(scope);
              if (stale !== null && Date.now() - stale.cachedAt <= maxStaleMs) {
                yield* Effect.logWarning(
                  `Serving stale cached pull request read after provider failure (${scope.provider})`,
                  {
                    repository: scope.repository,
                    prIdentity: scope.prIdentity,
                    error: errorString,
                  },
                );
                return stale.data;
              }
            }

            return yield* Effect.fail(error);
          }),
        ),
      );

      return result;
    });

  const invalidate: PullRequestReadCacheShape["invalidate"] = (filter) =>
    Effect.gen(function* () {
      let count = 0;
      const toDelete: Array<{ key: string; filePath: string }> = [];

      for (const [key, value] of memoryCache.entries()) {
        if (isMatchingFilter(value.entry.scope, filter)) {
          toDelete.push({ key, filePath: value.filePath });
        }
      }

      for (const item of toDelete) {
        memoryCache.delete(item.key);
        yield* fs.remove(item.filePath).pipe(Effect.orElseSucceed(() => void 0));
        count++;
      }

      return count;
    });

  const invalidateAll: PullRequestReadCacheShape["invalidateAll"] = Effect.gen(function* () {
    memoryCache.clear();
    const files = yield* fs
      .readDirectory(cacheDir)
      .pipe(Effect.orElseSucceed(() => [] as string[]));
    for (const file of files) {
      if (file.endsWith(".json")) {
        yield* fs.remove(path.join(cacheDir, file)).pipe(Effect.orElseSucceed(() => void 0));
      }
    }
  });

  return PullRequestReadCache.of({
    get,
    getEntry,
    set,
    readOrFetch,
    invalidate,
    invalidateAll,
    markRateLimited,
    isRateLimited,
  });
});

export const PullRequestReadCacheLive = Layer.effect(
  PullRequestReadCache,
  makePullRequestReadCache,
);
