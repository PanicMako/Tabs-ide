import {
  ThreadId,
  OrchestrationV2GetShellSnapshotError,
  type OrchestrationV2GetThreadFamilyInput,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ThreadManagementService } from "./ThreadManagementService.ts";
import { OrchestrationEventStore } from "../persistence/OrchestrationEventStore.ts";

/** Family metadata only; new clients request a bounded page, legacy clients retain full reads. */
export const readThreadFamilyPage = Effect.fn("ThreadFamilyQuery.readPage")(function* (
  input: OrchestrationV2GetThreadFamilyInput,
) {
  const sql = yield* SqlClient.SqlClient;
  const threadManagement = yield* ThreadManagementService;
  const applicationEvents = yield* OrchestrationEventStore;
  return yield* sql
    .withTransaction(
      Effect.gen(function* () {
        const limit = input.limit ?? 2_147_483_647;
        const membership = sql`json_extract(payload_json, '$.lineage.rootThreadId') = (
  SELECT json_extract(payload_json, '$.lineage.rootThreadId') FROM orchestration_v2_projection_threads WHERE thread_id = ${input.threadId} AND deleted_at IS NULL
) AND deleted_at IS NULL`;
        const counts = yield* sql<{
          count: number;
        }>`SELECT count(*) AS count FROM orchestration_v2_projection_threads WHERE ${membership}`;
        const rows = yield* sql<{
          thread_id: string;
        }>`SELECT thread_id FROM orchestration_v2_projection_threads WHERE ${membership}
  ${input.afterThreadId === undefined ? sql`` : sql`AND thread_id > ${input.afterThreadId}`}
  ORDER BY thread_id ASC LIMIT ${limit + 1}`;
        // Ancestors are shell-only and bounded, so the first page can navigate its parent.
        const ancestors = yield* sql<{
          thread_id: string;
        }>`WITH RECURSIVE ancestors(thread_id, parent_id) AS (
  SELECT thread_id, json_extract(payload_json, '$.lineage.parentThreadId') FROM orchestration_v2_projection_threads WHERE thread_id = ${input.threadId} AND deleted_at IS NULL
  UNION
  SELECT parent.thread_id, json_extract(parent.payload_json, '$.lineage.parentThreadId') FROM orchestration_v2_projection_threads parent JOIN ancestors child ON parent.thread_id = child.parent_id WHERE parent.deleted_at IS NULL
  LIMIT 32
) SELECT thread_id FROM ancestors`;
        const page = rows.slice(0, limit);
        const ids = [
          ...new Set([...page, ...ancestors].map((row) => ThreadId.make(row.thread_id))),
        ];
        const snapshot =
          ids.length === 0 ? null : yield* threadManagement.getShellSnapshot({ threadIds: ids });
        const threads = snapshot === null ? [] : [...snapshot.threads, ...snapshot.archivedThreads];
        return {
          snapshotSequence: yield* applicationEvents.latestApplicationSequence,
          threads,
          totalCount: counts[0]?.count ?? 0,
          nextCursor: rows.length > limit ? ThreadId.make(page.at(-1)!.thread_id) : null,
        };
      }),
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new OrchestrationV2GetShellSnapshotError({
            message: "Failed to load the thread family",
            cause,
          }),
      ),
    );
});
