import {
  type ChatAttachment,
  CommandId,
  EventId,
  type ModelSelection,
  type OrchestrationEvent,
  ProviderDriverKind,
  type OrchestrationSession,
  ThreadId,
  type ProviderSession,
  type RuntimeMode,
  type TurnId,
} from "@tabs/contracts";
import {
  Cache,
  Cause,
  DateTime,
  Deferred,
  Duration,
  Effect,
  Equal,
  Layer,
  Option,
  Schema,
  Stream,
} from "effect";
import { makeDrainableWorker } from "@tabs/shared/DrainableWorker";

import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { GitCore } from "../../git/Services/GitCore.ts";
import { ProviderAdapterRequestError, ProviderServiceError } from "../../provider/Errors.ts";
import { TextGeneration } from "../../textGeneration/TextGeneration";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ProviderCommandReactor,
  type ProviderCommandReactorShape,
} from "../Services/ProviderCommandReactor.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ServerConfig } from "../../config.ts";
import { discoverSkillsCatalog } from "../../provider/skillsCatalog.ts";
import {
  buildInlineSkillInstructions,
  resolveInvokedSkillReferences,
} from "../../provider/skillPromptInjection.ts";

type ProviderIntentEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.meta-updated"
      | "thread.runtime-mode-set"
      | "thread.turn-start-requested"
      | "thread.turn-interrupt-requested"
      | "thread.approval-response-requested"
      | "thread.user-input-response-requested"
      | "thread.session-stop-requested";
  }
>;

