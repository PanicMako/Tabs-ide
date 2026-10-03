import {
  EventId,
  type AntigravitySettings,
  type ProviderRuntimeEvent,
  type ProviderSession,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeItemId,
  type ThreadId,
  TurnId,
} from "@tabs/contracts";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter";
import { appendFileAttachmentsPromptBlock } from "../attachmentProjection";
import { teardownChildProcessTree } from "../supervisedProcessTeardown";

const PROVIDER = "antigravity" as ProviderDriverKind;
const PRINT_TIMEOUT = "30m";
const RESUME_SCHEMA_VERSION = 1;

interface AntigravityJsonResult {
  readonly conversation_id: string;
  readonly status: string;
  readonly response: string;
  readonly usage?: unknown;
}

interface AntigravitySessionContext {
  session: ProviderSession;
  conversationId: string | undefined;
  cliModel: string | undefined;
  activeProcess: ChildProcessWithoutNullStreams | undefined;
  interrupted: boolean;
  turns: Array<{ id: TurnId; items: Array<unknown> }>;
}

export interface AntigravityAdapterOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
  readonly defaultCwd: string;
  readonly attachmentsDir: string;
}

type AntigravityAdapterError =
  | ProviderAdapterRequestError
  | ProviderAdapterSessionNotFoundError
  | ProviderAdapterValidationError;

function stamp() {
  return {
    eventId: randomUUID() as EventId,
    createdAt: new Date().toISOString(),
  };
}

function resumeConversationId(cursor: unknown): string | undefined {
  if (typeof cursor !== "object" || cursor === null) return undefined;
  const value = (cursor as Record<string, unknown>).conversationId;
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function resolveAntigravityCliModel(
  model: string | undefined,
  options: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }> | undefined,
): string | undefined {
  const base = model?.trim();
  if (!base) return undefined;
  const effort = options?.find(
    (option) => option.id === "reasoningEffort" && typeof option.value === "string",
  )?.value;
  return typeof effort === "string" && /^(low|medium|high)$/u.test(effort)
    ? `${base}-${effort}`
    : base;
}

function parseResult(stdout: string): AntigravityJsonResult {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]!) as Partial<AntigravityJsonResult>;
      if (
        typeof parsed.conversation_id === "string" &&
        typeof parsed.status === "string" &&
        typeof parsed.response === "string"
      ) {
        return parsed as AntigravityJsonResult;
      }
    } catch {
      // The CLI can print diagnostics before its final JSON envelope.
    }
  }
  throw new Error("Antigravity CLI did not return its expected JSON result envelope.");
}

