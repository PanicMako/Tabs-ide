import * as Crypto from "effect/Crypto";
import { resolveSelfInvocation } from "@tabs/shared/nodeRuntime";
import * as IdAllocator from "../../orchestration-v2/IdAllocator.ts";
import { makeCopilotAdapterV2 } from "../../orchestration-v2/Adapters/CopilotAdapterV2.ts";
import { ProviderRuntimeGeneration } from "../ProviderRuntimeGeneration.ts";
import { makeAcpNativeLoggerFactory } from "../acp/AcpNativeLogging.ts";
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

import { ServerConfig } from "../../config.ts";
import { makeCopilotTextGeneration } from "../../textGeneration/CopilotTextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeCopilotAdapter } from "../Layers/CopilotAdapter.ts";
import {
  buildInitialCopilotProviderSnapshot,
  checkCopilotProviderStatus,
  enrichCopilotSnapshot,
} from "../Layers/CopilotProvider.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  makeProviderInstanceCapabilities,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { getProviderSecret } from "../ProviderSecretStore.ts";
import {
  makeManualOnlyProviderMaintenanceCapabilities,
  makeStaticProviderMaintenanceResolver,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../providerMaintenance.ts";

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

export const CopilotDriver: ProviderDriver<CopilotSettings, any> = {
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
      const generation = yield* ProviderRuntimeGeneration;
      const orchestrationAdapter =
        generation === "v2"
          ? yield* Effect.gen(function* () {
              const crypto = yield* Crypto.Crypto;
              const idAllocator = yield* IdAllocator.IdAllocatorV2;
              const serverConfig = yield* ServerConfig;
              const selfInvocation = yield* resolveSelfInvocation();
              const nativeLoggers = yield* makeAcpNativeLoggerFactory();
              return makeCopilotAdapterV2({
                instanceId,
                settings: effectiveConfig,
                environment: processEnv,
                childProcessSpawner: spawner,
                crypto,
                idAllocator,
                serverConfig,
                selfInvocation,
                fileSystem: yield* FileSystem.FileSystem,
                nativeLogging: (threadId) =>
                  nativeLoggers({
                    provider: "copilot" as ProviderDriverKind,
                    threadId,
                    nativeEventLogger: eventLoggers.native,
                  }),
              });
            })
          : undefined;
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
        ...(orchestrationAdapter === undefined ? {} : { orchestrationAdapter }),
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
