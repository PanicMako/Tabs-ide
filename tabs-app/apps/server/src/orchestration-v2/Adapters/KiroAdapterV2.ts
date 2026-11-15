import { HostProcessEnvironment } from "@tabs/shared/hostProcess";
import { resolveSelfInvocation, type SelfInvocation } from "@tabs/shared/nodeRuntime";
import {
  KiroSettings,
  type ModelSelection,
  ProviderDriverKind,
  type OrchestrationV2ProviderCapabilities,
} from "@tabs/contracts";
import { getModelSelectionStringOptionValue } from "@tabs/shared/model";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";
import type * as EffectAcpSchema from "effect-acp/compat";
import * as EffectAcpErrors from "effect-acp/errors";

import * as ServerConfig from "../../config.ts";
import { makeAcpNativeLoggerFactory } from "../../provider/acp/AcpNativeLogging.ts";
import type * as AcpSessionRuntime from "../../provider/acp/AcpSessionRuntime.ts";
import type { AcpToolCallState } from "../../provider/acp/AcpRuntimeModel.ts";
import {
  KIRO_AGENT_CONFIG_ID,
  KIRO_AUTOPILOT_CONFIG_ID,
  KIRO_DEFAULT_MODEL_SLUG,
  KIRO_EFFORT_CONFIG_ID,
  KIRO_FALLBACK_DEFAULT_MODEL,
  KIRO_MODEL_CONFIG_ID,
  kiroApprovalOptions,
  kiroAutopilotValue,
  kiroPermissionDisposition,
  makeKiroAcpRuntime,
} from "../../provider/acp/KiroAcpSupport.ts";
import { mergeProviderInstanceEnvironment } from "../../provider/ProviderInstanceEnvironment.ts";
import * as ProviderEventLoggers from "../../provider/ProviderEventLoggers.ts";
import * as IdAllocator from "../IdAllocator.ts";
import * as ProviderContinuationRequests from "../ProviderContinuationRequests.ts";
import { makeProviderFailure } from "../ProviderFailure.ts";
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

export const KIRO_PROVIDER = ProviderDriverKind.make("kiro");
const DEFAULT_KIRO_SETTINGS = Schema.decodeSync(KiroSettings)({});

const KiroProviderCapabilitiesV2 = {
  ...AcpProviderCapabilitiesV2,
  sessions: {
    ...AcpProviderCapabilitiesV2.sessions,
    supportsModelSwitchInSession: true,
  },
  // Kiro 2.27 and later fork at a turn's prompt (`_meta.kiro.messageId`); see kiroForkFromTurn.
  threads: {
    ...AcpProviderCapabilitiesV2.threads,
    canForkThread: true,
    canForkFromTurn: true,
  },
  // `_session/steer` waits for the running tool, then Kiro reads the message at its next step.
  turns: {
    ...AcpProviderCapabilitiesV2.turns,
    supportsActiveSteering: true,
    activeSteeringInterruptsTools: false,
    // `_session/steer` takes a string, so a message with images restarts the turn.
    activeSteeringAcceptsAttachments: false,
  },
  tools: {
    ...AcpProviderCapabilitiesV2.tools,
    supportsMcpTools: true,
  },
  subagents: {
    ...AcpProviderCapabilitiesV2.subagents,
    supportsSubagents: true,
    emitsSubagentLifecycle: true,
  },
} satisfies OrchestrationV2ProviderCapabilities;

const KIRO_COMPACT_METHOD = "_kiro/session/compact";
const KIRO_STEER_METHOD = "_session/steer";

const KiroCompactResult = Schema.Struct({ success: Schema.Boolean });
const decodeKiroCompactResult = Schema.decodeUnknownOption(KiroCompactResult);

const decodeKiroExtensionMethods = Schema.decodeUnknownOption(
  Schema.Struct({ kiro: Schema.Struct({ extensionMethods: Schema.Array(Schema.String) }) }),
);

