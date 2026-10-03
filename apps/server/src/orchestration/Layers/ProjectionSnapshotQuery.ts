import {
  AgentSessionImportSource,
  ChatAttachment,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  OrchestrationCheckpointFile,
  OrchestrationProposedPlanId,
  OrchestrationReadModel,
  ProjectId,
  ProjectScript,
  ThreadId,
  ThreadLinkedPullRequest,
  ThreadPullRequestSnapshot,
  ThreadPullRequestStack,
  TurnId,
  type OrchestrationCheckpointSummary,
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type OrchestrationProposedPlan,
  type OrchestrationProject,
  type OrchestrationSession,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
  type ThreadPullRequestLink,
  ModelSelection,
  ProjectIconOverride,
} from "@tabs/contracts";
import { legacyLinkedPullRequestOf } from "@tabs/shared/threadPullRequests";
import { Effect, Layer, Option, Schema, Struct } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { ProjectionThreadPullRequest } from "../../persistence/ProjectionThreadPullRequests.ts";

import {
  isPersistenceError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type ProjectionRepositoryError,
} from "../../persistence/Errors.ts";
import { ProjectionCheckpoint } from "../../persistence/Services/ProjectionCheckpoints.ts";
import { ProjectionProject } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionState } from "../../persistence/Services/ProjectionState.ts";
import { ProjectionThreadActivity } from "../../persistence/Services/ProjectionThreadActivities.ts";
import { ProjectionThreadMessage } from "../../persistence/Services/ProjectionThreadMessages.ts";
import { ProjectionThreadProposedPlan } from "../../persistence/Services/ProjectionThreadProposedPlans.ts";
import { ProjectionThreadSession } from "../../persistence/Services/ProjectionThreadSessions.ts";
import { ProjectionThread } from "../../persistence/Services/ProjectionThreads.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./ProjectionPipeline.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../Services/ProjectionSnapshotQuery.ts";

const decodeReadModel = Schema.decodeUnknownEffect(OrchestrationReadModel);
const ProjectionProjectDbRowSchema = ProjectionProject.mapFields(
  Struct.assign({
    defaultModelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
    autoPull: Schema.Number,
    projectIcon: Schema.NullOr(Schema.fromJsonString(ProjectIconOverride)),
    scripts: Schema.fromJsonString(Schema.Array(ProjectScript)),
  }),
);
const ProjectionThreadMessageDbRowSchema = ProjectionThreadMessage.mapFields(
  Struct.assign({
    isStreaming: Schema.Number,
    attachments: Schema.NullOr(Schema.fromJsonString(Schema.Array(ChatAttachment))),
  }),
);
const ProjectionThreadProposedPlanDbRowSchema = ProjectionThreadProposedPlan;
const ProjectionThreadDbRowSchema = ProjectionThread.mapFields(
  Struct.assign({
    modelSelection: Schema.fromJsonString(ModelSelection),
    linkedPullRequest: Schema.NullOr(Schema.fromJsonString(ThreadLinkedPullRequest)),
  }),
);
const ProjectionThreadPullRequestDbRowSchema = ProjectionThreadPullRequest.mapFields(
  Struct.assign({
    snapshot: Schema.NullOr(Schema.fromJsonString(ThreadPullRequestSnapshot)),
    stack: Schema.NullOr(Schema.fromJsonString(ThreadPullRequestStack)),
  }),
);

const ProjectionImportedAgentSessionSourcesRowSchema = Schema.Struct({
  threadId: ThreadId,
  runtimePayload: Schema.NullOr(Schema.String),
});

const decodeImportedTranscriptsPayload = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      importedTranscripts: Schema.Array(Schema.Unknown),
    }),
  ),
);

const decodeAgentSessionImportSource = Schema.decodeUnknownOption(AgentSessionImportSource);

function mapPullRequestRow(
  row: Schema.Schema.Type<typeof ProjectionThreadPullRequestDbRowSchema>,
): ThreadPullRequestLink {
  return {
    host: row.host,
    repository: row.repository,
    number: row.number,
    url: row.url,
    source: row.source,
    linkedAt: row.linkedAt,
    snapshot: row.snapshot,
    stack: row.stack,
  };
}

