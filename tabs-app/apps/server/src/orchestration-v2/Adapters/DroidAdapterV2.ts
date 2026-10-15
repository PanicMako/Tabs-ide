import {
  defaultInstanceIdForDriver,
  DroidSettings,
  ProviderDriverKind,
  type OrchestrationV2ProviderCapabilities,
} from "@tabs/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as EffectAcpErrors from "effect-acp/errors";

import { HostProcessEnvironment } from "@tabs/shared/hostProcess";
import { resolveSelfInvocation, type SelfInvocation } from "@tabs/shared/nodeRuntime";
import * as ServerConfig from "../../config.ts";
import { makeAcpNativeLoggerFactory } from "../../provider/acp/AcpNativeLogging.ts";
import {
  applyDroidAcpModelSelection,
  currentDroidModelIdFromSessionSetup,
  makeDroidAcpRuntime,
  resolveDroidAcpBaseModelId,
} from "../../provider/acp/DroidAcpSupport.ts";
import { mergeProviderInstanceEnvironment } from "../../provider/ProviderInstanceEnvironment.ts";
import { acpPermissionDisposition } from "../../provider/acp/AcpClientPolicy.ts";
import * as AcpSessionRuntime from "../../provider/acp/AcpSessionRuntime.ts";
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
  type AcpAdapterV2RuntimeInput,
} from "./AcpAdapterV2.ts";

export const DROID_PROVIDER = ProviderDriverKind.make("droid");
export const DROID_DEFAULT_INSTANCE_ID = defaultInstanceIdForDriver(DROID_PROVIDER);
const DEFAULT_DROID_SETTINGS = Schema.decodeSync(DroidSettings)({});

export const DroidProviderCapabilitiesV2 = {
  ...AcpProviderCapabilitiesV2,
  sessions: {
    ...AcpProviderCapabilitiesV2.sessions,
    supportsModelSwitchInSession: true,
  },
  tools: {
    ...AcpProviderCapabilitiesV2.tools,
    supportsMcpTools: true,
  },
} satisfies OrchestrationV2ProviderCapabilities;

export interface DroidAdapterV2Options extends Omit<AcpAdapterV2Options, "flavor"> {
  readonly settings: DroidSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly makeRuntime?: (
    input: AcpAdapterV2RuntimeInput,
  ) => Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError,
    Crypto.Crypto | Scope.Scope
  >;
}

export function makeDroidAcpAdapterFlavor(options: DroidAdapterV2Options): AcpAdapterV2Flavor {
  return {
    driver: DROID_PROVIDER,
    runtimeHarness: "Droid",
    capabilities: DroidProviderCapabilitiesV2,
    resolveModelId: (selection) => resolveDroidAcpBaseModelId(selection.model),
    applyModelSelection: ({ runtime, startResult, modelSelection }) =>
      Effect.gen(function* () {
        const protocolVersion = startResult.initializeResult.protocolVersion;
        const legacy = protocolVersion === 1;
        const configOptions = legacy ? [] : yield* runtime.getConfigOptions;
        const configured = configOptions.find(
          (option) => option.category === "model",
        )?.currentValue;
        return yield* applyDroidAcpModelSelection({
          runtime: legacy
            ? runtime
            : { setSessionModel: (model) => runtime.setModel(model).pipe(Effect.as({})) },
          currentModelId: legacy
            ? currentDroidModelIdFromSessionSetup(startResult.sessionSetupResult as any)
            : typeof configured === "string"
              ? configured
              : undefined,
          requestedModelId:
            modelSelection.model === "auto" || modelSelection.model === "default"
              ? undefined
              : resolveDroidAcpBaseModelId(modelSelection.model),
          mapError: (cause) => cause,
        });
      }),
    makeRuntime:
      options.makeRuntime ??
      (({ runtimePolicy: _policy, processEnvironment, ...input }) =>
        makeDroidAcpRuntime({
          ...input,
          droidSettings: options.settings,
          environment: { ...options.environment, ...processEnvironment },
          childProcessSpawner: options.childProcessSpawner,
        })),
    permissionDisposition: (policy, request) => acpPermissionDisposition(policy, request),
  };
}

export function makeDroidAdapterV2(options: DroidAdapterV2Options) {
  const flavor = makeDroidAcpAdapterFlavor(options);
  return makeAcpAdapterV2({
    ...options,
    flavor,
  });
}

export type DroidAdapterV2DriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | IdAllocator.IdAllocatorV2
  | Path.Path
  | ProviderEventLoggers.ProviderEventLoggers
  | ServerConfig.ServerConfig;

export const DroidAdapterV2Driver: ProviderAdapterDriver<DroidSettings, DroidAdapterV2DriverEnv> = {
  driverKind: DROID_PROVIDER,
  configSchema: DroidSettings,
  defaultConfig: (): DroidSettings => DEFAULT_DROID_SETTINGS,
  create: Effect.fn("DroidAdapterV2Driver.create")(
    function* (input: ProviderAdapterDriverCreateInput<DroidSettings>) {
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
      return makeDroidAdapterV2({
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
            provider: DROID_PROVIDER,
            threadId,
          }),
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterDriverCreateError({
              driver: DROID_PROVIDER,
              instanceId: input.instanceId,
              detail: "Failed to create Factory Droid ACP adapter.",
              cause,
            }),
        ),
      ),
  ),
};

export const layer: Layer.Layer<ProviderAdapter.ProviderAdapterV2, never, DroidAdapterV2DriverEnv> =
  Layer.effect(
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
      return makeDroidAdapterV2({
        instanceId: DROID_DEFAULT_INSTANCE_ID,
        settings: DEFAULT_DROID_SETTINGS,
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
            provider: DROID_PROVIDER,
            threadId,
          }),
      });
    }),
  );