/**
 * Kiro answers a `/compact` prompt as chat, so Tabs compacts with Kiro's own request,
 * on deployments whose `initialize` result lists it among Kiro's extension methods.
 */
const kiroCompactSession = {
  supported: (
    initializeResult: AcpSessionRuntime.AcpSessionRuntimeStartResult["initializeResult"],
  ) =>
    Option.exists(decodeKiroExtensionMethods(initializeResult.agentCapabilities?._meta), (meta) =>
      meta.kiro.extensionMethods.includes(KIRO_COMPACT_METHOD),
    ),
  compact: (runtime: AcpSessionRuntime.AcpSessionRuntime["Service"], sessionId: string) =>
    runtime.request(KIRO_COMPACT_METHOD, { sessionId }).pipe(
      Effect.flatMap((result) =>
        Option.exists(decodeKiroCompactResult(result), (decoded) => decoded.success)
          ? Effect.void
          : Effect.fail(
              new EffectAcpErrors.AcpRequestError({
                code: -32603,
                errorMessage: "Kiro could not compact the conversation.",
                method: KIRO_COMPACT_METHOD,
                data: result,
              }),
            ),
      ),
    ),
};

const KiroSteerResult = Schema.Struct({ queued: Schema.Literal(true), messageId: Schema.String });
const decodeKiroSteerResult = Schema.decodeUnknownOption(KiroSteerResult);
const KiroSteeringInjected = Schema.Struct({
  kiro: Schema.Struct({ kind: Schema.Literal("steering_injected"), messageId: Schema.String }),
});
const decodeKiroSteeringInjected = Schema.decodeUnknownOption(KiroSteeringInjected);

/** Kiro queues a steer, then reports `steering_injected` with its id once the model reads it. */
const kiroSteering = {
  send: (
    runtime: AcpSessionRuntime.AcpSessionRuntime["Service"],
    sessionId: string,
    text: string,
  ) =>
    runtime.request(KIRO_STEER_METHOD, { sessionId, message: text }).pipe(
      Effect.flatMap((result) =>
        Option.match(decodeKiroSteerResult(result), {
          onSome: (decoded) => Effect.succeed(decoded.messageId),
          onNone: () =>
            Effect.fail(
              new EffectAcpErrors.AcpRequestError({
                code: -32603,
                errorMessage: "Kiro did not queue the steering message.",
                method: KIRO_STEER_METHOD,
                data: result,
              }),
            ),
        }),
      ),
    ),
  injectedSteerId: (notification: EffectAcpSchema.SessionNotification) =>
    notification.update.sessionUpdate === "session_info_update"
      ? Option.getOrUndefined(decodeKiroSteeringInjected(notification.update._meta))?.kiro.messageId
      : undefined,
};

const decodeKiroForkCapability = Schema.decodeUnknownOption(
  Schema.Struct({ kiro: Schema.Struct({ messageId: Schema.Literal(true) }) }),
);
const decodeKiroUserMessageId = Schema.decodeUnknownOption(
  Schema.Struct({
    kiro: Schema.Struct({
      kind: Schema.Literal("user_message_id_assigned"),
      userMessageId: Schema.String,
    }),
  }),
);

/**
 * Kiro assigns each prompt a `userMessageId`, and `session/fork` with that id keeps the
 * session up to and including the reply to that prompt.
 */
const kiroForkFromTurn = {
  supported: (
    initializeResult: AcpSessionRuntime.AcpSessionRuntimeStartResult["initializeResult"],
  ) =>
    Option.isSome(
      decodeKiroForkCapability(
        initializeResult.agentCapabilities?.sessionCapabilities?.fork?._meta,
      ),
    ),
  nativeTurnId: (notification: EffectAcpSchema.SessionNotification) =>
    notification.update.sessionUpdate === "session_info_update"
      ? Option.getOrUndefined(decodeKiroUserMessageId(notification.update._meta))?.kiro
          .userMessageId
      : undefined,
  forkMeta: (messageId: string) => ({ kiro: { messageId } }),
};

