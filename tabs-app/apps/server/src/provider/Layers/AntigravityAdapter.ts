import {
  ApprovalRequestId,
  type AntigravitySettings,
  EventId,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderUserInputAnswers,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeRequestId,
  RuntimeTaskId,
  type ThreadId,
  TurnId,
} from "@tabs/contracts";
import { randomUUID as nodeRandomUUID } from "node:crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import { resolveAttachmentPath } from "../../attachmentStore";
import { ServerConfig } from "../../config";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors";
import { mapAcpToAdapterError } from "../acp/AcpAdapterSupport";
import { type AcpSessionRuntimeShape } from "../acp/AcpSessionRuntime";
import {
  makeAcpAssistantItemEvent,
  makeAcpContentDeltaEvent,
  makeAcpPlanUpdatedEvent,
  makeAcpRequestOpenedEvent,
  makeAcpRequestResolvedEvent,
  makeAcpToolCallEvent,
} from "../acp/AcpCoreRuntimeEvents";
import { parsePermissionRequest } from "../acp/AcpRuntimeModel";
import { makeAcpNativeLoggerFactory } from "../acp/AcpNativeLogging";
import {
  antigravityApprovalOptions,
  extractAntigravityUserInputQuestion,
  isAntigravityUserInputRequest,
  classifyAntigravitySubagentToolCall,
  antigravitySubagentOutput,
  makeAntigravityUserInputResponse,
  normalizeAntigravityToolCall,
  planAntigravitySubagentUpdate,
  selectAntigravityPermissionOptionId,
} from "../acp/AntigravityProtocol";
import {
  antigravityPermissionMode,
  applyAntigravityAcpModelSelection,
  buildAntigravityPrompt,
  currentAntigravityModelIdFromSessionSetup,
  discoverAntigravityAcpModels,
  makeAntigravityAcpRuntime,
  resolveAntigravityAcpBaseModelId,
} from "../acp/AntigravityAcpSupport";
import { type AntigravityAdapterShape } from "../Services/AntigravityAdapter";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger";

const encodeUnknownJsonStringExit = Schema.encodeUnknownExit(Schema.UnknownFromJsonString);

const PROVIDER = "antigravity" as ProviderDriverKind;
const ANTIGRAVITY_RESUME_VERSION = 1 as const;

function encodeJsonStringForDiagnostics(input: unknown): string | undefined {
  const result = encodeUnknownJsonStringExit(input);
  return Exit.isSuccess(result) ? result.value : undefined;
}

export interface AntigravityAdapterLiveOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
  readonly instanceId?: ProviderInstanceId;
  readonly defaultCwd?: string;
  readonly attachmentsDir?: string;
  readonly isModelAdvertised?: (modelId: string) => Effect.Effect<boolean, never, never>;
}

interface PendingApproval {
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
}

type PendingUserInputResolution =
  | { readonly _tag: "answered"; readonly answers: ProviderUserInputAnswers }
  | { readonly _tag: "cancelled" };

interface PendingUserInput {
  readonly resolution: Deferred.Deferred<PendingUserInputResolution>;
}

interface AntigravitySessionContext {
  readonly threadId: ThreadId;
  readonly acpSessionId: string;
  session: ProviderSession;
  readonly scope: Scope.Closeable;
  readonly acp: AcpSessionRuntimeShape;
  notificationFiber: Fiber.Fiber<void, never> | undefined;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
  turns: Array<{ id: TurnId; items: Array<unknown> }>;
  lastPlanFingerprint: string | undefined;
  activeTurnId: TurnId | undefined;
  currentModelId: string | undefined;
  readonly subagentStates: Map<string, "active" | "finished">;
  stopped: boolean;
}

function settlePendingApprovalsAsCancelled(
  pendingApprovals: ReadonlyMap<ApprovalRequestId, PendingApproval>,
): Effect.Effect<void> {
  return Effect.forEach(
    Array.from(pendingApprovals.values()),
    (pending) => Deferred.succeed(pending.decision, "cancel").pipe(Effect.ignore),
    { discard: true },
  );
}