function groupPullRequestRowsByThread(
  rows: ReadonlyArray<Schema.Schema.Type<typeof ProjectionThreadPullRequestDbRowSchema>>,
): Map<string, Array<ThreadPullRequestLink>> {
  const byThread = new Map<string, Array<ThreadPullRequestLink>>();
  for (const row of rows) {
    let links = byThread.get(row.threadId);
    if (links === undefined) {
      links = [];
      byThread.set(row.threadId, links);
    }
    links.push(mapPullRequestRow(row));
  }
  return byThread;
}

function mapThreadPullRequests(
  pullRequests: ReadonlyArray<ThreadPullRequestLink>,
  projectId: string,
): Pick<OrchestrationThread, "pullRequests" | "linkedPullRequest"> {
  const linkedPullRequest = legacyLinkedPullRequestOf(pullRequests, projectId as any);
  return {
    pullRequests,
    ...(linkedPullRequest === null ? {} : { linkedPullRequest }),
  };
}
const ProjectionThreadActivityDbRowSchema = ProjectionThreadActivity.mapFields(
  Struct.assign({
    payload: Schema.fromJsonString(Schema.Unknown),
    sequence: Schema.NullOr(NonNegativeInt),
  }),
);
const ProjectionThreadSessionDbRowSchema = ProjectionThreadSession;
const ProjectionCheckpointDbRowSchema = ProjectionCheckpoint.mapFields(
  Struct.assign({
    files: Schema.fromJsonString(Schema.Array(OrchestrationCheckpointFile)),
  }),
);
const ProjectionLatestTurnDbRowSchema = Schema.Struct({
  threadId: ProjectionThread.fields.threadId,
  turnId: TurnId,
  state: Schema.String,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
  sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
});
const ProjectionStateDbRowSchema = ProjectionState;

const REQUIRED_SNAPSHOT_PROJECTORS = [
  ORCHESTRATION_PROJECTOR_NAMES.projects,
  ORCHESTRATION_PROJECTOR_NAMES.threads,
  ORCHESTRATION_PROJECTOR_NAMES.threadMessages,
  ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans,
  ORCHESTRATION_PROJECTOR_NAMES.threadActivities,
  ORCHESTRATION_PROJECTOR_NAMES.threadSessions,
  ORCHESTRATION_PROJECTOR_NAMES.checkpoints,
] as const;

function maxIso(left: string | null, right: string): string {
  if (left === null) {
    return right;
  }
  return left > right ? left : right;
}