function toNonEmptyProviderInput(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

const isCompactCommandMessage = (message: {
  readonly role: string;
  readonly text: string;
  readonly attachments?: ReadonlyArray<unknown> | undefined;
}): boolean =>
  message.role === "user" &&
  (message.attachments?.length ?? 0) === 0 &&
  message.text.trim().toLowerCase() === "/compact";

function mapProviderSessionStatusToOrchestrationStatus(
  status: "connecting" | "ready" | "running" | "error" | "closed",
): OrchestrationSession["status"] {
  switch (status) {
    case "connecting":
      return "starting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "closed":
      return "stopped";
    case "ready":
    default:
      return "ready";
  }
}

const turnStartKeyForEvent = (event: ProviderIntentEvent): string =>
  event.commandId !== null ? `command:${event.commandId}` : `event:${event.eventId}`;

const serverCommandId = (tag: string): CommandId =>
  `server:${tag}:${crypto.randomUUID()}` as CommandId;

const HANDLED_TURN_START_KEY_MAX = 10_000;
const HANDLED_TURN_START_KEY_TTL = Duration.minutes(30);
const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";
const MAX_INLINE_SKILL_INSTRUCTIONS_CHARS = 96_000;
const WORKTREE_BRANCH_PREFIX = "tabs";
const TEMP_WORKTREE_BRANCH_PATTERN = new RegExp(`^${WORKTREE_BRANCH_PREFIX}\\/[0-9a-f]{8}$`);

function isUnknownPendingApprovalRequestError(cause: Cause.Cause<ProviderServiceError>): boolean {
  const error = Cause.squash(cause);
  if (Schema.is(ProviderAdapterRequestError)(error)) {
    const detail = error.detail.toLowerCase();
    return (
      detail.includes("unknown pending approval request") ||
      detail.includes("unknown pending permission request")
    );
  }
  const message = Cause.pretty(cause);
  return (
    message.includes("unknown pending approval request") ||
    message.includes("unknown pending permission request")
  );
}

function isUnknownPendingUserInputRequestError(cause: Cause.Cause<ProviderServiceError>): boolean {
  const error = Cause.squash(cause);
  if (Schema.is(ProviderAdapterRequestError)(error)) {
    return error.detail.toLowerCase().includes("unknown pending user-input request");
  }
  return Cause.pretty(cause).toLowerCase().includes("unknown pending user-input request");
}

function stalePendingRequestDetail(
  requestKind: "approval" | "user-input",
  requestId: string,
): string {
  return `Stale pending ${requestKind} request: ${requestId}. Provider callback state does not survive app restarts or recovered sessions. Restart the turn to continue.`;
}

function isTemporaryWorktreeBranch(branch: string): boolean {
  return TEMP_WORKTREE_BRANCH_PATTERN.test(branch.trim().toLowerCase());
}

function buildGeneratedWorktreeBranchName(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/^refs\/heads\//, "")
    .replace(/['"`]/g, "");

  const withoutPrefix = normalized.startsWith(`${WORKTREE_BRANCH_PREFIX}/`)
    ? normalized.slice(`${WORKTREE_BRANCH_PREFIX}/`.length)
    : normalized;

  const branchFragment = withoutPrefix
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[./_-]+|[./_-]+$/g, "")
    .slice(0, 64)
    .replace(/[./_-]+$/g, "");

  const safeFragment = branchFragment.length > 0 ? branchFragment : "update";
  return `${WORKTREE_BRANCH_PREFIX}/${safeFragment}`;
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;
  const git = yield* GitCore;
  const textGeneration = yield* TextGeneration;
  const serverSettingsService = yield* ServerSettingsService;
  const serverConfig = yield* ServerConfig;
  const handledTurnStartKeys = yield* Cache.make<string, true>({
    capacity: HANDLED_TURN_START_KEY_MAX,
    timeToLive: HANDLED_TURN_START_KEY_TTL,
    lookup: () => Effect.succeed(true),
  });

  const hasHandledTurnStartRecently = (key: string) =>
    Cache.getOption(handledTurnStartKeys, key).pipe(
      Effect.flatMap((cached) =>
        Cache.set(handledTurnStartKeys, key, true).pipe(Effect.as(Option.isSome(cached))),
      ),
    );

  const threadModelSelections = new Map<string, ModelSelection>();
  type QueuedTurnStart = Extract<ProviderIntentEvent, { type: "thread.turn-start-requested" }>;
  const compactingThreadIds = new Set<ThreadId>();
  const turnsAfterCompaction = new Map<ThreadId, Array<QueuedTurnStart>>();
  const resumedTurnStarts = new Map<
    CommandId,
    {
      readonly event: QueuedTurnStart;
      readonly queued: Array<QueuedTurnStart>;
      readonly sent: Deferred.Deferred<void>;
    }
  >();
  const stoppingThreadIds = new Set<ThreadId>();

  const appendProviderFailureActivity = (input: {
    readonly threadId: ThreadId;
    readonly kind:
      | "provider.turn.start.failed"
      | "provider.turn.interrupt.failed"
      | "provider.approval.respond.failed"
      | "provider.user-input.respond.failed"
      | "provider.session.stop.failed";
    readonly summary: string;
    readonly detail: string;
    readonly turnId: TurnId | null;
    readonly createdAt: string;
    readonly requestId?: string;
  }) =>
    orchestrationEngine.dispatch({
      type: "thread.activity.append",
      commandId: serverCommandId("provider-failure-activity"),
      threadId: input.threadId,
      activity: {
        id: crypto.randomUUID() as EventId,
        tone: "error",
        kind: input.kind,
        summary: input.summary,
        payload: {
          detail: input.detail,
          ...(input.requestId ? { requestId: input.requestId } : {}),
        },
        turnId: input.turnId,
        createdAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });

  const setThreadSession = (input: {
    readonly threadId: ThreadId;
    readonly session: OrchestrationSession;
    readonly createdAt: string;
  }) =>
    orchestrationEngine.dispatch({
      type: "thread.session.set",
      commandId: serverCommandId("provider-session-set"),
      threadId: input.threadId,
      session: input.session,
      createdAt: input.createdAt,
    });

  const resolveThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    const readModel = yield* orchestrationEngine.getReadModel();
    return readModel.threads.find((entry) => entry.id === threadId);
  });
  const resolveProject = Effect.fnUntraced(function* (projectId: string) {
    const readModel = yield* orchestrationEngine.getReadModel();
    return readModel.projects.find((entry) => entry.id === projectId);
  });

  const cancelTurnsAfterCompaction = Effect.fnUntraced(function* (
    threadId: ThreadId,
    detail: string,
  ) {
    const queued = turnsAfterCompaction.get(threadId) ?? [];
    turnsAfterCompaction.delete(threadId);
    for (const event of queued) {
      yield* appendProviderFailureActivity({
        threadId,
        kind: "provider.turn.start.failed",
        summary: "Queued message was not sent",
        detail,
        turnId: null,
        createdAt: DateTime.formatIso(yield* DateTime.now),
        requestId: event.payload.messageId,
      }).pipe(Effect.ignore({ log: true, message: "failed to report canceled queued message" }));
    }
  });

  const resumeTurnsAfterCompaction = Effect.fnUntraced(function* (threadId: ThreadId) {
    const queued = turnsAfterCompaction.get(threadId) ?? [];
    while (queued.length > 0 && turnsAfterCompaction.get(threadId) === queued) {
      const event = queued[0]!;
      const thread = yield* resolveThread(threadId);
      const turnStartMessage = thread?.messages.find(
        (entry) => entry.id === event.payload.messageId,
      );
      if (turnsAfterCompaction.get(threadId) !== queued) return;
      // In flight from here on: a cancellation reports it when the replay runs, not from the queue.
      queued.shift();
      if (!turnStartMessage) continue;
      // Reissue the durable request after restoration clears compaction's
      // pending slot. Reusing the message id preserves a single user bubble.
      const commandId = serverCommandId("after-compaction");
      const sent = yield* Deferred.make<void>();
      resumedTurnStarts.set(commandId, { event, queued, sent });
      const { messageId, ...request } = event.payload;
      yield* orchestrationEngine
        .dispatch({
          type: "thread.turn.start",
          commandId,
          ...request,
          message: {
            messageId,
            role: "user",
            text: turnStartMessage.text,
            attachments: turnStartMessage.attachments ?? [],
          },
        })
        .pipe(
          Effect.onError(() =>
            Effect.sync(() => {
              resumedTurnStarts.delete(commandId);
              queued.unshift(event);
            }),
          ),
        );
      yield* Deferred.await(sent);
      resumedTurnStarts.delete(commandId);
    }
    if (turnsAfterCompaction.get(threadId) === queued) turnsAfterCompaction.delete(threadId);
  });

  const restoreCompaction = Effect.fnUntraced(function* (threadId: ThreadId, fromRunning = false) {
    if (stoppingThreadIds.has(threadId)) {
      compactingThreadIds.delete(threadId);
      return;
    }
    const thread = yield* resolveThread(threadId);
    if (!thread?.session) return;
    if (
      thread.session.status !== "starting" &&
      thread.session.status !== "ready" &&
      (!fromRunning || thread.session.status !== "running")
    )
      return;
    const completedAt = DateTime.formatIso(yield* DateTime.now);
    if (stoppingThreadIds.has(threadId)) {
      compactingThreadIds.delete(threadId);
      return;
    }
    yield* setThreadSession({
      threadId,
      session: {
        ...thread.session,
        status: "ready",
        activeTurnId: null,
        lastError: null,
        updatedAt: completedAt,
      },
      createdAt: completedAt,
    });
  });

  const ensureSessionForThread = Effect.fnUntraced(function* (
    threadId: ThreadId,
    createdAt: string,
    options?: {
      readonly modelSelection?: ModelSelection;
    },
  ) {
    const readModel = yield* orchestrationEngine.getReadModel();
    const thread = readModel.threads.find((entry) => entry.id === threadId);
    if (!thread) {
      return yield* Effect.die(new Error(`Thread '${threadId}' was not found in read model.`));
    }

    const desiredRuntimeMode = thread.runtimeMode;
    const currentProvider: ProviderDriverKind | undefined =
      thread.session !== null && Schema.is(ProviderDriverKind)(thread.session.providerName)
        ? thread.session.providerName
        : undefined;
    const requestedModelSelection = options?.modelSelection;
    // Routing is keyed on the configured provider INSTANCE id (the model
    // selection's `instanceId`). For the built-in single-instance drivers the
    // instance id equals the driver kind, so legacy threads route unchanged.
    const threadInstanceId = thread.modelSelection.instanceId;
    if (
      requestedModelSelection !== undefined &&
      requestedModelSelection.instanceId !== threadInstanceId
    ) {
      return yield* new ProviderAdapterRequestError({
        provider: threadInstanceId as unknown as ProviderDriverKind,
        method: "thread.turn.start",
        detail: `Thread '${threadId}' is bound to provider instance '${threadInstanceId}' and cannot switch to '${requestedModelSelection.instanceId}'.`,
      });
    }
    const desiredModelSelection = requestedModelSelection ?? thread.modelSelection;
    const desiredInstanceId = desiredModelSelection.instanceId;

    // Guard: reject chat turns against text-generation-only providers (e.g.
    // Google Gemini) before any session is started. This prevents a TypeError
    // from `yield* adapter.sendTurn` (which would be undefined on an
    // incomplete stub) and surfaces a clear, user-visible error instead.
    const desiredCapabilities = yield* providerService
      .getCapabilities(desiredInstanceId)
      .pipe(Effect.option);
    if (
      Option.isSome(desiredCapabilities) &&
      desiredCapabilities.value.agentChat === "unsupported"
    ) {
      return yield* new ProviderAdapterRequestError({
        provider: desiredInstanceId as unknown as ProviderDriverKind,
        method: "thread.turn.start",
        detail: `Provider instance '${desiredInstanceId}' does not support interactive Agent Chat. It is a text-generation-only provider. Select a different provider in the Agents tab.`,
      });
    }

    const effectiveCwd = resolveThreadWorkspaceCwd({
      thread,
      projects: readModel.projects,
    });

    const resolveActiveSession = (threadId: ThreadId) =>
      providerService
        .listSessions()
        .pipe(Effect.map((sessions) => sessions.find((session) => session.threadId === threadId)));

    const startProviderSession = (input?: { readonly resumeCursor?: unknown }) =>
      providerService.startSession(threadId, {
        threadId,
        providerInstanceId: desiredInstanceId,
        ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
        modelSelection: desiredModelSelection,
        ...(input?.resumeCursor !== undefined ? { resumeCursor: input.resumeCursor } : {}),
        runtimeMode: desiredRuntimeMode,
      });

    const bindSessionToThread = (session: ProviderSession) =>
      setThreadSession({
        threadId,
        session: {
          threadId,
          status: mapProviderSessionStatusToOrchestrationStatus(session.status),
          providerName: session.provider,
          runtimeMode: desiredRuntimeMode,
          // Provider turn ids are not orchestration turn ids.
          activeTurnId: null,
          lastError: session.lastError ?? null,
          updatedAt: session.updatedAt,
        },
        createdAt,
      });

    const existingSessionThreadId =
      thread.session && thread.session.status !== "stopped" ? thread.id : null;
    if (existingSessionThreadId) {
      const runtimeModeChanged = thread.runtimeMode !== thread.session?.runtimeMode;
      const providerChanged =
        requestedModelSelection !== undefined &&
        requestedModelSelection.instanceId !== threadInstanceId;
      const activeSession = yield* resolveActiveSession(existingSessionThreadId);
      const sessionModelSwitch =
        currentProvider === undefined
          ? "in-session"
          : (yield* providerService.getCapabilities(threadInstanceId)).sessionModelSwitch;
      const modelChanged =
        requestedModelSelection !== undefined &&
        requestedModelSelection.model !== activeSession?.model;
      // The driver SPI collapsed "restart-session" into "unsupported": a model
      // change the running session can't apply in place requires a restart.
      const shouldRestartForModelChange = modelChanged && sessionModelSwitch === "unsupported";
      const previousModelSelection = threadModelSelections.get(threadId);
      const shouldRestartForModelSelectionChange =
        currentProvider === "claudeAgent" &&
        requestedModelSelection !== undefined &&
        !Equal.equals(previousModelSelection, requestedModelSelection);

      if (
        !runtimeModeChanged &&
        !providerChanged &&
        !shouldRestartForModelChange &&
        !shouldRestartForModelSelectionChange
      ) {
        return existingSessionThreadId;
      }

      const resumeCursor =
        providerChanged || shouldRestartForModelChange
          ? undefined
          : (activeSession?.resumeCursor ?? undefined);
      yield* Effect.logInfo("provider command reactor restarting provider session", {
        threadId,
        existingSessionThreadId,
        currentProvider,
        desiredProvider: desiredInstanceId,
        currentRuntimeMode: thread.session?.runtimeMode,
        desiredRuntimeMode: thread.runtimeMode,
        runtimeModeChanged,
        providerChanged,
        modelChanged,
        shouldRestartForModelChange,
        shouldRestartForModelSelectionChange,
        hasResumeCursor: resumeCursor !== undefined,
      });
      const restartedSession = yield* startProviderSession(
        resumeCursor !== undefined ? { resumeCursor } : undefined,
      );
      yield* Effect.logInfo("provider command reactor restarted provider session", {
        threadId,
        previousSessionId: existingSessionThreadId,
        restartedSessionThreadId: restartedSession.threadId,
        provider: restartedSession.provider,
        runtimeMode: restartedSession.runtimeMode,
      });
      yield* bindSessionToThread(restartedSession);
      return restartedSession.threadId;
    }

    const startedSession = yield* startProviderSession(undefined);
    yield* bindSessionToThread(startedSession);
    return startedSession.threadId;
  });

  const sendTurnForThread = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly messageText: string;
    readonly attachments?: ReadonlyArray<ChatAttachment>;
    readonly modelSelection?: ModelSelection;
    readonly interactionMode?: "default" | "plan";
    readonly createdAt: string;
  }) {
    const thread = yield* resolveThread(input.threadId);
    if (!thread) {
      return;
    }
    yield* ensureSessionForThread(
      input.threadId,
      input.createdAt,
      input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {},
    );
    if (input.modelSelection !== undefined) {
      threadModelSelections.set(input.threadId, input.modelSelection);
    }
    const normalizedInput = toNonEmptyProviderInput(input.messageText);
    const normalizedAttachments = input.attachments ?? [];
    const activeSession = yield* providerService
      .listSessions()
      .pipe(
        Effect.map((sessions) => sessions.find((session) => session.threadId === input.threadId)),
      );
    let providerInput = normalizedInput;
    if (normalizedInput?.includes("$") && activeSession) {
      const project = yield* resolveProject(thread.projectId);
      const cwd = resolveThreadWorkspaceCwd({
        thread,
        projects: project ? [project] : [],
      });
      const catalog = yield* Effect.promise(() =>
        discoverSkillsCatalog({
          ...(cwd ? { cwd } : {}),
          homeDir: process.env.HOME ?? process.cwd(),
          synaraBaseDir: serverConfig.baseDir,
          provider: activeSession.provider,
        }),
      );
      const invokedSkills = resolveInvokedSkillReferences(normalizedInput, catalog);
      if (invokedSkills.length > 0) {
        const inlineInstructions = yield* Effect.promise(() =>
          buildInlineSkillInstructions({
            provider: activeSession.provider,
            skills: invokedSkills,
            maxChars: MAX_INLINE_SKILL_INSTRUCTIONS_CHARS,
          }),
        );
        if (inlineInstructions) providerInput = `${normalizedInput}\n\n${inlineInstructions}`;
      }
    }
    const sessionModelSwitch =
      activeSession === undefined
        ? "in-session"
        : (yield* providerService.getCapabilities(
            activeSession.providerInstanceId ?? thread.modelSelection.instanceId,
          )).sessionModelSwitch;
    const requestedModelSelection =
      input.modelSelection ?? threadModelSelections.get(input.threadId) ?? thread.modelSelection;
    const modelForTurn =
      sessionModelSwitch === "unsupported"
        ? activeSession?.model !== undefined
          ? {
              ...requestedModelSelection,
              model: activeSession.model,
            }
          : requestedModelSelection
        : input.modelSelection;

    yield* providerService.sendTurn({
      threadId: input.threadId,
      ...(providerInput ? { input: providerInput } : {}),
      ...(normalizedAttachments.length > 0 ? { attachments: normalizedAttachments } : {}),
      ...(modelForTurn !== undefined ? { modelSelection: modelForTurn } : {}),
      ...(input.interactionMode !== undefined ? { interactionMode: input.interactionMode } : {}),
    });
  });

  const maybeGenerateAndRenameWorktreeBranchForFirstTurn = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly branch: string | null;
    readonly worktreePath: string | null;
    readonly messageId: string;
    readonly messageText: string;
    readonly attachments?: ReadonlyArray<ChatAttachment>;
  }) {
    if (!input.branch || !input.worktreePath) {
      return;
    }
    if (!isTemporaryWorktreeBranch(input.branch)) {
      return;
    }

    const thread = yield* resolveThread(input.threadId);
    if (!thread) {
      return;
    }

    const userMessages = thread.messages.filter((message) => message.role === "user");
    if (userMessages.length !== 1 || userMessages[0]?.id !== input.messageId) {
      return;
    }

    const oldBranch = input.branch;
    const cwd = input.worktreePath;
    const attachments = input.attachments ?? [];
    yield* Effect.gen(function* () {
      const { textGenerationModelSelection: modelSelection } =
        yield* serverSettingsService.getSettings;

      const generated = yield* textGeneration.generateBranchName({
        cwd,
        message: input.messageText,
        ...(attachments.length > 0 ? { attachments } : {}),
        modelSelection,
      });
      if (!generated) return;

      const targetBranch = buildGeneratedWorktreeBranchName(generated.branch);
      if (targetBranch === oldBranch) return;

      const renamed = yield* git.renameBranch({ cwd, oldBranch, newBranch: targetBranch });
      yield* orchestrationEngine.dispatch({
        type: "thread.meta.update",
        commandId: serverCommandId("worktree-branch-rename"),
        threadId: input.threadId,
        branch: renamed.branch,
        worktreePath: cwd,
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("provider command reactor failed to generate or rename worktree branch", {
          threadId: input.threadId,
          cwd,
          oldBranch,
          cause: Cause.pretty(cause),
        }),
      ),
    );
  });

  const processTurnStartRequested = Effect.fnUntraced(function* (
    receivedEvent: Extract<ProviderIntentEvent, { type: "thread.turn-start-requested" }>,
  ) {
    const resumed =
      receivedEvent.commandId !== null ? resumedTurnStarts.get(receivedEvent.commandId) : undefined;
    const event = resumed ? { ...receivedEvent, payload: resumed.event.payload } : receivedEvent;
    const key = turnStartKeyForEvent(event);
    if (yield* hasHandledTurnStartRecently(key)) {
      return;
    }

    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }

    const message = thread.messages.find((entry) => entry.id === event.payload.messageId);
    if (!message || message.role !== "user") {
      yield* appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.turn.start.failed",
        summary: "Provider turn start failed",
        detail: `User message '${event.payload.messageId}' was not found for turn start request.`,
        turnId: null,
        createdAt: event.payload.createdAt,
      });
      return;
    }

    const appendTurnStartFailure = (summary: string, detail: string) =>
      appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.turn.start.failed",
        summary,
        detail,
        turnId: null,
        createdAt: event.payload.createdAt,
        requestId: event.payload.messageId,
      });

    if (resumed && turnsAfterCompaction.get(event.payload.threadId) !== resumed.queued) {
      return yield* appendTurnStartFailure(
        "Queued message was not sent",
        "The queued message was canceled before it could resume. Send it again to continue.",
      );
    }

    const hasOtherUserMessages = thread.messages.some(
      (entry) => entry.role === "user" && entry.id !== message.id,
    );
    const isCompactCommand = isCompactCommandMessage(message);

    if (isCompactCommand) {
      if (!hasOtherUserMessages) {
        return yield* appendTurnStartFailure(
          "Context compaction failed",
          "Context compaction requires an existing conversation.",
        );
      }
      const latestThread = yield* resolveThread(event.payload.threadId);
      if (
        compactingThreadIds.has(event.payload.threadId) ||
        turnsAfterCompaction.has(event.payload.threadId) ||
        latestThread?.session?.status === "starting" ||
        latestThread?.session?.status === "running"
      ) {
        yield* appendTurnStartFailure(
          "Context compaction failed",
          "Context compaction is unavailable while a provider turn is running.",
        );
        return;
      }
      compactingThreadIds.add(event.payload.threadId);
      const clearCompacting = Effect.sync(
        () => void compactingThreadIds.delete(event.payload.threadId),
      );
      yield* Effect.gen(function* () {
        yield* ensureSessionForThread(
          event.payload.threadId,
          event.payload.createdAt,
          event.payload.modelSelection !== undefined
            ? { modelSelection: event.payload.modelSelection }
            : {},
        );
        if (event.payload.modelSelection !== undefined) {
          threadModelSelections.set(event.payload.threadId, event.payload.modelSelection);
        }
        yield* providerService.compactThread(
          event.payload.threadId,
          event.payload.modelSelection,
          event.payload.messageId,
        );
      }).pipe(
        Effect.andThen(restoreCompaction(event.payload.threadId, true)),
        Effect.andThen(clearCompacting),
        Effect.andThen(resumeTurnsAfterCompaction(event.payload.threadId)),
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            const detail = Cause.pretty(cause);
            yield* appendTurnStartFailure("Context compaction failed", detail);
          }).pipe(
            Effect.ensuring(clearCompacting),
            Effect.andThen(
              cancelTurnsAfterCompaction(
                event.payload.threadId,
                "Context compaction failed. Send this message again to continue.",
              ),
            ),
          ),
        ),
        Effect.forkScoped,
      );
      return;
    }

    if (
      !resumed &&
      (compactingThreadIds.has(event.payload.threadId) ||
        turnsAfterCompaction.has(event.payload.threadId))
    ) {
      const queued = turnsAfterCompaction.get(event.payload.threadId) ?? [];
      queued.push(event);
      turnsAfterCompaction.set(event.payload.threadId, queued);
      return;
    }

    if (!hasOtherUserMessages && !isCompactCommand) {
      yield* maybeGenerateAndRenameWorktreeBranchForFirstTurn({
        threadId: event.payload.threadId,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        messageId: message.id,
        messageText: message.text,
        ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
      }).pipe(Effect.forkScoped);
    }

    if (resumed && event.commandId !== null) resumedTurnStarts.delete(event.commandId);

    const send = sendTurnForThread({
      threadId: event.payload.threadId,
      messageText: message.text,
      ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
      ...(event.payload.modelSelection !== undefined
        ? { modelSelection: event.payload.modelSelection }
        : {}),
      interactionMode: event.payload.interactionMode,
      createdAt: event.payload.createdAt,
    }).pipe(
      Effect.catchCause((cause) =>
        appendTurnStartFailure("Provider turn start failed", Cause.pretty(cause)),
      ),
    );

    yield* send.pipe(
      Effect.ensuring(resumed ? Deferred.succeed(resumed.sent, undefined) : Effect.void),
      Effect.forkScoped,
    );
  });

  const processTurnInterruptRequested = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.turn-interrupt-requested" }>,
  ) {
    yield* cancelTurnsAfterCompaction(
      event.payload.threadId,
      "Context compaction was interrupted. Send this message again to continue.",
    );
    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }
    const hasSession = thread.session && thread.session.status !== "stopped";
    if (!hasSession) {
      return yield* appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.turn.interrupt.failed",
        summary: "Provider turn interrupt failed",
        detail: "No active provider session is bound to this thread.",
        turnId: event.payload.turnId ?? null,
        createdAt: event.payload.createdAt,
      });
    }

    // Orchestration turn ids are not provider turn ids, so interrupt by session.
    yield* providerService.interruptTurn({ threadId: event.payload.threadId });
  });

  const processApprovalResponseRequested = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.approval-response-requested" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }
    const hasSession = thread.session && thread.session.status !== "stopped";
    if (!hasSession) {
      return yield* appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.approval.respond.failed",
        summary: "Provider approval response failed",
        detail: "No active provider session is bound to this thread.",
        turnId: null,
        createdAt: event.payload.createdAt,
        requestId: event.payload.requestId,
      });
    }

    yield* providerService
      .respondToRequest({
        threadId: event.payload.threadId,
        requestId: event.payload.requestId,
        decision: event.payload.decision,
      })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            yield* appendProviderFailureActivity({
              threadId: event.payload.threadId,
              kind: "provider.approval.respond.failed",
              summary: "Provider approval response failed",
              detail: isUnknownPendingApprovalRequestError(cause)
                ? stalePendingRequestDetail("approval", event.payload.requestId)
                : Cause.pretty(cause),
              turnId: null,
              createdAt: event.payload.createdAt,
              requestId: event.payload.requestId,
            });

            if (!isUnknownPendingApprovalRequestError(cause)) return;
          }),
        ),
      );
  });

  const processUserInputResponseRequested = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.user-input-response-requested" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }
    const hasSession = thread.session && thread.session.status !== "stopped";
    if (!hasSession) {
      return yield* appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.user-input.respond.failed",
        summary: "Provider user input response failed",
        detail: "No active provider session is bound to this thread.",
        turnId: null,
        createdAt: event.payload.createdAt,
        requestId: event.payload.requestId,
      });
    }

    yield* providerService
      .respondToUserInput({
        threadId: event.payload.threadId,
        requestId: event.payload.requestId,
        answers: event.payload.answers,
      })
      .pipe(
        Effect.catchCause((cause) =>
          appendProviderFailureActivity({
            threadId: event.payload.threadId,
            kind: "provider.user-input.respond.failed",
            summary: "Provider user input response failed",
            detail: isUnknownPendingUserInputRequestError(cause)
              ? stalePendingRequestDetail("user-input", event.payload.requestId)
              : Cause.pretty(cause),
            turnId: null,
            createdAt: event.payload.createdAt,
            requestId: event.payload.requestId,
          }),
        ),
      );
  });

  const processSessionStopRequested = Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.session-stop-requested" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }

    const now = event.payload.createdAt;
    stoppingThreadIds.add(thread.id);
    const clearStopping = Effect.sync(() => void stoppingThreadIds.delete(thread.id));

    yield* cancelTurnsAfterCompaction(
      thread.id,
      "The session was stopped during context compaction. Send this message again to continue.",
    ).pipe(
      Effect.andThen(
        thread.session && thread.session.status !== "stopped"
          ? providerService.stopSession({ threadId: thread.id })
          : Effect.void,
      ),
      Effect.ensuring(clearStopping),
    );

    yield* setThreadSession({
      threadId: thread.id,
      session: {
        threadId: thread.id,
        status: "stopped",
        providerName: thread.session?.providerName ?? null,
        runtimeMode: thread.session?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
        activeTurnId: null,
        lastError: thread.session?.lastError ?? null,
        updatedAt: now,
      },
      createdAt: now,
    });
  });

  const processDomainEvent = (event: ProviderIntentEvent) =>
    Effect.gen(function* () {
      switch (event.type) {
        case "thread.meta-updated": {
          if (event.payload.regenerateTitle !== true) return;
          const requestId = event.payload.titleRegeneration?.requestId ?? event.commandId;
          if (requestId === null) return;
          const thread = yield* resolveThread(event.payload.threadId);
          if (!thread || thread.titleRegeneration?.requestId !== requestId) return;
          const firstUserMessage = thread.messages.find((message) => message.role === "user");
          let title: string | undefined;
          if (firstUserMessage?.text.trim()) {
            const attachments = firstUserMessage.attachments ?? [];
            const project = yield* resolveProject(thread.projectId);
            const cwd =
              resolveThreadWorkspaceCwd({ thread, projects: project ? [project] : [] }) ??
              process.cwd();
            const { textGenerationModelSelection: modelSelection } =
              yield* serverSettingsService.getSettings;
            const generated = yield* textGeneration.generateThreadTitle({
              cwd,
              message: firstUserMessage.text,
              ...(attachments.length > 0 ? { attachments } : {}),
              modelSelection,
            });
            if (generated.title !== thread.title) title = generated.title;
          }
          yield* orchestrationEngine.dispatch({
            type: "thread.title.regeneration.complete",
            commandId: serverCommandId("thread-title-regeneration-complete"),
            threadId: thread.id,
            requestId,
            ...(title !== undefined ? { title } : {}),
          });
          return;
        }
        case "thread.runtime-mode-set": {
          const thread = yield* resolveThread(event.payload.threadId);
          if (!thread?.session || thread.session.status === "stopped") {
            return;
          }
          const cachedModelSelection = threadModelSelections.get(event.payload.threadId);
          yield* ensureSessionForThread(
            event.payload.threadId,
            event.occurredAt,
            cachedModelSelection !== undefined ? { modelSelection: cachedModelSelection } : {},
          );
          return;
        }
        case "thread.turn-start-requested":
          yield* processTurnStartRequested(event);
          return;
        case "thread.turn-interrupt-requested":
          yield* processTurnInterruptRequested(event);
          return;
        case "thread.approval-response-requested":
          yield* processApprovalResponseRequested(event);
          return;
        case "thread.user-input-response-requested":
          yield* processUserInputResponseRequested(event);
          return;
        case "thread.session-stop-requested":
          yield* processSessionStopRequested(event);
          return;
      }
    });

  const processDomainEventSafely = (event: ProviderIntentEvent) =>
    processDomainEvent(event).pipe(
      Effect.ensuring(
        Effect.suspend(() => {
          const resumed = event.commandId !== null && resumedTurnStarts.get(event.commandId);
          return resumed ? Deferred.succeed(resumed.sent, undefined) : Effect.void;
        }),
      ),
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("provider command reactor failed to process event", {
          eventType: event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processDomainEventSafely);

  const start: ProviderCommandReactorShape["start"] = Effect.gen(function* () {
    const readModel = yield* orchestrationEngine.getReadModel();
    yield* Effect.forEach(
      readModel.threads,
      (thread) => {
        const requestId = thread.titleRegeneration?.requestId;
        if (requestId === undefined) return Effect.void;
        return orchestrationEngine
          .dispatch({
            type: "thread.title.regeneration.complete",
            commandId: serverCommandId("thread-title-regeneration-recovery"),
            threadId: thread.id,
            requestId,
          })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("failed to clear interrupted thread title regeneration", {
                threadId: thread.id,
                cause: Cause.pretty(cause),
              }),
            ),
          );
      },
      { discard: true },
    );

    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (
          event.type !== "thread.meta-updated" &&
          event.type !== "thread.runtime-mode-set" &&
          event.type !== "thread.turn-start-requested" &&
          event.type !== "thread.turn-interrupt-requested" &&
          event.type !== "thread.approval-response-requested" &&
          event.type !== "thread.user-input-response-requested" &&
          event.type !== "thread.session-stop-requested"
        ) {
          return Effect.void;
        }

        return worker.enqueue(event);
      }),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies ProviderCommandReactorShape;
});

export const ProviderCommandReactorLive = Layer.effect(ProviderCommandReactor, make);
