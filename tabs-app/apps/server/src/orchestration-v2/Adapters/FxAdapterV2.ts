import { HostProcessEnvironment } from "@tabs/shared/hostProcess";
import { resolveSelfInvocation, type SelfInvocation } from "@tabs/shared/nodeRuntime";
import { FxSettings, type OrchestrationV2ProviderCapabilities } from "@tabs/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import { ChildProcessSpawner } from "effect/unstable/process";
import type * as EffectAcpErrors from "effect-acp/errors";

import * as ServerConfig from "../../config.ts";
import { makeAcpNativeLoggerFactory } from "../../provider/acp/AcpNativeLogging.ts";
import {
  applyFxEffortDefault,
  applyFxModelSelection,
  FX_DRIVER_KIND,
  fxPermissionDisposition,
  fxSessionModeForPolicy,
  makeFxAcpRuntime,
  withFxSessionMode,
} from "../../provider/acp/FxAcpSupport.ts";
import { mergeProviderInstanceEnvironment } from "../../provider/ProviderInstanceEnvironment.ts";
import type * as AcpSessionRuntime from "../../provider/acp/AcpSessionRuntime.ts";
import type { AcpToolCallState } from "../../provider/acp/AcpRuntimeModel.ts";
import * as ProviderEventLoggers from "../../provider/ProviderEventLoggers.ts";
import * as IdAllocator from "../IdAllocator.ts";
import * as ProviderContinuationRequests from "../ProviderContinuationRequests.ts";
import {
  ProviderAdapterDriverCreateError,
  type ProviderAdapterDriver,
  type ProviderAdapterDriverCreateInput,
} from "../ProviderAdapterDriver.ts";
import {
  AcpProviderCapabilitiesV2,
  makeAcpAdapterV2,
  type AcpAdapterV2Flavor,
  type AcpAdapterV2RuntimeInput,
  type AcpAdapterV2SubagentUpdate,
} from "./AcpAdapterV2.ts";

export { FX_DRIVER_KIND } from "../../provider/acp/FxAcpSupport.ts";

const DEFAULT_FX_SETTINGS = Schema.decodeSync(FxSettings)({});

const FxProviderCapabilitiesV2 = {
  ...AcpProviderCapabilitiesV2,
  sessions: {
    ...AcpProviderCapabilitiesV2.sessions,
    supportsModelSwitchInSession: true,
  },
  threads: {
    ...AcpProviderCapabilitiesV2.threads,
    canReadThreadSnapshot: true,
  },
  tools: {
    ...AcpProviderCapabilitiesV2.tools,
    supportsMcpTools: true,
  },
  checkpointing: {
    ...AcpProviderCapabilitiesV2.checkpointing,
    providerCanReadConversationSnapshot: true,
  },
  subagents: {
    ...AcpProviderCapabilitiesV2.subagents,
    supportsSubagents: true,
    emitsSubagentLifecycle: true,
  },
} satisfies OrchestrationV2ProviderCapabilities;

const FxSubagentRequest = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("run"),
    task: Schema.String,
    model: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    action: Schema.Literal("message"),
    agent: Schema.String,
    message: Schema.String,
    model: Schema.optionalKey(Schema.String),
  }),
]);
// fx 0.0.14 wraps the arguments in `request`; later fx sends them flat (vercel-labs/fx@df0878eb).
const decodeFxSubagentInput = Schema.decodeUnknownOption(
  Schema.Union([FxSubagentRequest, Schema.Struct({ request: FxSubagentRequest })]),
);
const decodeFxToolContent = Schema.decodeUnknownOption(
  Schema.Array(Schema.Struct({ content: Schema.Struct({ text: Schema.String }) })),
);
const decodeFxSubagentResult = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ ok: Schema.Boolean, result: Schema.NullOr(Schema.String) }),
  ),
);
const decodeJsonString = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.String));

/**
 * fx clips every tool result to 199 bytes, so a long sub-agent reply arrives
 * as cut-off `{"ok":…,"result":"…` JSON. Keeps the readable prefix and marks the cut.
 */
export function fxSubagentOutcome(
  text: string,
): { readonly ok: boolean; readonly result: string | null } | undefined {
  const whole = decodeFxSubagentResult(text);
  if (Option.isSome(whole)) return whole.value;
  const clipped = /^\{"ok":(true|false),"result":"((?:[^"\\]|\\.)*)/.exec(text);
  if (clipped === null) return undefined;
  const fragment = clipped[2] ?? "";
  const prefix = decodeJsonString(`"${fragment}"`).pipe(
    Option.orElse(() => decodeJsonString(`"${fragment.replace(/\\u[0-9a-fA-F]{0,3}$/, "")}"`)),
  );
  const cut = text[clipped[0].length] !== '"';
  return {
    ok: clipped[1] === "true",
    result: Option.isSome(prefix) ? `${prefix.value}${cut ? "…" : ""}` : null,
  };
}

/** fx streams no child frames over ACP, so each `subagent` call becomes a child thread holding its task and reply. */
function extractFxSubagentUpdate(tool: AcpToolCallState): AcpAdapterV2SubagentUpdate | undefined {
  if (tool.data.name !== "subagent") return undefined;
  const input = decodeFxSubagentInput(tool.data.rawInput);
  if (Option.isNone(input)) return undefined;
  const request = "request" in input.value ? input.value.request : input.value;
  const text = Option.getOrUndefined(decodeFxToolContent(tool.data.content))?.[0]?.content.text;
  const outcome = text === undefined ? undefined : fxSubagentOutcome(text);
  const status =
    tool.status === "completed"
      ? outcome?.ok === false
        ? "failed"
        : "completed"
      : tool.status === "failed"
        ? "failed"
        : "running";
  return {
    nativeTaskId: tool.toolCallId,
    childSessionId: null,
    prompt: request.action === "run" ? request.task : request.message,
    title: request.action === "message" ? request.agent : null,
    model: request.model ?? null,
    status,
    result: status === "running" ? null : (outcome?.result ?? text ?? null),
  };
}

