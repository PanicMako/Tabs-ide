import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, it } from "@effect/vitest";
import { expect } from "vitest";
import type { GitResolvePullRequestResult } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { ServerConfig } from "../../config";
import {
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_MAX_ENTRIES,
  makePullRequestReadCache,
} from "./PullRequestReadCache";

const samplePrResult = (number = 42, title = "Feature PR"): GitResolvePullRequestResult => ({
  pullRequest: {
    number,
    title,
    url: `https://github.com/owner/repo/pull/${number}`,
    headBranch: "feature/test",
    baseBranch: "main",
    state: "open",
    isDraft: false,
    author: { login: "octocat" },
    comments: [],
    files: [],
    reviewThreads: [],
  },
  capabilities: {
    provider: "github",
    diff: true,
    create: true,
    search: true,
    actions: ["merge", "close", "reopen"],
    mergeMethods: ["merge", "squash", "rebase"],
  },
});

const makeTestEnv = (dir: string) => {
  const configLayer = Layer.succeed(ServerConfig, {
    pullRequestsCacheDir: dir,
    stateDir: dir,
  } as any);

  return makePullRequestReadCache.pipe(
    Effect.provide(Layer.mergeAll(configLayer, NodeServices.layer)),
  );
};

it.layer(NodeServices.layer)("PullRequestReadCache", (it) => {
  it.effect("persists PR reads across restarts and respects TTL", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "tabs-pr-cache-test-" });

      const scope = {
        provider: "github",
        account: "octocat",
        environmentId: "local",
        repository: "owner/repo",
        prIdentity: "42",
      };

      let fetches = 0;
      const fetchPr = Effect.sync(() => {
        fetches++;
        return samplePrResult(42, `Fresh read ${fetches}`);
      });

      // First run: cold cache fetches once
      const cache1 = yield* makeTestEnv(dir);
      const res1 = yield* cache1.readOrFetch(scope, fetchPr, { ttlMs: 10_000 });
      expect(res1.pullRequest.title).toBe("Fresh read 1");
      expect(fetches).toBe(1);

      // Subsequent read hits cache without fetching
      const res2 = yield* cache1.readOrFetch(scope, fetchPr, { ttlMs: 10_000 });
      expect(res2.pullRequest.title).toBe("Fresh read 1");
      expect(fetches).toBe(1);

      // Simulate app restart by instantiating new cache layer on the same directory
      const restartedCache = yield* makeTestEnv(dir);
      const resRestart = yield* restartedCache.readOrFetch(scope, fetchPr, { ttlMs: 10_000 });
      expect(resRestart.pullRequest.title).toBe("Fresh read 1");
      expect(fetches).toBe(1); // No new fetch on restart!
    }),
  );

  it.effect("strictly isolates cached PR data between accounts", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "tabs-pr-cache-test-" });
      const cache = yield* makeTestEnv(dir);

      const aliceScope = {
        provider: "github",
        account: "alice",
        environmentId: "local",
        repository: "owner/repo",
        prIdentity: "42",
      };

      const bobScope = {
        provider: "github",
        account: "bob",
        environmentId: "local",
        repository: "owner/repo",
        prIdentity: "42",
      };

      yield* cache.set(aliceScope, samplePrResult(42, "Alice Secret PR"));

      // Alice can read her cached PR
      const aliceCached = yield* cache.get(aliceScope);
      expect(aliceCached).not.toBeNull();
      expect(aliceCached?.pullRequest.title).toBe("Alice Secret PR");

      // Bob MUST NOT receive Alice's cached PR
      const bobCached = yield* cache.get(bobScope);
      expect(bobCached).toBeNull();

      // Bob's fetch receives Bob's data
      const bobRes = yield* cache.readOrFetch(
        bobScope,
        Effect.succeed(samplePrResult(42, "Bob PR")),
      );
      expect(bobRes.pullRequest.title).toBe("Bob PR");

      // Alice still receives her own PR
      const aliceAgain = yield* cache.get(aliceScope);
      expect(aliceAgain?.pullRequest.title).toBe("Alice Secret PR");
    }),
  );

  it.effect("degrades gracefully to stale cache when provider fails", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "tabs-pr-cache-test-" });
      const cache = yield* makeTestEnv(dir);

      const scope = {
        provider: "github",
        account: "octocat",
        environmentId: "local",
        repository: "owner/repo",
        prIdentity: "42",
      };

      // Populate initial cache with short TTL (already expired)
      yield* cache.set(scope, samplePrResult(42, "Last Good PR"), -1000);

      // Verify fresh get returns null because it expired
      const fresh = yield* cache.get(scope);
      expect(fresh).toBeNull();

      // Live fetch fails (network down / CLI error)
      const failingFetch = Effect.fail(new Error("GitHub API offline: connection refused"));

      // readOrFetch should gracefully fall back to the stale cached data
      const fallback = yield* cache.readOrFetch(scope, failingFetch, {
        allowStaleOnFailure: true,
        maxStaleMs: 60_000,
      });

      expect(fallback).not.toBeNull();
      expect(fallback.pullRequest.title).toBe("Last Good PR");
    }),
  );

  it.effect("respects provider rate limits by serving cached data without calling provider", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "tabs-pr-cache-test-" });
      const cache = yield* makeTestEnv(dir);

      const scope = {
        provider: "github",
        account: "octocat",
        environmentId: "local",
        repository: "owner/repo",
        prIdentity: "42",
      };

      // Populate cache
      yield* cache.set(scope, samplePrResult(42, "Cached Before Rate Limit"), -1000);

      // Provider throws rate limit error
      let attemptedFetches = 0;
      const rateLimitedFetch = Effect.sync(() => {
        attemptedFetches++;
      }).pipe(
        Effect.andThen(
          Effect.fail(new Error("API rate limit exceeded for user octocat (HTTP 429)")),
        ),
      );

      // First call triggers rate limit error and serves cached fallback
      const res1 = yield* cache.readOrFetch(scope, rateLimitedFetch, { allowStaleOnFailure: true });
      expect(res1.pullRequest.title).toBe("Cached Before Rate Limit");
      expect(attemptedFetches).toBe(1);

      // Cache now knows provider is rate-limited
      const isLimited = yield* cache.isRateLimited("github", "octocat");
      expect(isLimited).toBe(true);

      // Second call during rate-limit window serves cache immediately WITHOUT attempting fetch!
      const res2 = yield* cache.readOrFetch(scope, rateLimitedFetch, { allowStaleOnFailure: true });
      expect(res2.pullRequest.title).toBe("Cached Before Rate Limit");
      expect(attemptedFetches).toBe(1); // fetch count did not increase!
    }),
  );

  it.effect("invalidates cache on mutation", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "tabs-pr-cache-test-" });
      const cache = yield* makeTestEnv(dir);

      const scope = {
        provider: "github",
        account: "octocat",
        environmentId: "local",
        repository: "owner/repo",
        prIdentity: "42",
      };

      yield* cache.set(scope, samplePrResult(42, "Old PR State"));
      expect(yield* cache.get(scope)).not.toBeNull();

      // Invalidate specific PR
      const invalidatedCount = yield* cache.invalidate({
        provider: "github",
        repository: "owner/repo",
        prIdentity: "42",
      });
      expect(invalidatedCount).toBe(1);

      // PR is now cleared from cache
      expect(yield* cache.get(scope)).toBeNull();
    }),
  );

  it.effect("tolerates schema upgrades and corrupt storage files", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "tabs-pr-cache-test-" });

      // Write corrupt / incompatible JSON into cache directory
      yield* fs.writeFileString(path.join(dir, "corrupt.json"), "{ invalid json");
      yield* fs.writeFileString(
        path.join(dir, "old_version.json"),
        JSON.stringify({ version: 99, unknownField: true }),
      );

      // Starting cache should safely shrug off corrupt files and clear them
      const cache = yield* makeTestEnv(dir);

      const scope = {
        provider: "github",
        account: "octocat",
        environmentId: "local",
        repository: "owner/repo",
        prIdentity: "42",
      };

      const res = yield* cache.readOrFetch(
        scope,
        Effect.succeed(samplePrResult(42, "Recovered PR")),
      );
      expect(res.pullRequest.title).toBe("Recovered PR");
    }),
  );
});
