import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("045_ProjectionThreadPullRequests", (it) => {
  it.effect(
    "migrates legacy thread linked_pull_request_json rows into projection_thread_pull_requests",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        yield* runMigrations({ toMigrationInclusive: 44 });

        yield* sql`
          INSERT INTO projection_projects (
            project_id,
            title,
            workspace_root,
            scripts_json,
            created_at,
            updated_at
          )
          VALUES
            ('project-1', 'Project 1', '/tmp/p1', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
        `;

        yield* sql`
          INSERT INTO projection_threads (
            thread_id,
            project_id,
            title,
            branch,
            worktree_path,
            created_at,
            updated_at,
            runtime_mode,
            interaction_mode,
            linked_pull_request_json
          )
          VALUES
            (
              'thread-github',
              'project-1',
              'GitHub Thread',
              'feat-1',
              NULL,
              '2026-01-01T00:00:00.000Z',
              '2026-01-02T12:00:00.000Z',
              'full-access',
              'default',
              '{"projectId":"project-1","repository":"org/repo","number":42,"url":"https://github.com/org/repo/pull/42"}'
            ),
            (
              'thread-azure',
              'project-1',
              'Azure Thread',
              'feat-2',
              NULL,
              '2026-01-01T00:00:00.000Z',
              '2026-01-03T12:00:00.000Z',
              'full-access',
              'default',
              '{"projectId":"project-1","repository":"web","number":7,"url":"https://dev.azure.com/acme/project/_git/web/pullrequest/7"}'
            ),
            (
              'thread-invalid',
              'project-1',
              'Invalid Thread',
              'feat-3',
              NULL,
              '2026-01-01T00:00:00.000Z',
              '2026-01-04T12:00:00.000Z',
              'full-access',
              'default',
              'not-valid-json'
            ),
            (
              'thread-no-pr',
              'project-1',
              'No PR Thread',
              'feat-4',
              NULL,
              '2026-01-01T00:00:00.000Z',
              '2026-01-05T12:00:00.000Z',
              'full-access',
              'default',
              NULL
            )
        `;

        // Run migration 45
        yield* runMigrations({ toMigrationInclusive: 45 });

        interface MigratedRow {
          threadId: string;
          host: string;
          repository: string;
          number: number;
          url: string;
          source: string;
          linkedAt: string;
        }

        const rows = yield* sql<MigratedRow>`
          SELECT
            thread_id AS "threadId",
            host,
            repository,
            number,
            url,
            source,
            linked_at AS "linkedAt"
          FROM projection_thread_pull_requests
          ORDER BY thread_id ASC
        `;

        assert.equal(rows.length, 2);

        const azureRow = rows.find((r) => r.threadId === "thread-azure");
        assert.isDefined(azureRow);
        assert.equal(azureRow?.host, "dev.azure.com");
        assert.equal(azureRow?.repository, "acme/project/_git/web");
        assert.equal(azureRow?.number, 7);
        assert.equal(azureRow?.url, "https://dev.azure.com/acme/project/_git/web/pullrequest/7");
        assert.equal(azureRow?.source, "manual");
        assert.equal(azureRow?.linkedAt, "2026-01-03T12:00:00.000Z");

        const githubRow = rows.find((r) => r.threadId === "thread-github");
        assert.isDefined(githubRow);
        assert.equal(githubRow?.host, "github.com");
        assert.equal(githubRow?.repository, "org/repo");
        assert.equal(githubRow?.number, 42);
        assert.equal(githubRow?.url, "https://github.com/org/repo/pull/42");
        assert.equal(githubRow?.source, "manual");
        assert.equal(githubRow?.linkedAt, "2026-01-02T12:00:00.000Z");
      }),
  );
});
