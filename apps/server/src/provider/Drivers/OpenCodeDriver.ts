import { openCodeUpdateFor as modernOpenCodeUpdateFor } from "./OpenCodeDriver.modern.ts";
import { resolveProviderMaintenanceCapabilitiesEffect as resolveModernMaintenance } from "../providerMaintenance.modern.ts";
import { OpenCodeDriver as ModernOpenCodeDriver } from "./OpenCodeDriver.modern.ts";
import { ProviderRuntimeGeneration } from "../ProviderRuntimeGeneration.ts";
/**
 * OpenCodeDriver — `ProviderDriver` for the OpenCode runtime.
 *
 * Mirrors the Codex / Claude drivers: a plain value whose `create()`
 * bundles `snapshot` / `adapter` / `textGeneration` closures over the
 * per-instance `OpenCodeSettings`.
 *
 * Two instances with different `serverUrl`s therefore talk to independent
 * OpenCode servers; when no `serverUrl` is set, the adapter + text-generation
 * shares spin up their own scoped child processes, and those child
 * processes are released when the registry scope closes.
 *
 * @module provider/Drivers/OpenCodeDriver
 */
import { OpenCodeSettings, ProviderDriverKind, type ServerProvider } from "@tabs/contracts";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";
import { readOpenCodeGoUsageLimits } from "../openCodeUsageLimits.ts";