/**
 * Evidence that Kiro started the current prompt, so Stop's `session/cancel` is
 * honored: a `turn_start` info update or output only a running prompt produces.
 * Kiro doesn't promise `turn_start`, so Stop gives up after KIRO_CANCEL_HOLD_BOUND.
 */
export function isKiroPromptActivity(update: EffectAcpSchema.SessionUpdate): boolean {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
    case "agent_message":
    case "agent_thought_chunk":
    case "agent_thought":
    case "tool_call":
    case "tool_call_update":
    case "tool_call_content_chunk":
    case "plan_update":
      return true;
    case "session_info_update": {
      const kiro = update._meta?.kiro;
      return (
        typeof kiro === "object" && kiro !== null && "kind" in kiro && kiro.kind === "turn_start"
      );
    }
    default:
      return false;
  }
}

/** Past the 0-0.5 s window where TinBane saw cancels dropped, and the 1.5 s cancel they saw honored. */
const KIRO_CANCEL_HOLD_BOUND = "2 seconds";

export interface KiroAdapterV2Options {
  readonly instanceId: Parameters<typeof makeAcpAdapterV2>[0]["instanceId"];
  readonly settings: KiroSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly crypto: Crypto.Crypto;
  readonly selfInvocation: SelfInvocation;
  readonly fileSystem: FileSystem.FileSystem;
  readonly idAllocator: IdAllocator.IdAllocatorV2["Service"];
  readonly serverConfig: ServerConfig.ServerConfig["Service"];
  readonly continuationRequests?: Parameters<typeof makeAcpAdapterV2>[0]["continuationRequests"];
  readonly nativeLogging?: Parameters<typeof makeAcpAdapterV2>[0]["nativeLogging"];
  /**
   * Kiro's id for "Kiro default" (the provider snapshot's `--list-models`
   * default). Absent, it is `auto`.
   */
  readonly defaultModel?: Effect.Effect<string>;
  /** Replaces the `kiro-cli` launch (replay tests). Kiro's session setup still applies. */
  readonly makeRuntime?: (
    input: AcpAdapterV2RuntimeInput,
  ) => Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError,
    Crypto.Crypto | Scope.Scope
  >;
  readonly assertComplete?: Effect.Effect<void, EffectAcpErrors.AcpError>;
  readonly testHooks?: Parameters<typeof makeAcpAdapterV2>[0]["testHooks"];
}

/** Kiro's `model` option once it advertises one. */
const findKiroModelOption = (configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>) =>
  configOptions.find((option) => option.id === KIRO_MODEL_CONFIG_ID || option.category === "model");

/**
 * Kiro selects models only through its `model` config option; "default" is
 * Kiro's own default. The write goes to `model` even before Kiro advertises it,
 * and for unlisted ids: Kiro fails the next prompt on a model it can't use.
 */
const applyKiroModel = Effect.fn("KiroAdapterV2.applyKiroModel")(function* (
  runtime: AcpSessionRuntime.AcpSessionRuntime["Service"],
  modelSelection: ModelSelection,
  defaultModel: Effect.Effect<string>,
  agentSwitched: boolean,
) {
  const modelOption = findKiroModelOption(yield* runtime.getConfigOptions);
  const current = modelOption?.type === "select" ? modelOption.currentValue : undefined;
  const selected = modelSelection.model.trim();
  const isDefault = selected.length === 0 || selected === KIRO_DEFAULT_MODEL_SLUG;
  // Before Kiro advertises `model` the session is new, so it already runs
  // Kiro's default, unless an agent switch just moved it to the agent's model.
  if (isDefault && modelOption?.type !== "select" && !agentSwitched) {
    return current;
  }
  const requested = isDefault ? yield* defaultModel : selected;
  if (requested === current) {
    return current;
  }
  yield* runtime.setConfigOption(modelOption?.id ?? KIRO_MODEL_CONFIG_ID, requested, {
    allowUnlistedValue: true,
  });
  return requested;
});

