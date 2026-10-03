import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ModelSelection, ProviderRuntimeEvent, ProviderSession } from "@tabs/contracts";
import {
  ApprovalRequestId,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  ProviderInstanceId,
  ProviderDriverKind,
} from "@tabs/contracts";
import { Effect, Exit, Layer, ManagedRuntime, PubSub, Scope, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { deriveServerPaths, ServerConfig } from "../../config.ts";
import { TextGenerationError } from "../../git/Errors.ts";
import { ProviderAdapterRequestError } from "../../provider/Errors.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { GitCore, type GitCoreShape } from "../../git/Services/GitCore.ts";
import { TextGeneration, type TextGenerationShape } from "../../textGeneration/TextGeneration";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { ProviderCommandReactorLive } from "./ProviderCommandReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProviderCommandReactor } from "../Services/ProviderCommandReactor.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ServerSettingsService } from "../../serverSettings.ts";

const asProjectId = (value: string): ProjectId => value as ProjectId;
const asApprovalRequestId = (value: string): ApprovalRequestId => value as ApprovalRequestId;
const asMessageId = (value: string): MessageId => value as MessageId;
const asTurnId = (value: string): TurnId => value as TurnId;

const deriveServerPathsSync = (baseDir: string, devUrl: URL | undefined) =>
  Effect.runSync(deriveServerPaths(baseDir, devUrl).pipe(Effect.provide(NodeServices.layer)));

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const poll = async (): Promise<void> => {
    if (await predicate()) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for expectation.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    return poll();
  };

  return poll();
}