export interface FxAdapterV2Options {
  readonly instanceId: Parameters<typeof makeAcpAdapterV2>[0]["instanceId"];
  readonly settings: FxSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly crypto: Crypto.Crypto;
  readonly selfInvocation: SelfInvocation;
  readonly fileSystem: FileSystem.FileSystem;
  readonly idAllocator: IdAllocator.IdAllocatorV2["Service"];
  readonly serverConfig: ServerConfig.ServerConfig["Service"];
  readonly continuationRequests?: Parameters<typeof makeAcpAdapterV2>[0]["continuationRequests"];
  /** fx's id for "Default", the model the provider snapshot read from `fx status`. */
  readonly defaultModel?: Effect.Effect<string | undefined>;
  readonly nativeLogging?: Parameters<typeof makeAcpAdapterV2>[0]["nativeLogging"];
  readonly testHooks?: Parameters<typeof makeAcpAdapterV2>[0]["testHooks"];
  /** Replaces the `fx acp` launch (replay tests). fx's session setup still applies. */
  readonly makeRuntime?: (
    input: AcpAdapterV2RuntimeInput,
  ) => Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError,
    Crypto.Crypto | Scope.Scope
  >;
  readonly assertComplete?: Effect.Effect<void, EffectAcpErrors.AcpError>;
}

function makeFxAcpAdapterFlavor(options: FxAdapterV2Options): AcpAdapterV2Flavor {
  const makeRuntime =
    options.makeRuntime ??
    (({ runtimePolicy: _runtimePolicy, processEnvironment, ...input }: AcpAdapterV2RuntimeInput) =>
      makeFxAcpRuntime({
        ...input,
        fxSettings: options.settings,
        childProcessSpawner: options.childProcessSpawner,
        environment: { ...options.environment, ...processEnvironment },
      }));
  return {
    driver: FX_DRIVER_KIND,
    runtimeHarness: "fx",
    capabilities: FxProviderCapabilitiesV2,
    makeRuntime: (input) => makeRuntime(input).pipe(Effect.map(withFxSessionMode)),
    applyModelSelection: ({ runtime, modelSelection }) =>
      applyFxModelSelection(runtime, modelSelection, options.defaultModel).pipe(
        Effect.tap(() => applyFxEffortDefault(runtime, modelSelection)),
      ),
    sessionModeForPolicy: fxSessionModeForPolicy,
    permissionDisposition: fxPermissionDisposition,
    extractSubagentUpdate: extractFxSubagentUpdate,
    ...(options.assertComplete === undefined ? {} : { assertComplete: options.assertComplete }),
  };
}

export function makeFxAdapterV2(options: FxAdapterV2Options) {
  return makeAcpAdapterV2({
    instanceId: options.instanceId,
    flavor: makeFxAcpAdapterFlavor(options),
    crypto: options.crypto,
    fileSystem: options.fileSystem,
    idAllocator: options.idAllocator,
    serverConfig: options.serverConfig,
    selfInvocation: options.selfInvocation,
    ...(options.continuationRequests === undefined
      ? {}
      : { continuationRequests: options.continuationRequests }),
    ...(options.nativeLogging === undefined ? {} : { nativeLogging: options.nativeLogging }),
    ...(options.testHooks === undefined ? {} : { testHooks: options.testHooks }),
  });
}

export type FxAdapterV2DriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | IdAllocator.IdAllocatorV2
  | Path.Path
  | ProviderEventLoggers.ProviderEventLoggers
  | ServerConfig.ServerConfig;

/** `defaultModel` reads fx's id for "Default" from the provider snapshot. */
export const makeFxAdapterV2Driver = (
  defaultModel: Effect.Effect<string | undefined>,
): ProviderAdapterDriver<FxSettings, FxAdapterV2DriverEnv> => ({
  driverKind: FX_DRIVER_KIND,
  configSchema: FxSettings,
  defaultConfig: (): FxSettings => DEFAULT_FX_SETTINGS,
  create: Effect.fn("FxAdapterV2Driver.create")(
    function* (input: ProviderAdapterDriverCreateInput<FxSettings>) {
      const hostEnvironment = yield* HostProcessEnvironment;
      const selfInvocation = yield* resolveSelfInvocation();
      const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const crypto = yield* Crypto.Crypto;
      const fileSystem = yield* FileSystem.FileSystem;
      const idAllocator = yield* IdAllocator.IdAllocatorV2;
      const providerEventLoggers = yield* ProviderEventLoggers.ProviderEventLoggers;
      const serverConfig = yield* ServerConfig.ServerConfig;
      const continuationRequests = yield* ProviderContinuationRequests.ProviderContinuationRequests;
      const makeNativeLogger = yield* makeAcpNativeLoggerFactory();
      return makeFxAdapterV2({
        instanceId: input.instanceId,
        settings: { ...input.config, enabled: input.enabled },
        environment: mergeProviderInstanceEnvironment(input.environment, hostEnvironment),
        childProcessSpawner,
        crypto,
        fileSystem,
        idAllocator,
        serverConfig,
        continuationRequests,
        selfInvocation,
        defaultModel,
        nativeLogging: (threadId) =>
          makeNativeLogger({
            nativeEventLogger: providerEventLoggers.native,
            provider: FX_DRIVER_KIND,
            threadId,
          }),
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterDriverCreateError({
              driver: FX_DRIVER_KIND,
              instanceId: input.instanceId,
              detail: "Failed to create the fx ACP adapter.",
              cause,
            }),
        ),
      ),
  ),
});