/**
 * Bound on waiting for Kiro to advertise the model Tabs just wrote. Kiro 2.27.0
 * sent it 40-90 ms after the write's result.
 */
const KIRO_MODEL_ADVERT_BOUND = "2 seconds";

/**
 * Writes the thread's effort to Kiro's `effortLevel` once Kiro advertises the
 * written model, since Kiro ignores the option before then and resets it on a
 * model change. Levels the model doesn't offer are not sent. A rejected write
 * or no advert within the bound keeps Kiro's level rather than failing the turn.
 */
const applyKiroEffort = Effect.fn("KiroAdapterV2.applyKiroEffort")(function* (
  runtime: AcpSessionRuntime.AcpSessionRuntime["Service"],
  modelSelection: ModelSelection,
  appliedModel: string | undefined,
) {
  const requested = getModelSelectionStringOptionValue(modelSelection, "reasoningEffort");
  if (requested === undefined) return;
  const advertised = yield* runtime.configOptionChanges.pipe(
    Stream.filter((configOptions) => {
      const modelOption = findKiroModelOption(configOptions);
      return (
        appliedModel === undefined ||
        (modelOption?.type === "select" && modelOption.currentValue === appliedModel)
      );
    }),
    Stream.runHead,
    Effect.timeoutOption(KIRO_MODEL_ADVERT_BOUND),
    Effect.map(Option.flatten),
  );
  if (Option.isNone(advertised)) {
    return yield* Effect.logWarning("Kiro did not advertise the model's reasoning effort", {
      waitedForWrittenModel: appliedModel !== undefined,
    });
  }
  const effortOption = advertised.value.find((option) => option.id === KIRO_EFFORT_CONFIG_ID);
  if (effortOption?.type !== "select" || !selectValues(effortOption).includes(requested)) {
    return;
  }
  yield* runtime.setConfigOption(KIRO_EFFORT_CONFIG_ID, requested).pipe(
    Effect.catchTags({
      // `requested` is one of the levels Kiro just advertised, so it is safe to log.
      AcpRequestError: (error) =>
        Effect.logWarning("Kiro rejected the reasoning effort", {
          value: requested,
          code: error.code,
        }),
    }),
  );
});

/**
 * Selects the thread's Kiro agent and reports whether a switch went out. It runs
 * before the model write, because switching applies the agent's own model. An
 * agent the session doesn't list is skipped: Kiro would accept it and not switch.
 */
const applyKiroAgent = Effect.fn("KiroAdapterV2.applyKiroAgent")(function* (
  runtime: AcpSessionRuntime.AcpSessionRuntime["Service"],
  modelSelection: ModelSelection,
) {
  const requested = getModelSelectionStringOptionValue(modelSelection, KIRO_AGENT_CONFIG_ID);
  if (requested === undefined) return false;
  const agentOption = (yield* runtime.getConfigOptions).find(
    (option) => option.id === KIRO_AGENT_CONFIG_ID,
  );
  if (agentOption?.type !== "select" || agentOption.currentValue === requested) return false;
  if (!selectValues(agentOption).includes(requested)) {
    yield* Effect.logWarning("Kiro does not list the thread's agent", {
      listedAgents: selectValues(agentOption).length,
    });
    return false;
  }
  yield* runtime.setConfigOption(KIRO_AGENT_CONFIG_ID, requested);
  return true;
});

const applyKiroModelSelection =
  (defaultModel: Effect.Effect<string>): NonNullable<AcpAdapterV2Flavor["applyModelSelection"]> =>
  ({ runtime, modelSelection }) =>
    applyKiroAgent(runtime, modelSelection).pipe(
      Effect.flatMap((agentSwitched) =>
        applyKiroModel(runtime, modelSelection, defaultModel, agentSwitched),
      ),
      Effect.tap((appliedModel) => applyKiroEffort(runtime, modelSelection, appliedModel)),
    );

