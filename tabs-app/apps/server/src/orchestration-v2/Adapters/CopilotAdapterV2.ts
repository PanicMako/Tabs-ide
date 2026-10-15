import { defaultInstanceIdForDriver, CopilotSettings, ProviderDriverKind } from "@tabs/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";

import { HostProcessEnvironment } from "@tabs/shared/hostProcess";
import { resolveSelfInvocation } from "@tabs/shared/nodeRuntime";
import * as ServerConfig from "../../config.ts";
import { makeAcpNativeLoggerFactory } from "../../provider/acp/AcpNativeLogging.ts";
import {
  makeCopilotAcpRuntime,
  applyCopilotAcpModelSelection,
  currentCopilotModelIdFromSessionSetup,
} from "../../provider/acp/CopilotAcpSupport.ts";
import { mergeProviderInstanceEnvironment } from "../../provider/ProviderInstanceEnvironment.ts";
import * as ProviderEventLoggers from "../../provider/ProviderEventLoggers.ts";
import * as IdAllocator from "../IdAllocator.ts";
import * as ProviderContinuationRequests from "../ProviderContinuationRequests.ts";
import * as ProviderAdapter from "../ProviderAdapter.ts";
import {
  ProviderAdapterDriverCreateError,
  type ProviderAdapterDriver,
  type ProviderAdapterDriverCreateInput,
} from "../ProviderAdapterDriver.ts";
import {
  AcpProviderCapabilitiesV2,
  makeAcpAdapterV2,
  type AcpAdapterV2Flavor,
  type AcpAdapterV2Options,
} from "./AcpAdapterV2.ts";

export const COPILOT_PROVIDER = ProviderDriverKind.make("copilot");
export const COPILOT_DEFAULT_INSTANCE_ID = defaultInstanceIdForDriver(COPILOT_PROVIDER);
const DEFAULT_COPILOT_SETTINGS = Schema.decodeSync(CopilotSettings)({});

export interface CopilotAdapterV2Options extends Omit<AcpAdapterV2Options, "flavor"> {
  readonly settings: CopilotSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly makeRuntime?: AcpAdapterV2Flavor["makeRuntime"];
}

export const CopilotProviderCapabilitiesV2 = {
  ...AcpProviderCapabilitiesV2,
  sessions: { ...AcpProviderCapabilitiesV2.sessions, supportsModelSwitchInSession: true },
  tools: { ...AcpProviderCapabilitiesV2.tools, supportsMcpTools: true },
};

export function makeCopilotAdapterV2(options: CopilotAdapterV2Options) {
  return makeAcpAdapterV2({
    ...options,
    flavor: {
      driver: COPILOT_PROVIDER,
      capabilities: CopilotProviderCapabilitiesV2,
      applyModelSelection: ({ runtime, startResult, modelSelection }) =>
        Effect.gen(function* () {
          const protocolVersion = startResult.initializeResult.protocolVersion;
          const legacy = protocolVersion === 1;
          const configOptions = legacy ? [] : yield* runtime.getConfigOptions;
          const configured = configOptions.find(
            (option) => option.category === "model",
          )?.currentValue;
          return yield* applyCopilotAcpModelSelection({
            runtime,
            protocolVersion,
            currentModelId: legacy
              ? currentCopilotModelIdFromSessionSetup(startResult.sessionSetupResult)
              : typeof configured === "string"
                ? configured
                : undefined,
            requestedModelId:
              modelSelection.model === "auto" || modelSelection.model === "default"
                ? undefined
                : modelSelection.model,
            mapError: (cause) => cause,
          });
        }),

      makeRuntime:
        options.makeRuntime ??
        (({ runtimePolicy: _policy, processEnvironment, ...input }) =>
          makeCopilotAcpRuntime({
            ...input,
            copilotSettings: options.settings,
            environment: { ...options.environment, ...processEnvironment },
            childProcessSpawner: options.childProcessSpawner,
          })),
    },
  });
}

export type CopilotAdapterV2DriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | IdAllocator.IdAllocatorV2
  | Path.Path
  | ProviderEventLoggers.ProviderEventLoggers
  | ServerConfig.ServerConfig;

export const CopilotAdapterV2Driver: ProviderAdapterDriver<
  CopilotSettings,
  CopilotAdapterV2DriverEnv
> = {
  driverKind: COPILOT_PROVIDER,
  configSchema: CopilotSettings,
  defaultConfig: (): CopilotSettings => DEFAULT_COPILOT_SETTINGS,
  create: Effect.fn("CopilotAdapterV2Driver.create")(
    function* (input: ProviderAdapterDriverCreateInput<CopilotSettings>) {
      const hostEnvironment = yield* HostProcessEnvironment;
      const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const crypto = yield* Crypto.Crypto;
      const fileSystem = yield* FileSystem.FileSystem;
      const idAllocator = yield* IdAllocator.IdAllocatorV2;
      const providerEventLoggers = yield* ProviderEventLoggers.ProviderEventLoggers;
      const serverConfig = yield* ServerConfig.ServerConfig;
      const selfInvocation = yield* resolveSelfInvocation();
      const continuationRequests = yield* ProviderContinuationRequests.ProviderContinuationRequests;
      const makeNativeLogger = yield* makeAcpNativeLoggerFactory();
      return makeCopilotAdapterV2({
        instanceId: input.instanceId,
        settings: { ...input.config, enabled: input.enabled },
        environment: mergeProviderInstanceEnvironment(input.environment, hostEnvironment),
        childProcessSpawner,
        crypto,
        fileSystem,
        idAllocator,
        serverConfig,
        selfInvocation,
        continuationRequests,
        nativeLogging: (threadId) =>
          makeNativeLogger({
            nativeEventLogger: providerEventLoggers.native,
            provider: COPILOT_PROVIDER,
            threadId,
          }),
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterDriverCreateError({
              driver: COPILOT_PROVIDER,
              instanceId: input.instanceId,
              detail: "Failed to create Copilot ACP adapter.",
              cause,
            }),
        ),
      ),
  ),
};

export const layer: Layer.Layer<
  ProviderAdapter.ProviderAdapterV2,
  never,
  CopilotAdapterV2DriverEnv
> = Layer.effect(
  ProviderAdapter.ProviderAdapterV2,
  Effect.gen(function* () {
    const hostEnvironment = yield* HostProcessEnvironment;
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const crypto = yield* Crypto.Crypto;
    const fileSystem = yield* FileSystem.FileSystem;
    const idAllocator = yield* IdAllocator.IdAllocatorV2;
    const providerEventLoggers = yield* ProviderEventLoggers.ProviderEventLoggers;
    const serverConfig = yield* ServerConfig.ServerConfig;
    const selfInvocation = yield* resolveSelfInvocation();
    const continuationRequests = yield* ProviderContinuationRequests.ProviderContinuationRequests;
    const makeNativeLogger = yield* makeAcpNativeLoggerFactory();
    return makeCopilotAdapterV2({
      instanceId: COPILOT_DEFAULT_INSTANCE_ID,
      settings: DEFAULT_COPILOT_SETTINGS,
      environment: hostEnvironment,
      childProcessSpawner,
      crypto,
      fileSystem,
      idAllocator,
      serverConfig,
      selfInvocation,
      continuationRequests,
      nativeLogging: (threadId) =>
        makeNativeLogger({
          nativeEventLogger: providerEventLoggers.native,
          provider: COPILOT_PROVIDER,
          threadId,
        }),
    });
  }),
);