export const makeLegacyAntigravityAdapter = Effect.fn(function* (
  settings: AntigravitySettings,
  options: AntigravityAdapterOptions,
) {
  const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const sessions = new Map<ThreadId, AntigravitySessionContext>();
  const binaryPath = settings.binaryPath?.trim() || "agy";
  const environment = options.environment ?? process.env;

  const offer = (event: ProviderRuntimeEvent) => PubSub.publish(events, event);
  const requireSession = (threadId: ThreadId) => {
    const context = sessions.get(threadId);
    return context
      ? Effect.succeed(context)
      : Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }));
  };

  const stopProcess = (context: AntigravitySessionContext) => {
    const activeProcess = context.activeProcess;
    return activeProcess
      ? Effect.tryPromise({
          try: () => teardownChildProcessTree(activeProcess),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "turn/interrupt",
              detail: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        }).pipe(Effect.asVoid)
      : Effect.void;
  };

  const adapter: ProviderAdapterShape<AntigravityAdapterError> = {
    provider: PROVIDER,
    capabilities: { sessionModelSwitch: "in-session" },
    streamEvents: Stream.fromPubSub(events),

    startSession: (input) =>
      Effect.gen(function* () {
        if (input.runtimeMode !== "full-access") {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "session/start",
            issue:
              "Antigravity print mode cannot pause for interactive approvals. Select Full access to use this provider.",
          });
        }
        const previous = sessions.get(input.threadId);
        if (previous) {
          previous.interrupted = true;
          yield* Effect.ignore(stopProcess(previous));
        }
        const now = new Date().toISOString();
        const conversationId = resumeConversationId(input.resumeCursor);
        const model = input.modelSelection?.model;
        const session: ProviderSession = {
          provider: PROVIDER,
          ...(options.instanceId ? { providerInstanceId: options.instanceId } : {}),
          status: "ready",
          runtimeMode: input.runtimeMode,
          cwd: input.cwd ?? options.defaultCwd,
          ...(model ? { model } : {}),
          threadId: input.threadId,
          ...(conversationId
            ? {
                resumeCursor: {
                  schemaVersion: RESUME_SCHEMA_VERSION,
                  conversationId,
                },
              }
            : {}),
          createdAt: now,
          updatedAt: now,
        };
        sessions.set(input.threadId, {
          session,
          conversationId,
          cliModel: resolveAntigravityCliModel(
            input.modelSelection?.model,
            input.modelSelection?.options,
          ),
          activeProcess: undefined,
          interrupted: false,
          turns: [],
        });
        yield* offer({
          type: "session.started",
          ...stamp(),
          provider: PROVIDER,
          ...(options.instanceId ? { providerInstanceId: options.instanceId } : {}),
          threadId: input.threadId,
          payload: input.resumeCursor ? { resume: input.resumeCursor } : {},
        });
        yield* offer({
          type: "session.state.changed",
          ...stamp(),
          provider: PROVIDER,
          ...(options.instanceId ? { providerInstanceId: options.instanceId } : {}),
          threadId: input.threadId,
          payload: { state: "ready", reason: "Antigravity CLI session ready" },
        });
        yield* offer({
          type: "thread.started",
          ...stamp(),
          provider: PROVIDER,
          ...(options.instanceId ? { providerInstanceId: options.instanceId } : {}),
          threadId: input.threadId,
          payload: conversationId ? { providerThreadId: conversationId } : {},
        });
        return session;
      }),

    sendTurn: (input) =>
      Effect.gen(function* () {
        const context = yield* requireSession(input.threadId);
        if (context.activeProcess) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "turn/start",
            issue: "An Antigravity turn is already running for this thread.",
          });
        }
        const prompt = appendFileAttachmentsPromptBlock({
          text: input.input?.trim(),
          attachments: input.attachments,
          attachmentsDir: options.attachmentsDir,
          include: "all-files",
          includeImage: () => true,
        })?.trim();
        if (!prompt) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "turn/start",
            issue: "Antigravity requires non-empty text input.",
          });
        }
        const selection = input.modelSelection;
        const displayModel = selection?.model ?? context.session.model;
        const cliModel = selection
          ? resolveAntigravityCliModel(selection.model, selection.options)
          : context.cliModel;
        const turnId = randomUUID() as TurnId;
        const itemId = randomUUID() as RuntimeItemId;
        context.interrupted = false;
        context.cliModel = cliModel;
        context.session = {
          ...context.session,
          status: "running",
          activeTurnId: turnId,
          ...(displayModel ? { model: displayModel } : {}),
          updatedAt: new Date().toISOString(),
        };
        yield* offer({
          type: "turn.started",
          ...stamp(),
          provider: PROVIDER,
          ...(options.instanceId ? { providerInstanceId: options.instanceId } : {}),
          threadId: input.threadId,
          turnId,
          payload: displayModel ? { model: displayModel } : {},
        });

        const args = [
          ...(context.conversationId
            ? ["--conversation", context.conversationId]
            : ["--new-project"]),
          "--dangerously-skip-permissions",
          ...(cliModel ? ["--model", cliModel] : []),
          ...(input.interactionMode === "plan" ? ["--mode", "plan"] : []),
          "--output-format",
          "json",
          "--print-timeout",
          PRINT_TIMEOUT,
          "-p",
          prompt,
        ];
        const child = yield* Effect.try({
          try: () =>
            spawn(binaryPath, args, {
              cwd: context.session.cwd ?? options.defaultCwd,
              env: environment,
              stdio: ["pipe", "pipe", "pipe"],
            }),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "turn/start",
              detail: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        });
        context.activeProcess = child;
        let stdout = "";
        let stderr = "";
        let settled = false;
        child.stdin.end();
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => (stdout += chunk));
        child.stderr.on("data", (chunk: string) => (stderr += chunk));

        const settle = (code: number | null, signal: NodeJS.Signals | null, cause?: unknown) => {
          if (settled) return;
          settled = true;
          if (context.activeProcess !== child || context.session.activeTurnId !== turnId) return;
          context.activeProcess = undefined;
          Effect.runFork(
            Effect.gen(function* () {
              let result: AntigravityJsonResult | undefined;
              let errorMessage: string | undefined;
              if (!context.interrupted && code === 0 && cause === undefined) {
                const parsed = yield* Effect.try({
                  try: () => parseResult(stdout),
                  catch: (parseCause) =>
                    parseCause instanceof Error ? parseCause.message : String(parseCause),
                }).pipe(Effect.result);
                if (Result.isSuccess(parsed)) {
                  result = parsed.success;
                } else {
                  errorMessage = parsed.failure;
                }
              } else {
                errorMessage =
                  stderr.trim() ||
                  (cause instanceof Error
                    ? cause.message
                    : `Antigravity CLI exited with code ${String(code)} (${String(signal)}).`);
              }

              if (result) {
                context.conversationId = result.conversation_id;
                const resumeCursor = {
                  schemaVersion: RESUME_SCHEMA_VERSION,
                  conversationId: result.conversation_id,
                };
                context.turns.push({ id: turnId, items: [{ text: result.response }] });
                context.session = {
                  ...context.session,
                  status: result.status === "SUCCESS" ? "ready" : "error",
                  activeTurnId: undefined,
                  resumeCursor,
                  updatedAt: new Date().toISOString(),
                };
                if (result.response.length > 0) {
                  yield* offer({
                    type: "item.started",
                    ...stamp(),
                    provider: PROVIDER,
                    ...(options.instanceId ? { providerInstanceId: options.instanceId } : {}),
                    threadId: input.threadId,
                    turnId,
                    itemId,
                    payload: { itemType: "assistant_message", status: "inProgress" },
                  });
                  yield* offer({
                    type: "content.delta",
                    ...stamp(),
                    provider: PROVIDER,
                    ...(options.instanceId ? { providerInstanceId: options.instanceId } : {}),
                    threadId: input.threadId,
                    turnId,
                    itemId,
                    payload: { streamKind: "assistant_text", delta: result.response },
                  });
                  yield* offer({
                    type: "item.completed",
                    ...stamp(),
                    provider: PROVIDER,
                    ...(options.instanceId ? { providerInstanceId: options.instanceId } : {}),
                    threadId: input.threadId,
                    turnId,
                    itemId,
                    payload: { itemType: "assistant_message", status: "completed" },
                  });
                }
              } else {
                context.session = {
                  ...context.session,
                  status: context.interrupted ? "ready" : "error",
                  activeTurnId: undefined,
                  updatedAt: new Date().toISOString(),
                };
              }
              yield* offer({
                type: "turn.completed",
                ...stamp(),
                provider: PROVIDER,
                ...(options.instanceId ? { providerInstanceId: options.instanceId } : {}),
                threadId: input.threadId,
                turnId,
                payload: result
                  ? {
                      state: result.status === "SUCCESS" ? "completed" : "failed",
                      usage: result.usage,
                    }
                  : {
                      state: context.interrupted ? "interrupted" : "failed",
                      errorMessage: errorMessage ?? "Antigravity CLI turn failed.",
                    },
              });
            }),
          );
        };
        child.once("error", (cause) => settle(null, null, cause));
        child.once("close", (code, signal) => settle(code, signal));

        return {
          threadId: input.threadId,
          turnId,
          ...(context.session.resumeCursor !== undefined
            ? { resumeCursor: context.session.resumeCursor }
            : {}),
        };
      }),

    interruptTurn: (threadId) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        context.interrupted = true;
        yield* stopProcess(context);
      }),
    respondToRequest: () =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "request/respond",
          detail: "Antigravity print mode does not expose interactive approval requests.",
        }),
      ),
    respondToUserInput: () =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "user-input/respond",
          detail: "Antigravity print mode does not expose structured user-input requests.",
        }),
      ),
    stopSession: (threadId) =>
      Effect.gen(function* () {
        const context = sessions.get(threadId);
        if (!context) return;
        context.interrupted = true;
        yield* Effect.ignore(stopProcess(context));
        sessions.delete(threadId);
        yield* offer({
          type: "session.exited",
          ...stamp(),
          provider: PROVIDER,
          ...(options.instanceId ? { providerInstanceId: options.instanceId } : {}),
          threadId,
          payload: { reason: "Session stopped", exitKind: "graceful" },
        });
      }),
    listSessions: () => Effect.sync(() => [...sessions.values()].map(({ session }) => session)),
    hasSession: (threadId) => Effect.sync(() => sessions.has(threadId)),
    readThread: (threadId) =>
      Effect.map(requireSession(threadId), (context) => ({
        threadId,
        turns: context.turns,
      })),
    rollbackThread: (threadId, numTurns) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        if (numTurns > 0) context.turns.splice(Math.max(0, context.turns.length - numTurns));
        return { threadId, turns: context.turns };
      }),
    stopAll: () =>
      Effect.forEach([...sessions.keys()], (threadId) => adapter.stopSession(threadId), {
        discard: true,
      }),
  };

  return adapter;
});
