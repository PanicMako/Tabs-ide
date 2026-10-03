import * as Context from "effect/Context";
/**
 * ServerSettings - Server-authoritative settings service.
 *
 * Owns persistence, validation, and change notification of settings that affect
 * server-side behavior (binary paths, streaming mode, env mode, custom models,
 * text generation model selection).
 *
 * Follows the same pattern as `keybindings.ts`: JSON file + Cache + PubSub +
 * Semaphore + FileSystem.watch for concurrency and external edit detection.
 *
 * @module ServerSettings
 */
import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  DEFAULT_SERVER_SETTINGS,
  type ModelSelection,
  ProviderInstanceId,
  ServerSettings,
  type ServerSettingsPatch,
} from "@tabs/contracts";
import {
  Cache,
  Deferred,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Path,
  PubSub,
  Ref,
  Schema,
  SchemaIssue,
  Scope,
  Stream,
} from "effect";
import * as Semaphore from "effect/Semaphore";
import { ServerConfig } from "./config";
import { type DeepPartial, deepMerge } from "@tabs/shared/Struct";
import { applyServerSettingsPatch } from "@tabs/shared/serverSettings";
import { fromLenientJson } from "@tabs/shared/schemaJson";
import { setProviderSecret, type ProviderSecretName } from "./provider/ProviderSecretStore";

