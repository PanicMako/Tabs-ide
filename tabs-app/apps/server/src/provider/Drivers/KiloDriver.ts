/**
 * KiloDriver — `ProviderDriver` for the Kilo runtime.
 *
 * Reuses the OpenCode runtime protocol engine with Kilo-specific binary and settings.
 *
 * @module provider/Drivers/KiloDriver
 */
import { KiloSettings, ProviderDriverKind, type ServerProvider } from "@tabs/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import { makeOpenCodeTextGeneration } from "../../textGeneration/OpenCodeTextGeneration";
import { ServerConfig } from "../../config";
import { ProviderDriverError } from "../Errors";
import { makeOpenCodeAdapter } from "../Layers/OpenCodeAdapter";
import { checkKiloProviderStatus, makePendingKiloProvider } from "../Layers/KiloProvider";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers";
import { makeManagedServerProvider } from "../makeManagedServerProvider";
import { OpenCodeRuntime } from "../opencodeRuntime";
import {
  defaultProviderContinuationIdentity,
  makeExternalCliLifecycle,
  makeProviderInstanceCapabilities,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver";
import type { ServerProviderDraft } from "../providerSnapshot";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment";
import { getProviderSecret } from "../ProviderSecretStore";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  makePackageManagedProviderMaintenanceResolver,
  normalizeCommandPath,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../providerMaintenance";

const decodeKiloSettings = Schema.decodeSync(KiloSettings);

const DRIVER_KIND = "kilo" as ProviderDriverKind;
const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);

function isKiloNativeCommandPath(commandPath: string): boolean {
  const normalized = normalizeCommandPath(commandPath);
  return normalized.endsWith("/.kilo/bin/kilo") || normalized.endsWith("/.kilo/bin/kilo.exe");
}

const UPDATE = makePackageManagedProviderMaintenanceResolver({
  provider: DRIVER_KIND,
  npmPackageName: "@kilocode/cli",
  homebrewFormula: "kilocode/tap/kilo",
  nativeUpdate: {
    executable: "kilo",
    args: ["upgrade"],
    lockKey: "kilo-native",
    isCommandPath: isKiloNativeCommandPath,
  },
});

export type KiloDriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | OpenCodeRuntime
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

export const KiloDriver: ProviderDriver<KiloSettings, KiloDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Kilo",
    supportsMultipleInstances: true,
  },
  configSchema: KiloSettings,
  defaultConfig: (): KiloSettings => decodeKiloSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const openCodeRuntime = yield* OpenCodeRuntime;
      const serverConfig = yield* ServerConfig;
      const httpClient = yield* HttpClient.HttpClient;
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
      const secureServerPassword = yield* Effect.tryPromise(() =>
        getProviderSecret("kilo.server-password"),
      ).pipe(Effect.orElseSucceed(() => null));
      const effectiveConfig = {
        ...config,
        enabled,
        serverPassword: secureServerPassword ?? config.serverPassword,
      } satisfies KiloSettings;
      const maintenanceCapabilities = yield* resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
        binaryPath: effectiveConfig.binaryPath,
        env: processEnv,
      });

      const adapter = yield* makeOpenCodeAdapter(effectiveConfig, {
        instanceId,
        environment: processEnv,
        provider: DRIVER_KIND,
        runtimeEventSource: "kilo.sdk.event",
        turnIdPrefix: "kilo-turn",
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
      });
      const textGeneration = yield* makeOpenCodeTextGeneration(effectiveConfig, processEnv, "kilo");

      const checkProvider = checkKiloProviderStatus(
        effectiveConfig,
        serverConfig.cwd,
        processEnv,
      ).pipe(Effect.map(stampIdentity), Effect.provideService(OpenCodeRuntime, openCodeRuntime));

      const snapshot = yield* makeManagedServerProvider<KiloSettings>({
        maintenanceCapabilities,
        getSettings: Effect.succeed(effectiveConfig),
        streamSettings: Stream.never,
        haveSettingsChanged: () => false,
        initialSnapshot: (settings) =>
          makePendingKiloProvider(settings).pipe(Effect.map(stampIdentity)),
        checkProvider,
        enrichSnapshot: ({ snapshot, publishSnapshot }) =>
          enrichProviderSnapshotWithVersionAdvisory(snapshot, maintenanceCapabilities).pipe(
            Effect.provideService(HttpClient.HttpClient, httpClient),
            Effect.flatMap((enrichedSnapshot) => publishSnapshot(enrichedSnapshot)),
          ),
        refreshInterval: SNAPSHOT_REFRESH_INTERVAL,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Kilo snapshot: ${cause.message ?? String(cause)}`,
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
          textGeneration: "supported",
          structuredGeneration: "supported",
          login: "external",
          logout: "external",
          accountSwitch: "external",
          installation: "external",
        }),
        lifecycle: makeExternalCliLifecycle([
          { kind: "login", command: "kilo auth login" },
          { kind: "logout", command: "kilo auth logout" },
          { kind: "switch-account", command: "kilo auth logout && kilo auth login" },
        ]),
        snapshot,
        adapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
