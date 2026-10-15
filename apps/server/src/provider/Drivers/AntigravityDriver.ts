import { AntigravityDriver as ModernAntigravityDriver } from "./AntigravityDriver.modern.ts";
import { ProviderRuntimeGeneration } from "../ProviderRuntimeGeneration.ts";
import { AntigravitySettings, ProviderDriverKind, type ServerProvider } from "@tabs/contracts";
import * as Duration from "effect/Duration";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ChildProcessSpawner } from "effect/unstable/process";

import { makeUnsupportedTextGeneration } from "../../textGeneration/UnsupportedTextGeneration.ts";
import { ServerConfig } from "../../config.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeAntigravityAdapter } from "../Layers/AntigravityAdapter.ts";
import { makeLegacyAntigravityAdapter } from "../Layers/LegacyAntigravityAdapter.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { checkAntigravityProviderStatus } from "../Layers/AntigravityProvider.ts";
import {
  defaultProviderContinuationIdentity,
  makeProviderInstanceCapabilities,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { buildServerProvider } from "../providerSnapshot.ts";
import { makeProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { AntigravityInstallation } from "../AntigravityInstallation.ts";
import { discoverAntigravitySkills, resolveAntigravityUserHome } from "./AntigravitySkills.ts";

const decodeAntigravitySettings = Schema.decodeSync(AntigravitySettings);

const DRIVER_KIND = "antigravity" as ProviderDriverKind;
const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);

export function isNativeAntigravityAcpBinary(binaryPath: string | null | undefined): boolean {
  return /(?:^|[\\/])agy_acp_server(?:\.par|\.exe)?$/iu.test(binaryPath?.trim() ?? "");
}

const withInstanceIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationGroupKey: string;
  }) =>
  (snapshot: ReturnType<typeof buildServerProvider>): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });

export type AntigravityDriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | ServerConfig;

