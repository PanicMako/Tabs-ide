import { FxSettings, ProviderDriverKind } from "@tabs/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import {
  type FxAdapterV2DriverEnv,
  makeFxAdapterV2Driver,
} from "../../orchestration-v2/Adapters/FxAdapterV2.ts";
import { discoverFxSkills } from "./FxSkills.ts";
import { makeUnsupportedTextGeneration } from "../../textGeneration/UnsupportedTextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import {
  buildInitialFxProviderSnapshot,
  checkFxProviderStatus,
  fxDefaultModelId,
} from "../FxProvider.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { withInstanceIdentity } from "./instanceIdentity.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import {
  makeCachedProviderMaintenanceResolution,
  makeManualOnlyProviderMaintenanceCapabilities,
  resolveProviderMaintenanceCapabilitiesEffect,
  type ProviderMaintenanceCapabilitiesResolver,
} from "../providerMaintenance.modern.ts";
import * as ServerSettings from "../../serverSettings.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";

const decodeFxSettings = Schema.decodeSync(FxSettings);

const DRIVER_KIND = ProviderDriverKind.make("fx");
// fx installs from its own setup script and updates with `fx upgrade`; there
// is no npm package to read a latest version from.
const UPDATE: ProviderMaintenanceCapabilitiesResolver = {
  resolve: () =>
    Effect.succeed(
      makeManualOnlyProviderMaintenanceCapabilities({
        provider: DRIVER_KIND,
        packageName: null,
      }),
    ),
};

export type FxDriverEnv =
  | FxAdapterV2DriverEnv
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | Path.Path
  | ServerSettings.ServerSettingsService;

export const FxDriver: ProviderDriver<FxSettings, FxDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Fx",
    supportsMultipleInstances: true,
  },
  configSchema: FxSettings,
  defaultConfig: (): FxSettings => decodeFxSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const serverSettings = yield* ServerSettings.ServerSettingsService;
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        driverKind: DRIVER_KIND,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const effectiveConfig = { ...config, enabled } satisfies FxSettings;
      const resolveMaintenance = yield* makeCachedProviderMaintenanceResolution(
        resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
          binaryPath: effectiveConfig.binaryPath,
          env: processEnv,
        }).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        ),
      );

      const checkProvider = checkFxProviderStatus(effectiveConfig, processEnv).pipe(
        Effect.map(stampIdentity),
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<FxSettings>>({
        resolveMaintenance,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          buildInitialFxProviderSnapshot(settings.provider).pipe(Effect.map(stampIdentity)),
        checkProvider,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: "Failed to build Fx snapshot.",
              cause,
            }),
        ),
      );

      // "Default" selects the model the snapshot read from `fx status`.
      const orchestrationAdapter = yield* makeFxAdapterV2Driver(
        snapshot.getSnapshot.pipe(Effect.map((current) => fxDefaultModelId(current.models))),
      )
        .create({
          instanceId,
          displayName,
          accentColor,
          environment,
          enabled,
          config: effectiveConfig,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ProviderDriverError({
                driver: DRIVER_KIND,
                instanceId,
                detail: "Failed to build Fx orchestration adapter.",
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
        snapshot,
        snapshotForCwd: (cwd: string) =>
          !effectiveConfig.enabled
            ? snapshot.getSnapshot
            : Effect.all([
                snapshot.getSnapshot,
                discoverFxSkills({ cwd, environment: processEnv }).pipe(
                  Effect.provideService(FileSystem.FileSystem, fileSystem),
                  Effect.provideService(Path.Path, path),
                ),
              ]).pipe(Effect.map(([machineSnapshot, skills]) => ({ ...machineSnapshot, skills }))),
        orchestrationAdapter,
        textGeneration: makeUnsupportedTextGeneration("Fx"),
      } satisfies ProviderInstance;
    }),
};