function settlePendingUserInputsAsCancelled(
  pendingUserInputs: ReadonlyMap<ApprovalRequestId, PendingUserInput>,
): Effect.Effect<void> {
  return Effect.forEach(
    Array.from(pendingUserInputs.values()),
    (pending) => Deferred.succeed(pending.resolution, { _tag: "cancelled" }).pipe(Effect.ignore),
    { discard: true },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAntigravityResume(raw: unknown): { sessionId: string } | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.schemaVersion !== ANTIGRAVITY_RESUME_VERSION) return undefined;
  if (typeof raw.sessionId !== "string" || !raw.sessionId.trim()) return undefined;
  return { sessionId: raw.sessionId.trim() };
}

export function makeAntigravityAdapter(
  antigravitySettings: AntigravitySettings,
  options?: AntigravityAdapterLiveOptions,
): Effect.Effect<
  AntigravityAdapterShape,
  never,
  | Scope.Scope
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | ServerConfig
> {
  return Effect.gen(function* () {
    const boundInstanceId = options?.instanceId ?? ("antigravity" as ProviderInstanceId);
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const serverConfig = yield* Effect.service(ServerConfig);
    const nativeEventLogger =
      options?.nativeEventLogger ??
      (options?.nativeEventLogPath !== undefined
        ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, { stream: "native" })
        : undefined);
    const makeAcpNativeLoggers = yield* makeAcpNativeLoggerFactory();

    const sessions = new Map<ThreadId, AntigravitySessionContext>();
    const threadLocksRef = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());
    const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();

    const validateAdvertisedModel = (
      modelId: string | undefined,
      operation: string,
    ): Effect.Effect<void, ProviderAdapterValidationError> =>
      !modelId || !options?.isModelAdvertised
        ? Effect.void
        : options.isModelAdvertised(modelId).pipe(
            Effect.flatMap((advertised) =>
              advertised
                ? Effect.void
                : Effect.fail(
                    new ProviderAdapterValidationError({
                      provider: PROVIDER,
                      operation,
                      issue: `Antigravity model '${modelId}' is not in the current account catalog. Refresh providers and select an advertised model.`,
                    }),
                  ),
            ),
          );

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const randomUUIDv4 = Effect.sync(() => nodeRandomUUID()).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "crypto/randomUUIDv4",
            detail: "Failed to generate Antigravity runtime identifier.",
            cause,
          }),
      ),
    );
    const nextEventId = Effect.map(randomUUIDv4, (id) => id as EventId);
    const makeEventStamp = () => Effect.all({ eventId: nextEventId, createdAt: nowIso });
    const mapAcpCallbackFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new EffectAcpErrors.AcpTransportError({
              detail: "Failed to process Antigravity ACP callback.",
              cause,
            }),
        ),
      );

    const offerRuntimeEvent = (event: ProviderRuntimeEvent) =>
      PubSub.publish(runtimeEventPubSub, event).pipe(Effect.asVoid);

    const getThreadSemaphore = (threadId: string) =>
      SynchronizedRef.modifyEffect(threadLocksRef, (current) => {
        const existing: Option.Option<Semaphore.Semaphore> = Option.fromNullishOr(
          current.get(threadId),
        );
        return Option.match(existing, {
          onNone: () =>
            Semaphore.make(1).pipe(
              Effect.map((semaphore) => {
                const next = new Map(current);
                next.set(threadId, semaphore);
                return [semaphore, next] as const;
              }),
            ),
          onSome: (semaphore) => Effect.succeed([semaphore, current] as const),
        });
      });

    const withThreadLock = <A, E, R>(threadId: string, effect: Effect.Effect<A, E, R>) =>
      Effect.flatMap(getThreadSemaphore(threadId), (semaphore) => semaphore.withPermit(effect));

    const logNative = (threadId: ThreadId, method: string, payload: unknown) =>
      Effect.gen(function* () {
        if (!nativeEventLogger) return;
        const observedAt = yield* nowIso;
        yield* nativeEventLogger.write(
          {
            observedAt,
            event: {
              id: yield* randomUUIDv4,
              kind: "notification",
              provider: PROVIDER,
              createdAt: observedAt,
              method,
              threadId,
              payload,
            },
          },
          threadId,
        );
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Failed to write native Antigravity notification log.", {
            cause,
            threadId,
            method,
          }),
        ),
      );

    const emitPlanUpdate = (
      ctx: AntigravitySessionContext,
      payload: {
        readonly explanation?: string | null;
        readonly plan: ReadonlyArray<{
          readonly step: string;
          readonly status: "pending" | "inProgress" | "completed";
        }>;
      },
      rawPayload: unknown,
      method: string,
    ) =>
      Effect.gen(function* () {
        const fingerprint = `${ctx.activeTurnId ?? "no-turn"}:${encodeJsonStringForDiagnostics(payload) ?? "[unserializable payload]"}`;
        if (ctx.lastPlanFingerprint === fingerprint) {
          return;
        }
        ctx.lastPlanFingerprint = fingerprint;
        yield* offerRuntimeEvent(
          makeAcpPlanUpdatedEvent({
            stamp: yield* makeEventStamp(),
            provider: PROVIDER,
            threadId: ctx.threadId,
            turnId: ctx.activeTurnId,
            payload,
            source: "acp.jsonrpc",
            method,
            rawPayload,
          }),
        );
      });

    const requireSession = (
      threadId: ThreadId,
    ): Effect.Effect<AntigravitySessionContext, ProviderAdapterSessionNotFoundError> => {
      const ctx = sessions.get(threadId);
      if (!ctx || ctx.stopped) {
        return Effect.fail(
          new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }),
        );
      }
      return Effect.succeed(ctx);
    };

    const stopSessionInternal = (ctx: AntigravitySessionContext) =>
      Effect.gen(function* () {
        if (ctx.stopped) return;
        ctx.stopped = true;
        yield* settlePendingApprovalsAsCancelled(ctx.pendingApprovals);
        yield* settlePendingUserInputsAsCancelled(ctx.pendingUserInputs);
        if (ctx.notificationFiber) {
          yield* Fiber.interrupt(ctx.notificationFiber);
        }
        yield* Effect.ignore(Scope.close(ctx.scope, Exit.void));
        sessions.delete(ctx.threadId);
        yield* offerRuntimeEvent({
          type: "session.exited",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: ctx.threadId,
          payload: { exitKind: "graceful" },
        });
      });

    const startSession: AntigravityAdapterShape["startSession"] = (input) =>
      withThreadLock(
        input.threadId,
        Effect.gen(function* () {
          if (input.provider !== undefined && input.provider !== PROVIDER) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
            });
          }
          if (!input.cwd?.trim()) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: "cwd is required and must be non-empty.",
            });
          }

          const cwd = path.resolve(input.cwd.trim());
          const antigravityModelSelection =
            input.modelSelection?.instanceId === boundInstanceId ? input.modelSelection : undefined;
          const existing = sessions.get(input.threadId);
          if (existing && !existing.stopped) {
            yield* stopSessionInternal(existing);
          }

          const pendingApprovals = new Map<ApprovalRequestId, PendingApproval>();
          const pendingUserInputs = new Map<ApprovalRequestId, PendingUserInput>();
          const sessionScope = yield* Scope.make("sequential");
          let sessionScopeTransferred = false;
          yield* Effect.addFinalizer(() =>
            sessionScopeTransferred ? Effect.void : Scope.close(sessionScope, Exit.void),
          );

          const resumeSessionId = parseAntigravityResume(input.resumeCursor)?.sessionId;
          const acpNativeLoggers = makeAcpNativeLoggers({
            nativeEventLogger,
            provider: PROVIDER,
            threadId: input.threadId,
          });

          const acp = yield* makeAntigravityAcpRuntime({
            antigravitySettings,
            ...(options?.environment ? { environment: options.environment } : {}),
            childProcessSpawner,
            cwd,
            clientFileSystem: true,
            profileDirectory: path.join(
              serverConfig.baseDir,
              "providers",
              "antigravity",
              boundInstanceId,
            ),
            ...(resumeSessionId ? { resumeSessionId } : {}),
            clientInfo: { name: "tabs-ide", version: "0.0.0" },
            ...acpNativeLoggers,
          }).pipe(
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.provideService(Path.Path, path),
            Effect.provideService(Scope.Scope, sessionScope),
            Effect.mapError(
              (cause) =>
                new ProviderAdapterProcessError({
                  provider: PROVIDER,
                  threadId: input.threadId,
                  detail: cause.message,
                  cause,
                }),
            ),
          );

          const started = yield* Effect.gen(function* () {
            yield* acp.handleRequestPermission((params) =>
              mapAcpCallbackFailure(
                Effect.gen(function* () {
                  yield* logNative(input.threadId, "session/request_permission", params);
                  // AG-002: Distinguish native Antigravity interaction questions from security approvals.
                  if (isAntigravityUserInputRequest(params)) {
                    const question = extractAntigravityUserInputQuestion(params);
                    if (!question) {
                      return {
                        outcome: { outcome: "cancelled" },
                      } satisfies EffectAcpSchema.RequestPermissionResponse;
                    }
                    const requestId = (yield* randomUUIDv4) as ApprovalRequestId;
                    const runtimeRequestId = requestId as unknown as RuntimeRequestId;
                    const resolution = yield* Deferred.make<PendingUserInputResolution>();
                    pendingUserInputs.set(requestId, { resolution });
                    yield* offerRuntimeEvent({
                      type: "user-input.requested",
                      ...(yield* makeEventStamp()),
                      provider: PROVIDER,
                      threadId: input.threadId,
                      turnId: sessions.get(input.threadId)?.activeTurnId,
                      requestId: runtimeRequestId,
                      payload: {
                        questions: [question],
                      },
                      raw: {
                        source: "acp.jsonrpc",
                        method: "session/request_permission",
                        payload: params,
                      },
                    });
                    const resolved = yield* Deferred.await(resolution);
                    pendingUserInputs.delete(requestId);
                    const answers = resolved._tag === "answered" ? resolved.answers : {};
                    yield* offerRuntimeEvent({
                      type: "user-input.resolved",
                      ...(yield* makeEventStamp()),
                      provider: PROVIDER,
                      threadId: input.threadId,
                      turnId: sessions.get(input.threadId)?.activeTurnId,
                      requestId: runtimeRequestId,
                      payload: { answers },
                      raw: {
                        source: "acp.jsonrpc",
                        method: "session/request_permission",
                        payload: params,
                      },
                    });
                    const response = makeAntigravityUserInputResponse(params, answers);
                    return (
                      response ??
                      ({
                        outcome: { outcome: "cancelled" },
                      } satisfies EffectAcpSchema.RequestPermissionResponse)
                    );
                  }

                  if (input.runtimeMode === "full-access") {
                    const autoOptionId =
                      selectAntigravityPermissionOptionId(params, "acceptForSession") ??
                      selectAntigravityPermissionOptionId(params, "accept");
                    if (autoOptionId) {
                      return {
                        outcome: {
                          outcome: "selected",
                          optionId: autoOptionId,
                        },
                      } satisfies EffectAcpSchema.RequestPermissionResponse;
                    }
                  }

                  const permissionRequest = parsePermissionRequest(params);
                  // AG-004: Surface native prompt injection warnings on approval options.
                  const approvalOptions = antigravityApprovalOptions(params);
                  const requestId = (yield* randomUUIDv4) as ApprovalRequestId;
                  const runtimeRequestId = requestId as unknown as RuntimeRequestId;
                  const decisionDeferred = yield* Deferred.make<ProviderApprovalDecision>();
                  pendingApprovals.set(requestId, { decision: decisionDeferred });

                  yield* offerRuntimeEvent(
                    makeAcpRequestOpenedEvent({
                      stamp: yield* makeEventStamp(),
                      provider: PROVIDER,
                      threadId: input.threadId,
                      turnId: sessions.get(input.threadId)?.activeTurnId,
                      requestId: runtimeRequestId,
                      permissionRequest,
                      options: approvalOptions,
                      detail:
                        permissionRequest.detail ??
                        encodeJsonStringForDiagnostics(params)?.slice(0, 2000) ??
                        "[unserializable params]",
                      args: params,
                      source: "acp.jsonrpc",
                      method: "session/request_permission",
                      rawPayload: params,
                    }),
                  );

                  const decision = yield* Deferred.await(decisionDeferred);
                  pendingApprovals.delete(requestId);
                  yield* offerRuntimeEvent(
                    makeAcpRequestResolvedEvent({
                      stamp: yield* makeEventStamp(),
                      provider: PROVIDER,
                      threadId: input.threadId,
                      turnId: sessions.get(input.threadId)?.activeTurnId,
                      requestId: runtimeRequestId,
                      permissionRequest,
                      decision,
                    }),
                  );

                  if (decision === "cancel") {
                    return {
                      outcome: { outcome: "cancelled" },
                    } satisfies EffectAcpSchema.RequestPermissionResponse;
                  }

                  const optionId = selectAntigravityPermissionOptionId(params, decision);
                  if (!optionId) {
                    return {
                      outcome: { outcome: "cancelled" },
                    } satisfies EffectAcpSchema.RequestPermissionResponse;
                  }

                  return {
                    outcome: {
                      outcome: "selected",
                      optionId,
                    },
                  } satisfies EffectAcpSchema.RequestPermissionResponse;
                }),
              ),
            );

            yield* acp.handleReadTextFile((params) =>
              mapAcpCallbackFailure(
                Effect.gen(function* () {
                  yield* logNative(input.threadId, "fs/read_text_file", params);
                  const targetPath = path.isAbsolute(params.path)
                    ? params.path
                    : path.resolve(cwd, params.path);
                  const content = yield* fileSystem.readFileString(targetPath);
                  return { content };
                }),
              ),
            );

            yield* acp.handleWriteTextFile((params) =>
              mapAcpCallbackFailure(
                Effect.gen(function* () {
                  yield* logNative(input.threadId, "fs/write_text_file", params);
                  const targetPath = path.isAbsolute(params.path)
                    ? params.path
                    : path.resolve(cwd, params.path);
                  yield* fileSystem.writeFileString(targetPath, params.content);
                  return {};
                }),
              ),
            );

            return yield* acp
              .start()
              .pipe(
                Effect.mapError((cause) =>
                  mapAcpToAdapterError(PROVIDER, input.threadId, "session/start", cause),
                ),
              );
          });

          yield* acp
            .setMode(antigravityPermissionMode(input.runtimeMode))
            .pipe(
              Effect.mapError((cause) =>
                mapAcpToAdapterError(PROVIDER, input.threadId, "session/set_mode", cause),
              ),
            );

          let currentModelId = currentAntigravityModelIdFromSessionSetup(
            started.sessionSetupResult,
          );
          if (antigravityModelSelection?.model) {
            const requestedModelId = resolveAntigravityAcpBaseModelId(
              antigravityModelSelection.model,
            );
            yield* validateAdvertisedModel(requestedModelId, "session/start");
            currentModelId = yield* applyAntigravityAcpModelSelection({
              runtime: acp,
              model: requestedModelId,
              mapError: (cause) =>
                mapAcpToAdapterError(PROVIDER, input.threadId, "session/set_model", cause),
            });
          }

          const startedAt = yield* nowIso;
          const session: ProviderSession = {
            threadId: input.threadId,
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            status: "ready",
            runtimeMode: input.runtimeMode,
            cwd,
            ...(currentModelId ? { model: currentModelId } : {}),
            createdAt: startedAt,
            updatedAt: startedAt,
            resumeCursor: {
              schemaVersion: ANTIGRAVITY_RESUME_VERSION,
              sessionId: started.sessionId,
            },
          };

          const ctx: AntigravitySessionContext = {
            threadId: input.threadId,
            acpSessionId: started.sessionId,
            session,
            scope: sessionScope,
            acp,
            notificationFiber: undefined,
            pendingApprovals,
            pendingUserInputs,
            turns: [],
            lastPlanFingerprint: undefined,
            activeTurnId: undefined,
            currentModelId,
            subagentStates: new Map(),
            stopped: false,
          };

          ctx.notificationFiber = yield* Stream.runForEach(acp.getEvents(), (parsedEvent) =>
            Effect.gen(function* () {
              switch (parsedEvent._tag) {
                case "AssistantItemStarted":
                case "AssistantItemCompleted":
                  yield* offerRuntimeEvent(
                    makeAcpAssistantItemEvent({
                      stamp: yield* makeEventStamp(),
                      provider: PROVIDER,
                      threadId: ctx.threadId,
                      turnId: ctx.activeTurnId,
                      itemId: parsedEvent.itemId,
                      lifecycle:
                        parsedEvent._tag === "AssistantItemStarted"
                          ? "item.started"
                          : "item.completed",
                    }),
                  );
                  break;
                case "ContentDelta":
                  yield* offerRuntimeEvent(
                    makeAcpContentDeltaEvent({
                      stamp: yield* makeEventStamp(),
                      provider: PROVIDER,
                      threadId: ctx.threadId,
                      turnId: ctx.activeTurnId,
                      ...(parsedEvent.itemId ? { itemId: parsedEvent.itemId } : {}),
                      text: parsedEvent.text,
                      rawPayload: parsedEvent.rawPayload,
                    }),
                  );
                  break;
                case "PlanUpdated":
                  yield* emitPlanUpdate(
                    ctx,
                    parsedEvent.payload,
                    parsedEvent.rawPayload,
                    "session/update",
                  );
                  break;
                case "ToolCallUpdated":
                  {
                    const toolCall = normalizeAntigravityToolCall(parsedEvent.toolCall);
                    const classification = classifyAntigravitySubagentToolCall(
                      toolCall,
                      parsedEvent.rawPayload,
                    );
                    if (classification !== "subagent") {
                      yield* offerRuntimeEvent(
                        makeAcpToolCallEvent({
                          stamp: yield* makeEventStamp(),
                          provider: PROVIDER,
                          threadId: ctx.threadId,
                          turnId: ctx.activeTurnId,
                          toolCall,
                          rawPayload: parsedEvent.rawPayload,
                        }),
                      );
                      break;
                    }

                    const previousState = ctx.subagentStates.get(toolCall.toolCallId);
                    const lifecycle = planAntigravitySubagentUpdate({
                      toolCall,
                      rawPayload: parsedEvent.rawPayload,
                      previousState,
                    });
                    if (!lifecycle) break;
                    const taskId = RuntimeTaskId.makeUnsafe(toolCall.toolCallId);
                    const description = toolCall.detail ?? toolCall.title ?? "Antigravity subagent";
                    if (lifecycle.start) {
                      yield* offerRuntimeEvent({
                        type: "task.started",
                        ...(yield* makeEventStamp()),
                        provider: PROVIDER,
                        threadId: ctx.threadId,
                        turnId: ctx.activeTurnId,
                        payload: {
                          taskId,
                          description,
                          taskType: "antigravity-subagent",
                        },
                      });
                    }
                    if (lifecycle.completion === "failed") {
                      yield* offerRuntimeEvent({
                        type: "task.completed",
                        ...(yield* makeEventStamp()),
                        provider: PROVIDER,
                        threadId: ctx.threadId,
                        turnId: ctx.activeTurnId,
                        payload: {
                          taskId,
                          status: "failed",
                          ...(antigravitySubagentOutput(toolCall)
                            ? { summary: antigravitySubagentOutput(toolCall) }
                            : {}),
                        },
                      });
                      ctx.subagentStates.set(toolCall.toolCallId, "finished");
                      break;
                    }
                    const progress = antigravitySubagentOutput(toolCall) ?? description;
                    if (lifecycle.progress) {
                      yield* offerRuntimeEvent({
                        type: "task.progress",
                        ...(yield* makeEventStamp()),
                        provider: PROVIDER,
                        threadId: ctx.threadId,
                        turnId: ctx.activeTurnId,
                        payload: { taskId, description: progress, summary: progress },
                      });
                    }
                    ctx.subagentStates.set(toolCall.toolCallId, lifecycle.nextState);
                  }
                  break;
              }
            }),
          ).pipe(
            Effect.catch((cause) =>
              Effect.logError("Failed to process Antigravity runtime notification.", { cause }),
            ),
            Effect.forkIn(ctx.scope),
          );

          sessionScopeTransferred = true;
          sessions.set(input.threadId, ctx);
          return session;
        }).pipe(Effect.scoped),
      );

    const sendTurn: AntigravityAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const prepared = yield* withThreadLock(
          input.threadId,
          Effect.gen(function* () {
            const ctx = yield* requireSession(input.threadId);
            const turnId = (yield* randomUUIDv4) as TurnId;
            ctx.activeTurnId = turnId;
            ctx.lastPlanFingerprint = undefined;

            const antigravityModelSelection =
              input.modelSelection?.instanceId === boundInstanceId
                ? input.modelSelection
                : undefined;
            if (antigravityModelSelection?.model) {
              const requestedModelId = resolveAntigravityAcpBaseModelId(
                antigravityModelSelection.model,
              );
              yield* validateAdvertisedModel(requestedModelId, "turn/send");
              ctx.currentModelId = yield* applyAntigravityAcpModelSelection({
                runtime: ctx.acp,
                model: requestedModelId,
                mapError: (cause) =>
                  mapAcpToAdapterError(PROVIDER, input.threadId, "session/set_model", cause),
              });
              ctx.session = {
                ...ctx.session,
                ...(ctx.currentModelId ? { model: ctx.currentModelId } : {}),
                updatedAt: yield* nowIso,
              };
            }

            // AG-007: Safe attachment parsing and bounded prompts.
            const promptParts = yield* buildAntigravityPrompt({
              input: input.input,
              attachments: input.attachments,
              attachmentsDir: serverConfig.attachmentsDir,
            }).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.mapError(
                (cause) =>
                  new ProviderAdapterRequestError({
                    provider: PROVIDER,
                    method: "session/prompt",
                    detail: cause.message,
                    cause,
                  }),
              ),
            );
            yield* offerRuntimeEvent({
              type: "turn.started",
              ...(yield* makeEventStamp()),
              provider: PROVIDER,
              threadId: input.threadId,
              turnId,
              payload: ctx.currentModelId ? { model: ctx.currentModelId } : {},
            });
            return { acp: ctx.acp, acpSessionId: ctx.acpSessionId, promptParts, turnId };
          }),
        );

        const result = yield* prepared.acp
          .prompt({ prompt: prepared.promptParts })
          .pipe(
            Effect.mapError((cause) =>
              mapAcpToAdapterError(PROVIDER, input.threadId, "session/prompt", cause),
            ),
          );

        return yield* withThreadLock(
          input.threadId,
          Effect.gen(function* () {
            const ctx = yield* requireSession(input.threadId);
            if (ctx.acpSessionId !== prepared.acpSessionId) {
              return yield* new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "session/prompt",
                detail: "Antigravity session changed before the turn completed.",
              });
            }
            ctx.turns.push({
              id: prepared.turnId,
              items: [{ prompt: prepared.promptParts, result }],
            });
            ctx.session = {
              ...ctx.session,
              status: "ready",
              activeTurnId: undefined,
              updatedAt: yield* nowIso,
            };
            for (const [subagentId, state] of ctx.subagentStates) {
              if (state !== "active") continue;
              yield* offerRuntimeEvent({
                type: "task.completed",
                ...(yield* makeEventStamp()),
                provider: PROVIDER,
                threadId: input.threadId,
                turnId: prepared.turnId,
                payload: {
                  taskId: RuntimeTaskId.makeUnsafe(subagentId),
                  status: result.stopReason === "cancelled" ? "stopped" : "completed",
                },
              });
              ctx.subagentStates.set(subagentId, "finished");
            }
            yield* offerRuntimeEvent({
              type: "turn.completed",
              ...(yield* makeEventStamp()),
              provider: PROVIDER,
              threadId: input.threadId,
              turnId: prepared.turnId,
              payload: {
                state: result.stopReason === "cancelled" ? "cancelled" : "completed",
                stopReason: result.stopReason ?? null,
              },
            });
            return {
              threadId: input.threadId,
              turnId: prepared.turnId,
              resumeCursor: ctx.session.resumeCursor,
            };
          }),
        );
      });

    const interruptTurn: AntigravityAdapterShape["interruptTurn"] = (threadId) =>
      withThreadLock(
        threadId,
        Effect.gen(function* () {
          const ctx = yield* requireSession(threadId);
          yield* ctx.acp.cancel.pipe(
            Effect.mapError((cause) =>
              mapAcpToAdapterError(PROVIDER, threadId, "session/cancel", cause),
            ),
            Effect.catch(() => Effect.void),
          );
        }),
      );

    const respondToRequest: AntigravityAdapterShape["respondToRequest"] = (
      threadId,
      requestId,
      decision,
    ) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const pending = ctx.pendingApprovals.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "respondToRequest",
            detail: `No pending approval request '${requestId}' for thread '${threadId}'.`,
          });
        }
        yield* Deferred.succeed(pending.decision, decision);
      });

    const respondToUserInput: AntigravityAdapterShape["respondToUserInput"] = (
      threadId,
      requestId,
      answers,
    ) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const pending = ctx.pendingUserInputs.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "respondToUserInput",
            detail: `No pending user input request '${requestId}' for thread '${threadId}'.`,
          });
        }
        yield* Deferred.succeed(pending.resolution, { _tag: "answered", answers });
      });

    const stopSession: AntigravityAdapterShape["stopSession"] = (threadId) =>
      withThreadLock(
        threadId,
        Effect.gen(function* () {
          const ctx = sessions.get(threadId);
          if (ctx) {
            yield* stopSessionInternal(ctx);
          }
        }),
      );

    const listSessions: AntigravityAdapterShape["listSessions"] = () =>
      Effect.sync(() =>
        Array.from(sessions.values())
          .filter((ctx) => !ctx.stopped)
          .map((ctx) => ctx.session),
      );

    const hasSession: AntigravityAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => {
        const ctx = sessions.get(threadId);
        return Boolean(ctx && !ctx.stopped);
      });

    const readThread: AntigravityAdapterShape["readThread"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        return {
          threadId,
          turns: ctx.turns.map((t) => ({ id: t.id, items: [...t.items] })),
        };
      });

    const rollbackThread: AntigravityAdapterShape["rollbackThread"] = (threadId, numTurns) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        if (numTurns > 0) {
          ctx.turns = ctx.turns.slice(0, -numTurns);
        }
        return {
          threadId,
          turns: ctx.turns.map((t) => ({ id: t.id, items: [...t.items] })),
        };
      });

    const stopAll: AntigravityAdapterShape["stopAll"] = () =>
      Effect.forEach(Array.from(sessions.values()), (ctx) => stopSessionInternal(ctx), {
        discard: true,
      });

    const listModels: NonNullable<AntigravityAdapterShape["listModels"]> = (input) =>
      Effect.scoped(
        Effect.gen(function* () {
          const cwd = path.resolve(input.cwd?.trim() || serverConfig.cwd);
          const runtime = yield* makeAntigravityAcpRuntime({
            antigravitySettings: {
              ...antigravitySettings,
              ...(input.binaryPath ? { binaryPath: input.binaryPath } : {}),
            },
            ...(options?.environment ? { environment: options.environment } : {}),
            childProcessSpawner,
            cwd,
            profileDirectory: path.join(
              serverConfig.baseDir,
              "providers",
              "antigravity",
              boundInstanceId,
            ),
            clientInfo: { name: "tabs-model-discovery", version: "0.0.0" },
          }).pipe(
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.provideService(Path.Path, path),
          );
          yield* runtime.start();
          return yield* discoverAntigravityAcpModels(runtime);
        }).pipe(
          Effect.mapError((cause) =>
            mapAcpToAdapterError(
              PROVIDER,
              "antigravity-model-discovery" as ThreadId,
              "model/list",
              cause,
            ),
          ),
        ),
      );

    return {
      provider: PROVIDER,
      capabilities: {
        sessionModelSwitch: "in-session",
      },
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      readThread,
      rollbackThread,
      listModels,
      stopAll,
      streamEvents: Stream.fromPubSub(runtimeEventPubSub),
    } satisfies AntigravityAdapterShape;
  });
}
