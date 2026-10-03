import { CopilotSettings, ProviderDriverKind, type ServerProvider } from "@tabs/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import { ServerConfig } from "../../config";
import { makeCopilotTextGeneration } from "../../textGeneration/CopilotTextGeneration";
import { ProviderDriverError } from "../Errors";
import { makeCopilotAdapter } from "../Layers/CopilotAdapter";
import {
  buildInitialCopilotProviderSnapshot,
  checkCopilotProviderStatus,
  enrichCopilotSnapshot,
} from "../Layers/CopilotProvider";
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
  makeManualOnlyProviderMaintenanceCapabilities,
  makeStaticProviderMaintenanceResolver,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../providerMaintenance";

const decodeCopilotSettings = Schema.decodeSync(CopilotSettings);

const DRIVER_KIND = "copilot" as ProviderDriverKind;
const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);
const UPDATE = makeStaticProviderMaintenanceResolver(
  makeManualOnlyProviderMaintenanceCapabilities({
    provider: DRIVER_KIND,
    packageName: "@github/copilot",
  }),
);

export type CopilotDriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | HttpClient.HttpClient
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

export const CopilotDriver: ProviderDriver<CopilotSettings, CopilotDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "GitHub Copilot",
    supportsMultipleInstances: true,
  },
  configSchema: CopilotSettings,
  defaultConfig: (): CopilotSettings => decodeCopilotSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
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
      const secureByokApiKey = yield* Effect.tryPromise(() =>
        getProviderSecret("copilot.byok-api-key"),
      ).pipe(Effect.orElseSucceed(() => null));
      const effectiveConfig = {
        ...config,
        enabled,
        byokApiKey: secureByokApiKey ?? config.byokApiKey,
      } satisfies CopilotSettings;
      const maintenanceCapabilities = yield* resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
        binaryPath: effectiveConfig.binaryPath,
        env: processEnv,
      });

      const advertisedModelsRef = yield* Ref.make<ReadonlySet<string>>(new Set());
      const checkProvider = checkCopilotProviderStatus(effectiveConfig, processEnv).pipe(
        Effect.map(stampIdentity),
        Effect.tap((provider) =>
          Ref.set(advertisedModelsRef, new Set(provider.models.map((model) => model.slug))),
        ),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
      const adapter = yield* makeCopilotAdapter(effectiveConfig, {
        environment: processEnv,
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
        instanceId,
        isModelAdvertised: (modelId) =>
          Ref.get(advertisedModelsRef).pipe(Effect.map((models) => models.has(modelId))),
      });
      const textGeneration = yield* makeCopilotTextGeneration(
        effectiveConfig,
        processEnv,
        (modelId) => Ref.get(advertisedModelsRef).pipe(Effect.map((models) => models.has(modelId))),
      );

      const snapshot = yield* makeManagedServerProvider<CopilotSettings>({
        maintenanceCapabilities,
        getSettings: Effect.succeed(effectiveConfig),
        streamSettings: Stream.never,
        haveSettingsChanged: () => false,
        initialSnapshot: (settings) =>
          buildInitialCopilotProviderSnapshot(settings).pipe(Effect.map(stampIdentity)),
        checkProvider,
        enrichSnapshot: ({ snapshot: currentSnapshot, publishSnapshot }) =>
          enrichCopilotSnapshot({
            snapshot: currentSnapshot,
            maintenanceCapabilities,
            publishSnapshot,
            httpClient,
          }),
        refreshInterval: SNAPSHOT_REFRESH_INTERVAL,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Copilot snapshot: ${cause.message ?? String(cause)}`,
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
          login: "supported",
          logout: "supported",
          accountSwitch: "supported",
          installation: "supported",
        }),
        lifecycle: {
          actions: [
            { kind: "login", command: "copilot login", external: false },
            { kind: "logout", command: "copilot /logout", external: false },
            { kind: "switch-account", command: "copilot /logout", external: false },
            { kind: "install", command: "npm install -g @github/copilot", external: false },
          ],
        },
        snapshot,
        adapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
