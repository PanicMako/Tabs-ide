import { describe, expect, it } from "vitest";
import {
  MessageId,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProjectId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  ProviderInstanceId,
} from "@tabs/contracts";
import { Effect } from "effect";

import {
  findThreadById,
  listThreadsByProjectId,
  requireNonNegativeInteger,
  requireThread,
  requireThreadAbsent,
} from "./commandInvariants.ts";

const now = new Date().toISOString();

const readModel: OrchestrationReadModel = {
  snapshotSequence: 2,
  updatedAt: now,
  projects: [
    {
      id: "project-a" as ProjectId,
      title: "Project A",
      workspaceRoot: "/tmp/project-a",
      defaultModelSelection: {
        instanceId: "codex" as ProviderInstanceId,
        model: "gpt-5-codex",
      },
      scripts: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    {
      id: "project-b" as ProjectId,
      title: "Project B",
      workspaceRoot: "/tmp/project-b",
      defaultModelSelection: {
        instanceId: "codex" as ProviderInstanceId,
        model: "gpt-5-codex",
      },
      scripts: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  ],
  threads: [
    {
      id: "thread-1" as ThreadId,
      projectId: "project-a" as ProjectId,
      title: "Thread A",
      modelSelection: {
        instanceId: "codex" as ProviderInstanceId,
        model: "gpt-5-codex",
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "full-access",
      branch: null,
      worktreePath: null,
      pullRequests: [],
      createdAt: now,
      updatedAt: now,
      latestTurn: null,
      messages: [],
      session: null,
      activities: [],
      proposedPlans: [],
      checkpoints: [],
      deletedAt: null,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
    },
    {
      id: "thread-2" as ThreadId,
      projectId: "project-b" as ProjectId,
      title: "Thread B",
      modelSelection: {
        instanceId: "codex" as ProviderInstanceId,
        model: "gpt-5-codex",
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "full-access",
      branch: null,
      worktreePath: null,
      pullRequests: [],
      createdAt: now,
      updatedAt: now,
      latestTurn: null,
      messages: [],
      session: null,
      activities: [],
      proposedPlans: [],
      checkpoints: [],
      deletedAt: null,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
    },
  ],
};

const messageSendCommand: OrchestrationCommand = {
  type: "thread.turn.start",
  commandId: "cmd-1" as CommandId,
  threadId: "thread-1" as ThreadId,
  message: {
    messageId: "msg-1" as MessageId,
    role: "user",
    text: "hello",
    attachments: [],
  },
  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
  runtimeMode: "approval-required",
  createdAt: now,
};

describe("commandInvariants", () => {
  it("finds threads by id and project", () => {
    expect(findThreadById(readModel, "thread-1" as ThreadId)?.projectId).toBe("project-a");
    expect(findThreadById(readModel, "missing" as ThreadId)).toBeUndefined();
    expect(
      listThreadsByProjectId(readModel, "project-b" as ProjectId).map((thread) => thread.id),
    ).toEqual(["thread-2" as ThreadId]);
  });

  it("requires existing thread", async () => {
    const thread = await Effect.runPromise(
      requireThread({
        readModel,
        command: messageSendCommand,
        threadId: "thread-1" as ThreadId,
      }),
    );
    expect(thread.id).toBe("thread-1" as ThreadId);

    await expect(
      Effect.runPromise(
        requireThread({
          readModel,
          command: messageSendCommand,
          threadId: "missing" as ThreadId,
        }),
      ),
    ).rejects.toThrow("does not exist");
  });

  it("requires missing thread for create flows", async () => {
    await Effect.runPromise(
      requireThreadAbsent({
        readModel,
        command: {
          type: "thread.create",
          commandId: "cmd-2" as CommandId,
          threadId: "thread-3" as ThreadId,
          projectId: "project-a" as ProjectId,
          title: "new",
          modelSelection: {
            instanceId: "codex" as ProviderInstanceId,
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
        },
        threadId: "thread-3" as ThreadId,
      }),
    );

    await expect(
      Effect.runPromise(
        requireThreadAbsent({
          readModel,
          command: {
            type: "thread.create",
            commandId: "cmd-3" as CommandId,
            threadId: "thread-1" as ThreadId,
            projectId: "project-a" as ProjectId,
            title: "dup",
            modelSelection: {
              instanceId: "codex" as ProviderInstanceId,
              model: "gpt-5-codex",
            },
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt: now,
          },
          threadId: "thread-1" as ThreadId,
        }),
      ),
    ).rejects.toThrow("already exists");
  });

  it("requires non-negative integers", async () => {
    await Effect.runPromise(
      requireNonNegativeInteger({
        commandType: "thread.checkpoint.revert",
        field: "turnCount",
        value: 0,
      }),
    );

    await expect(
      Effect.runPromise(
        requireNonNegativeInteger({
          commandType: "thread.checkpoint.revert",
          field: "turnCount",
          value: -1,
        }),
      ),
    ).rejects.toThrow("greater than or equal to 0");
  });
});