export class ServerSettingsError extends Schema.TaggedErrorClass<ServerSettingsError>()(
  "ServerSettingsError",
  {
    settingsPath: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {
  override get message(): string {
    return `Server settings error at ${this.settingsPath}: ${this.detail}`;
  }
}

export interface ServerSettingsShape {
  /** Start the settings runtime and attach file watching. */
  readonly start: Effect.Effect<void, ServerSettingsError>;

  /** Await settings runtime readiness. */
  readonly ready: Effect.Effect<void, ServerSettingsError>;

  /** Read the current settings. */
  readonly getSettings: Effect.Effect<ServerSettings, ServerSettingsError>;

  /** Patch settings and persist. Returns the new full settings object. */
  readonly updateSettings: (
    patch: ServerSettingsPatch,
  ) => Effect.Effect<ServerSettings, ServerSettingsError>;

  /** Stream of settings change events. */
  readonly streamChanges: Stream.Stream<ServerSettings>;
}

export class ServerSettingsService extends Context.Service<
  ServerSettingsService,
  ServerSettingsShape
>()("tabs/serverSettings/ServerSettingsService") {
  static readonly layerTest = (overrides: DeepPartial<ServerSettings> = {}) =>
    Layer.effect(
      ServerSettingsService,
      Effect.gen(function* () {
        const currentSettingsRef = yield* Ref.make<ServerSettings>(
          deepMerge(DEFAULT_SERVER_SETTINGS, overrides),
        );

        return {
          start: Effect.void,
          ready: Effect.void,
          getSettings: Ref.get(currentSettingsRef),
          updateSettings: (patch) =>
            Ref.get(currentSettingsRef).pipe(
              Effect.map((currentSettings) => mergeServerSettingsPatch(currentSettings, patch)),
              Effect.map((merged) => Schema.encodeSync(ServerSettings)(merged)),
              Effect.flatMap((mergedRaw) =>
                Schema.decodeUnknownEffect(ServerSettings)(mergedRaw).pipe(
                  Effect.mapError(
                    (cause) =>
                      new ServerSettingsError({
                        settingsPath: "<memory>",
                        detail: `failed to normalize server settings: ${SchemaIssue.makeFormatterDefault()(cause.issue)}`,
                        cause,
                      }),
                  ),
                ),
              ),
              Effect.tap((nextSettings) => Ref.set(currentSettingsRef, nextSettings)),
            ),
          streamChanges: Stream.empty,
        } satisfies ServerSettingsShape;
      }),
    );
}

const ServerSettingsJson = fromLenientJson(ServerSettings);

type ProviderSettingsKey = keyof ServerSettings["providers"];
const PROVIDER_ORDER: readonly ProviderSettingsKey[] = [
  "codex",
  "claudeAgent",
  "cursor",
  "copilot",
  "grok",
  "opencode",
  "kilo",
  "droid",
  "antigravity",
  "openrouter",
  "gemini",
];

function mergeServerSettingsPatch(
  current: typeof DEFAULT_SERVER_SETTINGS,
  patch: ServerSettingsPatch,
): typeof DEFAULT_SERVER_SETTINGS {
  return applyServerSettingsPatch(current, patch);
}

/**
 * Ensure the `textGenerationModelSelection` points to an enabled provider.
 * If the selected provider is disabled, fall back to the first enabled
 * provider with its default model.  This is applied at read-time so the
 * persisted preference is preserved for when a provider is re-enabled.
 */
function resolveTextGenerationProvider(settings: ServerSettings): ServerSettings {
  const selection = settings.textGenerationModelSelection;
  const selectedKey = selection.instanceId as ProviderSettingsKey;
  if (settings.providers[selectedKey]?.enabled) {
    return settings;
  }

  const fallback = PROVIDER_ORDER.find((p) => settings.providers[p].enabled);
  if (!fallback) {
    // No providers enabled — return as-is; callers will report the error.
    return settings;
  }

  return {
    ...settings,
    textGenerationModelSelection: {
      instanceId: fallback as ProviderInstanceId,

      model:
        (DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER as Record<string, string>)[fallback] ?? "",
    } as ModelSelection,
  };
}

function stripDefaultServerSettings(current: unknown, defaults: unknown): unknown | undefined {
  if (Array.isArray(current) || Array.isArray(defaults)) {
    return JSON.stringify(current) === JSON.stringify(defaults) ? undefined : current;
  }

  if (
    current !== null &&
    defaults !== null &&
    typeof current === "object" &&
    typeof defaults === "object"
  ) {
    const currentRecord = current as Record<string, unknown>;
    const defaultsRecord = defaults as Record<string, unknown>;
    const next: Record<string, unknown> = {};

    for (const key of Object.keys(currentRecord)) {
      const stripped = stripDefaultServerSettings(currentRecord[key], defaultsRecord[key]);
      if (stripped !== undefined) {
        next[key] = stripped;
      }
    }

    return Object.keys(next).length > 0 ? next : undefined;
  }

  return Object.is(current, defaults) ? undefined : current;
}

function providerSecretsFromSettings(
  settings: ServerSettings,
): ReadonlyArray<readonly [ProviderSecretName, string]> {
  const entries: Array<readonly [ProviderSecretName, string]> = [
    ["copilot.github-token", settings.providers.copilot.token],
    ["copilot.byok-api-key", settings.providers.copilot.byokApiKey],
    ["gemini.api-key", settings.providers.gemini.apiKey],
    ["droid.api-key", settings.providers.droid.apiKey],
    ["antigravity.api-key", settings.providers.antigravity.apiKey],
    ["openrouter.api-key", settings.providers.openrouter.apiKey],
    ["opencode.server-password", settings.providers.opencode.serverPassword],
    ["kilo.server-password", settings.providers.kilo.serverPassword],
  ];
  return entries.filter((entry) => entry[1].trim().length > 0);
}

function withoutPlaintextProviderSecrets(settings: ServerSettings): ServerSettings {
  return {
    ...settings,
    providers: {
      ...settings.providers,
      copilot: { ...settings.providers.copilot, token: "", byokApiKey: "" },
      gemini: { ...settings.providers.gemini, apiKey: "" },
      droid: { ...settings.providers.droid, apiKey: "" },
      antigravity: { ...settings.providers.antigravity, apiKey: "" },
      openrouter: { ...settings.providers.openrouter, apiKey: "" },
      opencode: { ...settings.providers.opencode, serverPassword: "" },
      kilo: { ...settings.providers.kilo, serverPassword: "" },
    },
  };
}

function providerSecretsFromPatch(
  patch: ServerSettingsPatch,
): ReadonlyArray<readonly [ProviderSecretName, string]> {
  const providers = patch.providers;
  const entries: Array<readonly [ProviderSecretName, string | undefined]> = [
    ["copilot.github-token", providers?.copilot?.token],
    ["copilot.byok-api-key", providers?.copilot?.byokApiKey],
    ["gemini.api-key", providers?.gemini?.apiKey],
    ["droid.api-key", providers?.droid?.apiKey],
    ["antigravity.api-key", providers?.antigravity?.apiKey],
    ["openrouter.api-key", providers?.openrouter?.apiKey],
    ["opencode.server-password", providers?.opencode?.serverPassword],
    ["kilo.server-password", providers?.kilo?.serverPassword],
  ];
  return entries.filter(
    (entry): entry is readonly [ProviderSecretName, string] => typeof entry[1] === "string",
  );
}

function withoutPlaintextProviderSecretsPatch(patch: ServerSettingsPatch): ServerSettingsPatch {
  if (!patch.providers) return patch;
  return {
    ...patch,
    providers: {
      ...patch.providers,
      ...(patch.providers.copilot
        ? { copilot: { ...patch.providers.copilot, token: "", byokApiKey: "" } }
        : {}),
      ...(patch.providers.gemini ? { gemini: { ...patch.providers.gemini, apiKey: "" } } : {}),
      ...(patch.providers.droid ? { droid: { ...patch.providers.droid, apiKey: "" } } : {}),
      ...(patch.providers.antigravity
        ? { antigravity: { ...patch.providers.antigravity, apiKey: "" } }
        : {}),
      ...(patch.providers.openrouter
        ? { openrouter: { ...patch.providers.openrouter, apiKey: "" } }
        : {}),
      ...(patch.providers.opencode
        ? { opencode: { ...patch.providers.opencode, serverPassword: "" } }
        : {}),
      ...(patch.providers.kilo ? { kilo: { ...patch.providers.kilo, serverPassword: "" } } : {}),
    },
  };
}

const makeServerSettings = Effect.gen(function* () {
  const { settingsPath } = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const writeSemaphore = yield* Semaphore.make(1);
  const cacheKey = "settings" as const;
  const changesPubSub = yield* PubSub.unbounded<ServerSettings>();
  const startedRef = yield* Ref.make(false);
  const startedDeferred = yield* Deferred.make<void, ServerSettingsError>();
  const watcherScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(watcherScope, Exit.void));

  const emitChange = (settings: ServerSettings) =>
    PubSub.publish(changesPubSub, settings).pipe(Effect.asVoid);

  const readConfigExists = fs.exists(settingsPath).pipe(
    Effect.mapError(
      (cause) =>
        new ServerSettingsError({
          settingsPath,
          detail: "failed to check settings file existence",
          cause,
        }),
    ),
  );

  const readRawConfig = fs.readFileString(settingsPath).pipe(
    Effect.mapError(
      (cause) =>
        new ServerSettingsError({
          settingsPath,
          detail: "failed to read settings file",
          cause,
        }),
    ),
  );

  const loadSettingsFromDisk = Effect.gen(function* () {
    if (!(yield* readConfigExists)) {
      return DEFAULT_SERVER_SETTINGS;
    }

    const raw = yield* readRawConfig;
    const decoded = Schema.decodeUnknownExit(ServerSettingsJson)(raw);
    if (decoded._tag === "Failure") {
      yield* Effect.logWarning("failed to parse settings.json, using defaults", {
        path: settingsPath,
      });
      return DEFAULT_SERVER_SETTINGS;
    }
    return decoded.value;
  });

  const settingsCache = yield* Cache.make<typeof cacheKey, ServerSettings, ServerSettingsError>({
    capacity: 1,
    lookup: () => loadSettingsFromDisk,
  });

  const getSettingsFromCache = Cache.get(settingsCache, cacheKey);

  const writeSettingsAtomically = (settings: ServerSettings) => {
    const tempPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
    const sparseSettings = stripDefaultServerSettings(settings, DEFAULT_SERVER_SETTINGS) ?? {};

    return Effect.succeed(`${JSON.stringify(sparseSettings, null, 2)}\n`).pipe(
      Effect.tap(() => fs.makeDirectory(pathService.dirname(settingsPath), { recursive: true })),
      Effect.tap((encoded) => fs.writeFileString(tempPath, encoded)),
      Effect.flatMap(() => fs.rename(tempPath, settingsPath)),
      Effect.ensuring(fs.remove(tempPath, { force: true }).pipe(Effect.ignore({ log: true }))),
      Effect.mapError(
        (cause) =>
          new ServerSettingsError({
            settingsPath,
            detail: "failed to write settings file",
            cause,
          }),
      ),
    );
  };

  const revalidateAndEmit = writeSemaphore.withPermits(1)(
    Effect.gen(function* () {
      yield* Cache.invalidate(settingsCache, cacheKey);
      const settings = yield* getSettingsFromCache;
      yield* emitChange(settings);
    }),
  );

  const startWatcher = Effect.gen(function* () {
    const settingsDir = pathService.dirname(settingsPath);
    const settingsFile = pathService.basename(settingsPath);
    const settingsPathResolved = pathService.resolve(settingsPath);

    yield* fs.makeDirectory(settingsDir, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new ServerSettingsError({
            settingsPath,
            detail: "failed to prepare settings directory",
            cause,
          }),
      ),
    );

    const revalidateAndEmitSafely = revalidateAndEmit.pipe(Effect.ignoreCause({ log: true }));

    // Debounce watch events so the file is fully written before we read it.
    // Editors emit multiple events per save (truncate, write, rename) and
    // `fs.watch` can fire before the content has been flushed to disk.
    const debouncedSettingsEvents = fs.watch(settingsDir).pipe(
      Stream.filter((event) => {
        return (
          event.path === settingsFile ||
          event.path === settingsPath ||
          pathService.resolve(settingsDir, event.path) === settingsPathResolved
        );
      }),
      Stream.debounce(Duration.millis(100)),
    );

    yield* Stream.runForEach(debouncedSettingsEvents, () => revalidateAndEmitSafely).pipe(
      Effect.ignoreCause({ log: true }),
      Effect.forkIn(watcherScope),
      Effect.asVoid,
    );
  });

  const start = Effect.gen(function* () {
    const shouldStart = yield* Ref.modify(startedRef, (started) => [!started, true]);
    if (!shouldStart) {
      return yield* Deferred.await(startedDeferred);
    }

    const startup = Effect.gen(function* () {
      yield* startWatcher;
      yield* Cache.invalidate(settingsCache, cacheKey);
      const settings = yield* getSettingsFromCache;
      const legacySecrets = providerSecretsFromSettings(settings);
      if (legacySecrets.length > 0) {
        yield* Effect.forEach(legacySecrets, ([name, value]) =>
          Effect.tryPromise(() => setProviderSecret(name, value)).pipe(
            Effect.mapError(
              (cause) =>
                new ServerSettingsError({
                  settingsPath,
                  detail: `failed to migrate '${name}' to secure storage`,
                  cause,
                }),
            ),
          ),
        );
        const migrated = withoutPlaintextProviderSecrets(settings);
        yield* writeSettingsAtomically(migrated);
        yield* Cache.set(settingsCache, cacheKey, migrated);
      }
    });

    const startupExit = yield* Effect.exit(startup);
    if (startupExit._tag === "Failure") {
      yield* Deferred.failCause(startedDeferred, startupExit.cause).pipe(Effect.orDie);
      return yield* Effect.failCause(startupExit.cause);
    }

    yield* Deferred.succeed(startedDeferred, undefined).pipe(Effect.orDie);
  });

  return {
    start,
    ready: Deferred.await(startedDeferred),
    getSettings: getSettingsFromCache.pipe(Effect.map(resolveTextGenerationProvider)),
    updateSettings: (patch) =>
      writeSemaphore.withPermits(1)(
        Effect.gen(function* () {
          yield* Effect.forEach(providerSecretsFromPatch(patch), ([name, value]) =>
            Effect.tryPromise(() => setProviderSecret(name, value)).pipe(
              Effect.mapError(
                (cause) =>
                  new ServerSettingsError({
                    settingsPath,
                    detail: `failed to update '${name}' in secure storage`,
                    cause,
                  }),
              ),
            ),
          );
          const current = yield* getSettingsFromCache;
          const merged = mergeServerSettingsPatch(
            current,
            withoutPlaintextProviderSecretsPatch(patch),
          );
          const mergedRaw = Schema.encodeSync(ServerSettings)(merged);
          const next = yield* Schema.decodeUnknownEffect(ServerSettings)(mergedRaw).pipe(
            Effect.mapError(
              (cause) =>
                new ServerSettingsError({
                  settingsPath: "<memory>",
                  detail: `failed to normalize server settings: ${SchemaIssue.makeFormatterDefault()(cause.issue)}`,
                  cause,
                }),
            ),
          );
          yield* writeSettingsAtomically(next);
          yield* Cache.set(settingsCache, cacheKey, next);
          yield* emitChange(next);
          return resolveTextGenerationProvider(next);
        }),
      ),
    get streamChanges() {
      return Stream.fromPubSub(changesPubSub).pipe(Stream.map(resolveTextGenerationProvider));
    },
  } satisfies ServerSettingsShape;
});

export const ServerSettingsLive = Layer.effect(ServerSettingsService, makeServerSettings);
