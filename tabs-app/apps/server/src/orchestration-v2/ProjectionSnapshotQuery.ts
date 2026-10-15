import {
  type AgentSessionImportSource,
  type IsoDateTime,
  type OrchestrationCheckpointSummary,
  type OrchestrationProject,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type ProjectId,
  type ThreadId,
  type TurnId,
} from "@tabs/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { PersistenceSqlError, type ProjectionRepositoryError } from "../persistence/Errors.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

export interface ProjectionSnapshotQueryShape {
  readonly getSnapshot: () => Effect.Effect<OrchestrationReadModel, ProjectionRepositoryError>;
  readonly getImportedAgentSessionSources: (
    projectId: ProjectId,
  ) => Effect.Effect<
    ReadonlyArray<{ readonly threadId: ThreadId; readonly source: AgentSessionImportSource }>,
    ProjectionRepositoryError
  >;
}

export class ProjectionSnapshotQuery extends Context.Service<
  ProjectionSnapshotQuery,
  ProjectionSnapshotQueryShape
>()("tabs/orchestration/Services/ProjectionSnapshotQuery") {}

const make = Effect.gen(function* () {
  const projectStore = yield* ProjectStore.ProjectStoreV2;
  const projectionStore = yield* ProjectionStore.ProjectionStoreV2;

  const getSnapshot = Effect.fn("ProjectionSnapshotQuery.getSnapshot")(function* () {
    const projectRows = yield* projectStore.list({ includeDeleted: false }).pipe(
      Effect.mapError(
        (cause) =>
          new PersistenceSqlError({
            operation: "ProjectionSnapshotQuery.getSnapshot:projects",
            cause,
          }),
      ),
    );

    const projects: OrchestrationProject[] = projectRows.map((row) => ({
      id: row.projectId,
      title: row.title,
      workspaceRoot: row.workspaceRoot,
      repositoryIdentity: null,
      defaultModelSelection: row.defaultModelSelection,
      defaultThreadEnvMode: row.defaultThreadEnvMode ?? undefined,
      autoPull: row.autoPull,
      faviconPath: row.faviconPath ?? undefined,
      projectIcon: (row.projectIcon as any) ?? undefined,
      scripts: [...row.scripts],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    }));

    const shellSnapshot = yield* projectionStore.getShellSnapshot({ location: "active" }).pipe(
      Effect.mapError(
        (cause) =>
          new PersistenceSqlError({
            operation: "ProjectionSnapshotQuery.getSnapshot:threads",
            cause,
          }),
      ),
    );

    const now = yield* DateTime.now;
    const nowIso = DateTime.formatIso(now) as IsoDateTime;

    const toIso = <T extends DateTime.Utc | null | undefined>(
      dt: T,
    ): T extends DateTime.Utc ? IsoDateTime : T => {
      if (dt == null) return dt as any;
      return DateTime.formatIso(dt as DateTime.Utc) as any;
    };

    const threads: OrchestrationThread[] = [];
    for (const shell of shellSnapshot.threads) {
      const checkpointContext = yield* projectionStore
        .getCheckpointContext(shell.id)
        .pipe(Effect.orElseSucceed(() => ({ runs: [], checkpointScopes: [], checkpoints: [] })));

      const checkpoints: OrchestrationCheckpointSummary[] = checkpointContext.checkpoints.map(
        (cp) => ({
          turnId: `turn-${cp.appRunOrdinal ?? 0}` as TurnId,
          checkpointTurnCount: (cp.appRunOrdinal ?? 0) as any,
          checkpointRef: cp.ref,
          status: "ready",
          files: [],
          assistantMessageId: null,
          completedAt: toIso(shell.createdAt),
        }),
      );

      threads.push({
        id: shell.id,
        projectId: shell.projectId,
        title: shell.title,
        modelSelection: shell.modelSelection,
        runtimeMode: shell.runtimeMode,
        interactionMode: shell.interactionMode,
        branch: shell.branch,
        worktreePath: shell.worktreePath,
        linkedPullRequest: shell.linkedPullRequest,
        pullRequests: shell.pullRequests ? [...shell.pullRequests] : [],
        latestTurn: null,
        createdAt: toIso(shell.createdAt),
        updatedAt: toIso(shell.updatedAt),
        archivedAt: toIso(shell.archivedAt),
        settledOverride: shell.settledOverride,
        settledAt: toIso(shell.settledAt),
        unsettledAt: toIso(shell.unsettledAt),
        snoozedUntil: toIso(shell.snoozedUntil),
        snoozedAt: toIso(shell.snoozedAt),
        pinnedAt: toIso(shell.pinnedAt),
        pinOrderKey: shell.pinOrderKey,
        deletedAt: toIso(shell.deletedAt),
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints,
        session: null,
      });
    }

    return {
      snapshotSequence: shellSnapshot.snapshotSequence,
      projects,
      threads,
      updatedAt: nowIso,
    } satisfies OrchestrationReadModel;
  });

  const getImportedAgentSessionSources = Effect.fn(
    "ProjectionSnapshotQuery.getImportedAgentSessionSources",
  )(function* () {
    return [] as ReadonlyArray<{
      readonly threadId: ThreadId;
      readonly source: AgentSessionImportSource;
    }>;
  });

  return {
    getSnapshot,
    getImportedAgentSessionSources,
  } satisfies ProjectionSnapshotQueryShape;
});

export const ProjectionSnapshotQueryLive = Layer.effect(ProjectionSnapshotQuery, make).pipe(
  Layer.provide(Layer.merge(ProjectStore.layer, ProjectionStore.layer)),
);
