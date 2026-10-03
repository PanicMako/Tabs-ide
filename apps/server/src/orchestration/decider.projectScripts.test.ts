import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  ProviderInstanceId,
} from "@tabs/contracts";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asEventId = (value: string): EventId => value as EventId;
const asProjectId = (value: string): ProjectId => value as ProjectId;
const asMessageId = (value: string): MessageId => value as MessageId;

describe("decider project scripts", () => {
  it("emits empty scripts on project.create", async () => {
    const now = new Date().toISOString();
    const readModel = createEmptyReadModel(now);

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "project.create",
          commandId: "cmd-project-create-scripts" as CommandId,
          projectId: asProjectId("project-scripts"),
          title: "Scripts",
          workspaceRoot: "/tmp/scripts",
          createdAt: now,
        },
        readModel,
      }),
    );

    const event = Array.isArray(result) ? result[0] : result;
    expect(event.type).toBe("project.created");
    expect((event.payload as { scripts: unknown[] }).scripts).toEqual([]);
  });

  it("propagates scripts in project.meta.update payload", async () => {
    const now = new Date().toISOString();
    const initial = createEmptyReadModel(now);
    const readModel = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create-scripts"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-scripts"),
        type: "project.created",
        occurredAt: now,
        commandId: "cmd-project-create-scripts" as CommandId,
        causationEventId: null,
        correlationId: "cmd-project-create-scripts" as CommandId,
        metadata: {},
        payload: {
          projectId: asProjectId("project-scripts"),
          title: "Scripts",
          workspaceRoot: "/tmp/scripts",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const scripts = [
      {
        id: "lint",
        name: "Lint",
        command: "bun run lint",
        icon: "lint",
        runOnWorktreeCreate: false,
      },
    ] as const;

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "project.meta.update",
          commandId: "cmd-project-update-scripts" as CommandId,
          projectId: asProjectId("project-scripts"),
          scripts: Array.from(scripts),
        },
        readModel,
      }),
    );

    const event = Array.isArray(result) ? result[0] : result;
    expect(event.type).toBe("project.meta-updated");
    expect((event.payload as { scripts?: unknown[] }).scripts).toEqual(scripts);
  });

  it("emits user message and turn-start-requested events for thread.turn.start", async () => {
    const now = new Date().toISOString();
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: "cmd-project-create" as CommandId,
        causationEventId: null,
        correlationId: "cmd-project-create" as CommandId,
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const readModel = await Effect.runPromise(
      projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create"),
        aggregateKind: "thread",
        aggregateId: "thread-1" as ThreadId,
        type: "thread.created",
        occurredAt: now,
        commandId: "cmd-thread-create" as CommandId,
        causationEventId: null,
        correlationId: "cmd-thread-create" as CommandId,
        metadata: {},
        payload: {
          threadId: "thread-1" as ThreadId,
          projectId: asProjectId("project-1"),
          title: "Thread",
          modelSelection: {
            instanceId: "codex" as ProviderInstanceId,
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.turn.start",
          commandId: "cmd-turn-start" as CommandId,
          threadId: "thread-1" as ThreadId,
          message: {
            messageId: asMessageId("message-user-1"),
            role: "user",
            text: "hello",
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
        },
        readModel,
      }),
    );

    expect(Array.isArray(result)).toBe(true);
    const events = Array.isArray(result) ? result : [result];
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("thread.message-sent");
    const turnStartEvent = events[1];
    expect(turnStartEvent?.type).toBe("thread.turn-start-requested");
    expect(turnStartEvent?.causationEventId).toBe(events[0]?.eventId ?? null);
    if (turnStartEvent?.type !== "thread.turn-start-requested") {
      return;
    }
    expect(turnStartEvent.payload).toMatchObject({
      threadId: "thread-1" as ThreadId,
      messageId: asMessageId("message-user-1"),
      modelSelection: {
        instanceId: "codex",
        model: "gpt-5.3-codex",
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ],
      },
      runtimeMode: "approval-required",
    });
  });

  it("emits thread.runtime-mode-set from thread.runtime-mode.set", async () => {
    const now = new Date().toISOString();
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: "cmd-project-create" as CommandId,
        causationEventId: null,
        correlationId: "cmd-project-create" as CommandId,
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const readModel = await Effect.runPromise(
      projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create"),
        aggregateKind: "thread",
        aggregateId: "thread-1" as ThreadId,
        type: "thread.created",
        occurredAt: now,
        commandId: "cmd-thread-create" as CommandId,
        causationEventId: null,
        correlationId: "cmd-thread-create" as CommandId,
        metadata: {},
        payload: {
          threadId: "thread-1" as ThreadId,
          projectId: asProjectId("project-1"),
          title: "Thread",
          modelSelection: {
            instanceId: "codex" as ProviderInstanceId,
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.runtime-mode.set",
          commandId: "cmd-runtime-mode-set" as CommandId,
          threadId: "thread-1" as ThreadId,
          runtimeMode: "approval-required",
          createdAt: now,
        },
        readModel,
      }),
    );

    const singleResult = Array.isArray(result) ? null : result;
    if (singleResult === null) {
      throw new Error("Expected a single runtime-mode-set event.");
    }
    expect(singleResult).toMatchObject({
      type: "thread.runtime-mode-set",
      payload: {
        threadId: "thread-1" as ThreadId,
        runtimeMode: "approval-required",
      },
    });
  });

  it("emits thread.interaction-mode-set from thread.interaction-mode.set", async () => {
    const now = new Date().toISOString();
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: "cmd-project-create" as CommandId,
        causationEventId: null,
        correlationId: "cmd-project-create" as CommandId,
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    const readModel = await Effect.runPromise(
      projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create"),
        aggregateKind: "thread",
        aggregateId: "thread-1" as ThreadId,
        type: "thread.created",
        occurredAt: now,
        commandId: "cmd-thread-create" as CommandId,
        causationEventId: null,
        correlationId: "cmd-thread-create" as CommandId,
        metadata: {},
        payload: {
          threadId: "thread-1" as ThreadId,
          projectId: asProjectId("project-1"),
          title: "Thread",
          modelSelection: {
            instanceId: "codex" as ProviderInstanceId,
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.interaction-mode.set",
          commandId: "cmd-interaction-mode-set" as CommandId,
          threadId: "thread-1" as ThreadId,
          interactionMode: "plan",
          createdAt: now,
        },
        readModel,
      }),
    );

    const singleResult = Array.isArray(result) ? null : result;
    if (singleResult === null) {
      throw new Error("Expected a single interaction-mode-set event.");
    }
    expect(singleResult).toMatchObject({
      type: "thread.interaction-mode-set",
      payload: {
        threadId: "thread-1" as ThreadId,
        interactionMode: "plan",
      },
    });
  });
});