function computeSnapshotSequence(
  stateRows: ReadonlyArray<Schema.Schema.Type<typeof ProjectionStateDbRowSchema>>,
): number {
  if (stateRows.length === 0) {
    return 0;
  }
  const sequenceByProjector = new Map(
    stateRows.map((row) => [row.projector, row.lastAppliedSequence] as const),
  );

  let minSequence = Number.POSITIVE_INFINITY;
  for (const projector of REQUIRED_SNAPSHOT_PROJECTORS) {
    const sequence = sequenceByProjector.get(projector);
    if (sequence === undefined) {
      return 0;
    }
    if (sequence < minSequence) {
      minSequence = sequence;
    }
  }

  return Number.isFinite(minSequence) ? minSequence : 0;
}

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): ProjectionRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeProjectionSnapshotQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listProjectRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProjectDbRowSchema,
    execute: () =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          default_thread_env_mode AS "defaultThreadEnvMode",
          auto_pull AS "autoPull",
          favicon_path AS "faviconPath",
          project_icon_json AS "projectIcon",
          scripts_json AS "scripts",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        ORDER BY created_at ASC, project_id ASC
      `,
  });

  const listThreadRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          branch,
          worktree_path AS "worktreePath",
          linked_pull_request_json AS "linkedPullRequest",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt",
          archived_at AS "archivedAt",
          settled_override AS "settledOverride",
          settled_at AS "settledAt",
          unsettled_at AS "unsettledAt",
          snoozed_until AS "snoozedUntil",
          snoozed_at AS "snoozedAt",
          pinned_at AS "pinnedAt",
          pin_order_key AS "pinOrderKey",
          title_regeneration_request_id AS "titleRegenerationRequestId",
          title_regeneration_started_at AS "titleRegenerationStartedAt",
          latest_user_message_at AS "latestUserMessageAt",
          pending_approval_count AS "pendingApprovalCount",
          pending_user_input_count AS "pendingUserInputCount",
          has_actionable_proposed_plan AS "hasActionableProposedPlan"
        FROM projection_threads
        ORDER BY created_at ASC, thread_id ASC
      `,
  });

  const listThreadMessageRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadMessageDbRowSchema,
    execute: () =>
      sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          role,
          text,
          attachments_json AS "attachments",
          is_streaming AS "isStreaming",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_messages
        ORDER BY thread_id ASC, created_at ASC, message_id ASC
      `,
  });

  const listThreadProposedPlanRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadProposedPlanDbRowSchema,
    execute: () =>
      sql`
        SELECT
          plan_id AS "planId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          plan_markdown AS "planMarkdown",
          implemented_at AS "implementedAt",
          implementation_thread_id AS "implementationThreadId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_proposed_plans
        ORDER BY thread_id ASC, created_at ASC, plan_id ASC
      `,
  });

  const listThreadActivityRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadActivityDbRowSchema,
    execute: () =>
      sql`
        SELECT
          activity_id AS "activityId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          tone,
          kind,
          summary,
          payload_json AS "payload",
          sequence,
          created_at AS "createdAt"
        FROM projection_thread_activities
        ORDER BY
          thread_id ASC,
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
          sequence ASC,
          created_at ASC,
          activity_id ASC
      `,
  });

  const listThreadSessionRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadSessionDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          status,
          provider_name AS "providerName",
          provider_session_id AS "providerSessionId",
          provider_thread_id AS "providerThreadId",
          runtime_mode AS "runtimeMode",
          active_turn_id AS "activeTurnId",
          last_error AS "lastError",
          updated_at AS "updatedAt"
        FROM projection_thread_sessions
        ORDER BY thread_id ASC
      `,
  });

  const listCheckpointRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionCheckpointDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "status",
          checkpoint_files_json AS "files",
          assistant_message_id AS "assistantMessageId",
          completed_at AS "completedAt"
        FROM projection_turns
        WHERE checkpoint_turn_count IS NOT NULL
        ORDER BY thread_id ASC, checkpoint_turn_count ASC
      `,
  });

  const listLatestTurnRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionLatestTurnDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          state,
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          assistant_message_id AS "assistantMessageId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId"
        FROM projection_turns
        WHERE turn_id IS NOT NULL
        ORDER BY thread_id ASC, requested_at DESC, turn_id DESC
      `,
  });

  const listThreadPullRequestRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadPullRequestDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          host,
          repository,
          number,
          url,
          source,
          linked_at AS "linkedAt",
          snapshot_json AS "snapshot",
          stack_json AS "stack"
        FROM projection_thread_pull_requests
        ORDER BY thread_id ASC, linked_at ASC, number ASC
      `,
  });

  const listProjectionStateRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionStateDbRowSchema,
    execute: () =>
      sql`
        SELECT
          projector,
          last_applied_sequence AS "lastAppliedSequence",
          updated_at AS "updatedAt"
        FROM projection_state
      `,
  });

  const getSnapshot: ProjectionSnapshotQueryShape["getSnapshot"] = () =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const [
            projectRows,
            threadRows,
            messageRows,
            proposedPlanRows,
            activityRows,
            sessionRows,
            checkpointRows,
            latestTurnRows,
            stateRows,
            pullRequestRows,
          ] = yield* Effect.all([
            listProjectRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listProjects:query",
                  "ProjectionSnapshotQuery.getSnapshot:listProjects:decodeRows",
                ),
              ),
            ),
            listThreadRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreads:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreads:decodeRows",
                ),
              ),
            ),
            listThreadMessageRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadMessages:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadMessages:decodeRows",
                ),
              ),
            ),
            listThreadProposedPlanRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadProposedPlans:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadProposedPlans:decodeRows",
                ),
              ),
            ),
            listThreadActivityRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadActivities:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadActivities:decodeRows",
                ),
              ),
            ),
            listThreadSessionRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadSessions:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadSessions:decodeRows",
                ),
              ),
            ),
            listCheckpointRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listCheckpoints:query",
                  "ProjectionSnapshotQuery.getSnapshot:listCheckpoints:decodeRows",
                ),
              ),
            ),
            listLatestTurnRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listLatestTurns:query",
                  "ProjectionSnapshotQuery.getSnapshot:listLatestTurns:decodeRows",
                ),
              ),
            ),
            listProjectionStateRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listProjectionState:query",
                  "ProjectionSnapshotQuery.getSnapshot:listProjectionState:decodeRows",
                ),
              ),
            ),
            listThreadPullRequestRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadPullRequests:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadPullRequests:decodeRows",
                ),
              ),
            ),
          ]);

          const messagesByThread = new Map<string, Array<OrchestrationMessage>>();
          const proposedPlansByThread = new Map<string, Array<OrchestrationProposedPlan>>();
          const activitiesByThread = new Map<string, Array<OrchestrationThreadActivity>>();
          const checkpointsByThread = new Map<string, Array<OrchestrationCheckpointSummary>>();
          const sessionsByThread = new Map<string, OrchestrationSession>();
          const latestTurnByThread = new Map<string, OrchestrationLatestTurn>();

          let updatedAt: string | null = null;

          for (const row of projectRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of threadRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of stateRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }

          for (const row of messageRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
            const threadMessages = messagesByThread.get(row.threadId) ?? [];
            threadMessages.push({
              id: row.messageId,
              role: row.role,
              text: row.text,
              ...(row.attachments !== null ? { attachments: row.attachments } : {}),
              turnId: row.turnId,
              streaming: row.isStreaming === 1,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            });
            messagesByThread.set(row.threadId, threadMessages);
          }

          for (const row of proposedPlanRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
            const threadProposedPlans = proposedPlansByThread.get(row.threadId) ?? [];
            threadProposedPlans.push({
              id: row.planId,
              turnId: row.turnId,
              planMarkdown: row.planMarkdown,
              implementedAt: row.implementedAt,
              implementationThreadId: row.implementationThreadId,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            });
            proposedPlansByThread.set(row.threadId, threadProposedPlans);
          }

          for (const row of activityRows) {
            updatedAt = maxIso(updatedAt, row.createdAt);
            const threadActivities = activitiesByThread.get(row.threadId) ?? [];
            threadActivities.push({
              id: row.activityId,
              tone: row.tone,
              kind: row.kind,
              summary: row.summary,
              payload: row.payload,
              turnId: row.turnId,
              ...(row.sequence !== null ? { sequence: row.sequence } : {}),
              createdAt: row.createdAt,
            });
            activitiesByThread.set(row.threadId, threadActivities);
          }

          for (const row of checkpointRows) {
            updatedAt = maxIso(updatedAt, row.completedAt);
            const threadCheckpoints = checkpointsByThread.get(row.threadId) ?? [];
            threadCheckpoints.push({
              turnId: row.turnId,
              checkpointTurnCount: row.checkpointTurnCount,
              checkpointRef: row.checkpointRef,
              status: row.status,
              files: row.files,
              assistantMessageId: row.assistantMessageId,
              completedAt: row.completedAt,
            });
            checkpointsByThread.set(row.threadId, threadCheckpoints);
          }

          for (const row of latestTurnRows) {
            updatedAt = maxIso(updatedAt, row.requestedAt);
            if (row.startedAt !== null) {
              updatedAt = maxIso(updatedAt, row.startedAt);
            }
            if (row.completedAt !== null) {
              updatedAt = maxIso(updatedAt, row.completedAt);
            }
            if (latestTurnByThread.has(row.threadId)) {
              continue;
            }
            latestTurnByThread.set(row.threadId, {
              turnId: row.turnId,
              state:
                row.state === "error"
                  ? "error"
                  : row.state === "interrupted"
                    ? "interrupted"
                    : row.state === "completed"
                      ? "completed"
                      : "running",
              requestedAt: row.requestedAt,
              startedAt: row.startedAt,
              completedAt: row.completedAt,
              assistantMessageId: row.assistantMessageId,
              ...(row.sourceProposedPlanThreadId !== null && row.sourceProposedPlanId !== null
                ? {
                    sourceProposedPlan: {
                      threadId: row.sourceProposedPlanThreadId,
                      planId: row.sourceProposedPlanId,
                    },
                  }
                : {}),
            });
          }

          for (const row of sessionRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
            sessionsByThread.set(row.threadId, {
              threadId: row.threadId,
              status: row.status,
              providerName: row.providerName,
              runtimeMode: row.runtimeMode,
              activeTurnId: row.activeTurnId,
              lastError: row.lastError,
              updatedAt: row.updatedAt,
            });
          }

          const projects: ReadonlyArray<OrchestrationProject> = projectRows.map((row) => ({
            id: row.projectId,
            title: row.title,
            workspaceRoot: row.workspaceRoot,
            defaultModelSelection: row.defaultModelSelection,
            defaultThreadEnvMode: row.defaultThreadEnvMode ?? null,
            autoPull: row.autoPull === 1,
            faviconPath: row.faviconPath ?? null,
            projectIcon: row.projectIcon ?? null,
            scripts: row.scripts,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
          }));

          const pullRequestsByThread = groupPullRequestRowsByThread(pullRequestRows);

          const threads: ReadonlyArray<OrchestrationThread> = threadRows.map((row) => ({
            id: row.threadId,
            projectId: row.projectId,
            title: row.title,
            modelSelection: row.modelSelection,
            runtimeMode: row.runtimeMode,
            interactionMode: row.interactionMode,
            branch: row.branch,
            worktreePath: row.worktreePath,
            ...mapThreadPullRequests(pullRequestsByThread.get(row.threadId) ?? [], row.projectId),
            latestTurn: latestTurnByThread.get(row.threadId) ?? null,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
            archivedAt: row.archivedAt,
            settledOverride: row.settledOverride,
            settledAt: row.settledAt,
            unsettledAt: row.unsettledAt,
            snoozedUntil: row.snoozedUntil,
            snoozedAt: row.snoozedAt,
            pinnedAt: row.pinnedAt,
            pinOrderKey: row.pinOrderKey ?? null,
            titleRegeneration:
              row.titleRegenerationRequestId && row.titleRegenerationStartedAt
                ? {
                    requestId: row.titleRegenerationRequestId,
                    startedAt: row.titleRegenerationStartedAt,
                  }
                : null,
            messages: messagesByThread.get(row.threadId) ?? [],
            proposedPlans: proposedPlansByThread.get(row.threadId) ?? [],
            activities: activitiesByThread.get(row.threadId) ?? [],
            checkpoints: checkpointsByThread.get(row.threadId) ?? [],
            session: sessionsByThread.get(row.threadId) ?? null,
          }));

          const snapshot = {
            snapshotSequence: computeSnapshotSequence(stateRows),
            projects,
            threads,
            updatedAt: updatedAt ?? new Date(0).toISOString(),
          };

          return yield* decodeReadModel(snapshot).pipe(
            Effect.mapError(
              toPersistenceDecodeError("ProjectionSnapshotQuery.getSnapshot:decodeReadModel"),
            ),
          );
        }),
      )
      .pipe(
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError("ProjectionSnapshotQuery.getSnapshot:query")(error);
        }),
      );

  const listImportedAgentSessionSourceRows = SqlSchema.findAll({
    Request: Schema.Struct({ projectId: ProjectId }),
    Result: ProjectionImportedAgentSessionSourcesRowSchema,
    execute: ({ projectId }) =>
      sql`
        SELECT
          threads.thread_id AS "threadId",
          runtime.runtime_payload_json AS "runtimePayload"
        FROM projection_threads AS threads
        INNER JOIN projection_projects AS projects
          ON projects.project_id = threads.project_id
        INNER JOIN provider_session_runtime AS runtime
          ON runtime.thread_id = threads.thread_id
        WHERE threads.project_id = ${projectId}
          AND threads.deleted_at IS NULL
          AND threads.archived_at IS NULL
          AND projects.deleted_at IS NULL
          AND EXISTS (
            SELECT 1
            FROM projection_thread_messages AS messages
            WHERE messages.thread_id = threads.thread_id
              AND messages.message_id GLOB 'import:*'
          )
        ORDER BY threads.thread_id ASC
      `,
  });

  const getImportedAgentSessionSources: ProjectionSnapshotQueryShape["getImportedAgentSessionSources"] =
    Effect.fn("ProjectionSnapshotQuery.getImportedAgentSessionSources")(function* (projectId) {
      const rows = yield* listImportedAgentSessionSourceRows({ projectId }).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionSnapshotQuery.getImportedAgentSessionSources:query"),
        ),
      );
      return rows.flatMap((row) => {
        if (!row.runtimePayload) return [];
        const payload = decodeImportedTranscriptsPayload(row.runtimePayload);
        if (Option.isNone(payload)) return [];
        return payload.value.importedTranscripts.flatMap((entry) => {
          const source = decodeAgentSessionImportSource(entry);
          if (
            Option.isNone(source) ||
            row.threadId !==
              `import:${source.value.providerInstanceId}:${source.value.providerSessionId}`
          ) {
            return [];
          }
          return [{ threadId: row.threadId, source: source.value }];
        });
      });
    });

  return {
    getSnapshot,
    getImportedAgentSessionSources,
  } satisfies ProjectionSnapshotQueryShape;
});

export const OrchestrationProjectionSnapshotQueryLive = Layer.effect(
  ProjectionSnapshotQuery,
  makeProjectionSnapshotQuery,
);
