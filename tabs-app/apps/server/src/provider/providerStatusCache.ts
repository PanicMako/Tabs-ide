import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  ServerProvider as ServerProviderSchema,
} from "@tabs/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { writeFileStringAtomically } from "../atomicWrite";

// Versioned identity envelope. Time-derived freshness is intentionally not
// persisted: a stored "fresh" bit becomes false as time passes, and provider
// errors must not silently advance a supposed last-success timestamp.
export const PROVIDER_STATUS_CACHE_SCHEMA_VERSION = 1 as const;

export const ProviderStatusCacheEnvelope = Schema.Struct({
  schemaVersion: Schema.Literal(PROVIDER_STATUS_CACHE_SCHEMA_VERSION),
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  provider: ServerProviderSchema,
});
export type ProviderStatusCacheEnvelope = typeof ProviderStatusCacheEnvelope.Type;

const decodeProviderStatusCacheEnvelope = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ProviderStatusCacheEnvelope),
);

const decodeLegacyProviderStatusCache = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ServerProviderSchema),
);

const mergeProviderModels = (
  fallbackModels: ReadonlyArray<ServerProvider["models"][number]>,
  cachedModels: ReadonlyArray<ServerProvider["models"][number]>,
): ReadonlyArray<ServerProvider["models"][number]> => {
  const fallbackSlugs = new Set(fallbackModels.map((model) => model.slug));
  return [...fallbackModels, ...cachedModels.filter((model) => !fallbackSlugs.has(model.slug))];
};

export const orderProviderSnapshots = (
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ServerProvider> =>
  [...providers].toSorted(
    (left, right) =>
      (left.displayName ?? "").localeCompare(right.displayName ?? "") ||
      left.driver.localeCompare(right.driver) ||
      left.instanceId.localeCompare(right.instanceId),
  );

export const isCachedProviderCorrelated = (input: {
  readonly cachedProvider: ServerProvider;
  readonly fallbackProvider: ServerProvider;
}): boolean =>
  input.cachedProvider.instanceId === input.fallbackProvider.instanceId &&
  input.cachedProvider.driver === input.fallbackProvider.driver;

export const hydrateCachedProvider = (input: {
  readonly cachedProvider: ServerProvider;
  readonly fallbackProvider: ServerProvider;
}): ServerProvider => {
  if (!isCachedProviderCorrelated(input)) {
    return input.fallbackProvider;
  }

  if (
    !input.fallbackProvider.enabled ||
    input.cachedProvider.enabled !== input.fallbackProvider.enabled
  ) {
    return input.fallbackProvider;
  }

  const { message: _fallbackMessage, ...fallbackWithoutMessage } = input.fallbackProvider;
  // PR-003: Preserve last-known-good model catalog when fallback provider has empty models or during refresh failure
  const models =
    input.fallbackProvider.models.length > 0
      ? mergeProviderModels(input.fallbackProvider.models, input.cachedProvider.models)
      : input.cachedProvider.models;

  const hydratedProvider: ServerProvider = {
    ...fallbackWithoutMessage,
    models,
    installed: input.cachedProvider.installed,
    version: input.cachedProvider.version,
    status: input.cachedProvider.status,
    auth: input.cachedProvider.auth,
    checkedAt: input.cachedProvider.checkedAt,
    slashCommands: input.cachedProvider.slashCommands,
    skills: input.cachedProvider.skills,
  };

  return input.cachedProvider.message
    ? { ...hydratedProvider, message: input.cachedProvider.message }
    : hydratedProvider;
};

/**
 * Resolve the on-disk cache path for a provider instance snapshot.
 *
 * File naming: `<cacheDir>/<instanceId>.json`. For the default instance of
 * a built-in kind this equals the legacy `<kind>.json` path (because
 * `defaultInstanceIdForDriver(kind).toString() === kind`), so existing
 * cached snapshots remain readable without any rename step.
 *
 * Non-default instances (e.g. `codex_personal`) land in their own files and
 * never collide with other instances.
 *
 * Cache contents must still carry matching `instanceId` + `driver` identity
 * before hydration. The filename alone is not trusted as a routing key.
 */
export const resolveProviderStatusCachePath = Effect.fn("resolveProviderStatusCachePath")(
  function* (input: {
    readonly cacheDir: string;
    readonly instanceId: ProviderInstanceId;
  }): Effect.fn.Return<string, never, Path.Path> {
    const path = yield* Path.Path;
    return path.join(input.cacheDir, `${input.instanceId}.json`);
  },
);

/**
 * Legacy kind-keyed path resolver retained for callers that still think in
 * terms of `ProviderDriverKind`. Prefer `resolveProviderStatusCachePath` with an
 * `instanceId`; new code should route through the instance registry.
 *
 * @deprecated use `resolveProviderStatusCachePath` with an instance id.
 */
export const resolveLegacyProviderStatusCachePath = Effect.fn(
  "resolveLegacyProviderStatusCachePath",
)(function* (input: {
  readonly cacheDir: string;
  readonly provider: ProviderDriverKind;
}): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  return path.join(input.cacheDir, `${input.provider}.json`);
});

export const readProviderStatusCacheEnvelope = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      return undefined;
    }

    const raw = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""));
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return undefined;
    }

    const envelopeExit = yield* decodeProviderStatusCacheEnvelope(trimmed).pipe(Effect.exit);
    if (Exit.isSuccess(envelopeExit)) {
      return envelopeExit.value;
    }

    const legacyExit = yield* decodeLegacyProviderStatusCache(trimmed).pipe(Effect.exit);
    if (Exit.isSuccess(legacyExit)) {
      const provider = legacyExit.value;
      return {
        schemaVersion: PROVIDER_STATUS_CACHE_SCHEMA_VERSION,
        instanceId: provider.instanceId,
        driver: provider.driver,
        provider,
      } satisfies ProviderStatusCacheEnvelope;
    }

    yield* Effect.logWarning("failed to parse provider status cache, ignoring", {
      path: filePath,
    });
    return undefined;
  });

export const readProviderStatusCache = (filePath: string) =>
  Effect.map(readProviderStatusCacheEnvelope(filePath), (envelope) => envelope?.provider);

export const writeProviderStatusCache = (input: {
  readonly filePath: string;
  readonly provider: ServerProvider;
}) => {
  const { updateState: _updateState, ...cacheableProvider } = input.provider;
  const envelope: ProviderStatusCacheEnvelope = {
    schemaVersion: PROVIDER_STATUS_CACHE_SCHEMA_VERSION,
    instanceId: input.provider.instanceId,
    driver: input.provider.driver,
    provider: cacheableProvider,
  };
  return writeFileStringAtomically({
    filePath: input.filePath,
    contents: `${JSON.stringify(envelope, null, 2)}\n`,
  });
};