import { makeOpenCodeTextGeneration } from "../../textGeneration/OpenCodeTextGeneration.ts";
import { ServerConfig } from "../../config.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeOpenCodeAdapter } from "../Layers/OpenCodeAdapter.ts";
import {
  checkOpenCodeProviderStatus,
  makePendingOpenCodeProvider,
  openCodeSkillsToServerProviderSkills,
} from "../Layers/OpenCodeProvider.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { OpenCodeRuntime } from "../opencodeRuntime.ts";
import {
  defaultProviderContinuationIdentity,
  makeExternalCliLifecycle,
  makeProviderInstanceCapabilities,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { getProviderSecret } from "../ProviderSecretStore.ts";
import {
  makeManualOnlyProviderMaintenanceCapabilities,
  enrichProviderSnapshotWithVersionAdvisory,
  makePackageManagedProviderMaintenanceResolver,
  normalizeCommandPath,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../providerMaintenance.ts";
const decodeOpenCodeSettings = Schema.decodeSync(OpenCodeSettings);

const DRIVER_KIND = "opencode" as ProviderDriverKind;
const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);

function isOpenCodeNativeCommandPath(commandPath: string): boolean {
  const normalized = normalizeCommandPath(commandPath);
  return (
    normalized.endsWith("/.opencode/bin/opencode") ||
    normalized.endsWith("/.opencode/bin/opencode.exe")
  );
}

const legacyOpenCodeUpdateFor = (generation: "v1" | "v2") =>
  makePackageManagedProviderMaintenanceResolver({
    provider: DRIVER_KIND,
    npmPackageName: generation === "v2" ? "@opencode/cli" : "opencode-ai",
    homebrewFormula: "anomalyco/tap/opencode",
    nativeUpdate: {
      executable: "opencode",
      args: ["upgrade"],
      lockKey: "opencode-native",
      isCommandPath: isOpenCodeNativeCommandPath,
    },
  });

const UPDATE = legacyOpenCodeUpdateFor("v1");

export type OpenCodeDriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
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

const LegacyOpenCodeDriver: ProviderDriver<OpenCodeSettings, any> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "OpenCode",
    supportsMultipleInstances: true,
  },
  configSchema: OpenCodeSettings,
  defaultConfig: (): OpenCodeSettings => decodeOpenCodeSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const openCodeRuntime = yield* OpenCodeRuntime;
      const serverConfig = yield* ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const crypto = yield* Crypto.Crypto;
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
        getProviderSecret("opencode.server-password"),
      ).pipe(Effect.orElseSucceed(() => null));
      const effectiveConfig = {
        ...config,
        enabled,
        serverPassword: secureServerPassword ?? config.serverPassword,
      } satisfies OpenCodeSettings;
      const maintenanceCapabilities = yield* resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
        ...(effectiveConfig.binaryPath ? { binaryPath: effectiveConfig.binaryPath } : {}),
        env: processEnv,
      });

      const adapter = yield* makeOpenCodeAdapter(effectiveConfig, {
        instanceId,
        environment: processEnv,
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
      });
      const textGeneration = yield* makeOpenCodeTextGeneration(effectiveConfig, processEnv);

      const checkProvider = Effect.all(
        {
          provider: checkOpenCodeProviderStatus(effectiveConfig, serverConfig.cwd, processEnv),
          usageLimits: readOpenCodeGoUsageLimits({
            enabled: effectiveConfig.enabled,
            serverUrl: effectiveConfig.serverUrl,
            environment: processEnv,
          }).pipe(
            Effect.catchDefect(() => Effect.succeed(undefined)),
            Effect.orElseSucceed(() => undefined),
          ),
        },
        { concurrency: "unbounded" },
      ).pipe(
        Effect.map(({ provider, usageLimits }) => ({
          ...provider,
          ...(usageLimits ? { usageLimits } : {}),
        })),
        Effect.map(stampIdentity),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.provideService(OpenCodeRuntime, openCodeRuntime),
      );

      const snapshot = yield* makeManagedServerProvider<OpenCodeSettings>({
        maintenanceCapabilities,
        getSettings: Effect.succeed(effectiveConfig),
        streamSettings: Stream.never,
        haveSettingsChanged: () => false,
        initialSnapshot: (settings) =>
          makePendingOpenCodeProvider(settings).pipe(Effect.map(stampIdentity)),
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
              detail: `Failed to build OpenCode snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      const loadSkillsForCwd = (cwd: string) =>
        Effect.scoped(
          Effect.gen(function* () {
            const server = yield* openCodeRuntime.connectToOpenCodeServer({
              binaryPath: effectiveConfig.binaryPath,
              serverUrl: effectiveConfig.serverUrl,
              directory: cwd,
              environment: processEnv,
            });
            const client = openCodeRuntime.createOpenCodeSdkClient({
              baseUrl: server.url,
              directory: cwd,
              ...(effectiveConfig.serverPassword
                ? { serverPassword: effectiveConfig.serverPassword }
                : {}),
            });
            return yield* openCodeRuntime.loadOpenCodeSkills(client);
          }),
        );

      const snapshotForCwd = (cwd: string) =>
        !effectiveConfig.enabled
          ? snapshot.getSnapshot
          : Effect.all([
              snapshot.getSnapshot,
              loadSkillsForCwd(cwd).pipe(Effect.timeout("20 seconds")),
            ]).pipe(
              Effect.map(([machineSnapshot, skills]) => ({
                ...machineSnapshot,
                skills: openCodeSkillsToServerProviderSkills(skills),
              })),
              Effect.mapError(
                (cause) =>
                  new ProviderDriverError({
                    driver: DRIVER_KIND,
                    instanceId,
                    detail: `Failed to probe OpenCode skills for '${cwd}'`,
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
          { kind: "login", command: "opencode auth login" },
          { kind: "logout", command: "opencode auth logout" },
          { kind: "switch-account", command: "opencode auth logout && opencode auth login" },
        ]),
        snapshot,
        snapshotForCwd,
        adapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};

// Both server generations share the provider catalog during the transition.
// Legacy registry assembly explicitly retains its existing adapters until
// the browser migration is accepted.
export const OpenCodeDriver: typeof LegacyOpenCodeDriver = {
  ...LegacyOpenCodeDriver,
  create: (input) =>
    Effect.gen(function* () {
      const generation = yield* ProviderRuntimeGeneration;
      return yield* generation === "v2"
        ? ModernOpenCodeDriver.create(input)
        : LegacyOpenCodeDriver.create(input);
    }),
};

export const openCodeUpdateFor = (generation: "v1" | "v2") => ({
  resolve: () =>
    makeManualOnlyProviderMaintenanceCapabilities({ provider: DRIVER_KIND, packageName: null }),
  resolveEffect: (
    options?: import("../providerMaintenance.ts").ProviderMaintenanceCapabilityResolutionOptions,
  ) => resolveModernMaintenance(modernOpenCodeUpdateFor(generation), options),
});