function selectValues(
  option: Extract<EffectAcpSchema.SessionConfigOption, { readonly type: "select" }>,
): ReadonlyArray<string> {
  return option.options.flatMap((entry) =>
    "value" in entry ? [entry.value] : entry.options.map((choice) => choice.value),
  );
}

const isAcpRequestError = Schema.is(EffectAcpErrors.AcpRequestError);

/**
 * Kiro 2.31 fetches an Identity Center account's cloud config as a tool call
 * of its own around session start (reported by @hstern), which can land inside
 * the user's turn. Only the call carries this id; its updates name the call.
 */
const KIRO_CLOUD_CONFIG_TOOL_ID = "fetch_cloud_config";

/** Drops Kiro's cloud-config tool call and every update that follows it. */
export function makeKiroCloudConfigFilter() {
  const running = new Set<string>();
  return (notification: EffectAcpSchema.SessionNotification): boolean => {
    const { update } = notification;
    if (
      update.sessionUpdate !== "tool_call" &&
      update.sessionUpdate !== "tool_call_update" &&
      update.sessionUpdate !== "tool_call_content_chunk"
    ) {
      return false;
    }
    const key = `${notification.sessionId}\n${update.toolCallId}`;
    const kiro = update._meta?.kiro;
    const toolId =
      typeof kiro === "object" && kiro !== null && "toolId" in kiro ? kiro.toolId : null;
    if (toolId === KIRO_CLOUD_CONFIG_TOOL_ID) running.add(key);
    else if (!running.has(key)) return false;
    if ("status" in update && (update.status === "completed" || update.status === "failed")) {
      running.delete(key);
    }
    return true;
  };
}

const KIRO_STEERING_NOTE = "[STEERING steer-";
const decodeKiroSteeringInfo = Schema.decodeUnknownOption(
  Schema.Struct({ kiro: Schema.Struct({ kind: Schema.String }) }),
);

/** Length of the longest end of `text` that could still grow into the steering note. */
function steeringNotePrefixLength(text: string): number {
  for (let length = Math.min(text.length, KIRO_STEERING_NOTE.length - 1); length > 0; length -= 1) {
    if (KIRO_STEERING_NOTE.startsWith(text.slice(-length))) return length;
  }
  return 0;
}

/**
 * After an injected steer, Kiro's model ends its reply with a `[STEERING steer-…: …]`
 * note meant for Kiro's own UI. This drops it from the streamed text, holding back a
 * chunk end that may be the start of the note until the next chunk shows otherwise.
 */
export function makeKiroSteeringNoteFilter() {
  const sessions = new Map<string, { held: string; inNote: boolean }>();
  return (
    notification: EffectAcpSchema.SessionNotification,
  ): EffectAcpSchema.SessionNotification => {
    const { update } = notification;
    if (update.sessionUpdate === "session_info_update") {
      const kind = Option.getOrUndefined(decodeKiroSteeringInfo(update._meta))?.kiro.kind;
      if (kind === "steering_injected") {
        sessions.set(notification.sessionId, { held: "", inNote: false });
      } else if (kind === "steering_cleared") sessions.delete(notification.sessionId);
      return notification;
    }
    const state = sessions.get(notification.sessionId);
    if (
      state === undefined ||
      update.sessionUpdate !== "agent_message_chunk" ||
      update.content.type !== "text"
    ) {
      return notification;
    }
    let pending = state.held + update.content.text;
    let visible = "";
    state.held = "";
    while (pending.length > 0) {
      if (state.inNote) {
        const end = pending.indexOf("]");
        if (end < 0) break;
        pending = pending.slice(end + 1);
        state.inNote = false;
        continue;
      }
      const start = pending.indexOf(KIRO_STEERING_NOTE);
      if (start >= 0) {
        visible += pending.slice(0, start).trimEnd();
        pending = pending.slice(start + KIRO_STEERING_NOTE.length);
        state.inNote = true;
        continue;
      }
      const held = steeringNotePrefixLength(pending);
      visible += pending.slice(0, pending.length - held);
      state.held = pending.slice(pending.length - held);
      break;
    }
    return {
      ...notification,
      update: { ...update, content: { ...update.content, text: visible } },
    };
  };
}

