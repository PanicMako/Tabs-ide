/**
 * MuseDriver — `ProviderDriver` for Muse Code, composing the Muse Session
 * Protocol adapter (`provider/muse/adapter.ts`) and its status probe.
 *
 * Muse keeps its sessions and login in the user's own home, so continuation
 * identity uses the default instance grouping. Muse has no headless text
 * generation entry point here, so git writing uses the configured writer.
 */
import { MuseSettings, ProviderDriverKind, type ServerProvider } from "@tabs/contracts";
import { HostProcessEnvironment } from "@tabs/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import * as ServerConfig from "../../config.ts";
import * as IdAllocator from "../../orchestration-v2/IdAllocator.ts";
import { expandHomePath } from "../../os-jank.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { makeUnsupportedTextGeneration } from "../../textGeneration/UnsupportedTextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { makeMuseAdapterV2 } from "../muse/adapter.ts";
import { makeMuseEnvironment } from "../muse/sdk.ts";
import { checkMuseProviderStatus, makePendingMuseProvider } from "../muse/status.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";

const DRIVER_KIND = ProviderDriverKind.make("muse");
const decodeMuseSettings = Schema.decodeSync(MuseSettings);
// Muse updates through its own installer; Tabs offers no one-click update.
const MAINTENANCE = makeManualOnlyProviderMaintenanceCapabilities({
  provider: DRIVER_KIND,
  packageName: null,
});

export type MuseDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | IdAllocator.IdAllocatorV2
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig.ServerConfig
  | ServerSettings.ServerSettingsService;

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

export const MuseDriver: ProviderDriver<MuseSettings, MuseDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "Muse Code", supportsMultipleInstances: true },
  configSchema: MuseSettings,
  defaultConfig: (): MuseSettings => decodeMuseSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { cwd } = yield* ServerConfig.ServerConfig;
      const serverSettings = yield* ServerSettings.ServerSettingsService;
      const eventLoggers = yield* ProviderEventLoggers;
      const hostEnvironment = yield* HostProcessEnvironment;
      // Drop an inherited META_API_KEY so Muse uses its login; an instance value still wins.
      const processEnvironment = {
        ...makeMuseEnvironment(hostEnvironment),
        ...mergeProviderInstanceEnvironment(environment),
      };
      const binaryPath = yield* expandHomePath(config.binaryPath).pipe(
        Effect.provideService(Path.Path, path),
      );
      const effectiveConfig = { ...config, enabled, binaryPath } satisfies MuseSettings;
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

      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<MuseSettings>>({
        resolveMaintenance: () => Effect.succeed(MAINTENANCE),
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          makePendingMuseProvider(settings.provider).pipe(Effect.map(stampIdentity)),
        checkProvider: checkMuseProviderStatus(effectiveConfig, processEnvironment, cwd).pipe(
          Effect.map(stampIdentity),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        ),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: "Failed to build Muse Code snapshot.",
              cause,
            }),
        ),
      );

      const orchestrationAdapter = yield* makeMuseAdapterV2({
        instanceId,
        settings: effectiveConfig,
        environment: processEnvironment,
        modelCatalog: snapshot.getSnapshot.pipe(Effect.map((current) => current.models)),
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
      });

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        orchestrationAdapter,
        textGeneration: makeUnsupportedTextGeneration("Muse Code"),
      } satisfies ProviderInstance;
    }),
};
