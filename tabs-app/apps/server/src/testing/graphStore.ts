import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type {
  TestingCaseCreateInput,
  TestingCaseListResult,
  TestingCaseReviewInput,
  TestingCaseSummary,
  TestingClearGraphResult,
  TestingExplorationResult,
  TestingExplorationScope,
  TestingExecutionCaseResult,
  TestingExecutionRun,
  TestingExecutionRunListResult,
  TestingGraphSummary,
  TestingGraphExplorerResult,
  TestingHealingDecisionInput,
  TestingHealingProposal,
  TestingGeneratedArtifact,
  TestingGenerationJob,
  TestingGenerationJobListResult,
  TestingMismatch,
  TestingSchedule,
  TestingScheduleInput,
  TestingScheduleListResult,
  TestingTraceabilityResult,
  TestingWorkbookImportResult,
} from "@tabs/contracts";

import { sanitizePersistedUrl, type PiiToken } from "./security";
import { RuntimeSqliteDatabase } from "./sqlite";
import {
  alignExpectedResults,
  normalizeStepExpectedResults,
  summarizeExpectedResults,
} from "./expectedResults";

type RunStatus = TestingGraphSummary["lastRunStatus"];

interface CountRow {
  readonly count: number;
}

interface StatusRow {
  readonly target_url: string;
  readonly status: RunStatus;
  readonly error: string | null;
  readonly termination_reason: "plateaued" | "max-states" | "time-budget" | null;
  readonly states_visited: number | null;
  readonly transitions_observed: number | null;
  readonly duration_ms: number | null;
  readonly max_states: number | null;
  readonly max_duration_seconds: number | null;
}

interface AuthRow {
  readonly captured_at: string;
}

interface TableInfoRow {
  readonly name: string;
}

export interface StoredGraphNode {
  readonly stateId: string;
  readonly pageUrl: string;
  readonly pageTitle: string;
  readonly snapshot: string;
}

export interface StoredGraphEdge {
  readonly fromStateId: string;
  readonly toStateId: string;
  readonly role: string;
  readonly name: string;
  readonly intentLocator: string;
}

interface StoredCaseRow {
  readonly id: string;
  readonly external_id: string;
  readonly source: TestingCaseSummary["source"];
  readonly description: string;
  readonly group_name: string;
  readonly steps_json: string;
  readonly expected_results_json: string;
  readonly expected_result: string;
  readonly source_sheet: string | null;
  readonly source_row: number | null;
  readonly reconciliation_status: TestingCaseSummary["status"];
  readonly review_decision: TestingCaseSummary["reviewDecision"];
  readonly mismatches_json: string;
  readonly matched_state_ids_json: string;
  readonly standalone_status: TestingCaseSummary["standaloneStatus"];
  readonly ci_status: TestingCaseSummary["ciStatus"];
  readonly notes: string;
}

interface StoredGenerationJobRow {
  readonly id: string;
  readonly project_id: string;
  readonly status: TestingGenerationJob["status"];
  readonly engine: TestingGenerationJob["engine"];
  readonly stage: TestingGenerationJob["stage"];
  readonly parent_job_id: string | null;
  readonly parent_run_id: string | null;
  readonly attempt_count: number;
  readonly validation_summary_json: string | null;
  readonly immutable_artifact_paths_json: string | null;
  readonly provider_provenance_json: string | null;
  readonly usage_measured: number;
  readonly framework: "playwright-ts";
  readonly provider_instance_id: string;
  readonly model: string;
  readonly model_options_json: string;
  readonly output_directory: string;
  readonly total_cases: number;
  readonly completed_cases: number;
  readonly estimated_tokens: number;
  readonly estimated_cost_usd: number;
  readonly error: string | null;
}

interface StoredExecutionRunRow {
  readonly id: string;
  readonly project_id: string;
  readonly generation_job_id: string;
  readonly mode: TestingExecutionRun["mode"];
  readonly status: TestingExecutionRun["status"];
  readonly target_url: string;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly duration_ms: number;
  readonly artifact_revision: string;
  readonly stdout: string;
  readonly stderr: string;
}

interface StoredExecutionCaseRow {
  readonly case_id: string;
  readonly external_id: string;
  readonly status: TestingExecutionCaseResult["status"];
  readonly duration_ms: number;
  readonly error: string | null;
  readonly trace_path: string | null;
  readonly screenshot_path: string | null;
  readonly flaky: number;
  readonly quarantined: number;
  readonly visual_status: TestingExecutionCaseResult["visualStatus"];
}

interface StoredHealingRow {
  readonly id: string;
  readonly case_id: string;
  readonly locator_key: string;
  readonly previous_role: string;
  readonly previous_name: string;
  readonly proposed_role: string;
  readonly proposed_name: string;
  readonly confidence: number;
  readonly margin: number;
  readonly diff: string;
  readonly status: TestingHealingProposal["status"];
  readonly consecutive_attempts: number;
  readonly locator_entry_id: string | null;
  readonly locator_version_id: string | null;
}

export interface TestingExecutionArtifact {
  readonly caseId: string;
  readonly externalId: string;
  readonly specPath: string;
  readonly pageObjectPath: string;
  readonly fingerprints: ReadonlyArray<{
    readonly locatorKey: string;
    readonly role: string;
    readonly accessibleName: string;
    readonly graphStateId: string;
    readonly locatorEntryId?: string;
    readonly locatorVersionId?: string;
  }>;
}

function ensureCrawlRunColumn(
  database: RuntimeSqliteDatabase,
  name: string,
  definition: string,
): void {
  const columns = database.query<TableInfoRow, []>("PRAGMA table_info(crawl_runs)").all();
  if (!columns.some((column) => column.name === name)) {
    database.exec(`ALTER TABLE crawl_runs ADD COLUMN ${name} ${definition}`);
  }
}

