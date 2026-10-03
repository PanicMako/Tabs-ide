import { CommandId, EventId, ProjectId } from "@tabs/contracts";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { OrchestrationCommandInvariantError } from "./Errors.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asEventId = (value: string): EventId => value as EventId;
const asProjectId = (value: string): ProjectId => value as ProjectId;

async function readModelWithProject(input: {
  projectId: string;
  workspaceRoot: string;
  deletedAt?: string | null;
}) {
  const now = new Date().toISOString();
  let readModel = await Effect.runPromise(
    projectEvent(createEmptyReadModel(now), {
      sequence: 1,
      eventId: asEventId(`evt-create-${input.projectId}`),
      aggregateKind: "project",
      aggregateId: asProjectId(input.projectId),
      type: "project.created",
      occurredAt: now,
      commandId: `cmd-create-${input.projectId}` as CommandId,
      causationEventId: null,
      correlationId: `cmd-create-${input.projectId}` as CommandId,
      metadata: {},
      payload: {
        projectId: asProjectId(input.projectId),
        title: "Existing",
        workspaceRoot: input.workspaceRoot,
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
      },
    }),
  );

  if (input.deletedAt) {
    readModel = await Effect.runPromise(
      projectEvent(readModel, {
        sequence: 2,
        eventId: asEventId(`evt-delete-${input.projectId}`),
        aggregateKind: "project",
        aggregateId: asProjectId(input.projectId),
        type: "project.deleted",
        occurredAt: input.deletedAt,
        commandId: `cmd-delete-${input.projectId}` as CommandId,
        causationEventId: null,
        correlationId: `cmd-delete-${input.projectId}` as CommandId,
        metadata: {},
        payload: {
          projectId: asProjectId(input.projectId),
          deletedAt: input.deletedAt,
        },
      }),
    );
  }

  return readModel;
}

describe("decider project identity", () => {
  it("refuses to create a second live project for an existing workspace root", async () => {
    const readModel = await readModelWithProject({
      projectId: "project-existing",
      workspaceRoot: "/tmp/dup",
    });
    const now = new Date().toISOString();

    const error = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "project.create",
          commandId: "cmd-create-dup" as CommandId,
          projectId: asProjectId("project-duplicate"),
          title: "Duplicate",
          workspaceRoot: "/tmp/dup",
          createdAt: now,
        },
        readModel,
      }).pipe(Effect.flip),
    );

    expect(error).toBeInstanceOf(OrchestrationCommandInvariantError);
    expect(error.detail).toContain("workspace root");
    expect(error.detail).toContain("/tmp/dup");
  });

  it("surfaces the invariant as OrchestrationCommandInvariantError", async () => {
    const readModel = await readModelWithProject({
      projectId: "project-existing",
      workspaceRoot: "/tmp/dup",
    });
    const now = new Date().toISOString();

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "project.create",
          commandId: "cmd-create-dup" as CommandId,
          projectId: asProjectId("project-duplicate"),
          title: "Duplicate",
          workspaceRoot: "/tmp/dup",
          createdAt: now,
        },
        readModel,
      }).pipe(Effect.flip),
    );

    expect(result).toBeInstanceOf(OrchestrationCommandInvariantError);
  });

  it("allows creating a project for a distinct workspace root", async () => {
    const readModel = await readModelWithProject({
      projectId: "project-existing",
      workspaceRoot: "/tmp/dup",
    });
    const now = new Date().toISOString();

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "project.create",
          commandId: "cmd-create-other" as CommandId,
          projectId: asProjectId("project-other"),
          title: "Other",
          workspaceRoot: "/tmp/other",
          createdAt: now,
        },
        readModel,
      }),
    );

    const event = Array.isArray(result) ? result[0] : result;
    expect(event.type).toBe("project.created");
  });

  it("allows reusing a workspace root after its project was deleted", async () => {
    const readModel = await readModelWithProject({
      projectId: "project-existing",
      workspaceRoot: "/tmp/dup",
      deletedAt: new Date().toISOString(),
    });
    const now = new Date().toISOString();

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "project.create",
          commandId: "cmd-create-reuse" as CommandId,
          projectId: asProjectId("project-reuse"),
          title: "Reuse",
          workspaceRoot: "/tmp/dup",
          createdAt: now,
        },
        readModel,
      }),
    );

    const event = Array.isArray(result) ? result[0] : result;
    expect(event.type).toBe("project.created");
  });
});
