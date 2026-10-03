import {
  DroidSettings,
  ProviderDriverKind,
  type ProviderOptionDescriptor,
  type ServerProvider,
} from "@tabs/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";
import { createModelCapabilities } from "@tabs/shared/model";

import { ServerConfig } from "../../config";
import { makeUnsupportedTextGeneration } from "../../textGeneration/UnsupportedTextGeneration";
import { ProviderDriverError } from "../Errors";
import { makeDroidAdapter } from "../Layers/DroidAdapter";
import { checkDroidProviderStatus } from "../Layers/DroidProvider";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers";
import { makeManagedServerProvider } from "../makeManagedServerProvider";
import {
  defaultProviderContinuationIdentity,
  makeProviderInstanceCapabilities,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver";
import type { ServerProviderDraft } from "../providerSnapshot";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment";
import { getProviderSecret } from "../ProviderSecretStore";
import {
  makePackageManagedProviderMaintenanceResolver,
  normalizeCommandPath,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../providerMaintenance";

const decodeDroidSettings = Schema.decodeSync(DroidSettings);

const DRIVER_KIND = "droid" as ProviderDriverKind;
const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);
const isDroidNativeCommandPath = (commandPath: string) => {
  const normalized = normalizeCommandPath(commandPath);
  return (
    normalized.endsWith("/.local/bin/droid") ||
    normalized.endsWith("/appdata/local/droid/bin/droid.exe")
  );
};
export const DROID_MAINTENANCE = makePackageManagedProviderMaintenanceResolver({
  provider: DRIVER_KIND,
  npmPackageName: "droid",
  homebrewFormula: "droid",
  nativeUpdate: {
    executable: "droid",
    args: ["update"],
    lockKey: "droid-native",
    isCommandPath: isDroidNativeCommandPath,
  },
});

export type DroidDriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig;

const withInstanceIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationGroupKey: string;
  }) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });

export const DroidDriver: ProviderDriver<DroidSettings, DroidDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Factory Droid",
    supportsMultipleInstances: true,
  },
  configSchema: DroidSettings,
  defaultConfig: (): DroidSettings => decodeDroidSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const eventLoggers = yield* ProviderEventLoggers;
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const secureApiKey = yield* Effect.tryPromise(() => getProviderSecret("droid.api-key")).pipe(
        Effect.orElseSucceed(() => null),
      );
      const effectiveConfig = {
        ...config,
        enabled,
        apiKey: secureApiKey ?? config.apiKey,
      } satisfies DroidSettings;
      const maintenanceCapabilities = yield* resolveProviderMaintenanceCapabilitiesEffect(
        DROID_MAINTENANCE,
        {
          binaryPath: effectiveConfig.binaryPath,
          env: processEnv,
        },
      );

      const advertisedModelsRef = yield* Ref.make<ReadonlySet<string>>(new Set());
      const checkHealth: Effect.Effect<ServerProvider> = checkDroidProviderStatus(
        effectiveConfig,
        processEnv,
      ).pipe(
        Effect.map(stampIdentity),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
      const adapter = yield* makeDroidAdapter(effectiveConfig, {
        environment: processEnv,
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
        instanceId,
        isModelAdvertised: (modelId) =>
          Ref.get(advertisedModelsRef).pipe(Effect.map((models) => models.has(modelId))),
      });
      const checkProvider: Effect.Effect<ServerProvider> = checkHealth.pipe(
        Effect.flatMap((health) =>
          health.installed && adapter.listModels
            ? adapter.listModels({ binaryPath: effectiveConfig.binaryPath }).pipe(
                Effect.map((catalog) => {
                  const { message, ...healthWithoutMessage } = health;
                  void message;
                  return {
                    ...healthWithoutMessage,
                    status: "ready" as const,
                    auth: effectiveConfig.apiKey.trim()
                      ? {
                          status: "authenticated" as const,
                          type: "apiKey",
                          label: "Factory API Key (usage-based)",
                        }
                      : {
                          status: "authenticated" as const,
                          type: "account",
                          label: "Factory paired account",
                        },
                    models: catalog.models.map((model) => ({
                      slug: model.slug,
                      name: model.name,
                      isCustom: false,
                      capabilities: createModelCapabilities({
                        optionDescriptors:
                          (model.optionDescriptors as
                            | ReadonlyArray<ProviderOptionDescriptor>
                            | undefined) ?? [],
                      }),
                    })),
                    catalogStatus: "ready" as const,
                    catalogSource: catalog.source ?? "droid-acp",
                    catalogCheckedAt: new Date().toISOString(),
                  } satisfies ServerProvider;
                }),
                Effect.orElseSucceed(
                  () =>
                    ({
                      ...health,
                      status: "warning" as const,
                      auth: { status: "unauthenticated" as const },
                      message:
                        "Factory Droid did not authenticate through ACP. Run `droid` to pair this device, then retry.",
                      models: [],
                      catalogStatus: "failed" as const,
                      catalogSource: "droid-acp",
                      catalogCheckedAt: new Date().toISOString(),
                    }) satisfies ServerProvider,
                ),
              )
            : Effect.succeed<ServerProvider>({ ...health, models: [] }),
        ),
        Effect.tap((provider) =>
          Ref.set(advertisedModelsRef, new Set(provider.models.map((model) => model.slug))),
        ),
      );
      const textGeneration = makeUnsupportedTextGeneration("Factory Droid");

      const snapshot = yield* makeManagedServerProvider<DroidSettings>({
        maintenanceCapabilities,
        getSettings: Effect.succeed(effectiveConfig),
        streamSettings: Stream.never,
        haveSettingsChanged: () => false,
        initialSnapshot: () => checkProvider,
        checkProvider,
        enrichSnapshot: ({ snapshot: currentSnapshot }) => Effect.succeed(currentSnapshot),
        refreshInterval: SNAPSHOT_REFRESH_INTERVAL,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Droid snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        capabilities: makeProviderInstanceCapabilities({
          modelDiscovery: "runtime",
          agentSessions: "supported",
          textGeneration: "unsupported",
          structuredGeneration: "unsupported",
          login: "supported",
          logout: "supported",
          accountSwitch: "supported",
          installation: "supported",
        }),
        lifecycle: {
          actions: [
            { kind: "login", command: "droid", external: false },
            { kind: "logout", command: "droid logout", external: false },
            { kind: "switch-account", command: "droid logout && droid", external: false },
          ],
        },
        snapshot,
        adapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
