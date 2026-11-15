import { KiroSettings, ProviderDriverKind } from "@tabs/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import {
  type KiroAdapterV2DriverEnv,
  makeKiroAdapterV2Driver,
} from "../../orchestration-v2/Adapters/KiroAdapterV2.ts";
import { makeUnsupportedTextGeneration } from "../../textGeneration/UnsupportedTextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import {
  buildInitialKiroProviderSnapshot,
  checkKiroProviderStatus,
  kiroDefaultModelId,
} from "../KiroProvider.ts";
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

const decodeKiroSettings = Schema.decodeSync(KiroSettings);

const DRIVER_KIND = ProviderDriverKind.make("kiro");
// Kiro updates itself in the background (`kiro-cli update` reports only), so
// Tabs offers no one-click update.
const UPDATE: ProviderMaintenanceCapabilitiesResolver = {
  resolve: () =>
    Effect.succeed(
      makeManualOnlyProviderMaintenanceCapabilities({
        provider: DRIVER_KIND,
        packageName: null,
      }),
    ),
};

export type KiroDriverEnv =
  | KiroAdapterV2DriverEnv
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | Path.Path
  | ServerSettings.ServerSettingsService;

export const KiroDriver: ProviderDriver<KiroSettings, KiroDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Kiro",
    supportsMultipleInstances: true,
  },
  configSchema: KiroSettings,
  defaultConfig: (): KiroSettings => decodeKiroSettings({}),
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
      const effectiveConfig = { ...config, enabled } satisfies KiroSettings;
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

      const checkProvider = checkKiroProviderStatus(effectiveConfig, processEnv).pipe(
        Effect.map(stampIdentity),
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<KiroSettings>>({
        resolveMaintenance,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          buildInitialKiroProviderSnapshot(settings.provider).pipe(Effect.map(stampIdentity)),
        checkProvider,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: "Failed to build Kiro snapshot.",
              cause,
            }),
        ),
      );

      // "Kiro default" selects the default the snapshot read from Kiro's model list.
      const orchestrationAdapter = yield* makeKiroAdapterV2Driver(
        snapshot.getSnapshot.pipe(Effect.map((current) => kiroDefaultModelId(current.models))),
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
                detail: "Failed to build Kiro orchestration adapter.",
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
        orchestrationAdapter,
        textGeneration: makeUnsupportedTextGeneration("Kiro"),
      } satisfies ProviderInstance;
    }),
};
