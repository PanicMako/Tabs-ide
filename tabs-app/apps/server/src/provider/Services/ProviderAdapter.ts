/**
 * ProviderAdapter - Provider-specific runtime adapter contract.
 *
 * Defines the provider-native session/protocol operations that `ProviderService`
 * routes to after resolving the target provider. Implementations should focus
 * on provider behavior only and avoid cross-provider orchestration concerns.
 *
 * @module ProviderAdapter
 */
import type {
  ApprovalRequestId,
  ProviderApprovalDecision,
  ProviderDriverKind,
  ProviderUserInputAnswers,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
  ThreadId,
  ProviderTurnStartResult,
  TurnId,
} from "@tabs/contracts";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

export interface ProviderModelDescriptor {
  readonly slug: string;
  readonly name: string;
  readonly resolvedModel?: string;
  readonly optionDescriptors?: ReadonlyArray<unknown>;
  readonly supportsAutoMode?: boolean;
}

export interface ProviderListModelsResult {
  readonly models: ReadonlyArray<ProviderModelDescriptor>;
  readonly source?: string;
  readonly cached?: boolean;
}

export type ProviderSessionModelSwitchMode = "in-session" | "unsupported";

/**
 * How ProviderService runs manual context compaction for an adapter.
 * Native adapters expose a start call and must emit a compacted thread state
 * when they finish. Slash-command adapters get the command sent as a turn.
 */
export type ProviderCompaction<TError> =
  | {
      readonly type: "native";
      readonly start: (
        threadId: ThreadId,
        modelSelection?: ProviderSendTurnInput["modelSelection"],
      ) => Effect.Effect<void, TError>;
    }
  | { readonly type: "slash-command"; readonly command: `/${string}` };

export interface ProviderAdapterCapabilities {
  /**
   * Declares whether changing the model on an existing session is supported.
   */
  readonly sessionModelSwitch: ProviderSessionModelSwitchMode;
  /**
   * When set to `"unsupported"`, this provider instance does not support
   * interactive Agent Chat (sendTurn / startSession). It is a text-generation-
   * only driver (e.g. Google Gemini for Code Review). The Agents tab uses this
   * flag to filter the provider out of its selectable-provider list.
   */
  readonly agentChat?: "unsupported";
}

export interface ProviderThreadTurnSnapshot {
  readonly id: TurnId;
  readonly items: ReadonlyArray<unknown>;
}

export interface ProviderThreadSnapshot {
  readonly threadId: ThreadId;
  readonly turns: ReadonlyArray<ProviderThreadTurnSnapshot>;
}

export interface ProviderAdapterShape<TError> {
  /**
   * Provider kind implemented by this adapter.
   */
  readonly provider: ProviderDriverKind;
  readonly capabilities: ProviderAdapterCapabilities;

  readonly listModels?: (input: {
    readonly cwd?: string;
    readonly binaryPath?: string;
  }) => Effect.Effect<ProviderListModelsResult, TError>;

  /**
   * Start a provider-backed session.
   */
  readonly startSession: (
    input: ProviderSessionStartInput,
  ) => Effect.Effect<ProviderSession, TError>;

  /**
   * Send a turn to an active provider session.
   */
  readonly sendTurn: (
    input: ProviderSendTurnInput,
  ) => Effect.Effect<ProviderTurnStartResult, TError>;

  /** Omitted when this adapter does not support manual context compaction. */
  readonly compaction?: ProviderCompaction<TError>;

  /**
   * Interrupt an active turn.
   */
  readonly interruptTurn: (
    threadId: ThreadId,
    turnId?: TurnId,
    providerThreadId?: string,
  ) => Effect.Effect<void, TError>;

  readonly steerTurn?: (input: any) => Effect.Effect<ProviderTurnStartResult, TError>;
  readonly stopTask?: (threadId: ThreadId, taskId: string) => Effect.Effect<void, TError>;
  readonly backgroundTask?: (threadId: ThreadId, toolUseId: string) => Effect.Effect<void, TError>;
  readonly steerSubagent?: (
    threadId: ThreadId,
    providerThreadId: string,
    input: any,
  ) => Effect.Effect<void, TError>;
  readonly listSkills?: (input: any) => Effect.Effect<any, TError>;
  readonly listCommands?: (input: any) => Effect.Effect<any, TError>;
  readonly listAgents?: (input: any) => Effect.Effect<any, TError>;
  readonly getComposerCapabilities?: () => Effect.Effect<any, TError>;

  /**
   * Respond to an interactive approval request.
   */
  readonly respondToRequest: (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Effect.Effect<void, TError>;

  /**
   * Respond to a structured user-input request.
   */
  readonly respondToUserInput: (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers,
  ) => Effect.Effect<void, TError>;

  /**
   * Stop one provider session.
   */
  readonly stopSession: (threadId: ThreadId) => Effect.Effect<void, TError>;

  /**
   * List currently active provider sessions for this adapter.
   */
  readonly listSessions: () => Effect.Effect<ReadonlyArray<ProviderSession>>;

  /**
   * Check whether this adapter owns an active session id.
   */
  readonly hasSession: (threadId: ThreadId) => Effect.Effect<boolean>;

  /**
   * Read a provider thread snapshot.
   */
  readonly readThread: (threadId: ThreadId) => Effect.Effect<ProviderThreadSnapshot, TError>;

  /**
   * Roll back a provider thread by N turns.
   */
  readonly rollbackThread: (
    threadId: ThreadId,
    numTurns: number,
  ) => Effect.Effect<ProviderThreadSnapshot, TError>;

  /**
   * Stop all sessions owned by this adapter.
   */
  readonly stopAll: () => Effect.Effect<void, TError>;

  /**
   * Canonical runtime event stream emitted by this adapter.
   */
  readonly streamEvents: Stream.Stream<ProviderRuntimeEvent>;
}