describe("ProviderCommandReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<
    OrchestrationEngineService | ProviderCommandReactor,
    unknown
  > | null = null;
  let scope: Scope.Closeable | null = null;
  const createdStateDirs = new Set<string>();
  const createdBaseDirs = new Set<string>();

  afterEach(async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    scope = null;
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
    for (const stateDir of createdStateDirs) {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
    createdStateDirs.clear();
    for (const baseDir of createdBaseDirs) {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
    createdBaseDirs.clear();
  });

  async function createHarness(input?: {
    readonly baseDir?: string;
    readonly threadModelSelection?: ModelSelection;
    readonly sessionModelSwitch?: "unsupported" | "in-session";
    readonly compactThreadEffect?: () => Effect.Effect<void, any>;
  }) {
    const now = new Date().toISOString();
    const baseDir = input?.baseDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "tabs-reactor-"));
    createdBaseDirs.add(baseDir);
    const { stateDir } = deriveServerPathsSync(baseDir, undefined);
    createdStateDirs.add(stateDir);
    const runtimeEventPubSub = Effect.runSync(PubSub.unbounded<ProviderRuntimeEvent>());
    let nextSessionIndex = 1;
    const runtimeSessions: Array<ProviderSession> = [];
    const modelSelection = input?.threadModelSelection ?? {
      instanceId: "codex" as ProviderInstanceId,
      model: "gpt-5-codex",
    };
    const startSession = vi.fn((_: unknown, input: unknown) => {
      const sessionIndex = nextSessionIndex++;
      const resumeCursor =
        typeof input === "object" && input !== null && "resumeCursor" in input
          ? input.resumeCursor
          : undefined;
      const threadId =
        typeof input === "object" &&
        input !== null &&
        "threadId" in input &&
        typeof input.threadId === "string"
          ? (input.threadId as ThreadId)
          : (`thread-${sessionIndex}` as ThreadId);
      const session: ProviderSession = {
        provider: modelSelection.instanceId as unknown as ProviderDriverKind,
        status: "ready" as const,
        runtimeMode:
          typeof input === "object" &&
          input !== null &&
          "runtimeMode" in input &&
          (input.runtimeMode === "approval-required" || input.runtimeMode === "full-access")
            ? input.runtimeMode
            : "full-access",
        ...(modelSelection.model !== undefined ? { model: modelSelection.model } : {}),
        threadId,
        resumeCursor: resumeCursor ?? { opaque: `resume-${sessionIndex}` },
        createdAt: now,
        updatedAt: now,
      };
      runtimeSessions.push(session);
      return Effect.succeed(session);
    });
    const sendTurn = vi.fn((_: unknown) =>
      Effect.succeed({
        threadId: "thread-1" as ThreadId,
        turnId: asTurnId("turn-1"),
      }),
    );
    const interruptTurn = vi.fn((_: unknown) => Effect.void);
    const respondToRequest = vi.fn<ProviderServiceShape["respondToRequest"]>(() => Effect.void);
    const respondToUserInput = vi.fn<ProviderServiceShape["respondToUserInput"]>(() => Effect.void);
    const stopSession = vi.fn((input: unknown) =>
      Effect.sync(() => {
        const threadId =
          typeof input === "object" && input !== null && "threadId" in input
            ? (input as { threadId?: ThreadId }).threadId
            : undefined;
        if (!threadId) {
          return;
        }
        const index = runtimeSessions.findIndex((session) => session.threadId === threadId);
        if (index >= 0) {
          runtimeSessions.splice(index, 1);
        }
      }),
    );
    const renameBranch = vi.fn((input: unknown) =>
      Effect.succeed({
        branch:
          typeof input === "object" &&
          input !== null &&
          "newBranch" in input &&
          typeof input.newBranch === "string"
            ? input.newBranch
            : "renamed-branch",
      }),
    );
    const generateBranchName = vi.fn(() =>
      Effect.fail(
        new TextGenerationError({
          operation: "generateBranchName",
          detail: "disabled in test harness",
        }),
      ),
    );

    const compactThread = vi.fn((_: ThreadId) => input?.compactThreadEffect?.() ?? Effect.void);
    const unsupported = () => Effect.die(new Error("Unsupported provider call in test")) as never;
    const service: ProviderServiceShape = {
      startSession: startSession as ProviderServiceShape["startSession"],
      sendTurn: sendTurn as ProviderServiceShape["sendTurn"],
      compactThread,
      interruptTurn: interruptTurn as ProviderServiceShape["interruptTurn"],
      respondToRequest: respondToRequest as ProviderServiceShape["respondToRequest"],
      respondToUserInput: respondToUserInput as ProviderServiceShape["respondToUserInput"],
      stopSession: stopSession as ProviderServiceShape["stopSession"],
      listSessions: () => Effect.succeed(runtimeSessions),
      getCapabilities: (_provider) =>
        Effect.succeed({
          sessionModelSwitch: input?.sessionModelSwitch ?? "in-session",
        }),
      rollbackConversation: () => unsupported(),
      getInstanceInfo: () => unsupported(),
      streamEvents: Stream.fromPubSub(runtimeEventPubSub),
      subscribeEvents: PubSub.subscribe(runtimeEventPubSub),
    };

    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(SqlitePersistenceMemory),
    );
    const layer = ProviderCommandReactorLive.pipe(
      Layer.provideMerge(orchestrationLayer),
      Layer.provideMerge(Layer.succeed(ProviderService, service)),
      Layer.provideMerge(Layer.succeed(GitCore, { renameBranch } as unknown as GitCoreShape)),
      Layer.provideMerge(
        Layer.succeed(TextGeneration, { generateBranchName } as unknown as TextGenerationShape),
      ),
      Layer.provideMerge(ServerSettingsService.layerTest()),
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir)),
      Layer.provideMerge(NodeServices.layer),
    );
    const runtime = ManagedRuntime.make(layer);

    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const reactor = await runtime.runPromise(Effect.service(ProviderCommandReactor));
    scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start.pipe(Scope.provide(scope)));
    const drain = () => Effect.runPromise(reactor.drain);

    await Effect.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: "cmd-project-create" as CommandId,
        projectId: asProjectId("project-1"),
        title: "Provider Project",
        workspaceRoot: "/tmp/provider-project",
        defaultModelSelection: modelSelection,
        createdAt: now,
      }),
    );
    await Effect.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: "cmd-thread-create" as CommandId,
        threadId: "thread-1" as ThreadId,
        projectId: asProjectId("project-1"),
        title: "Thread",
        modelSelection: modelSelection,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt: now,
      }),
    );

    return {
      engine,
      readModel: () => Effect.runPromise(engine.getReadModel()),
      startSession,
      sendTurn,
      compactThread,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      stopSession,
      renameBranch,
      generateBranchName,
      stateDir,
      drain,
    };
  }

  it("reacts to thread.turn.start by ensuring session and sending provider turn", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: "cmd-turn-start-1" as CommandId,
        threadId: "thread-1" as ThreadId,
        message: {
          messageId: asMessageId("user-message-1"),
          role: "user",
          text: "hello reactor",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.startSession.mock.calls[0]?.[0]).toEqual("thread-1" as ThreadId);
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      cwd: "/tmp/provider-project",
      modelSelection: {
        instanceId: "codex",
        model: "gpt-5-codex",
      },
      runtimeMode: "approval-required",
    });

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === ("thread-1" as ThreadId));
    expect(thread?.session?.threadId).toBe("thread-1");
    expect(thread?.session?.runtimeMode).toBe("approval-required");
  });

  it("forwards codex model options through session start and turn send", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: "cmd-turn-start-fast" as CommandId,
        threadId: "thread-1" as ThreadId,
        message: {
          messageId: asMessageId("user-message-fast"),
          role: "user",
          text: "hello fast mode",
          attachments: [],
        },
        modelSelection: {
          instanceId: "codex" as ProviderInstanceId,
          model: "gpt-5.3-codex",
          options: [
            { id: "reasoningEffort", value: "high" },
            { id: "fastMode", value: true },
          ],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      modelSelection: {
        instanceId: "codex",
        model: "gpt-5.3-codex",
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ],
      },
    });
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: "thread-1" as ThreadId,
      modelSelection: {
        instanceId: "codex",
        model: "gpt-5.3-codex",
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ],
      },
    });
  });

  it("forwards claude effort options through session start and turn send", async () => {
    const harness = await createHarness({
      threadModelSelection: {
        instanceId: "claudeAgent" as ProviderInstanceId,
        model: "claude-sonnet-4-6",
      },
    });
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: "cmd-turn-start-claude-effort" as CommandId,
        threadId: "thread-1" as ThreadId,
        message: {
          messageId: asMessageId("user-message-claude-effort"),
          role: "user",
          text: "hello with effort",
          attachments: [],
        },
        modelSelection: {
          instanceId: "claudeAgent" as ProviderInstanceId,
          model: "claude-sonnet-4-6",
          options: [{ id: "effort", value: "max" }],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      modelSelection: {
        instanceId: "claudeAgent",
        model: "claude-sonnet-4-6",
        options: [{ id: "effort", value: "max" }],
      },
    });
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: "thread-1" as ThreadId,
      modelSelection: {
        instanceId: "claudeAgent",
        model: "claude-sonnet-4-6",
        options: [{ id: "effort", value: "max" }],
      },
    });
  });

  it("forwards claude fast mode options through session start and turn send", async () => {
    const harness = await createHarness({
      threadModelSelection: {
        instanceId: "claudeAgent" as ProviderInstanceId,
        model: "claude-opus-4-6",
      },
    });
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: "cmd-turn-start-claude-fast-mode" as CommandId,
        threadId: "thread-1" as ThreadId,
        message: {
          messageId: asMessageId("user-message-claude-fast-mode"),
          role: "user",
          text: "hello with fast mode",
          attachments: [],
        },
        modelSelection: {
          instanceId: "claudeAgent" as ProviderInstanceId,
          model: "claude-opus-4-6",
          options: [{ id: "fastMode", value: true }],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      modelSelection: {
        instanceId: "claudeAgent",
        model: "claude-opus-4-6",
        options: [{ id: "fastMode", value: true }],
      },
    });
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: "thread-1" as ThreadId,
      modelSelection: {
        instanceId: "claudeAgent",
        model: "claude-opus-4-6",
        options: [{ id: "fastMode", value: true }],
      },
    });
  });

  it("forwards plan interaction mode to the provider turn request", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.interaction-mode.set",
        commandId: "cmd-interaction-mode-set-plan" as CommandId,
        threadId: "thread-1" as ThreadId,
        interactionMode: "plan",
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: "cmd-turn-start-plan" as CommandId,
        threadId: "thread-1" as ThreadId,
        message: {
          messageId: asMessageId("user-message-plan"),
          role: "user",
          text: "plan this change",
          attachments: [],
        },
        interactionMode: "plan",
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: "thread-1" as ThreadId,
      interactionMode: "plan",
    });
  });

  it("rejects a first turn when requested provider conflicts with the thread model", async () => {
    const harness = await createHarness({
      threadModelSelection: {
        instanceId: "codex" as ProviderInstanceId,
        model: "gpt-5-codex",
      },
    });
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: "cmd-turn-start-provider-first" as CommandId,
        threadId: "thread-1" as ThreadId,
        message: {
          messageId: asMessageId("user-message-provider-first"),
          role: "user",
          text: "hello claude",
          attachments: [],
        },
        modelSelection: {
          instanceId: "claudeAgent" as ProviderInstanceId,
          model: "claude-opus-4-6",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(async () => {
      const readModel = await Effect.runPromise(harness.engine.getReadModel());
      const thread = readModel.threads.find((entry) => entry.id === ("thread-1" as ThreadId));
      return (
        thread?.activities.some((activity) => activity.kind === "provider.turn.start.failed") ??
        false
      );
    });

    expect(harness.startSession).not.toHaveBeenCalled();
    expect(harness.sendTurn).not.toHaveBeenCalled();

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === ("thread-1" as ThreadId));
    expect(thread?.session).toBeNull();
    expect(
      thread?.activities.find((activity) => activity.kind === "provider.turn.start.failed"),
    ).toMatchObject({
      summary: "Provider turn start failed",
      payload: {
        detail: expect.stringContaining("cannot switch to 'claudeAgent'"),
      },
    });
  });

  it("preserves the active session model when in-session model switching is unsupported", async () => {
    const harness = await createHarness({ sessionModelSwitch: "unsupported" });
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: "cmd-turn-start-unsupported-1" as CommandId,
        threadId: "thread-1" as ThreadId,
        message: {
          messageId: asMessageId("user-message-unsupported-1"),
          role: "user",
          text: "first",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: "cmd-turn-start-unsupported-2" as CommandId,
        threadId: "thread-1" as ThreadId,
        message: {
          messageId: asMessageId("user-message-unsupported-2"),
          role: "user",
          text: "second",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 2);

    expect(harness.sendTurn.mock.calls[1]?.[0]).toMatchObject({
      threadId: "thread-1" as ThreadId,
      modelSelection: {
        instanceId: "codex",
        model: "gpt-5-codex",
      },
    });
  });

  it("reuses the same provider session when runtime mode is unchanged", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: "cmd-turn-start-unchanged-1" as CommandId,
        threadId: "thread-1" as ThreadId,
        message: {
          messageId: asMessageId("user-message-unchanged-1"),
          role: "user",
          text: "first",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: "cmd-turn-start-unchanged-2" as CommandId,
        threadId: "thread-1" as ThreadId,
        message: {
          messageId: asMessageId("user-message-unchanged-2"),
          role: "user",
          text: "second",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 2);
    expect(harness.startSession.mock.calls.length).toBe(1);
    expect(harness.stopSession.mock.calls.length).toBe(0);
  });

  it("restarts claude sessions when claude effort changes", async () => {
    const harness = await createHarness({
      threadModelSelection: {
        instanceId: "claudeAgent" as ProviderInstanceId,
        model: "claude-sonnet-4-6",
      },
    });
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: "cmd-turn-start-claude-effort-1" as CommandId,
        threadId: "thread-1" as ThreadId,
        message: {
          messageId: asMessageId("user-message-claude-effort-1"),
          role: "user",
          text: "first claude turn",
          attachments: [],
        },
        modelSelection: {
          instanceId: "claudeAgent" as ProviderInstanceId,
          model: "claude-sonnet-4-6",
          options: [{ id: "effort", value: "medium" }],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: "cmd-turn-start-claude-effort-2" as CommandId,
        threadId: "thread-1" as ThreadId,
        message: {
          messageId: asMessageId("user-message-claude-effort-2"),
          role: "user",
          text: "second claude turn",
          attachments: [],
        },
        modelSelection: {
          instanceId: "claudeAgent" as ProviderInstanceId,
          model: "claude-sonnet-4-6",
          options: [{ id: "effort", value: "max" }],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 2);
    await waitFor(() => harness.sendTurn.mock.calls.length === 2);
    expect(harness.startSession.mock.calls[1]?.[1]).toMatchObject({
      resumeCursor: { opaque: "resume-1" },
      modelSelection: {
        instanceId: "claudeAgent",
        model: "claude-sonnet-4-6",
        options: [{ id: "effort", value: "max" }],
      },
    });
  });

  it("restarts the provider session when runtime mode is updated on the thread", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.runtime-mode.set",
        commandId: "cmd-runtime-mode-set-initial-full-access" as CommandId,
        threadId: "thread-1" as ThreadId,
        runtimeMode: "full-access",
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: "cmd-turn-start-runtime-mode-1" as CommandId,
        threadId: "thread-1" as ThreadId,
        message: {
          messageId: asMessageId("user-message-runtime-mode-1"),
          role: "user",
          text: "first",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.runtime-mode.set",
        commandId: "cmd-runtime-mode-set-1" as CommandId,
        threadId: "thread-1" as ThreadId,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(async () => {
      const readModel = await Effect.runPromise(harness.engine.getReadModel());
      const thread = readModel.threads.find((entry) => entry.id === ("thread-1" as ThreadId));
      return thread?.runtimeMode === "approval-required";
    });
    await waitFor(() => harness.startSession.mock.calls.length === 2);
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: "cmd-turn-start-runtime-mode-2" as CommandId,
        threadId: "thread-1" as ThreadId,
        message: {
          messageId: asMessageId("user-message-runtime-mode-2"),
          role: "user",
          text: "second",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 2);

    expect(harness.stopSession.mock.calls.length).toBe(0);
    expect(harness.startSession.mock.calls[1]?.[1]).toMatchObject({
      threadId: "thread-1" as ThreadId,
      resumeCursor: { opaque: "resume-1" },
      runtimeMode: "approval-required",
    });
    expect(harness.sendTurn.mock.calls[1]?.[0]).toMatchObject({
      threadId: "thread-1" as ThreadId,
    });

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === ("thread-1" as ThreadId));
    expect(thread?.session?.threadId).toBe("thread-1");
    expect(thread?.session?.runtimeMode).toBe("approval-required");
  });

  it("does not inject derived model options when restarting claude on runtime mode changes", async () => {
    const harness = await createHarness({
      threadModelSelection: {
        instanceId: "claudeAgent" as ProviderInstanceId,
        model: "claude-opus-4-6",
      },
    });
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: "cmd-session-set-runtime-mode-claude" as CommandId,
        threadId: "thread-1" as ThreadId,
        session: {
          threadId: "thread-1" as ThreadId,
          status: "ready",
          providerName: "claudeAgent",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.runtime-mode.set",
        commandId: "cmd-runtime-mode-set-claude-no-options" as CommandId,
        threadId: "thread-1" as ThreadId,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);

    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      modelSelection: {
        instanceId: "claudeAgent",
        model: "claude-opus-4-6",
      },
      runtimeMode: "approval-required",
    });
  });

  it("rejects provider changes after a thread is already bound to a session provider", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: "cmd-turn-start-provider-switch-1" as CommandId,
        threadId: "thread-1" as ThreadId,
        message: {
          messageId: asMessageId("user-message-provider-switch-1"),
          role: "user",
          text: "first",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: "cmd-turn-start-provider-switch-2" as CommandId,
        threadId: "thread-1" as ThreadId,
        message: {
          messageId: asMessageId("user-message-provider-switch-2"),
          role: "user",
          text: "second",
          attachments: [],
        },
        modelSelection: {
          instanceId: "claudeAgent" as ProviderInstanceId,
          model: "claude-opus-4-6",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(async () => {
      const readModel = await Effect.runPromise(harness.engine.getReadModel());
      const thread = readModel.threads.find((entry) => entry.id === ("thread-1" as ThreadId));
      return (
        thread?.activities.some((activity) => activity.kind === "provider.turn.start.failed") ??
        false
      );
    });

    expect(harness.startSession.mock.calls.length).toBe(1);
    expect(harness.sendTurn.mock.calls.length).toBe(1);
    expect(harness.stopSession.mock.calls.length).toBe(0);

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === ("thread-1" as ThreadId));
    expect(thread?.session?.threadId).toBe("thread-1");
    expect(thread?.session?.providerName).toBe("codex");
    expect(thread?.session?.runtimeMode).toBe("approval-required");
    expect(
      thread?.activities.find((activity) => activity.kind === "provider.turn.start.failed"),
    ).toMatchObject({
      payload: {
        detail: expect.stringContaining("cannot switch to 'claudeAgent'"),
      },
    });
  });

  it("does not stop the active session when restart fails before rebind", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.runtime-mode.set",
        commandId: "cmd-runtime-mode-set-initial-full-access-2" as CommandId,
        threadId: "thread-1" as ThreadId,
        runtimeMode: "full-access",
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: "cmd-turn-start-restart-failure-1" as CommandId,
        threadId: "thread-1" as ThreadId,
        message: {
          messageId: asMessageId("user-message-restart-failure-1"),
          role: "user",
          text: "first",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    harness.startSession.mockImplementationOnce(
      (_: unknown, __: unknown) => Effect.fail(new Error("simulated restart failure")) as never,
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.runtime-mode.set",
        commandId: "cmd-runtime-mode-set-restart-failure" as CommandId,
        threadId: "thread-1" as ThreadId,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(async () => {
      const readModel = await Effect.runPromise(harness.engine.getReadModel());
      const thread = readModel.threads.find((entry) => entry.id === ("thread-1" as ThreadId));
      return thread?.runtimeMode === "approval-required";
    });
    await waitFor(() => harness.startSession.mock.calls.length === 2);
    await harness.drain();

    expect(harness.stopSession.mock.calls.length).toBe(0);
    expect(harness.sendTurn.mock.calls.length).toBe(1);

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === ("thread-1" as ThreadId));
    expect(thread?.session?.threadId).toBe("thread-1");
    expect(thread?.session?.runtimeMode).toBe("full-access");
  });

  it("reacts to thread.turn.interrupt-requested by calling provider interrupt", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: "cmd-session-set" as CommandId,
        threadId: "thread-1" as ThreadId,
        session: {
          threadId: "thread-1" as ThreadId,
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: asTurnId("turn-1"),
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.interrupt",
        commandId: "cmd-turn-interrupt" as CommandId,
        threadId: "thread-1" as ThreadId,
        turnId: asTurnId("turn-1"),
        createdAt: now,
      }),
    );

    await waitFor(() => harness.interruptTurn.mock.calls.length === 1);
    expect(harness.interruptTurn.mock.calls[0]?.[0]).toEqual({
      threadId: "thread-1",
    });
  });

  it("reacts to thread.approval.respond by forwarding provider approval response", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: "cmd-session-set-for-approval" as CommandId,
        threadId: "thread-1" as ThreadId,
        session: {
          threadId: "thread-1" as ThreadId,
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.approval.respond",
        commandId: "cmd-approval-respond" as CommandId,
        threadId: "thread-1" as ThreadId,
        requestId: asApprovalRequestId("approval-request-1"),
        decision: "accept",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.respondToRequest.mock.calls.length === 1);
    expect(harness.respondToRequest.mock.calls[0]?.[0]).toEqual({
      threadId: "thread-1",
      requestId: "approval-request-1",
      decision: "accept",
    });
  });

  it("reacts to thread.user-input.respond by forwarding structured user input answers", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: "cmd-session-set-for-user-input" as CommandId,
        threadId: "thread-1" as ThreadId,
        session: {
          threadId: "thread-1" as ThreadId,
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.user-input.respond",
        commandId: "cmd-user-input-respond" as CommandId,
        threadId: "thread-1" as ThreadId,
        requestId: asApprovalRequestId("user-input-request-1"),
        answers: {
          sandbox_mode: "workspace-write",
        },
        createdAt: now,
      }),
    );

    await waitFor(() => harness.respondToUserInput.mock.calls.length === 1);
    expect(harness.respondToUserInput.mock.calls[0]?.[0]).toEqual({
      threadId: "thread-1",
      requestId: "user-input-request-1",
      answers: {
        sandbox_mode: "workspace-write",
      },
    });
  });

  it("surfaces stale provider approval request failures without faking approval resolution", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    harness.respondToRequest.mockImplementation(() =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: "codex",
          method: "session/request_permission",
          detail: "Unknown pending permission request: approval-request-1",
        }),
      ),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: "cmd-session-set-for-approval-error" as CommandId,
        threadId: "thread-1" as ThreadId,
        session: {
          threadId: "thread-1" as ThreadId,
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.activity.append",
        commandId: "cmd-approval-requested" as CommandId,
        threadId: "thread-1" as ThreadId,
        activity: {
          id: "activity-approval-requested" as EventId,
          tone: "approval",
          kind: "approval.requested",
          summary: "Command approval requested",
          payload: {
            requestId: "approval-request-1",
            requestKind: "command",
          },
          turnId: null,
          createdAt: now,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.approval.respond",
        commandId: "cmd-approval-respond-stale" as CommandId,
        threadId: "thread-1" as ThreadId,
        requestId: asApprovalRequestId("approval-request-1"),
        decision: "acceptForSession",
        createdAt: now,
      }),
    );

    await waitFor(async () => {
      const readModel = await Effect.runPromise(harness.engine.getReadModel());
      const thread = readModel.threads.find((entry) => entry.id === ("thread-1" as ThreadId));
      if (!thread) return false;
      return thread.activities.some(
        (activity) => activity.kind === "provider.approval.respond.failed",
      );
    });

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === ("thread-1" as ThreadId));
    expect(thread).toBeDefined();

    const failureActivity = thread?.activities.find(
      (activity) => activity.kind === "provider.approval.respond.failed",
    );
    expect(failureActivity).toBeDefined();
    expect(failureActivity?.payload).toMatchObject({
      requestId: "approval-request-1",
      detail: expect.stringContaining("Stale pending approval request: approval-request-1"),
    });

    const resolvedActivity = thread?.activities.find(
      (activity) =>
        activity.kind === "approval.resolved" &&
        typeof activity.payload === "object" &&
        activity.payload !== null &&
        (activity.payload as Record<string, unknown>).requestId === "approval-request-1",
    );
    expect(resolvedActivity).toBeUndefined();
  });

  it("surfaces stale provider user-input failures without faking user-input resolution", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();
    harness.respondToUserInput.mockImplementation(() =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: "claudeAgent",
          method: "item/tool/respondToUserInput",
          detail: "Unknown pending user-input request: user-input-request-1",
        }),
      ),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: "cmd-session-set-for-user-input-error" as CommandId,
        threadId: "thread-1" as ThreadId,
        session: {
          threadId: "thread-1" as ThreadId,
          status: "running",
          providerName: "claudeAgent",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.activity.append",
        commandId: "cmd-user-input-requested" as CommandId,
        threadId: "thread-1" as ThreadId,
        activity: {
          id: "activity-user-input-requested" as EventId,
          tone: "info",
          kind: "user-input.requested",
          summary: "User input requested",
          payload: {
            requestId: "user-input-request-1",
            questions: [
              {
                id: "sandbox_mode",
                header: "Sandbox",
                question: "Which mode should be used?",
                options: [
                  {
                    label: "workspace-write",
                    description: "Allow workspace writes only",
                  },
                ],
              },
            ],
          },
          turnId: null,
          createdAt: now,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.user-input.respond",
        commandId: "cmd-user-input-respond-stale" as CommandId,
        threadId: "thread-1" as ThreadId,
        requestId: asApprovalRequestId("user-input-request-1"),
        answers: {
          sandbox_mode: "workspace-write",
        },
        createdAt: now,
      }),
    );

    await waitFor(async () => {
      const readModel = await Effect.runPromise(harness.engine.getReadModel());
      const thread = readModel.threads.find((entry) => entry.id === ("thread-1" as ThreadId));
      if (!thread) return false;
      return thread.activities.some(
        (activity) => activity.kind === "provider.user-input.respond.failed",
      );
    });

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === ("thread-1" as ThreadId));
    expect(thread).toBeDefined();

    const failureActivity = thread?.activities.find(
      (activity) => activity.kind === "provider.user-input.respond.failed",
    );
    expect(failureActivity).toBeDefined();
    expect(failureActivity?.payload).toMatchObject({
      requestId: "user-input-request-1",
      detail: expect.stringContaining("Stale pending user-input request: user-input-request-1"),
    });

    const resolvedActivity = thread?.activities.find(
      (activity) =>
        activity.kind === "user-input.resolved" &&
        typeof activity.payload === "object" &&
        activity.payload !== null &&
        (activity.payload as Record<string, unknown>).requestId === "user-input-request-1",
    );
    expect(resolvedActivity).toBeUndefined();
  });

  it("reacts to thread.session.stop by stopping provider session and clearing thread session state", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: "cmd-session-set-for-stop" as CommandId,
        threadId: "thread-1" as ThreadId,
        session: {
          threadId: "thread-1" as ThreadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.stop",
        commandId: "cmd-session-stop" as CommandId,
        threadId: "thread-1" as ThreadId,
        createdAt: now,
      }),
    );

    await waitFor(() => harness.stopSession.mock.calls.length === 1);
    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === ("thread-1" as ThreadId));
    expect(thread?.session).not.toBeNull();
    expect(thread?.session?.status).toBe("stopped");
    expect(thread?.session?.threadId).toBe("thread-1");
    expect(thread?.session?.activeTurnId).toBeNull();
  });

  it("rejects /compact without conversation context", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: "cmd-empty-compact" as CommandId,
        threadId: "thread-1" as ThreadId,
        message: {
          messageId: asMessageId("user-message-empty-compact"),
          role: "user",
          text: "/compact",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await harness.drain();
    expect(harness.compactThread).not.toHaveBeenCalled();
    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === ("thread-1" as ThreadId));
    const failure = thread?.activities.find((a) => a.summary === "Context compaction failed");
    expect(failure).toBeDefined();
    expect((failure?.payload as Record<string, unknown>)?.detail).toContain(
      "Context compaction requires an existing conversation",
    );
  });

  it("queues messages until compaction restores the session and replays in deterministic order", async () => {
    let releaseCompaction: () => void = () => {};
    const compactionGate = new Promise<void>((resolve) => {
      releaseCompaction = resolve;
    });

    const harness = await createHarness({
      compactThreadEffect: () => Effect.promise(() => compactionGate),
    });
    const now = "2026-01-01T00:00:00.000Z";
    const threadId = "thread-1" as ThreadId;

    const dispatchTurn = (id: string, text: string, createdAt: string) =>
      Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: `cmd-${id}` as CommandId,
          threadId,
          message: {
            messageId: asMessageId(`user-message-${id}`),
            role: "user",
            text,
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt,
        }),
      );

    // Initial conversation context
    await dispatchTurn("before-compact", "hello world", now);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    await harness.drain();

    // Set session to ready
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: "cmd-session-ready" as CommandId,
        threadId,
        session: {
          threadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    // Start compaction (will block on compactionGate)
    await dispatchTurn("compact-cmd", "/compact", "2026-01-01T00:00:01.000Z");
    await waitFor(() => harness.compactThread.mock.calls.length === 1);

    // Send messages while compaction is active
    await dispatchTurn("during-compact-1", "first queued turn", "2026-01-01T00:00:02.000Z");
    await dispatchTurn("during-compact-2", "second queued turn", "2026-01-01T00:00:03.000Z");
    await harness.drain();

    // Still only 1 turn sent so far; the other 2 are queued
    expect(harness.sendTurn).toHaveBeenCalledTimes(1);

    // Release compaction
    releaseCompaction();
    await waitFor(() => harness.sendTurn.mock.calls.length === 3);
    await harness.drain();

    // Verify deterministic replay order
    expect(harness.sendTurn.mock.calls[1]?.[0]).toMatchObject({
      threadId,
      input: "first queued turn",
    });
    expect(harness.sendTurn.mock.calls[2]?.[0]).toMatchObject({
      threadId,
      input: "second queued turn",
    });

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === threadId);
    expect(thread?.session?.status).toBe("ready");
    expect(thread?.activities.filter((a) => a.kind === "provider.turn.start.failed")).toEqual([]);
  });

  it("cancels queued messages if session is stopped during compaction", async () => {
    let releaseCompaction: () => void = () => {};
    const compactionGate = new Promise<void>((resolve) => {
      releaseCompaction = resolve;
    });

    const harness = await createHarness({
      compactThreadEffect: () => Effect.promise(() => compactionGate),
    });
    const now = "2026-01-01T00:00:00.000Z";
    const threadId = "thread-1" as ThreadId;

    const dispatchTurn = (id: string, text: string, createdAt: string) =>
      Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: `cmd-${id}` as CommandId,
          threadId,
          message: {
            messageId: asMessageId(`user-message-${id}`),
            role: "user",
            text,
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt,
        }),
      );

    await dispatchTurn("init", "hello", now);
    await harness.drain();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: "cmd-session-ready" as CommandId,
        threadId,
        session: {
          threadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await dispatchTurn("compact", "/compact", "2026-01-01T00:00:01.000Z");
    await waitFor(() => harness.compactThread.mock.calls.length === 1);

    await dispatchTurn("queued", "queued turn to be canceled", "2026-01-01T00:00:02.000Z");
    await harness.drain();

    // Stop session during compaction
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.stop",
        commandId: "cmd-stop" as CommandId,
        threadId,
        createdAt: "2026-01-01T00:00:03.000Z",
      }),
    );
    await harness.drain();

    releaseCompaction();
    await harness.drain();

    // Queued turn was never sent to provider
    expect(harness.sendTurn).toHaveBeenCalledTimes(1);

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === threadId);
    expect(thread?.session?.status).toBe("stopped");
    const failure = thread?.activities.find((a) => a.summary === "Queued message was not sent");
    expect(failure).toBeDefined();
    expect((failure?.payload as Record<string, unknown>)?.detail).toContain(
      "The session was stopped during context compaction",
    );
    expect((failure?.payload as Record<string, unknown>)?.requestId).toBe("user-message-queued");
  });

  it("cancels queued messages if turn is interrupted during compaction", async () => {
    let releaseCompaction: () => void = () => {};
    const compactionGate = new Promise<void>((resolve) => {
      releaseCompaction = resolve;
    });

    const harness = await createHarness({
      compactThreadEffect: () => Effect.promise(() => compactionGate),
    });
    const now = "2026-01-01T00:00:00.000Z";
    const threadId = "thread-1" as ThreadId;

    const dispatchTurn = (id: string, text: string, createdAt: string) =>
      Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: `cmd-${id}` as CommandId,
          threadId,
          message: {
            messageId: asMessageId(`user-message-${id}`),
            role: "user",
            text,
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt,
        }),
      );

    await dispatchTurn("init", "hello", now);
    await harness.drain();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: "cmd-session-ready" as CommandId,
        threadId,
        session: {
          threadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await dispatchTurn("compact", "/compact", "2026-01-01T00:00:01.000Z");
    await waitFor(() => harness.compactThread.mock.calls.length === 1);

    await dispatchTurn("queued", "queued turn to be interrupted", "2026-01-01T00:00:02.000Z");
    await harness.drain();

    // Interrupt requested
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.interrupt",
        commandId: "cmd-interrupt" as CommandId,
        threadId,
        createdAt: "2026-01-01T00:00:03.000Z",
      }),
    );
    await harness.drain();

    releaseCompaction();
    await harness.drain();

    // Queued turn was never sent to provider
    expect(harness.sendTurn).toHaveBeenCalledTimes(1);

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === threadId);
    const failure = thread?.activities.find((a) => a.summary === "Queued message was not sent");
    expect(failure).toBeDefined();
    expect((failure?.payload as Record<string, unknown>)?.detail).toContain(
      "Context compaction was interrupted",
    );
  });

  it("cancels queued messages if context compaction fails", async () => {
    let rejectCompaction: (error: Error) => void = () => {};
    const compactionGate = new Promise<void>((_, reject) => {
      rejectCompaction = reject;
    });

    const harness = await createHarness({
      compactThreadEffect: () => Effect.tryPromise(() => compactionGate),
    });
    const now = "2026-01-01T00:00:00.000Z";
    const threadId = "thread-1" as ThreadId;

    const dispatchTurn = (id: string, text: string, createdAt: string) =>
      Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: `cmd-${id}` as CommandId,
          threadId,
          message: {
            messageId: asMessageId(`user-message-${id}`),
            role: "user",
            text,
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt,
        }),
      );

    await dispatchTurn("init", "hello", now);
    await harness.drain();

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: "cmd-session-ready" as CommandId,
        threadId,
        session: {
          threadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await dispatchTurn("compact", "/compact", "2026-01-01T00:00:01.000Z");
    await waitFor(() => harness.compactThread.mock.calls.length === 1);

    await dispatchTurn("queued", "queued turn during failed compact", "2026-01-01T00:00:02.000Z");
    await harness.drain();

    // Trigger compaction failure
    rejectCompaction(new Error("Provider internal compaction timeout"));
    await waitFor(async () => {
      const rm = await Effect.runPromise(harness.engine.getReadModel());
      const t = rm.threads.find((entry) => entry.id === threadId);
      return Boolean(
        t?.activities.some((a) => a.summary === "Context compaction failed") &&
        t?.activities.some((a) => a.summary === "Queued message was not sent"),
      );
    });
    await harness.drain();

    const readModel = await Effect.runPromise(harness.engine.getReadModel());
    const thread = readModel.threads.find((entry) => entry.id === threadId);
    const compactFailure = thread?.activities.find(
      (a) => a.summary === "Context compaction failed",
    );
    expect(compactFailure).toBeDefined();

    const queuedFailure = thread?.activities.find(
      (a) => a.summary === "Queued message was not sent",
    );
    expect(queuedFailure).toBeDefined();
    expect((queuedFailure?.payload as Record<string, unknown>)?.detail).toContain(
      "Context compaction failed. Send this message again to continue.",
    );
  });

  it("maintains strict queue isolation between multiple concurrent threads and environments", async () => {
    let releaseCompaction1: () => void = () => {};
    let releaseCompaction2: () => void = () => {};
    const gate1 = new Promise<void>((r) => {
      releaseCompaction1 = r;
    });
    const gate2 = new Promise<void>((r) => {
      releaseCompaction2 = r;
    });

    const thread1 = "thread-1" as ThreadId;
    const thread2 = "thread-2" as ThreadId;

    const harness = await createHarness({
      compactThreadEffect: () => Effect.void,
    });

    // Custom mock for compactThread that gates based on threadId
    harness.compactThread.mockImplementation((targetId: ThreadId) => {
      if (targetId === thread1) {
        return Effect.promise(() => gate1);
      }
      return Effect.promise(() => gate2);
    });

    const now = "2026-01-01T00:00:00.000Z";

    // Setup second project and thread (representing isolated environment)
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "project.create",
        commandId: "cmd-project-create-2" as CommandId,
        projectId: asProjectId("project-2"),
        title: "Remote Environment Project",
        workspaceRoot: "/tmp/remote-project",
        defaultModelSelection: { instanceId: "codex" as ProviderInstanceId, model: "gpt-5-codex" },
        createdAt: now,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: "cmd-thread-create-2" as CommandId,
        threadId: thread2,
        projectId: asProjectId("project-2"),
        title: "Thread 2",
        modelSelection: { instanceId: "codex" as ProviderInstanceId, model: "gpt-5-codex" },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt: now,
      }),
    );

    const dispatchTurn = (tId: ThreadId, id: string, text: string) =>
      Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: `cmd-${id}` as CommandId,
          threadId: tId,
          message: {
            messageId: asMessageId(`user-message-${id}`),
            role: "user",
            text,
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt: now,
        }),
      );

    // Initial turns
    await dispatchTurn(thread1, "init-t1", "hello t1");
    await dispatchTurn(thread2, "init-t2", "hello t2");
    await harness.drain();

    // Mark both ready
    for (const tId of [thread1, thread2]) {
      await Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.session.set",
          commandId: `cmd-session-ready-${tId}` as CommandId,
          threadId: tId,
          session: {
            threadId: tId,
            status: "ready",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: null,
            lastError: null,
            updatedAt: now,
          },
          createdAt: now,
        }),
      );
    }

    // Both start compaction concurrently
    await dispatchTurn(thread1, "compact-1", "/compact");
    await dispatchTurn(thread2, "compact-2", "/compact");
    await waitFor(() => harness.compactThread.mock.calls.length === 2);

    // Queue turns for both threads
    await dispatchTurn(thread1, "t1-queued", "turn for thread 1");
    await dispatchTurn(thread2, "t2-queued", "turn for thread 2");
    await harness.drain();

    // Only initial turns sent so far
    expect(harness.sendTurn).toHaveBeenCalledTimes(2);

    // Release thread2 compaction FIRST
    releaseCompaction2();
    await waitFor(() => harness.sendTurn.mock.calls.length === 3);
    await harness.drain();

    // Thread 2 received its queued turn, Thread 1 did NOT yet
    expect(harness.sendTurn.mock.calls[2]?.[0]).toMatchObject({
      threadId: thread2,
      input: "turn for thread 2",
    });

    // Now release thread1 compaction
    releaseCompaction1();
    await waitFor(() => harness.sendTurn.mock.calls.length === 4);
    await harness.drain();

    // Thread 1 received its queued turn
    expect(harness.sendTurn.mock.calls[3]?.[0]).toMatchObject({
      threadId: thread1,
      input: "turn for thread 1",
    });
  });
});