const decodeKiroAgentSubtask = Schema.decodeUnknownOption(
  Schema.Struct({
    kiro: Schema.Struct({ agentSubtaskId: Schema.String, kind: Schema.optionalKey(Schema.String) }),
  }),
);
const decodeKiroSubagentInput = Schema.decodeUnknownOption(
  Schema.Struct({ name: Schema.String, prompt: Schema.String }),
);

/**
 * Kiro runs sub-agents inside the parent's session: frames from an
 * `invoke_sub_agent` call carry `_meta.kiro.agentSubtaskId`, and routing them
 * to that id as their session gives the shared adapter the child to project.
 */
function normalizeKiroSessionUpdate(
  notification: EffectAcpSchema.SessionNotification,
): EffectAcpSchema.SessionNotification {
  const { update } = notification;
  const subtask = decodeKiroAgentSubtask("_meta" in update ? update._meta : undefined);
  return Option.isSome(subtask) && subtask.value.kiro.kind !== "agent-subtask"
    ? { ...notification, sessionId: subtask.value.kiro.agentSubtaskId }
    : notification;
}

/** The `invoke_sub_agent` call; it completes with the sub-agent's final response. */
function extractKiroSubagentUpdate(tool: AcpToolCallState): AcpAdapterV2SubagentUpdate | undefined {
  const subtask = decodeKiroAgentSubtask(tool.data.meta);
  if (Option.isNone(subtask) || subtask.value.kiro.kind !== "agent-subtask") return undefined;
  const input = decodeKiroSubagentInput(tool.data.rawInput);
  const status =
    tool.status === "failed" ? "failed" : tool.status === "completed" ? "completed" : "running";
  return {
    nativeTaskId: tool.toolCallId,
    childSessionId: subtask.value.kiro.agentSubtaskId,
    prompt: Option.isSome(input) ? input.value.prompt : (tool.title ?? "Kiro sub-agent"),
    title: Option.isSome(input) ? input.value.name : null,
    model: null,
    status,
    result: typeof tool.data.rawOutput === "string" ? tool.data.rawOutput : null,
  };
}

/**
 * Kiro's prompt errors carry a message meant for the user (live 2.27: -32000
 * "The model 'x' is not available. Please select a different model and try
 * again. (Request ID: …)"). Show it instead of the generic failure text;
 * makeProviderFailure bounds and redacts it.
 */
function kiroPromptFailure(cause: unknown) {
  return makeProviderFailure({
    cause,
    ...(isAcpRequestError(cause) ? { message: cause.errorMessage, code: String(cause.code) } : {}),
    class: "provider_error",
  });
}