function ensureTableColumn(
  database: RuntimeSqliteDatabase,
  table: string,
  name: string,
  definition: string,
): void {
  const columns = database.query<TableInfoRow, []>(`PRAGMA table_info(${table})`).all();
  if (!columns.some((column) => column.name === name)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

export class TestingGraphStore {
  readonly databasePath: string;
  readonly #database: RuntimeSqliteDatabase;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    mkdirSync(dirname(databasePath), { recursive: true });
    this.#database = new RuntimeSqliteDatabase(databasePath);
    this.#database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS crawl_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        target_url TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
        error TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        scope TEXT NOT NULL DEFAULT 'origin',
        max_states INTEGER,
        max_duration_seconds INTEGER,
        termination_reason TEXT,
        states_visited INTEGER,
        transitions_observed INTEGER,
        duration_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS crawl_runs_project_started
        ON crawl_runs(project_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS graph_nodes (
        project_id TEXT NOT NULL,
        state_id TEXT NOT NULL,
        page_url TEXT NOT NULL,
        page_title TEXT NOT NULL,
        sanitized_snapshot TEXT NOT NULL,
        first_seen_run_id TEXT NOT NULL REFERENCES crawl_runs(id),
        created_at TEXT NOT NULL,
        PRIMARY KEY(project_id, state_id)
      );

      CREATE TABLE IF NOT EXISTS graph_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        run_id TEXT NOT NULL REFERENCES crawl_runs(id),
        from_state_id TEXT NOT NULL,
        to_state_id TEXT NOT NULL,
        action_role TEXT NOT NULL,
        action_name TEXT NOT NULL,
        intent_locator TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(project_id, from_state_id, to_state_id, action_role, action_name)
      );

      CREATE TABLE IF NOT EXISTS pii_tokens (
        project_id TEXT NOT NULL,
        token TEXT NOT NULL,
        kind TEXT NOT NULL,
        plaintext TEXT NOT NULL,
        digest TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(project_id, token),
        UNIQUE(project_id, digest)
      );

      CREATE TABLE IF NOT EXISTS subtree_cache (
        project_id TEXT NOT NULL,
        subtree_hash TEXT NOT NULL,
        tokenized_content TEXT NOT NULL,
        approximate_tokens INTEGER NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT NOT NULL,
        PRIMARY KEY(project_id, subtree_hash)
      );

      CREATE TABLE IF NOT EXISTS auth_sessions (
        project_id TEXT PRIMARY KEY,
        profile_path TEXT NOT NULL,
        captured_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS test_imports (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        workbook_name TEXT NOT NULL,
        workbook_path TEXT NOT NULL,
        imported_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS test_imports_project_imported
        ON test_imports(project_id, imported_at DESC);

      CREATE TABLE IF NOT EXISTS test_cases (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        import_id TEXT REFERENCES test_imports(id),
        external_id TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('excel', 'generated')),
        description TEXT NOT NULL,
        group_name TEXT NOT NULL DEFAULT '',
        steps_json TEXT NOT NULL,
        expected_results_json TEXT NOT NULL DEFAULT '[]',
        expected_result TEXT NOT NULL DEFAULT '',
        source_sheet TEXT,
        source_row INTEGER,
        reconciliation_status TEXT NOT NULL CHECK (
          reconciliation_status IN ('matches', 'needs-review', 'blocked')
        ),
        review_decision TEXT NOT NULL DEFAULT 'pending' CHECK (
          review_decision IN ('pending', 'accepted', 'edited', 'rejected')
        ),
        mismatches_json TEXT NOT NULL DEFAULT '[]',
        matched_state_ids_json TEXT NOT NULL DEFAULT '[]',
        standalone_status TEXT NOT NULL DEFAULT 'not-yet-tested' CHECK (
          standalone_status IN ('passed', 'failed', 'blocked', 'not-applicable', 'not-yet-tested')
        ),
        ci_status TEXT CHECK (ci_status IN ('pass', 'fail')),
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS test_case_groups (
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, name)
      );
      CREATE INDEX IF NOT EXISTS test_cases_project_created
        ON test_cases(project_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS test_case_reviews (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL REFERENCES test_cases(id),
        decision TEXT NOT NULL,
        previous_json TEXT NOT NULL,
        reviewed_json TEXT NOT NULL,
        notes TEXT NOT NULL,
        reviewed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS generation_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'budget-stopped')
        ),
        engine TEXT NOT NULL DEFAULT 'standard',
        stage TEXT NOT NULL DEFAULT 'planned',
        parent_job_id TEXT,
        parent_run_id TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 1,
        validation_summary_json TEXT,
        immutable_artifact_paths_json TEXT,
        provider_provenance_json TEXT,
        usage_measured INTEGER NOT NULL DEFAULT 0,
        framework TEXT NOT NULL,
        provider_instance_id TEXT NOT NULL DEFAULT 'codex',
        model TEXT NOT NULL DEFAULT 'gpt-5.3-codex',
        model_options_json TEXT NOT NULL DEFAULT '[]',
        output_directory TEXT NOT NULL,
        total_cases INTEGER NOT NULL,
        completed_cases INTEGER NOT NULL DEFAULT 0,
        estimated_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL NOT NULL DEFAULT 0,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS generation_jobs_project_created
        ON generation_jobs(project_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS generated_artifacts (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES generation_jobs(id),
        case_id TEXT NOT NULL REFERENCES test_cases(id),
        external_id TEXT NOT NULL,
        feature_slug TEXT NOT NULL,
        page_object_path TEXT NOT NULL,
        data_path TEXT NOT NULL,
        spec_path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS locator_fingerprints (
        id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL REFERENCES generated_artifacts(id),
        case_id TEXT NOT NULL,
        locator_key TEXT NOT NULL,
        role TEXT NOT NULL,
        accessible_name TEXT NOT NULL,
        stable_attributes_json TEXT NOT NULL DEFAULT '{}',
        semantic_context TEXT NOT NULL,
        graph_state_id TEXT NOT NULL,
        url_pattern TEXT NOT NULL,
        verified_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS network_replay_metadata (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        sanitized_entries_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS execution_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        generation_job_id TEXT NOT NULL REFERENCES generation_jobs(id),
        mode TEXT NOT NULL CHECK (mode IN ('standalone', 'ci')),
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'passed', 'failed', 'blocked')),
        target_url TEXT NOT NULL,
        artifact_revision TEXT NOT NULL,
        stdout TEXT NOT NULL DEFAULT '',
        stderr TEXT NOT NULL DEFAULT '',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS execution_runs_project_started
        ON execution_runs(project_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS execution_case_results (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES execution_runs(id),
        case_id TEXT NOT NULL,
        external_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'blocked', 'not-applicable')),
        duration_ms INTEGER NOT NULL,
        error TEXT,
        trace_path TEXT,
        screenshot_path TEXT,
        flaky INTEGER NOT NULL DEFAULT 0,
        quarantined INTEGER NOT NULL DEFAULT 0,
        visual_status TEXT NOT NULL DEFAULT 'disabled',
        app_revision TEXT NOT NULL DEFAULT '',
        artifact_revision TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS healing_proposals (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES execution_runs(id),
        case_id TEXT NOT NULL,
        locator_key TEXT NOT NULL,
        previous_role TEXT NOT NULL,
        previous_name TEXT NOT NULL,
        proposed_role TEXT NOT NULL,
        proposed_name TEXT NOT NULL,
        confidence REAL NOT NULL,
        margin REAL NOT NULL,
        diff TEXT NOT NULL,
        status TEXT NOT NULL,
        consecutive_attempts INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        decided_at TEXT
      );

      CREATE TABLE IF NOT EXISTS visual_baselines (
        case_id TEXT PRIMARY KEY,
        screenshot_hash TEXT NOT NULL,
        screenshot_path TEXT NOT NULL,
        approved_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS testing_schedules (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        generation_job_id TEXT NOT NULL REFERENCES generation_jobs(id),
        target_url TEXT NOT NULL,
        timezone TEXT NOT NULL,
        recurrence TEXT NOT NULL CHECK (recurrence IN ('none', 'daily', 'weekly')),
        next_run_at TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS testing_reports (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES execution_runs(id),
        docx_path TEXT NOT NULL,
        pdf_path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    ensureTableColumn(this.#database, "locator_fingerprints", "locator_entry_id", "TEXT");
    ensureTableColumn(this.#database, "locator_fingerprints", "locator_version_id", "TEXT");
    ensureTableColumn(this.#database, "healing_proposals", "locator_entry_id", "TEXT");
    ensureTableColumn(this.#database, "healing_proposals", "locator_version_id", "TEXT");
    ensureCrawlRunColumn(this.#database, "scope", "TEXT NOT NULL DEFAULT 'origin'");
    ensureCrawlRunColumn(this.#database, "max_states", "INTEGER");
    ensureCrawlRunColumn(this.#database, "max_duration_seconds", "INTEGER");
    ensureCrawlRunColumn(this.#database, "termination_reason", "TEXT");
    ensureCrawlRunColumn(this.#database, "states_visited", "INTEGER");
    ensureCrawlRunColumn(this.#database, "transitions_observed", "INTEGER");
    ensureCrawlRunColumn(this.#database, "duration_ms", "INTEGER");
    ensureTableColumn(
      this.#database,
      "generation_jobs",
      "provider_instance_id",
      "TEXT NOT NULL DEFAULT 'codex'",
    );
    ensureTableColumn(
      this.#database,
      "generation_jobs",
      "model",
      "TEXT NOT NULL DEFAULT 'gpt-5.3-codex'",
    );
    ensureTableColumn(
      this.#database,
      "generation_jobs",
      "model_options_json",
      "TEXT NOT NULL DEFAULT '[]'",
    );
    ensureTableColumn(
      this.#database,
      "generation_jobs",
      "engine",
      "TEXT NOT NULL DEFAULT 'standard'",
    );
    ensureTableColumn(
      this.#database,
      "generation_jobs",
      "stage",
      "TEXT NOT NULL DEFAULT 'planned'",
    );
    ensureTableColumn(this.#database, "generation_jobs", "parent_job_id", "TEXT");
    ensureTableColumn(this.#database, "generation_jobs", "parent_run_id", "TEXT");
    ensureTableColumn(
      this.#database,
      "generation_jobs",
      "attempt_count",
      "INTEGER NOT NULL DEFAULT 1",
    );
    ensureTableColumn(this.#database, "generation_jobs", "validation_summary_json", "TEXT");
    ensureTableColumn(this.#database, "generation_jobs", "immutable_artifact_paths_json", "TEXT");
    ensureTableColumn(this.#database, "generation_jobs", "provider_provenance_json", "TEXT");
    ensureTableColumn(
      this.#database,
      "generation_jobs",
      "usage_measured",
      "INTEGER NOT NULL DEFAULT 0",
    );
    this.#database.exec(`
      UPDATE generation_jobs
      SET stage = CASE status
        WHEN 'completed' THEN 'validated'
        WHEN 'failed' THEN 'failed'
        WHEN 'cancelled' THEN 'cancelled'
        WHEN 'budget-stopped' THEN 'blocked'
        WHEN 'running' THEN 'generating'
        ELSE 'planned'
      END
      WHERE stage IS NULL OR (stage = 'planned' AND status != 'queued');
    `);
    ensureTableColumn(this.#database, "test_cases", "expected_result", "TEXT NOT NULL DEFAULT ''");
    ensureTableColumn(
      this.#database,
      "test_cases",
      "expected_results_json",
      "TEXT NOT NULL DEFAULT '[]'",
    );
    ensureTableColumn(this.#database, "test_cases", "group_name", "TEXT NOT NULL DEFAULT ''");
    this.#database.exec(`
      DELETE FROM test_cases
      WHERE id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER(
            PARTITION BY project_id, description, steps_json, expected_result
            ORDER BY created_at ASC, id ASC
          ) as rn
          FROM test_cases
          WHERE source = 'generated'
        ) WHERE rn = 1
      ) AND source = 'generated';
    `);
    this.#database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS test_cases_generated_dedup_idx
      ON test_cases(project_id, description, steps_json, expected_result)
      WHERE source = 'generated';
    `);
    this.#database
      .query(
        `UPDATE crawl_runs
         SET status = 'failed', error = ?, completed_at = ?
         WHERE status = 'running'`,
      )
      .run("Interrupted before completion", new Date().toISOString());
  }

  close(): void {
    this.#database.close();
  }

  beginRun(
    projectId: string,
    targetUrl: string,
    configuration: {
      readonly scope?: TestingExplorationScope;
      readonly maxStates?: number;
      readonly maxDurationSeconds?: number;
    } = {},
  ): string {
    const runId = crypto.randomUUID();
    this.#database
      .query(
        `INSERT INTO crawl_runs
          (id, project_id, target_url, status, started_at, scope, max_states, max_duration_seconds)
         VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`,
      )
      .run(
        runId,
        projectId,
        targetUrl,
        new Date().toISOString(),
        configuration.scope ?? "origin",
        configuration.maxStates ?? null,
        configuration.maxDurationSeconds ?? null,
      );
    return runId;
  }

  finishRun(
    runId: string,
    status: "completed" | "failed",
    error: string | null = null,
    metrics?: Pick<
      TestingExplorationResult,
      "terminationReason" | "statesVisited" | "transitionsObserved" | "durationMs"
    >,
  ): void {
    this.#database
      .query(
        `UPDATE crawl_runs SET
          status = ?, error = ?, completed_at = ?, termination_reason = ?, states_visited = ?,
          transitions_observed = ?, duration_ms = ?
         WHERE id = ?`,
      )
      .run(
        status,
        error,
        new Date().toISOString(),
        metrics?.terminationReason ?? null,
        metrics?.statesVisited ?? null,
        metrics?.transitionsObserved ?? null,
        metrics?.durationMs ?? null,
        runId,
      );
  }

  upsertNode(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly stateId: string;
    readonly pageUrl: string;
    readonly pageTitle: string;
    readonly snapshot: string;
  }): void {
    this.#database
      .query(
        `INSERT INTO graph_nodes
          (project_id, state_id, page_url, page_title, sanitized_snapshot, first_seen_run_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, state_id) DO UPDATE SET
          page_url = excluded.page_url,
          page_title = excluded.page_title,
          sanitized_snapshot = excluded.sanitized_snapshot`,
      )
      .run(
        input.projectId,
        input.stateId,
        input.pageUrl,
        input.pageTitle,
        input.snapshot,
        input.runId,
        new Date().toISOString(),
      );
  }

  upsertEdge(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly fromStateId: string;
    readonly toStateId: string;
    readonly role: string;
    readonly name: string;
  }): void {
    this.#database
      .query(
        `INSERT OR IGNORE INTO graph_edges
          (project_id, run_id, from_state_id, to_state_id, action_role, action_name, intent_locator, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.projectId,
        input.runId,
        input.fromStateId,
        input.toStateId,
        input.role,
        input.name,
        `getByRole('${input.role}', { name: ${JSON.stringify(input.name)} })`,
        new Date().toISOString(),
      );
  }

  storePiiTokens(projectId: string, tokens: ReadonlyArray<PiiToken>): void {
    const statement = this.#database.query(
      `INSERT OR IGNORE INTO pii_tokens
        (project_id, token, kind, plaintext, digest, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const now = new Date().toISOString();
    this.#database.transaction(() => {
      for (const token of tokens) {
        statement.run(projectId, token.token, token.kind, token.plaintext, token.digest, now);
      }
    })();
  }

  cacheSubtree(projectId: string, subtreeHash: string, tokenizedContent: string): boolean {
    const existing = this.#database
      .query("SELECT subtree_hash FROM subtree_cache WHERE project_id = ? AND subtree_hash = ?")
      .get(projectId, subtreeHash);
    const now = new Date().toISOString();
    if (existing) {
      this.#database
        .query(
          "UPDATE subtree_cache SET hit_count = hit_count + 1, last_used_at = ? WHERE project_id = ? AND subtree_hash = ?",
        )
        .run(now, projectId, subtreeHash);
      return true;
    }
    this.#database
      .query(
        `INSERT INTO subtree_cache
          (project_id, subtree_hash, tokenized_content, approximate_tokens, last_used_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(projectId, subtreeHash, tokenizedContent, Math.ceil(tokenizedContent.length / 4), now);
    return false;
  }

  recordAuthSession(projectId: string, profilePath: string): void {
    this.#database
      .query(
        `INSERT INTO auth_sessions (project_id, profile_path, captured_at) VALUES (?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
          profile_path = excluded.profile_path,
          captured_at = excluded.captured_at`,
      )
      .run(projectId, profilePath, new Date().toISOString());
  }

  graph(projectId: string): {
    readonly nodes: ReadonlyArray<StoredGraphNode>;
    readonly edges: ReadonlyArray<StoredGraphEdge>;
  } {
    const nodes = this.#database
      .query<
        { state_id: string; page_url: string; page_title: string; sanitized_snapshot: string },
        [string]
      >(
        `SELECT state_id, page_url, page_title, sanitized_snapshot
         FROM graph_nodes WHERE project_id = ? ORDER BY created_at`,
      )
      .all(projectId)
      .map((row) => ({
        stateId: row.state_id,
        pageUrl: row.page_url,
        pageTitle: row.page_title,
        snapshot: row.sanitized_snapshot,
      }));
    const edges = this.#database
      .query<
        {
          from_state_id: string;
          to_state_id: string;
          action_role: string;
          action_name: string;
          intent_locator: string;
        },
        [string]
      >(
        `SELECT from_state_id, to_state_id, action_role, action_name, intent_locator
         FROM graph_edges WHERE project_id = ? ORDER BY id`,
      )
      .all(projectId)
      .map((row) => ({
        fromStateId: row.from_state_id,
        toStateId: row.to_state_id,
        role: row.action_role,
        name: row.action_name,
        intentLocator: row.intent_locator,
      }));
    return { nodes, edges };
  }

  saveImportedCases(input: {
    readonly projectId: string;
    readonly workbookName: string;
    readonly workbookPath: string;
    readonly groupName?: string;
    readonly cases: ReadonlyArray<
      Omit<
        TestingCaseSummary,
        "id" | "source" | "groupName" | "reviewDecision" | "standaloneStatus" | "ciStatus" | "notes"
      >
    >;
  }): TestingWorkbookImportResult {
    const importId = crypto.randomUUID();
    const now = new Date().toISOString();
    const importedCaseIds: string[] = [];
    const insertCase = this.#database.query(
      `INSERT INTO test_cases
        (id, project_id, import_id, external_id, source, description, group_name, steps_json,
         expected_results_json, expected_result,
         source_sheet, source_row, reconciliation_status, mismatches_json, matched_state_ids_json,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, 'excel', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.#database.transaction(() => {
      this.#database
        .query(
          `INSERT INTO test_imports (id, project_id, workbook_name, workbook_path, imported_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(importId, input.projectId, input.workbookName, input.workbookPath, now);
      for (const testCase of input.cases) {
        const caseId = crypto.randomUUID();
        importedCaseIds.push(caseId);
        insertCase.run(
          caseId,
          input.projectId,
          importId,
          testCase.externalId,
          testCase.description,
          input.groupName?.trim() || testCase.sourceSheet || "Ungrouped",
          JSON.stringify(testCase.steps),
          JSON.stringify(testCase.expectedResults),
          summarizeExpectedResults(testCase.expectedResults),
          testCase.sourceSheet,
          testCase.sourceRow,
          testCase.status,
          JSON.stringify(testCase.mismatches),
          JSON.stringify(testCase.matchedStateIds),
          now,
          now,
        );
      }
    })();
    const cases = this.listCases(input.projectId).cases.filter((testCase) =>
      importedCaseIds.includes(testCase.id),
    );
    return {
      groups: this.listCases(input.projectId).groups,
      importId,
      workbookName: input.workbookName,
      cases,
      importedCount: input.cases.length,
      matchesCount: input.cases.filter((testCase) => testCase.status === "matches").length,
      needsReviewCount: input.cases.filter((testCase) => testCase.status === "needs-review").length,
      blockedCount: input.cases.filter((testCase) => testCase.status === "blocked").length,
    };
  }

  saveGeneratedCases(
    projectId: string,
    cases: ReadonlyArray<{
      readonly externalId: string;
      readonly description: string;
      readonly steps: ReadonlyArray<string>;
      readonly expectedResults?: ReadonlyArray<string>;
      readonly expectedResult: string;
      readonly matchedStateIds: ReadonlyArray<string>;
    }>,
  ): TestingCaseListResult {
    const now = new Date().toISOString();
    const statement = this.#database.query(
      `INSERT OR IGNORE INTO test_cases
        (id, project_id, external_id, source, description, steps_json,
         expected_results_json, expected_result,
         reconciliation_status, mismatches_json, matched_state_ids_json, created_at, updated_at)
       VALUES (?, ?, ?, 'generated', ?, ?, ?, ?, 'matches', '[]', ?, ?, ?)`,
    );
    this.#database.transaction(() => {
      for (const testCase of cases) {
        const expectedResults = alignExpectedResults(
          testCase.steps,
          testCase.expectedResults,
          testCase.expectedResult,
        );
        statement.run(
          crypto.randomUUID(),
          projectId,
          testCase.externalId,
          testCase.description,
          JSON.stringify(testCase.steps),
          JSON.stringify(expectedResults),
          summarizeExpectedResults(expectedResults),
          JSON.stringify(testCase.matchedStateIds),
          now,
          now,
        );
      }
    })();
    return this.listCases(projectId);
  }

  listCases(projectId: string): TestingCaseListResult {
    const rows = this.#database
      .query<StoredCaseRow, [string]>(
        `SELECT id, external_id, source, description, group_name, steps_json, expected_results_json,
          expected_result,
          source_sheet, source_row, reconciliation_status, review_decision, mismatches_json,
          matched_state_ids_json, standalone_status, ci_status, notes
         FROM test_cases WHERE project_id = ? ORDER BY created_at DESC, source_row`,
      )
      .all(projectId);
    const storedGroups = this.#database
      .query<{ name: string }, [string]>(
        "SELECT name FROM test_case_groups WHERE project_id = ? ORDER BY name COLLATE NOCASE",
      )
      .all(projectId)
      .map((row) => row.name);
    const caseGroups = rows.map(
      (row) => row.group_name.trim() || row.source_sheet?.trim() || "Ungrouped",
    );
    return {
      groups: [...new Set(["Ungrouped", ...storedGroups, ...caseGroups])].sort((left, right) =>
        left.localeCompare(right),
      ),
      cases: rows.map((row) => {
        const steps = JSON.parse(row.steps_json) as string[];
        let storedExpectedResults: string[] | undefined;
        try {
          const parsed = JSON.parse(row.expected_results_json) as unknown;
          if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) {
            storedExpectedResults = parsed;
          }
        } catch {
          storedExpectedResults = undefined;
        }
        const expectedResults = alignExpectedResults(
          steps,
          storedExpectedResults?.length ? storedExpectedResults : undefined,
          row.expected_result,
        );
        return {
          id: row.id,
          externalId: row.external_id,
          source: row.source,
          creationMethod:
            row.source === "excel"
              ? "imported"
              : row.notes === "Created manually in Testing"
                ? "manual"
                : "generated",
          description: row.description,
          groupName: row.group_name.trim() || row.source_sheet?.trim() || "Ungrouped",
          steps,
          expectedResults,
          expectedResult: summarizeExpectedResults(expectedResults),
          sourceSheet: row.source_sheet,
          sourceRow: row.source_row,
          status: row.reconciliation_status,
          reviewDecision: row.review_decision,
          mismatches: JSON.parse(row.mismatches_json) as TestingMismatch[],
          matchedStateIds: JSON.parse(row.matched_state_ids_json) as string[],
          standaloneStatus: row.standalone_status,
          ciStatus: row.ci_status,
          notes: row.notes,
        };
      }),
    };
  }

  createCase(
    input: TestingCaseCreateInput & { readonly externalId: string },
  ): TestingCaseListResult {
    const description = input.description.trim();
    const normalized = normalizeStepExpectedResults(
      input.steps,
      input.expectedResults,
      input.expectedResult,
    );
    const { steps, expectedResults } = normalized;
    const externalId = input.externalId.trim();
    if (!externalId || !description || steps.length === 0) {
      throw new Error("Manual cases require a Case ID, description, and at least one step");
    }
    const duplicate = this.listCases(input.projectId).cases.some(
      (item) => item.externalId.trim().toLocaleLowerCase() === externalId.toLocaleLowerCase(),
    );
    if (duplicate) throw new Error(`Case ID ${externalId} already exists in this project`);
    const now = new Date().toISOString();
    this.#database
      .query(
        `INSERT INTO test_cases
          (id, project_id, external_id, source, description, steps_json,
           expected_results_json, expected_result,
           reconciliation_status, review_decision, mismatches_json, matched_state_ids_json,
           notes, created_at, updated_at)
         VALUES (?, ?, ?, 'generated', ?, ?, ?, ?, 'matches', 'edited', '[]', '[]', ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        input.projectId,
        externalId,
        description,
        JSON.stringify(steps),
        JSON.stringify(expectedResults),
        summarizeExpectedResults(expectedResults),
        "Created manually in Testing",
        now,
        now,
      );
    return this.listCases(input.projectId);
  }

  reviewCase(input: TestingCaseReviewInput): TestingCaseListResult {
    const existing = this.listCases(input.projectId).cases.find((item) => item.id === input.caseId);
    if (!existing) throw new Error("Testing case was not found in this project");
    const externalId = input.externalId?.trim() || existing.externalId;
    const description = input.description?.trim() || existing.description;
    const normalized = normalizeStepExpectedResults(
      input.steps ?? existing.steps,
      input.expectedResults ??
        (input.expectedResult === undefined ? existing.expectedResults : undefined),
      input.expectedResult !== undefined ? input.expectedResult : existing.expectedResult,
    );
    const { steps, expectedResults } = normalized;
    const expectedResult = summarizeExpectedResults(expectedResults);
    if (input.decision === "edited" && (!externalId || !description || steps.length === 0)) {
      throw new Error("Edited cases require a Case ID, description, and at least one step");
    }
    const duplicate = this.listCases(input.projectId).cases.some(
      (item) =>
        item.id !== input.caseId &&
        item.externalId.trim().toLocaleLowerCase() === externalId.toLocaleLowerCase(),
    );
    if (duplicate) throw new Error(`Case ID ${externalId} already exists in this project`);
    const reviewed = {
      ...existing,
      externalId,
      description,
      steps,
      expectedResults,
      expectedResult,
      reviewDecision: input.decision,
    };
    const now = new Date().toISOString();
    this.#database.transaction(() => {
      this.#database
        .query(
          `UPDATE test_cases SET external_id = ?, description = ?, steps_json = ?,
           expected_results_json = ?, expected_result = ?, review_decision = ?, notes = ?,
           updated_at = ? WHERE id = ? AND project_id = ?`,
        )
        .run(
          externalId,
          description,
          JSON.stringify(steps),
          JSON.stringify(expectedResults),
          expectedResult,
          input.decision,
          input.notes ?? existing.notes,
          now,
          input.caseId,
          input.projectId,
        );
      this.#database
        .query(
          `INSERT INTO test_case_reviews
           (id, case_id, decision, previous_json, reviewed_json, notes, reviewed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          crypto.randomUUID(),
          input.caseId,
          input.decision,
          JSON.stringify(existing),
          JSON.stringify(reviewed),
          input.notes ?? "",
          now,
        );
    })();
    return this.listCases(input.projectId);
  }

  deleteCase(projectId: string, caseId: string): TestingCaseListResult {
    const existing = this.listCases(projectId).cases.find((item) => item.id === caseId);
    if (!existing) throw new Error("Testing case was not found in this project");
    this.#database.transaction(() => {
      this.#database.query("DELETE FROM test_case_reviews WHERE case_id = ?").run(caseId);
      this.#database
        .query("DELETE FROM test_cases WHERE id = ? AND project_id = ?")
        .run(caseId, projectId);
    })();
    return this.listCases(projectId);
  }

  updateCaseGroup(input: {
    readonly projectId: string;
    readonly caseId: string;
    readonly groupName: string;
  }): TestingCaseListResult {
    const existing = this.listCases(input.projectId).cases.find((item) => item.id === input.caseId);
    if (!existing) throw new Error("Testing case was not found in this project");
    const groupName = input.groupName.trim() || "Ungrouped";
    this.#database.transaction(() => {
      this.#database
        .query(
          "INSERT OR IGNORE INTO test_case_groups (project_id, name, created_at) VALUES (?, ?, ?)",
        )
        .run(input.projectId, groupName, new Date().toISOString());
      this.#database
        .query(
          "UPDATE test_cases SET group_name = ?, updated_at = ? WHERE id = ? AND project_id = ?",
        )
        .run(groupName, new Date().toISOString(), input.caseId, input.projectId);
    })();
    return this.listCases(input.projectId);
  }

  createCaseGroup(projectId: string, groupName: string): TestingCaseListResult {
    const name = groupName.trim();
    if (!name) throw new Error("Enter a test group name");
    this.#database
      .query(
        "INSERT OR IGNORE INTO test_case_groups (project_id, name, created_at) VALUES (?, ?, ?)",
      )
      .run(projectId, name, new Date().toISOString());
    return this.listCases(projectId);
  }

  deleteCaseGroup(projectId: string, groupName: string): TestingCaseListResult {
    const name = groupName.trim();
    if (!name || name === "Ungrouped") throw new Error("The Ungrouped folder cannot be deleted");
    const now = new Date().toISOString();
    this.#database.transaction(() => {
      this.#database
        .query(
          "UPDATE test_cases SET group_name = 'Ungrouped', updated_at = ? WHERE project_id = ? AND group_name = ?",
        )
        .run(now, projectId, name);
      this.#database
        .query("DELETE FROM test_case_groups WHERE project_id = ? AND name = ?")
        .run(projectId, name);
    })();
    return this.listCases(projectId);
  }

  clearGraph(projectId: string): TestingClearGraphResult {
    const before = this.summary(projectId);
    this.#database.transaction(() => {
      this.#database.query("DELETE FROM graph_edges WHERE project_id = ?").run(projectId);
      this.#database.query("DELETE FROM graph_nodes WHERE project_id = ?").run(projectId);
      this.#database.query("DELETE FROM subtree_cache WHERE project_id = ?").run(projectId);
      this.#database.query("DELETE FROM pii_tokens WHERE project_id = ?").run(projectId);
      this.#database.query("DELETE FROM crawl_runs WHERE project_id = ?").run(projectId);
    })();
    return {
      ...this.summary(projectId),
      clearedNodeCount: before.nodeCount,
      clearedEdgeCount: before.edgeCount,
    };
  }

  createGenerationJob(input: {
    readonly id: string;
    readonly projectId: string;
    readonly outputDirectory: string;
    readonly totalCases: number;
    readonly modelSelection: TestingGenerationJob["modelSelection"];
    readonly engine?: TestingGenerationJob["engine"];
    readonly stage?: TestingGenerationJob["stage"];
    readonly parentJobId?: string | null;
    readonly parentRunId?: string | null;
    readonly attemptCount?: number;
    readonly validationSummary?: TestingGenerationJob["validationSummary"];
    readonly immutableArtifactPaths?: TestingGenerationJob["immutableArtifactPaths"];
    readonly providerProvenance?: TestingGenerationJob["providerProvenance"];
    readonly usageMeasured?: boolean;
  }): void {
    const now = new Date().toISOString();
    this.#database
      .query(
        `INSERT INTO generation_jobs
          (id, project_id, status, engine, stage, parent_job_id, parent_run_id, attempt_count,
           validation_summary_json, immutable_artifact_paths_json, provider_provenance_json, usage_measured,
           framework, provider_instance_id, model, model_options_json,
           output_directory, total_cases, created_at, updated_at)
         VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'playwright-ts', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.projectId,
        input.engine ?? "standard",
        input.stage ?? "planned",
        input.parentJobId ?? null,
        input.parentRunId ?? null,
        input.attemptCount ?? 1,
        input.validationSummary ? JSON.stringify(input.validationSummary) : null,
        input.immutableArtifactPaths ? JSON.stringify(input.immutableArtifactPaths) : null,
        input.providerProvenance ? JSON.stringify(input.providerProvenance) : null,
        input.usageMeasured ? 1 : 0,
        input.modelSelection.instanceId,
        input.modelSelection.model,
        JSON.stringify(input.modelSelection.options ?? []),
        input.outputDirectory,
        input.totalCases,
        now,
        now,
      );
  }

  updateGenerationJob(
    id: string,
    patch: {
      readonly status: TestingGenerationJob["status"];
      readonly engine?: TestingGenerationJob["engine"];
      readonly stage?: TestingGenerationJob["stage"];
      readonly parentJobId?: string | null;
      readonly parentRunId?: string | null;
      readonly attemptCount?: number;
      readonly validationSummary?: TestingGenerationJob["validationSummary"];
      readonly immutableArtifactPaths?: TestingGenerationJob["immutableArtifactPaths"];
      readonly providerProvenance?: TestingGenerationJob["providerProvenance"];
      readonly usageMeasured?: boolean;
      readonly completedCases?: number;
      readonly estimatedTokens?: number;
      readonly estimatedCostUsd?: number;
      readonly error?: string | null;
    },
  ): void {
    this.#database
      .query(
        `UPDATE generation_jobs SET
          status = ?,
          engine = COALESCE(?, engine),
          stage = COALESCE(?, stage),
          parent_job_id = CASE WHEN ? IS NOT NULL THEN ? ELSE parent_job_id END,
          parent_run_id = CASE WHEN ? IS NOT NULL THEN ? ELSE parent_run_id END,
          attempt_count = COALESCE(?, attempt_count),
          validation_summary_json = CASE WHEN ? IS NOT NULL THEN ? ELSE validation_summary_json END,
          immutable_artifact_paths_json = CASE WHEN ? IS NOT NULL THEN ? ELSE immutable_artifact_paths_json END,
          provider_provenance_json = CASE WHEN ? IS NOT NULL THEN ? ELSE provider_provenance_json END,
          usage_measured = COALESCE(?, usage_measured),
          completed_cases = COALESCE(?, completed_cases),
          estimated_tokens = COALESCE(?, estimated_tokens),
          estimated_cost_usd = COALESCE(?, estimated_cost_usd),
          error = ?,
          updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.status,
        patch.engine ?? null,
        patch.stage ?? null,
        patch.parentJobId !== undefined ? 1 : null,
        patch.parentJobId ?? null,
        patch.parentRunId !== undefined ? 1 : null,
        patch.parentRunId ?? null,
        patch.attemptCount ?? null,
        patch.validationSummary !== undefined ? 1 : null,
        patch.validationSummary ? JSON.stringify(patch.validationSummary) : null,
        patch.immutableArtifactPaths !== undefined ? 1 : null,
        patch.immutableArtifactPaths ? JSON.stringify(patch.immutableArtifactPaths) : null,
        patch.providerProvenance !== undefined ? 1 : null,
        patch.providerProvenance ? JSON.stringify(patch.providerProvenance) : null,
        patch.usageMeasured !== undefined ? (patch.usageMeasured ? 1 : 0) : null,
        patch.completedCases ?? null,
        patch.estimatedTokens ?? null,
        patch.estimatedCostUsd ?? null,
        patch.error ?? null,
        new Date().toISOString(),
        id,
      );
  }

  addGeneratedArtifact(input: {
    readonly jobId: string;
    readonly caseId: string;
    readonly externalId: string;
    readonly featureSlug: string;
    readonly pageObjectPath: string;
    readonly dataPath: string;
    readonly specPath: string;
    readonly fingerprints: ReadonlyArray<{
      readonly locatorKey: string;
      readonly role: string;
      readonly accessibleName: string;
      readonly semanticContext: string;
      readonly graphStateId: string;
      readonly urlPattern: string;
      readonly locatorEntryId?: string;
      readonly locatorVersionId?: string;
    }>;
    readonly captureReplay: boolean;
  }): void {
    const artifactId = crypto.randomUUID();
    const now = new Date().toISOString();
    this.#database.transaction(() => {
      this.#database
        .query(
          `INSERT INTO generated_artifacts
           (id, job_id, case_id, external_id, feature_slug, page_object_path, data_path,
            spec_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          artifactId,
          input.jobId,
          input.caseId,
          input.externalId,
          input.featureSlug,
          input.pageObjectPath,
          input.dataPath,
          input.specPath,
          now,
        );
      const fingerprintStatement = this.#database.query(
        `INSERT INTO locator_fingerprints
         (id, artifact_id, case_id, locator_key, role, accessible_name, semantic_context,
          graph_state_id, url_pattern, verified_at, locator_entry_id, locator_version_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const fingerprint of input.fingerprints) {
        fingerprintStatement.run(
          crypto.randomUUID(),
          artifactId,
          input.caseId,
          fingerprint.locatorKey,
          fingerprint.role,
          fingerprint.accessibleName,
          fingerprint.semanticContext,
          fingerprint.graphStateId,
          fingerprint.urlPattern,
          now,
          fingerprint.locatorEntryId ?? null,
          fingerprint.locatorVersionId ?? null,
        );
      }
      this.#database
        .query(
          `INSERT INTO network_replay_metadata
           (id, case_id, enabled, sanitized_entries_json, created_at) VALUES (?, ?, ?, '[]', ?)`,
        )
        .run(crypto.randomUUID(), input.caseId, input.captureReplay ? 1 : 0, now);
    })();
  }

  listGenerationJobs(projectId: string): TestingGenerationJobListResult {
    const rows = this.#database
      .query<StoredGenerationJobRow, [string]>(
        `SELECT id, project_id, status, engine, stage, parent_job_id, parent_run_id,
          attempt_count, validation_summary_json, immutable_artifact_paths_json,
          provider_provenance_json, usage_measured,
          framework, provider_instance_id, model,
          model_options_json, output_directory, total_cases,
          completed_cases, estimated_tokens, estimated_cost_usd, error
         FROM generation_jobs WHERE project_id = ? ORDER BY created_at DESC`,
      )
      .all(projectId);
    const artifactStatement = this.#database.query<
      Omit<TestingGeneratedArtifact, "fingerprintCount"> & { fingerprint_count: number },
      [string]
    >(
      `SELECT a.case_id AS caseId, a.external_id AS externalId, a.feature_slug AS featureSlug,
        a.page_object_path AS pageObjectPath, a.data_path AS dataPath, a.spec_path AS specPath,
        COUNT(f.id) AS fingerprint_count
       FROM generated_artifacts a LEFT JOIN locator_fingerprints f ON f.artifact_id = a.id
       WHERE a.job_id = ? GROUP BY a.id ORDER BY a.created_at`,
    );
    return {
      jobs: rows.map((row) => {
        const options = JSON.parse(row.model_options_json) as NonNullable<
          TestingGenerationJob["modelSelection"]["options"]
        >;
        return {
          id: row.id,
          projectId: row.project_id,
          status: row.status,
          engine: row.engine ?? "standard",
          stage: row.stage ?? "planned",
          parentJobId: row.parent_job_id ?? undefined,
          parentRunId: row.parent_run_id ?? undefined,
          attemptCount: row.attempt_count ?? 1,
          validationSummary: row.validation_summary_json
            ? (JSON.parse(row.validation_summary_json) as TestingGenerationJob["validationSummary"])
            : undefined,
          immutableArtifactPaths: row.immutable_artifact_paths_json
            ? (JSON.parse(
                row.immutable_artifact_paths_json,
              ) as TestingGenerationJob["immutableArtifactPaths"])
            : undefined,
          providerProvenance: row.provider_provenance_json
            ? (JSON.parse(
                row.provider_provenance_json,
              ) as TestingGenerationJob["providerProvenance"])
            : undefined,
          usageMeasured: Boolean(row.usage_measured),
          framework: row.framework,
          modelSelection: {
            instanceId:
              row.provider_instance_id as TestingGenerationJob["modelSelection"]["instanceId"],
            model: row.model,
            ...(options.length > 0 ? { options } : {}),
          },
          outputDirectory: row.output_directory,
          totalCases: row.total_cases,
          completedCases: row.completed_cases,
          estimatedTokens: row.estimated_tokens,
          estimatedCostUsd: row.estimated_cost_usd,
          error: row.error,
          artifacts: artifactStatement.all(row.id).map((artifact) => ({
            ...artifact,
            fingerprintCount: artifact.fingerprint_count,
          })),
        };
      }),
    };
  }

  generationJob(projectId: string, jobId: string): TestingGenerationJob | null {
    return this.listGenerationJobs(projectId).jobs.find((job) => job.id === jobId) ?? null;
  }

  executionArtifacts(
    jobId: string,
    caseIds?: ReadonlyArray<string>,
  ): ReadonlyArray<TestingExecutionArtifact> {
    const rows = this.#database
      .query<
        { case_id: string; external_id: string; spec_path: string; page_object_path: string },
        [string]
      >(
        `SELECT case_id, external_id, spec_path, page_object_path
         FROM generated_artifacts WHERE job_id = ? ORDER BY created_at`,
      )
      .all(jobId)
      .filter((row) => !caseIds || caseIds.includes(row.case_id));
    const fingerprints = this.#database.query<
      {
        locator_key: string;
        role: string;
        accessible_name: string;
        graph_state_id: string;
        locator_entry_id: string | null;
        locator_version_id: string | null;
      },
      [string, string]
    >(
      `SELECT f.locator_key, f.role, f.accessible_name, f.graph_state_id,
        f.locator_entry_id, f.locator_version_id
       FROM locator_fingerprints f JOIN generated_artifacts a ON a.id = f.artifact_id
       WHERE a.job_id = ? AND f.case_id = ? ORDER BY f.id`,
    );
    return rows.map((row) => ({
      caseId: row.case_id,
      externalId: row.external_id,
      specPath: row.spec_path,
      pageObjectPath: row.page_object_path,
      fingerprints: fingerprints.all(jobId, row.case_id).map((fingerprint) => ({
        locatorKey: fingerprint.locator_key,
        role: fingerprint.role,
        accessibleName: fingerprint.accessible_name,
        graphStateId: fingerprint.graph_state_id,
        ...(fingerprint.locator_entry_id ? { locatorEntryId: fingerprint.locator_entry_id } : {}),
        ...(fingerprint.locator_version_id
          ? { locatorVersionId: fingerprint.locator_version_id }
          : {}),
      })),
    }));
  }

  beginExecutionRun(input: {
    readonly id: string;
    readonly projectId: string;
    readonly generationJobId: string;
    readonly mode: TestingExecutionRun["mode"];
    readonly targetUrl: string;
    readonly artifactRevision: string;
  }): void {
    this.#database
      .query(
        `INSERT INTO execution_runs
         (id, project_id, generation_job_id, mode, status, target_url, artifact_revision, started_at)
         VALUES (?, ?, ?, ?, 'running', ?, ?, ?)`,
      )
      .run(
        input.id,
        input.projectId,
        input.generationJobId,
        input.mode,
        sanitizePersistedUrl(input.targetUrl),
        input.artifactRevision,
        new Date().toISOString(),
      );
  }

  finishExecutionRun(input: {
    readonly runId: string;
    readonly status: TestingExecutionRun["status"];
    readonly durationMs: number;
    readonly stdout: string;
    readonly stderr: string;
    readonly artifactRevision: string;
    readonly results: ReadonlyArray<TestingExecutionCaseResult>;
    readonly proposals: ReadonlyArray<
      Omit<TestingHealingProposal, "id"> & { readonly id?: string }
    >;
  }): void {
    const now = new Date().toISOString();
    this.#database.transaction(() => {
      this.#database
        .query(
          `UPDATE execution_runs SET status = ?, duration_ms = ?, stdout = ?, stderr = ?,
           completed_at = ? WHERE id = ?`,
        )
        .run(input.status, input.durationMs, input.stdout, input.stderr, now, input.runId);
      const resultStatement = this.#database.query(
        `INSERT INTO execution_case_results
         (id, run_id, case_id, external_id, status, duration_ms, error, trace_path,
          screenshot_path, flaky, quarantined, visual_status, artifact_revision, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const result of input.results) {
        resultStatement.run(
          crypto.randomUUID(),
          input.runId,
          result.caseId,
          result.externalId,
          result.status,
          result.durationMs,
          result.error,
          result.tracePath,
          result.screenshotPath,
          result.flaky ? 1 : 0,
          result.quarantined ? 1 : 0,
          result.visualStatus,
          input.artifactRevision,
          now,
        );
        this.#database
          .query(
            `UPDATE test_cases SET standalone_status = ?, ci_status = ?, updated_at = ? WHERE id = ?`,
          )
          .run(
            input.status === "passed" ? "passed" : "failed",
            result.status === "passed" ? "pass" : "fail",
            now,
            result.caseId,
          );
      }
      const proposalStatement = this.#database.query(
        `INSERT INTO healing_proposals
         (id, run_id, case_id, locator_key, previous_role, previous_name, proposed_role,
          proposed_name, confidence, margin, diff, status, consecutive_attempts, created_at,
          locator_entry_id, locator_version_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const proposal of input.proposals) {
        proposalStatement.run(
          proposal.id ?? crypto.randomUUID(),
          input.runId,
          proposal.caseId,
          proposal.locatorKey,
          proposal.previousRole,
          proposal.previousName,
          proposal.proposedRole,
          proposal.proposedName,
          proposal.confidence,
          proposal.margin,
          proposal.diff,
          proposal.status,
          proposal.consecutiveAttempts,
          now,
          proposal.locatorEntryId ?? null,
          proposal.locatorVersionId ?? null,
        );
      }
    })();
  }

  executionRuns(projectId: string): TestingExecutionRunListResult {
    const runs = this.#database
      .query<StoredExecutionRunRow, [string]>(
        `SELECT * FROM execution_runs WHERE project_id = ? ORDER BY started_at DESC`,
      )
      .all(projectId);
    const results = this.#database.query<StoredExecutionCaseRow, [string]>(
      `SELECT case_id, external_id, status, duration_ms, error, trace_path, screenshot_path,
       flaky, quarantined, visual_status FROM execution_case_results WHERE run_id = ? ORDER BY created_at`,
    );
    const proposals = this.#database.query<StoredHealingRow, [string]>(
      `SELECT id, case_id, locator_key, previous_role, previous_name, proposed_role,
       proposed_name, confidence, margin, diff, status, consecutive_attempts,
       locator_entry_id, locator_version_id
       FROM healing_proposals WHERE run_id = ? ORDER BY created_at`,
    );
    return {
      runs: runs.map((run) => ({
        id: run.id,
        projectId: run.project_id,
        generationJobId: run.generation_job_id,
        mode: run.mode,
        status: run.status,
        targetUrl: run.target_url,
        startedAt: run.started_at,
        completedAt: run.completed_at,
        durationMs: run.duration_ms,
        artifactRevision: run.artifact_revision,
        stdout: run.stdout,
        stderr: run.stderr,
        results: results.all(run.id).map((result) => ({
          caseId: result.case_id,
          externalId: result.external_id,
          status: result.status,
          durationMs: result.duration_ms,
          error: result.error,
          tracePath: result.trace_path,
          screenshotPath: result.screenshot_path,
          flaky: Boolean(result.flaky),
          quarantined: Boolean(result.quarantined),
          visualStatus: result.visual_status,
        })),
        healingProposals: proposals.all(run.id).map((proposal) => ({
          id: proposal.id,
          caseId: proposal.case_id,
          locatorKey: proposal.locator_key,
          previousRole: proposal.previous_role,
          previousName: proposal.previous_name,
          proposedRole: proposal.proposed_role,
          proposedName: proposal.proposed_name,
          confidence: proposal.confidence,
          margin: proposal.margin,
          diff: proposal.diff,
          status: proposal.status,
          consecutiveAttempts: proposal.consecutive_attempts,
          ...(proposal.locator_entry_id ? { locatorEntryId: proposal.locator_entry_id } : {}),
          ...(proposal.locator_version_id ? { locatorVersionId: proposal.locator_version_id } : {}),
        })),
      })),
    };
  }

  comparableCaseStatuses(
    caseId: string,
    artifactRevision: string,
  ): ReadonlyArray<"passed" | "failed"> {
    return this.#database
      .query<{ status: "passed" | "failed" }, [string, string]>(
        `SELECT status FROM execution_case_results
       WHERE case_id = ? AND artifact_revision = ? AND app_revision = ''
         AND status IN ('passed', 'failed') ORDER BY created_at`,
      )
      .all(caseId, artifactRevision)
      .map((row) => row.status);
  }

  consecutiveHealingAttempts(caseId: string, locatorKey: string): number {
    return (
      this.#database
        .query<CountRow, [string, string]>(
          `SELECT COUNT(*) AS count FROM healing_proposals
       WHERE case_id = ? AND locator_key = ? AND status != 'accepted'`,
        )
        .get(caseId, locatorKey)?.count ?? 0
    );
  }

  compareVisualBaseline(
    caseId: string,
    screenshotHash: string,
    screenshotPath: string,
  ): "baseline-created" | "matched" | "changed" {
    const baseline = this.#database
      .query<{ screenshot_hash: string }, [string]>(
        "SELECT screenshot_hash FROM visual_baselines WHERE case_id = ?",
      )
      .get(caseId);
    if (!baseline) {
      this.#database
        .query(
          `INSERT INTO visual_baselines (case_id, screenshot_hash, screenshot_path, approved_at)
         VALUES (?, ?, ?, ?)`,
        )
        .run(caseId, screenshotHash, screenshotPath, new Date().toISOString());
      return "baseline-created";
    }
    return baseline.screenshot_hash === screenshotHash ? "matched" : "changed";
  }

  decideHealingProposal(input: TestingHealingDecisionInput): TestingExecutionRunListResult {
    const proposal = this.#database
      .query<{ project_id: string }, [string]>(
        `SELECT r.project_id FROM healing_proposals h JOIN execution_runs r ON r.id = h.run_id
       WHERE h.id = ?`,
      )
      .get(input.proposalId);
    if (!proposal || proposal.project_id !== input.projectId)
      throw new Error("Healing proposal not found");
    this.#database
      .query(
        `UPDATE healing_proposals SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'`,
      )
      .run(input.decision, new Date().toISOString(), input.proposalId);
    return this.executionRuns(input.projectId);
  }

  healingProposal(
    projectId: string,
    proposalId: string,
  ):
    | (TestingHealingProposal & {
        readonly targetUrl: string;
      })
    | null {
    const proposal = this.#database
      .query<StoredHealingRow & { target_url: string; project_id: string }, [string]>(
        `SELECT h.id, h.case_id, h.locator_key, h.previous_role, h.previous_name,
          h.proposed_role, h.proposed_name, h.confidence, h.margin, h.diff, h.status,
          h.consecutive_attempts, h.locator_entry_id, h.locator_version_id,
          r.target_url, r.project_id
         FROM healing_proposals h JOIN execution_runs r ON r.id = h.run_id WHERE h.id = ?`,
      )
      .get(proposalId);
    if (!proposal || proposal.project_id !== projectId) return null;
    return {
      id: proposal.id,
      caseId: proposal.case_id,
      locatorKey: proposal.locator_key,
      previousRole: proposal.previous_role,
      previousName: proposal.previous_name,
      proposedRole: proposal.proposed_role,
      proposedName: proposal.proposed_name,
      confidence: proposal.confidence,
      margin: proposal.margin,
      diff: proposal.diff,
      status: proposal.status,
      consecutiveAttempts: proposal.consecutive_attempts,
      ...(proposal.locator_entry_id ? { locatorEntryId: proposal.locator_entry_id } : {}),
      ...(proposal.locator_version_id ? { locatorVersionId: proposal.locator_version_id } : {}),
      targetUrl: proposal.target_url,
    };
  }

  createSchedule(input: TestingScheduleInput): TestingSchedule {
    const nextRunAt = new Date(input.runAt);
    if (Number.isNaN(nextRunAt.valueOf())) throw new Error("Schedule run time is invalid");
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format();
    } catch {
      throw new Error("Schedule timezone is invalid");
    }
    const schedule: TestingSchedule = {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      generationJobId: input.generationJobId,
      targetUrl: sanitizePersistedUrl(input.targetUrl),
      timezone: input.timezone,
      recurrence: input.recurrence ?? "none",
      nextRunAt: nextRunAt.toISOString(),
      enabled: true,
    };
    this.#database
      .query(
        `INSERT INTO testing_schedules
       (id, project_id, generation_job_id, target_url, timezone, recurrence, next_run_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        schedule.id,
        schedule.projectId,
        schedule.generationJobId,
        schedule.targetUrl,
        schedule.timezone,
        schedule.recurrence,
        schedule.nextRunAt,
        new Date().toISOString(),
      );
    return schedule;
  }

  listSchedules(projectId: string): TestingScheduleListResult {
    const schedules = this.#database
      .query<
        {
          id: string;
          project_id: string;
          generation_job_id: string;
          target_url: string;
          timezone: string;
          recurrence: TestingSchedule["recurrence"];
          next_run_at: string;
          enabled: number;
        },
        [string]
      >(`SELECT * FROM testing_schedules WHERE project_id = ? ORDER BY next_run_at`)
      .all(projectId);
    return {
      schedules: schedules.map((schedule) => ({
        id: schedule.id,
        projectId: schedule.project_id,
        generationJobId: schedule.generation_job_id,
        targetUrl: schedule.target_url,
        timezone: schedule.timezone,
        recurrence: schedule.recurrence,
        nextRunAt: schedule.next_run_at,
        enabled: Boolean(schedule.enabled),
      })),
    };
  }

  traceability(projectId: string, externalId: string): TestingTraceabilityResult {
    const testCase = this.listCases(projectId).cases.find((item) => item.externalId === externalId);
    if (!testCase) throw new Error(`Case ${externalId} was not found`);
    const imported = this.#database
      .query<
        {
          workbook_name: string;
          workbook_path: string;
        },
        [string]
      >(
        `SELECT i.workbook_name, i.workbook_path FROM test_cases c
       LEFT JOIN test_imports i ON i.id = c.import_id WHERE c.id = ?`,
      )
      .get(testCase.id);
    const artifacts = this.#database
      .query<
        {
          job_id: string;
          case_id: string;
          external_id: string;
          feature_slug: string;
          page_object_path: string;
          data_path: string;
          spec_path: string;
          fingerprint_count: number;
        },
        [string]
      >(
        `SELECT a.job_id, a.case_id, a.external_id, a.feature_slug, a.page_object_path,
       a.data_path, a.spec_path, COUNT(f.id) AS fingerprint_count
       FROM generated_artifacts a LEFT JOIN locator_fingerprints f ON f.artifact_id = a.id
       WHERE a.case_id = ? GROUP BY a.id ORDER BY a.created_at`,
      )
      .all(testCase.id);
    const executions = this.#database
      .query<
        {
          run_id: string;
          mode: "standalone" | "ci";
          status: TestingExecutionCaseResult["status"];
          started_at: string;
          duration_ms: number;
          error: string | null;
        },
        [string]
      >(
        `SELECT r.id AS run_id, r.mode, cr.status, r.started_at, cr.duration_ms, cr.error
       FROM execution_case_results cr JOIN execution_runs r ON r.id = cr.run_id
       WHERE cr.case_id = ? ORDER BY r.started_at DESC`,
      )
      .all(testCase.id);
    const healing = this.#database
      .query<StoredHealingRow & { run_id: string }, [string]>(
        `SELECT id, run_id, case_id, locator_key, previous_role, previous_name, proposed_role,
       proposed_name, confidence, margin, diff, status, consecutive_attempts,
       locator_entry_id, locator_version_id
       FROM healing_proposals WHERE case_id = ? ORDER BY created_at DESC`,
      )
      .all(testCase.id);
    return {
      case: testCase,
      import: imported?.workbook_name
        ? {
            workbookName: imported.workbook_name,
            workbookPath: imported.workbook_path,
          }
        : null,
      generatedArtifacts: artifacts.map((artifact) => ({
        jobId: artifact.job_id,
        caseId: artifact.case_id,
        externalId: artifact.external_id,
        featureSlug: artifact.feature_slug,
        pageObjectPath: artifact.page_object_path,
        dataPath: artifact.data_path,
        specPath: artifact.spec_path,
        fingerprintCount: artifact.fingerprint_count,
      })),
      executions: executions.map((execution) => ({
        runId: execution.run_id,
        mode: execution.mode,
        status: execution.status,
        verifiedAt: execution.started_at,
        durationMs: execution.duration_ms,
        error: execution.error,
      })),
      healing: healing.map((proposal) => ({
        id: proposal.id,
        runId: proposal.run_id,
        caseId: proposal.case_id,
        locatorKey: proposal.locator_key,
        previousRole: proposal.previous_role,
        previousName: proposal.previous_name,
        proposedRole: proposal.proposed_role,
        proposedName: proposal.proposed_name,
        confidence: proposal.confidence,
        margin: proposal.margin,
        diff: proposal.diff,
        status: proposal.status,
        consecutiveAttempts: proposal.consecutive_attempts,
        ...(proposal.locator_entry_id ? { locatorEntryId: proposal.locator_entry_id } : {}),
        ...(proposal.locator_version_id ? { locatorVersionId: proposal.locator_version_id } : {}),
      })),
    };
  }

  graphExplorer(projectId: string): TestingGraphExplorerResult {
    const graph = this.graph(projectId);
    const cases = this.listCases(projectId).cases;
    return {
      nodes: graph.nodes.map((node) => ({
        ...node,
        linkedCaseIds: cases
          .filter((testCase) => testCase.matchedStateIds.includes(node.stateId))
          .map((testCase) => testCase.externalId),
      })),
      edges: graph.edges,
    };
  }

  saveReport(runId: string, docxPath: string, pdfPath: string): { id: string; createdAt: string } {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.#database
      .query(
        "INSERT INTO testing_reports (id, run_id, docx_path, pdf_path, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, runId, docxPath, pdfPath, createdAt);
    return { id, createdAt };
  }

  updateRunProgress(runId: string, statesVisited: number, transitionsObserved: number): void {
    this.#database
      .query("UPDATE crawl_runs SET states_visited = ?, transitions_observed = ? WHERE id = ?")
      .run(statesVisited, transitionsObserved, runId);
  }

  summary(projectId: string): TestingGraphSummary {
    const latest = this.#database
      .query<StatusRow, [string]>(
        "SELECT target_url, status, error, termination_reason, states_visited, transitions_observed, duration_ms, max_states, max_duration_seconds FROM crawl_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT 1",
      )
      .get(projectId);
    const auth = this.#database
      .query<AuthRow, [string]>("SELECT captured_at FROM auth_sessions WHERE project_id = ?")
      .get(projectId);
    const count = (table: "graph_nodes" | "graph_edges" | "subtree_cache") =>
      this.#database
        .query<CountRow, [string]>(`SELECT COUNT(*) AS count FROM ${table} WHERE project_id = ?`)
        .get(projectId)?.count ?? 0;
    const cacheHits =
      this.#database
        .query<CountRow, [string]>(
          "SELECT COALESCE(SUM(hit_count), 0) AS count FROM subtree_cache WHERE project_id = ?",
        )
        .get(projectId)?.count ?? 0;

    return {
      projectId,
      targetUrl: latest?.target_url ?? null,
      databasePath: this.databasePath,
      authCapturedAt: auth?.captured_at ?? null,
      nodeCount: count("graph_nodes"),
      edgeCount: count("graph_edges"),
      cacheEntryCount: count("subtree_cache"),
      cacheHitCount: cacheHits,
      lastRunStatus: latest?.status ?? "idle",
      lastRunError: latest?.error ?? null,
      lastRunMetrics: latest
        ? {
            terminationReason: latest.termination_reason,
            statesVisited: latest.states_visited,
            transitionsObserved: latest.transitions_observed,
            durationMs: latest.duration_ms,
            maxStates: latest.max_states,
            maxDurationSeconds: latest.max_duration_seconds,
          }
        : null,
    };
  }
}