const LegacyAntigravityDriver: ProviderDriver<AntigravitySettings, any> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Antigravity",
    supportsMultipleInstances: true,
  },
  configSchema: AntigravitySettings,
  defaultConfig: (): AntigravitySettings => decodeAntigravitySettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const serverConfig = yield* ServerConfig;
      const installation = yield* Effect.serviceOption(AntigravityInstallation);
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
      const configuredBinaryPath = config.binaryPath?.trim();
      const managedExecutable =
        configuredBinaryPath || installation._tag === "None"
          ? null
          : yield* installation.value.resolve(undefined, processEnv).pipe(Effect.option);
      const nativeBinaryPath =
        managedExecutable?._tag === "Some" ? managedExecutable.value.executablePath : undefined;
      const effectiveConfig = {
        ...config,
        enabled,
        ...(nativeBinaryPath ? { binaryPath: nativeBinaryPath } : {}),
      } satisfies AntigravitySettings;
      const usesNativeAcp = isNativeAntigravityAcpBinary(effectiveConfig.binaryPath);
      const maintenanceCapabilities = makeProviderMaintenanceCapabilities({
        provider: DRIVER_KIND,
        packageName: null,
        updateExecutable: "agy",
        updateArgs: ["update"],
        updateLockKey: "antigravity-native",
      });

      const textGeneration = makeUnsupportedTextGeneration("Antigravity");

      const antigravityAdapter = yield* usesNativeAcp
        ? makeAntigravityAdapter(effectiveConfig, {
            instanceId,
            environment: processEnv,
            defaultCwd: serverConfig.cwd,
            attachmentsDir: serverConfig.attachmentsDir,
          })
        : makeLegacyAntigravityAdapter(effectiveConfig, {
            instanceId,
            environment: processEnv,
            defaultCwd: serverConfig.cwd,
            attachmentsDir: serverConfig.attachmentsDir,
          });

      const nativeInitialSnapshot = Effect.gen(function* () {
        const checkedAt = DateTime.formatIso(yield* DateTime.now);
        return stampIdentity(
          buildServerProvider({
            presentation: { displayName: "Antigravity" },
            enabled,
            checkedAt,
            models: [],
            probe: {
              // A configured native ACP executable is also a native install;
              // `nativeBinaryPath` is populated only for the managed runtime.
              installed: usesNativeAcp,
              version: managedExecutable?._tag === "Some" ? managedExecutable.value.version : null,
              // AG-001: Publish immediate installed state for native ACP without blocking startup on account discovery.
              status: "warning",
              auth: { status: "unknown" },
              message: enabled
                ? "Antigravity ACP is installed. Checking Google account access in the background."
                : "Antigravity is disabled in Tabs settings.",
            },
          }),
        );
      });

      const checkNativeProvider = Effect.gen(function* () {
        const checkedAt = DateTime.formatIso(yield* DateTime.now);
        const discovery = yield* antigravityAdapter.listModels!({
          cwd: serverConfig.cwd,
          binaryPath: effectiveConfig.binaryPath,
        }).pipe(Effect.timeoutOption("90 seconds"), Effect.result);
        const completed = Result.isSuccess(discovery)
          ? Option.getOrUndefined(discovery.success)
          : undefined;
        const detail = Result.isFailure(discovery)
          ? discovery.failure.message
          : completed === undefined
            ? "Antigravity ACP health check timed out."
            : undefined;
        const unauthenticated = Boolean(
          detail && /sign in|authenticate|unauthenticated|authorization/iu.test(detail),
        );
        const missing = Boolean(detail && /enoent|not installed|not found/iu.test(detail));
        return stampIdentity(
          buildServerProvider({
            presentation: { displayName: "Antigravity" },
            enabled,
            checkedAt,
            models:
              completed?.models.map((model) => ({
                slug: model.slug,
                name: model.name,
                isCustom: false,
                capabilities: null,
              })) ?? [],
            probe: {
              installed: !missing,
              version: managedExecutable?._tag === "Some" ? managedExecutable.value.version : null,
              status: completed ? "ready" : unauthenticated ? "warning" : "error",
              auth: {
                status: completed
                  ? "authenticated"
                  : unauthenticated
                    ? "unauthenticated"
                    : "unknown",
              },
              ...(detail ? { message: detail } : {}),
            },
          }),
        );
      });

      const checkProvider = usesNativeAcp
        ? checkNativeProvider
        : checkAntigravityProviderStatus(effectiveConfig, processEnv).pipe(
            Effect.map(stampIdentity),
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          );

      const snapshot = yield* makeManagedServerProvider<AntigravitySettings>({
        maintenanceCapabilities,
        getSettings: Effect.succeed(effectiveConfig),
        streamSettings: Stream.never,
        haveSettingsChanged: () => false,
        initialSnapshot: () => (usesNativeAcp ? nativeInitialSnapshot : checkProvider),
        checkProvider,
        enrichSnapshot: ({ snapshot: currentSnapshot }) => Effect.succeed(currentSnapshot),
        refreshInterval: SNAPSHOT_REFRESH_INTERVAL,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Antigravity snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      const userHome = resolveAntigravityUserHome(process.platform, processEnv);
      const snapshotForCwd = (cwd: string) =>
        !enabled
          ? snapshot.getSnapshot
          : discoverAntigravitySkills({ cwd, userHome }).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.flatMap((skills) =>
                snapshot.getSnapshot.pipe(
                  Effect.map((machineSnapshot) => ({ ...machineSnapshot, skills })),
                ),
              ),
              Effect.mapError(
                (cause) =>
                  new ProviderDriverError({
                    driver: DRIVER_KIND,
                    instanceId,
                    detail: "Could not read Antigravity workspace skills.",
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
          agentSessions: usesNativeAcp ? "supported" : "unsupported",
          textGeneration: "unsupported",
          structuredGeneration: "unsupported",
          login: "external",
          logout: "external",
          accountSwitch: "external",
        }),
        lifecycle: {
          actions: [
            { kind: "login", command: "agy", external: true },
            {
              kind: "install",
              command: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
              external: true,
            },
          ],
        },
        snapshot,
        snapshotForCwd,
        adapter: antigravityAdapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};

export const AntigravityDriver: typeof LegacyAntigravityDriver = {
  ...LegacyAntigravityDriver,
  create: (input) =>
    Effect.gen(function* () {
      const generation = yield* ProviderRuntimeGeneration;
      return yield* generation === "v2"
        ? ModernAntigravityDriver.create(input)
        : LegacyAntigravityDriver.create(input);
    }),
};
