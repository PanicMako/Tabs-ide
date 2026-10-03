import { ProjectId } from "@tabs/contracts";
import {
  projectScriptRuntimeEnv,
  resolveProjectScripts,
  setupProjectScript,
} from "@tabs/shared/projectScripts";
import { normalizeProjectPathForComparison } from "@tabs/shared/path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { TerminalManager } from "../terminal/Services/Manager.ts";

export interface ProjectSetupScriptRunnerResultNoScript {
  readonly status: "no-script";
}

export interface ProjectSetupScriptRunnerResultStarted {
  readonly status: "started";
  readonly scriptId: string;
  readonly scriptName: string;
  readonly terminalId: string;
  readonly cwd: string;
}

export type ProjectSetupScriptRunnerResult =
  | ProjectSetupScriptRunnerResultNoScript
  | ProjectSetupScriptRunnerResultStarted;

export interface ProjectSetupScriptRunnerInput {
  readonly threadId: string;
  readonly projectId?: string;
  readonly projectCwd?: string;
  readonly worktreePath: string;
  readonly preferredTerminalId?: string;
}

export class ProjectSetupScriptOperationError extends Schema.TaggedErrorClass<ProjectSetupScriptOperationError>()(
  "ProjectSetupScriptOperationError",
  {
    threadId: Schema.String,
    projectId: Schema.optional(Schema.String),
    projectCwd: Schema.optional(Schema.String),
    worktreePath: Schema.String,
    operation: Schema.Literals(["resolveProject", "readSettings", "openTerminal", "writeCommand"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Project setup script operation '${this.operation}' failed for thread '${this.threadId}' in '${this.worktreePath}'.`;
  }
}

export class ProjectSetupScriptProjectNotFoundError extends Schema.TaggedErrorClass<ProjectSetupScriptProjectNotFoundError>()(
  "ProjectSetupScriptProjectNotFoundError",
  {
    threadId: Schema.String,
    projectId: Schema.optional(Schema.String),
    projectCwd: Schema.optional(Schema.String),
    worktreePath: Schema.String,
  },
) {
  override get message(): string {
    return `Project was not found for setup script execution for thread '${this.threadId}' in '${this.worktreePath}'.`;
  }
}

export const ProjectSetupScriptRunnerError = Schema.Union([
  ProjectSetupScriptOperationError,
  ProjectSetupScriptProjectNotFoundError,
]);
export type ProjectSetupScriptRunnerError = typeof ProjectSetupScriptRunnerError.Type;

export class ProjectSetupScriptRunner extends Context.Service<
  ProjectSetupScriptRunner,
  {
    readonly runForThread: (
      input: ProjectSetupScriptRunnerInput,
    ) => Effect.Effect<ProjectSetupScriptRunnerResult, ProjectSetupScriptRunnerError>;
  }
>()("tabs/project/ProjectSetupScriptRunner") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const terminalManager = yield* TerminalManager;
  const serverSettings = yield* ServerSettingsService;

  // Active in-flight executions to strictly prevent duplicate concurrent runs
  const activeRuns = new Set<string>();

  const runForThread: ProjectSetupScriptRunner["Service"]["runForThread"] = Effect.fn(
    "ProjectSetupScriptRunner.runForThread",
  )(function* (input) {
    const errorContext = {
      threadId: input.threadId,
      worktreePath: input.worktreePath,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.projectCwd === undefined ? {} : { projectCwd: input.projectCwd }),
    };

    const runKey = `${input.threadId}:${input.worktreePath}`;
    if (activeRuns.has(runKey)) {
      // Prevent duplicate concurrent execution
      return { status: "no-script" } as const;
    }

    const snapshot = yield* projectionSnapshotQuery.getSnapshot().pipe(
      Effect.mapError(
        (cause) =>
          new ProjectSetupScriptOperationError({
            ...errorContext,
            operation: "resolveProject",
            cause,
          }),
      ),
    );

    let project = input.projectId ? snapshot.projects.find((p) => p.id === input.projectId) : null;

    if (!project && input.projectCwd) {
      const normalizedCwd = normalizeProjectPathForComparison(input.projectCwd);
      project = snapshot.projects.find(
        (p) => normalizeProjectPathForComparison(p.workspaceRoot) === normalizedCwd,
      );
    }

    if (!project) {
      return yield* new ProjectSetupScriptProjectNotFoundError(errorContext);
    }

    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError(
        (cause) =>
          new ProjectSetupScriptOperationError({
            ...errorContext,
            operation: "readSettings",
            cause,
          }),
      ),
    );

    const script = setupProjectScript(resolveProjectScripts(settings, project));
    if (!script) {
      return { status: "no-script" } as const;
    }

    const terminalId = input.preferredTerminalId ?? `setup-${script.id}`;
    const cwd = input.worktreePath;
    const env = projectScriptRuntimeEnv({
      project: { cwd: project.workspaceRoot },
      worktreePath: input.worktreePath,
    });

    activeRuns.add(runKey);

    yield* terminalManager
      .open({
        threadId: input.threadId,
        terminalId,
        cwd,
        worktreePath: input.worktreePath,
        env,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ProjectSetupScriptOperationError({
              ...errorContext,
              operation: "openTerminal",
              cause,
            }),
        ),
      );

    yield* terminalManager
      .write({
        threadId: input.threadId,
        terminalId,
        data: `${script.command}\r`,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ProjectSetupScriptOperationError({
              ...errorContext,
              operation: "writeCommand",
              cause,
            }),
        ),
      );

    return {
      status: "started",
      scriptId: script.id,
      scriptName: script.name,
      terminalId,
      cwd,
    } as const;
  });

  return ProjectSetupScriptRunner.of({ runForThread });
});

export const layer = Layer.effect(ProjectSetupScriptRunner, make);