function makeKiroAcpAdapterFlavor(options: KiroAdapterV2Options): AcpAdapterV2Flavor {
  const makeRuntime =
    options.makeRuntime ??
    ((input: AcpAdapterV2RuntimeInput) => {
      const { runtimePolicy: _runtimePolicy, processEnvironment, ...runtimeInput } = input;
      return makeKiroAcpRuntime({
        ...runtimeInput,
        settings: options.settings,
        childProcessSpawner: options.childProcessSpawner,
        environment: { ...options.environment, ...processEnvironment },
      });
    });
  const stripSteeringNote = makeKiroSteeringNoteFilter();
  return {
    driver: KIRO_PROVIDER,
    runtimeHarness: "Kiro",
    capabilities: KiroProviderCapabilitiesV2,
    // Kiro V3 loads the user's hooks only when the client opts in. `v2` makes
    // Kiro run them itself; `enabled` alone hands them to the client as
    // `_kiro/hooks/*` requests, which Tabs does not answer.
    clientCapabilitiesMeta: { kiro: { hooks: { enabled: true, v2: true } } },
    makeRuntime,
    promptFailure: kiroPromptFailure,
    ignoreSessionUpdate: makeKiroCloudConfigFilter(),
    normalizeSessionUpdate: (notification) =>
      stripSteeringNote(normalizeKiroSessionUpdate(notification)),
    extractSubagentUpdate: extractKiroSubagentUpdate,
    // See applyKiroModelSelection: `model` arrives after session/new.
    modelOptionArrivesLate: true,
    applyModelSelection: applyKiroModelSelection(
      options.defaultModel ?? Effect.succeed(KIRO_FALLBACK_DEFAULT_MODEL),
    ),
    // The generic option loop runs after the model write, and an agent write
    // there would put the agent's own model back.
    ownedModelOptionIds: ["reasoningEffort", KIRO_AGENT_CONFIG_ID],
    // With Autopilot off (Supervised) Kiro asks the user to accept a turn's
    // changes before it ends. The runtime policy answers its per-tool prompts
    // either way, and a runtime-mode change reopens the session to reapply it.
    sessionConfigForPolicy: (policy) => [
      { id: KIRO_AUTOPILOT_CONFIG_ID, value: kiroAutopilotValue(policy) },
    ],
    // See isKiroPromptActivity: Kiro 2.27.1 can drop a cancel sent just after
    // `session/prompt` and run the turn to completion.
    cancelAfterPromptStarts: { isStart: isKiroPromptActivity, bound: KIRO_CANCEL_HOLD_BOUND },
    compactSession: kiroCompactSession,
    steering: kiroSteering,
    forkFromTurn: kiroForkFromTurn,
    permissionDisposition: kiroPermissionDisposition,
    approvalOptions: kiroApprovalOptions,
    ...(options.assertComplete === undefined ? {} : { assertComplete: options.assertComplete }),
  };
}

export function makeKiroAdapterV2(options: KiroAdapterV2Options) {
  return makeAcpAdapterV2({
    instanceId: options.instanceId,
    flavor: makeKiroAcpAdapterFlavor(options),
    crypto: options.crypto,
    fileSystem: options.fileSystem,
    idAllocator: options.idAllocator,
    serverConfig: options.serverConfig,
    selfInvocation: options.selfInvocation,
    ...(options.nativeLogging === undefined ? {} : { nativeLogging: options.nativeLogging }),
    ...(options.continuationRequests === undefined
      ? {}
      : { continuationRequests: options.continuationRequests }),
    ...(options.testHooks === undefined ? {} : { testHooks: options.testHooks }),
  });
}

export type KiroAdapterV2DriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | IdAllocator.IdAllocatorV2
  | Path.Path
  | ProviderEventLoggers.ProviderEventLoggers
  | ServerConfig.ServerConfig;

/** `defaultModel` reads Kiro's id for "Kiro default" from the provider snapshot. */
export const makeKiroAdapterV2Driver = (
  defaultModel: Effect.Effect<string>,
): ProviderAdapterDriver<KiroSettings, KiroAdapterV2DriverEnv> => ({
  driverKind: KIRO_PROVIDER,
  configSchema: KiroSettings,
  defaultConfig: (): KiroSettings => DEFAULT_KIRO_SETTINGS,
  create: Effect.fn("KiroAdapterV2Driver.create")(
    function* (input: ProviderAdapterDriverCreateInput<KiroSettings>) {
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
      return makeKiroAdapterV2({
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
        defaultModel,
        nativeLogging: (threadId) =>
          makeNativeLogger({
            nativeEventLogger: providerEventLoggers.native,
            provider: KIRO_PROVIDER,
            threadId,
          }),
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterDriverCreateError({
              driver: KIRO_PROVIDER,
              instanceId: input.instanceId,
              detail: "Failed to create Kiro ACP adapter.",
              cause,
            }),
        ),
      ),
  ),
});
