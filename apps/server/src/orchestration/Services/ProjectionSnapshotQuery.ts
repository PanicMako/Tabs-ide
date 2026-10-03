import * as Context from "effect/Context";
/**
 * ProjectionSnapshotQuery - Read-model snapshot query service interface.
 *
 * Exposes the current orchestration projection snapshot for read-only API
 * access.
 *
 * @module ProjectionSnapshotQuery
 */
import type {
  AgentSessionImportSource,
  OrchestrationReadModel,
  ProjectId,
  ThreadId,
} from "@tabs/contracts";
import {} from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

/**
 * ProjectionSnapshotQueryShape - Service API for read-model snapshots.
 */
export interface ProjectionSnapshotQueryShape {
  /**
   * Read the latest orchestration projection snapshot.
   *
   * Rehydrates from projection tables and derives snapshot sequence from
   * projector cursor state.
   */
  readonly getSnapshot: () => Effect.Effect<OrchestrationReadModel, ProjectionRepositoryError>;

  /**
   * Read all imported agent session sources for a project.
   */
  readonly getImportedAgentSessionSources: (
    projectId: ProjectId,
  ) => Effect.Effect<
    ReadonlyArray<{ readonly threadId: ThreadId; readonly source: AgentSessionImportSource }>,
    ProjectionRepositoryError
  >;
}

/**
 * ProjectionSnapshotQuery - Service tag for projection snapshot queries.
 */
export class ProjectionSnapshotQuery extends Context.Service<
  ProjectionSnapshotQuery,
  ProjectionSnapshotQueryShape
>()("tabs/orchestration/Services/ProjectionSnapshotQuery") {}
