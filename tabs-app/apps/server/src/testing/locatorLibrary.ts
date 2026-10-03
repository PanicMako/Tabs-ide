import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type {
  TestingDiscoveryExperience,
  TestingCaseIdPolicy,
  TestingCaseIdPolicyInput,
  TestingDiscoveryMode,
  TestingDiscoverySafetyProfile,
  TestingLocatorCoverageMode,
  TestingLocatorEntry,
  TestingLocatorEntryReviewInput,
  TestingLocatorLibraryResult,
  TestingLocatorPage,
  TestingLocatorPageDeleteInput,
  TestingLocatorPageSelectionInput,
  TestingLocatorPageUpdateInput,
  TestingLocatorRepositoryTarget,
  TestingLocatorSyncDecisionInput,
  TestingLocatorSyncPreview,
  TestingLocatorStorageMode,
  TestingLocatorVerificationStatus,
  TestingPageObjectArtifact,
  TestingPageObjectCodeUpdateInput,
} from "@tabs/contracts";
import * as ts from "typescript";

import {
  redactCredentialLikeText,
  sanitizePersistedUrl,
  shortDigest,
  tokenizePii,
} from "./security";
import { RuntimeSqliteDatabase } from "./sqlite";

export interface LocatorCandidate {
  readonly locatorKey: string;
  readonly classification: TestingLocatorEntry["classification"];
  readonly strategy: TestingLocatorEntry["strategy"];
  readonly arguments: Readonly<Record<string, string | number | boolean>>;
  readonly semanticContext: string;
  readonly source: TestingLocatorEntry["source"];
  readonly sourceFile?: string;
  readonly sourceLine?: number;
  readonly fragile?: boolean;
  readonly lifecycleStatus?: TestingLocatorEntry["lifecycleStatus"];
  readonly elementFingerprint?: string | null;
  readonly targetPageFingerprint?: string | null;
}

interface PageRow {
  readonly id: string;
  readonly name: string;
  readonly url_pattern: string;
  readonly environment_label: string;
  readonly structural_fingerprint: string;
  readonly capture_source: TestingLocatorPage["captureSource"];
  readonly lifecycle_status: TestingLocatorPage["lifecycleStatus"];
  readonly incomplete_session: number;
}

interface EntryRow {
  readonly id: string;
  readonly page_id: string;
  readonly locator_key: string;
  readonly classification: TestingLocatorEntry["classification"];
  readonly source_file: string | null;
  readonly source_line: number | null;
  readonly lifecycle_status: TestingLocatorEntry["lifecycleStatus"];
  readonly sync_status: TestingLocatorEntry["syncStatus"];
  readonly current_version_id: string;
  readonly health: TestingLocatorEntry["health"];
  readonly element_fingerprint: string | null;
  readonly target_page_fingerprint: string | null;
  readonly verification_count: number;
  readonly consecutive_repair_attempts: number;
  readonly last_failure_classification: string | null;
  readonly version_number: number;
  readonly strategy: TestingLocatorEntry["strategy"];
  readonly arguments_json: string;
  readonly semantic_context: string;
  readonly source: TestingLocatorEntry["source"];
  readonly fragile: number;
  readonly verification_status: TestingLocatorVerificationStatus | null;
  readonly environment_label: string | null;
  readonly verified_at: string | null;
}

function featureEnabled(): boolean {
  return process.env.TABS_TESTING_LOCATOR_FIRST_ENABLED?.trim().toLowerCase() !== "false";
}

function safeName(value: string): string {
  return (
    value
      .replace(/[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu, "")
      .toLowerCase()
      .replace(/<[^>]+>/g, " redacted ")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "locator"
  );
}

function humanizePageSegment(value: string): string {
  const words = value
    .replace(/\.[^.]+$/u, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  if (!words) return "Captured page";
  const label = words
    .split(/\s+/u)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
  return /\bpage$/iu.test(label) ? label : `${label} page`;
}

function pageName(urlPattern: string): string {
  try {
    const url = new URL(urlPattern);
    const hashPath = url.hash.replace(/^#\/?/u, "").split(/[?#]/u)[0] ?? "";
    const segments = (hashPath || url.pathname).split("/").filter(Boolean);
    const segment = segments.findLast(
      (part) => !/^(?:index|default|web)(?:\.[a-z]+)?$/iu.test(part),
    );
    return segment ? humanizePageSegment(decodeURIComponent(segment)) : "Landing page";
  } catch {
    return "Captured page";
  }
}

function pascalCase(value: string): string {
  const result = value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
  return /^\d/.test(result) ? `Page${result}` : result || "CapturedPage";
}

function locatorExpression(entry: TestingLocatorEntry): string {
  const args = entry.arguments;
  const text = (key: string) => JSON.stringify(String(args[key] ?? ""));
  switch (entry.strategy) {
    case "role":
      return `this.page.getByRole(${text("role")}, { name: ${text("name")} })`;
    case "label":
      return `this.page.getByLabel(${text("text")})`;
    case "test-id":
      return `this.page.getByTestId(${text("testId")})`;
    case "placeholder":
      return `this.page.getByPlaceholder(${text("text")})`;
    case "alt-text":
      return `this.page.getByAltText(${text("text")})`;
    case "title":
      return `this.page.getByTitle(${text("text")})`;
    case "text":
      return `this.page.getByText(${text("text")})`;
    case "css":
      return `this.page.locator(${text("selector")})`;
    default:
      return `this.page.locator(${text("selector")})`;
  }
}

function generatePageObject(page: TestingLocatorPage): {
  readonly className: string;
  readonly fileName: string;
  readonly code: string;
  readonly sourceHash: string;
} {
  const artifactName = page.name.replace(/\s+page$/iu, "").trim() || "Page";
  const className = `${pascalCase(artifactName)}Page`;
  const containsRedactedArgument = (entry: TestingLocatorEntry) =>
    Object.values(entry.arguments).some(
      (value) => typeof value === "string" && /<(?:PII_|REDACTED_)[^>]*>/u.test(value),
    );
  const usable = page.entries.filter(
    (entry) => entry.lifecycleStatus === "accepted" && !containsRedactedArgument(entry),
  );
  const lines = usable.map(
    (entry) =>
      `\treadonly ${safeName(entry.locatorKey).replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase())} = ${locatorExpression(entry)};`,
  );
  const code = [
    'import type { Page } from "@playwright/test";',
    "",
    `export class ${className} {`,
    ...lines,
    "",
    "\tconstructor(readonly page: Page) {}",
    "}",
    "",
  ].join("\n");
  return {
    className,
    fileName: `${safeName(artifactName)}.page.ts`,
    code,
    sourceHash: shortDigest(
      [
        "playwright-page-object-v2",
        page.name,
        ...usable.map(
          (entry) =>
            `${entry.id}:${entry.locatorKey}:${entry.classification}:${entry.currentVersionId}`,
        ),
      ].join("\0"),
    ),
  };
}

export class LocatorLibraryStore {
  readonly #database: RuntimeSqliteDatabase;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.#database = new RuntimeSqliteDatabase(databasePath);
    this.#database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS testing_schema_migrations (
        version INTEGER PRIMARY KEY,
        phase TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS testing_project_preferences (
        project_id TEXT PRIMARY KEY,
        discovery_experience TEXT NOT NULL DEFAULT 'locator-first',
        case_id_prefix TEXT NOT NULL DEFAULT 'TC-',
        case_id_padding INTEGER NOT NULL DEFAULT 5,
        case_id_next INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS locator_discovery_sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        coverage TEXT NOT NULL,
        safety_profile TEXT NOT NULL,
        target_url_pattern TEXT NOT NULL,
        environment_label TEXT NOT NULL,
        max_elements_per_page INTEGER NOT NULL,
        max_pages_per_session INTEGER NOT NULL,
        current_url_pattern TEXT,
        current_page_name TEXT,
        observed_elements INTEGER NOT NULL DEFAULT 0,
        stored_elements INTEGER NOT NULL DEFAULT 0,
        truncated_elements INTEGER NOT NULL DEFAULT 0,
        captured_pages INTEGER NOT NULL DEFAULT 0,
        termination_reason TEXT,
        message TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS locator_sessions_project_started
        ON locator_discovery_sessions(project_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS locator_pages (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        session_id TEXT REFERENCES locator_discovery_sessions(id),
        name TEXT NOT NULL,
        name_source TEXT NOT NULL DEFAULT 'generated',
        url_pattern TEXT NOT NULL,
        environment_label TEXT NOT NULL,
        structural_fingerprint TEXT NOT NULL,
        capture_source TEXT NOT NULL,
        lifecycle_status TEXT NOT NULL DEFAULT 'draft',
        incomplete_session INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, url_pattern, environment_label)
      );
      CREATE INDEX IF NOT EXISTS locator_pages_project_updated
        ON locator_pages(project_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS locator_entries (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        page_id TEXT NOT NULL REFERENCES locator_pages(id),
        locator_key TEXT NOT NULL,
        classification TEXT NOT NULL,
        source_file TEXT,
        source_line INTEGER,
        lifecycle_status TEXT NOT NULL DEFAULT 'draft',
        sync_status TEXT NOT NULL DEFAULT 'managed',
        current_version_id TEXT NOT NULL,
        health TEXT NOT NULL DEFAULT 'healthy',
        element_fingerprint TEXT,
        target_page_fingerprint TEXT,
        verification_count INTEGER NOT NULL DEFAULT 0,
        consecutive_repair_attempts INTEGER NOT NULL DEFAULT 0,
        last_failure_classification TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, page_id, locator_key)
      );
      CREATE INDEX IF NOT EXISTS locator_entries_project_page
        ON locator_entries(project_id, page_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS locator_entry_versions (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL REFERENCES locator_entries(id),
        version_number INTEGER NOT NULL,
        strategy TEXT NOT NULL,
        arguments_json TEXT NOT NULL,
        semantic_context TEXT NOT NULL,
        source TEXT NOT NULL,
        fragile INTEGER NOT NULL DEFAULT 0,
        fingerprint TEXT NOT NULL,
        change_reason TEXT NOT NULL,
        superseded_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(entry_id, version_number)
      );

      CREATE TABLE IF NOT EXISTS locator_verifications (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        entry_id TEXT NOT NULL REFERENCES locator_entries(id),
        version_id TEXT NOT NULL REFERENCES locator_entry_versions(id),
        environment_label TEXT NOT NULL,
        target_url_pattern TEXT NOT NULL,
        status TEXT NOT NULL,
        match_count INTEGER,
        page_fingerprint TEXT,
        source_hash TEXT,
        message TEXT NOT NULL DEFAULT '',
        verified_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS locator_verifications_latest
        ON locator_verifications(entry_id, environment_label, verified_at DESC);

      CREATE TABLE IF NOT EXISTS locator_sources (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        folder_path TEXT NOT NULL,
        storage_mode TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'connected',
        files_scanned INTEGER NOT NULL DEFAULT 0,
        files_parsed INTEGER NOT NULL DEFAULT 0,
        recognized INTEGER NOT NULL DEFAULT 0,
        warnings INTEGER NOT NULL DEFAULT 0,
        unsupported_dynamic INTEGER NOT NULL DEFAULT 0,
        details_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        disconnected_at TEXT
      );

      CREATE TABLE IF NOT EXISTS locator_sync_conflicts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        entry_id TEXT REFERENCES locator_entries(id),
        source_id TEXT REFERENCES locator_sources(id),
        kind TEXT NOT NULL,
        details_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        decided_at TEXT
      );

      CREATE TABLE IF NOT EXISTS story_imports (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_name TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        sanitized_content TEXT NOT NULL,
        generated_case_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS case_locator_mappings (
        case_id TEXT NOT NULL,
        locator_entry_id TEXT NOT NULL REFERENCES locator_entries(id),
        locator_version_id TEXT NOT NULL REFERENCES locator_entry_versions(id),
        step_index INTEGER,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(case_id, locator_entry_id, step_index)
      );

      CREATE TABLE IF NOT EXISTS locator_page_artifacts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        page_id TEXT NOT NULL REFERENCES locator_pages(id),
        version_number INTEGER NOT NULL,
        class_name TEXT NOT NULL,
        file_name TEXT NOT NULL,
        code TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'current',
        origin TEXT NOT NULL DEFAULT 'generated',
        base_generated_source_hash TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(page_id, version_number)
      );

      CREATE TABLE IF NOT EXISTS locator_repository_targets (
        project_id TEXT NOT NULL,
        page_id TEXT NOT NULL REFERENCES locator_pages(id),
        folder_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        last_applied_artifact_source_hash TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(project_id, page_id)
      );
    `);
    this.#database
      .query(
        `INSERT OR IGNORE INTO testing_schema_migrations(version, phase, applied_at)
         VALUES (6, 'locator-first-discovery', ?)`,
      )
      .run(new Date().toISOString());
    this.#database
      .query(
        `INSERT OR IGNORE INTO testing_schema_migrations(version, phase, applied_at)
         VALUES (7, 'locator-first-workspace-ux', ?)`,
      )
      .run(new Date().toISOString());
    this.#database
      .query(
        `INSERT OR IGNORE INTO testing_schema_migrations(version, phase, applied_at)
         VALUES (8, 'locator-page-code-and-repository-output', ?)`,
      )
      .run(new Date().toISOString());
    this.#database
      .query(
        `INSERT OR IGNORE INTO testing_schema_migrations(version, phase, applied_at)
         VALUES (9, 'locator-page-object-manual-editing', ?)`,
      )
      .run(new Date().toISOString());
    this.#ensureFingerprintColumns();
    this.#ensureSourceColumns();
    this.#ensurePreferenceColumns();
    this.#ensurePageColumns();
    this.#ensureArtifactColumns();
    this.#ensureEntryHealthColumns();
    this.#refreshGeneratedPageNames();
    this.#recoverSessions();
    this.#backfill();
  }

  close(): void {
    this.#database.close();
  }

  isFeatureEnabled(): boolean {
    return featureEnabled();
  }

  experience(projectId: string): TestingDiscoveryExperience {
    return (
      this.#database
        .query<{ discovery_experience: TestingDiscoveryExperience }, [string]>(
          "SELECT discovery_experience FROM testing_project_preferences WHERE project_id = ?",
        )
        .get(projectId)?.discovery_experience ?? (featureEnabled() ? "locator-first" : "classic")
    );
  }

  caseIdPolicy(projectId: string): TestingCaseIdPolicy {
    const row = this.#database
      .query<
        {
          case_id_prefix: string;
          case_id_padding: number;
          case_id_next: number;
        },
        [string]
      >(
        "SELECT case_id_prefix, case_id_padding, case_id_next FROM testing_project_preferences WHERE project_id = ?",
      )
      .get(projectId);
    const prefix = row?.case_id_prefix ?? "TC-";
    const padding = row?.case_id_padding ?? 5;
    const nextSequence = row?.case_id_next ?? 1;
    return {
      prefix,
      padding,
      nextSequence,
      example: `${prefix}${String(nextSequence).padStart(padding, "0")}`,
    };
  }

  setCaseIdPolicy(input: TestingCaseIdPolicyInput): TestingCaseIdPolicy {
    const prefix = input.prefix.trim().slice(0, 24);
    this.#database
      .query(
        `INSERT INTO testing_project_preferences
          (project_id, discovery_experience, case_id_prefix, case_id_padding, case_id_next, updated_at)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET
          case_id_prefix = excluded.case_id_prefix, case_id_padding = excluded.case_id_padding,
          case_id_next = excluded.case_id_next, updated_at = excluded.updated_at`,
      )
      .run(
        input.projectId,
        this.experience(input.projectId),
        prefix,
        input.padding,
        input.nextSequence,
        new Date().toISOString(),
      );
    return this.caseIdPolicy(input.projectId);
  }

  allocateCaseIds(projectId: string, count: number): ReadonlyArray<string> {
    if (count <= 0) return [];
    const policy = this.caseIdPolicy(projectId);
    const values = Array.from(
      { length: count },
      (_, index) =>
        `${policy.prefix}${String(policy.nextSequence + index).padStart(policy.padding, "0")}`,
    );
    this.setCaseIdPolicy({
      projectId,
      prefix: policy.prefix,
      padding: policy.padding,
      nextSequence: policy.nextSequence + count,
    });
    return values;
  }

  setExperience(projectId: string, experience: TestingDiscoveryExperience): void {
    if (experience === "locator-first" && !featureEnabled()) {
      throw new Error("Locator-first discovery is disabled by the server feature flag");
    }
    this.#database
      .query(
        `INSERT INTO testing_project_preferences(project_id, discovery_experience, updated_at)
         VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET
         discovery_experience = excluded.discovery_experience, updated_at = excluded.updated_at`,
      )
      .run(projectId, experience, new Date().toISOString());
  }

  updatePage(input: TestingLocatorPageUpdateInput): TestingLocatorLibraryResult {
    const name = input.name.trim().replace(/\s+/gu, " ").slice(0, 80);
    if (!name) throw new Error("Enter a page name before saving");
    const exists = this.#database
      .query<{ id: string }, [string, string]>(
        "SELECT id FROM locator_pages WHERE id = ? AND project_id = ?",
      )
      .get(input.pageId, input.projectId);
    if (!exists) throw new Error("Locator page was not found in this project");
    this.#database
      .query(
        `UPDATE locator_pages SET name = ?, name_source = 'user', updated_at = ?
         WHERE id = ? AND project_id = ?`,
      )
      .run(name, new Date().toISOString(), input.pageId, input.projectId);
    return this.library(input.projectId);
  }

  setPageSelection(input: TestingLocatorPageSelectionInput): TestingLocatorLibraryResult {
    const requested = new Set(input.entryIds);
    const entries = this.#database
      .query<
        {
          id: string;
          lifecycle_status: TestingLocatorEntry["lifecycleStatus"];
        },
        [string, string]
      >(
        `SELECT id, lifecycle_status FROM locator_entries
         WHERE project_id = ? AND page_id = ?`,
      )
      .all(input.projectId, input.pageId);
    if (entries.length === 0) throw new Error("Locator page was not found or has no locators");
    const validIds = new Set(entries.map((entry) => entry.id));
    if ([...requested].some((id) => !validIds.has(id))) {
      throw new Error("A selected locator does not belong to this page");
    }
    const now = new Date().toISOString();
    this.#database.transaction(() => {
      for (const entry of entries) {
        if (entry.lifecycle_status === "archived" || entry.lifecycle_status === "manual-required") {
          if (requested.has(entry.id)) {
            throw new Error("Archived or manual-required locators cannot be added to code");
          }
          continue;
        }
        this.#database
          .query(
            `UPDATE locator_entries SET lifecycle_status = ?, updated_at = ?
             WHERE id = ? AND project_id = ? AND page_id = ?`,
          )
          .run(
            requested.has(entry.id) ? "accepted" : "draft",
            now,
            entry.id,
            input.projectId,
            input.pageId,
          );
      }
    })();
    return this.library(input.projectId);
  }

  deletePage(input: TestingLocatorPageDeleteInput): TestingLocatorLibraryResult {
    const exists = this.#database
      .query<{ id: string }, [string, string]>(
        "SELECT id FROM locator_pages WHERE id = ? AND project_id = ?",
      )
      .get(input.pageId, input.projectId);
    if (!exists) throw new Error("Locator page was not found in this project");
    const entries = this.#database
      .query<{ id: string }, [string, string]>(
        "SELECT id FROM locator_entries WHERE project_id = ? AND page_id = ?",
      )
      .all(input.projectId, input.pageId)
      .map((entry) => entry.id);
    this.#database.transaction(() => {
      for (const entryId of entries) {
        this.#database
          .query("DELETE FROM case_locator_mappings WHERE locator_entry_id = ?")
          .run(entryId);
        this.#database.query("DELETE FROM locator_sync_conflicts WHERE entry_id = ?").run(entryId);
        this.#database.query("DELETE FROM locator_verifications WHERE entry_id = ?").run(entryId);
        this.#database.query("DELETE FROM locator_entry_versions WHERE entry_id = ?").run(entryId);
      }
      this.#database
        .query("DELETE FROM locator_entries WHERE project_id = ? AND page_id = ?")
        .run(input.projectId, input.pageId);
      this.#database
        .query("DELETE FROM locator_page_artifacts WHERE page_id = ?")
        .run(input.pageId);
      this.#database
        .query("DELETE FROM locator_repository_targets WHERE project_id = ? AND page_id = ?")
        .run(input.projectId, input.pageId);
      this.#database
        .query("DELETE FROM locator_pages WHERE id = ? AND project_id = ?")
        .run(input.pageId, input.projectId);
    })();
    return this.library(input.projectId);
  }

  updatePageObjectCode(input: TestingPageObjectCodeUpdateInput): TestingLocatorLibraryResult {
    const code = input.code.replaceAll("\r\n", "\n");
    if (!code.trim()) throw new Error("Page-object code cannot be empty");
    if (code.length > 200_000)
      throw new Error("Page-object code must be 200,000 characters or less");
    if (code.includes("\0")) throw new Error("Page-object code contains an invalid null character");
    if (
      redactCredentialLikeText(code) !== code ||
      tokenizePii(input.projectId, code).tokens.length > 0
    ) {
      throw new Error("Remove credentials, high-entropy secrets, or personal data before saving");
    }
    const page = this.library(input.projectId).pages.find((value) => value.id === input.pageId);
    if (!page?.pageObject) throw new Error("Locator page was not found in this project");
    const pageObject = page.pageObject;
    if (pageObject.sourceHash !== input.expectedSourceHash) {
      throw new Error("The page object changed after editing started. Review the latest version.");
    }
    const sourceFile = ts.createSourceFile(
      pageObject.fileName,
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const parseDiagnostics =
      (
        sourceFile as ts.SourceFile & {
          readonly parseDiagnostics?: readonly ts.Diagnostic[];
        }
      ).parseDiagnostics ?? [];
    if (parseDiagnostics.length > 0) {
      throw new Error(
        `Fix the TypeScript syntax before saving: ${ts.flattenDiagnosticMessageText(parseDiagnostics[0]!.messageText, " ")}`,
      );
    }
    const preservesExpectedClass = sourceFile.statements.some(
      (statement) =>
        ts.isClassDeclaration(statement) &&
        statement.name?.text === pageObject.className &&
        statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
    );
    if (!preservesExpectedClass) {
      throw new Error(`Keep the exported ${pageObject.className} class in this page object`);
    }
    const generated = generatePageObject(page);
    const id = crypto.randomUUID();
    const versionNumber = pageObject.versionNumber + 1;
    const sourceHash = shortDigest(
      ["manual-page-object-v1", generated.sourceHash, code].join("\0"),
    );
    const createdAt = new Date().toISOString();
    this.#database.transaction(() => {
      this.#database
        .query(
          "UPDATE locator_page_artifacts SET status = 'stale' WHERE project_id = ? AND page_id = ?",
        )
        .run(input.projectId, input.pageId);
      this.#database
        .query(
          `INSERT INTO locator_page_artifacts
            (id, project_id, page_id, version_number, class_name, file_name, code,
             source_hash, status, origin, base_generated_source_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'current', 'manual', ?, ?)`,
        )
        .run(
          id,
          input.projectId,
          input.pageId,
          versionNumber,
          pageObject.className,
          pageObject.fileName,
          code,
          sourceHash,
          generated.sourceHash,
          createdAt,
        );
    })();
    return this.library(input.projectId);
  }

  saveRepositoryTarget(input: {
    readonly projectId: string;
    readonly pageId: string;
    readonly folderPath: string;
    readonly fileName: string;
    readonly relativePath: string;
    readonly artifactSourceHash: string;
  }): TestingLocatorLibraryResult {
    const now = new Date().toISOString();
    this.#database.transaction(() => {
      this.#database
        .query(
          `INSERT INTO locator_repository_targets
            (project_id, page_id, folder_path, file_name, relative_path,
             last_applied_artifact_source_hash, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(project_id, page_id) DO UPDATE SET
             folder_path = excluded.folder_path, file_name = excluded.file_name,
             relative_path = excluded.relative_path,
             last_applied_artifact_source_hash = excluded.last_applied_artifact_source_hash,
             updated_at = excluded.updated_at`,
        )
        .run(
          input.projectId,
          input.pageId,
          input.folderPath,
          input.fileName,
          input.relativePath,
          input.artifactSourceHash,
          now,
        );
      this.#database
        .query(
          `UPDATE locator_entries SET source_file = ?, sync_status = 'linked', updated_at = ?
           WHERE project_id = ? AND page_id = ? AND lifecycle_status = 'accepted'`,
        )
        .run(input.relativePath, now, input.projectId, input.pageId);
    })();
    return this.library(input.projectId);
  }

  library(projectId: string): TestingLocatorLibraryResult {
    const pageRows = this.#database
      .query<PageRow, [string]>(
        `SELECT id, name, url_pattern, environment_label, structural_fingerprint,
          capture_source, lifecycle_status, incomplete_session
         FROM locator_pages WHERE project_id = ? ORDER BY updated_at DESC`,
      )
      .all(projectId);
    const entries = this.#entries(projectId);
    const entriesByPage = new Map<string, TestingLocatorEntry[]>();
    for (const entry of entries) {
      const values = entriesByPage.get(entry.pageId) ?? [];
      values.push(entry);
      entriesByPage.set(entry.pageId, values);
    }
    const pagesWithoutArtifacts: TestingLocatorPage[] = pageRows.map((row) => ({
      id: row.id,
      name: row.name,
      urlPattern: row.url_pattern,
      environmentLabel: row.environment_label,
      structuralFingerprint: row.structural_fingerprint,
      captureSource: row.capture_source,
      lifecycleStatus: row.lifecycle_status,
      incompleteSession: row.incomplete_session === 1,
      pageObject: null,
      repositoryTarget: this.#repositoryTarget(projectId, row.id),
      entries: entriesByPage.get(row.id) ?? [],
    }));
    const pages = pagesWithoutArtifacts.map((page) => ({
      ...page,
      pageObject: this.#pageObjectArtifact(projectId, page),
    }));
    return {
      featureAvailable: featureEnabled(),
      experience: featureEnabled() ? this.experience(projectId) : "classic",
      pages,
      pageCount: pages.length,
      locatorCount: entries.length,
      verifiedCount: entries.filter((entry) => entry.verificationStatus === "verified").length,
      reviewCount: entries.filter(
        (entry) =>
          entry.lifecycleStatus === "draft" ||
          entry.lifecycleStatus === "manual-required" ||
          entry.syncStatus === "conflict" ||
          entry.verificationStatus === "missing" ||
          entry.verificationStatus === "ambiguous",
      ).length,
    };
  }

  beginSession(input: {
    readonly projectId: string;
    readonly mode: TestingDiscoveryMode;
    readonly coverage: TestingLocatorCoverageMode;
    readonly safetyProfile: TestingDiscoverySafetyProfile;
    readonly targetUrl: string;
    readonly environmentLabel: string;
    readonly maxElementsPerPage: number;
    readonly maxPagesPerSession: number;
  }): string {
    if (!featureEnabled()) throw new Error("Locator-first discovery is disabled");
    const id = crypto.randomUUID();
    const targetUrlPattern = sanitizePersistedUrl(input.targetUrl);
    this.#database
      .query(
        `INSERT INTO locator_discovery_sessions
          (id, project_id, status, mode, coverage, safety_profile, target_url_pattern,
           environment_label, max_elements_per_page, max_pages_per_session, current_url_pattern,
           started_at, message)
         VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Discovery session started')`,
      )
      .run(
        id,
        input.projectId,
        input.mode,
        input.coverage,
        input.safetyProfile,
        targetUrlPattern,
        input.environmentLabel,
        input.maxElementsPerPage,
        input.maxPagesPerSession,
        targetUrlPattern,
        new Date().toISOString(),
      );
    return id;
  }

  saveCapturedPage(input: {
    readonly replaceMissing?: boolean;
    readonly projectId: string;
    readonly sessionId: string | null;
    readonly rawUrl: string;
    readonly environmentLabel: string;
    readonly fingerprint: string;
    readonly captureSource: TestingLocatorPage["captureSource"];
    readonly candidates: ReadonlyArray<LocatorCandidate>;
    readonly observedElements: number;
    readonly truncatedElements: number;
  }): void {
    if (!featureEnabled() && input.sessionId)
      throw new Error("Locator-first discovery was disabled");
    const urlPattern = sanitizePersistedUrl(input.rawUrl);
    const now = new Date().toISOString();
    const existingPage = this.#database
      .query<{ id: string }, [string, string, string]>(
        "SELECT id FROM locator_pages WHERE project_id = ? AND url_pattern = ? AND environment_label = ?",
      )
      .get(input.projectId, urlPattern, input.environmentLabel);
    const pageId = existingPage?.id ?? crypto.randomUUID();
    this.#database.transaction(() => {
      this.#database
        .query(
          `INSERT INTO locator_pages
            (id, project_id, session_id, name, name_source, url_pattern, environment_label,
             structural_fingerprint, capture_source, lifecycle_status, incomplete_session,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, 'generated', ?, ?, ?, ?, 'draft', 0, ?, ?)
           ON CONFLICT(project_id, url_pattern, environment_label) DO UPDATE SET
             session_id = excluded.session_id, structural_fingerprint = excluded.structural_fingerprint,
             capture_source = excluded.capture_source,
             name = CASE WHEN locator_pages.name_source = 'generated' THEN excluded.name ELSE locator_pages.name END,
             updated_at = excluded.updated_at`,
        )
        .run(
          pageId,
          input.projectId,
          input.sessionId,
          pageName(urlPattern),
          urlPattern,
          input.environmentLabel,
          input.fingerprint,
          input.captureSource,
          now,
          now,
        );
      for (const candidate of input.candidates) {
        this.#upsertCandidate(input.projectId, pageId, candidate, now);
      }
      if (input.replaceMissing) {
        const keys = new Set(input.candidates.map((candidate) => safeName(candidate.locatorKey)));
        const entries = this.#database
          .query<{ id: string; locator_key: string }, [string]>(
            "SELECT e.id, e.locator_key FROM locator_entries e JOIN locator_entry_versions v ON v.id = e.current_version_id WHERE e.page_id = ? AND v.source = 'discovered'",
          )
          .all(pageId);
        for (const entry of entries) {
          if (!keys.has(entry.locator_key))
            this.#database
              .query(
                "UPDATE locator_entries SET lifecycle_status = 'archived', updated_at = ? WHERE id = ?",
              )
              .run(now, entry.id);
        }
      }
      if (input.sessionId) {
        this.#database
          .query(
            `UPDATE locator_discovery_sessions SET current_url_pattern = ?, current_page_name = ?,
              observed_elements = observed_elements + ?, stored_elements = stored_elements + ?,
              truncated_elements = truncated_elements + ?, captured_pages = (SELECT COUNT(*) FROM locator_pages WHERE session_id = ?),
              message = ? WHERE id = ? AND project_id = ?`,
          )
          .run(
            urlPattern,
            pageName(urlPattern),
            input.observedElements,
            input.candidates.length,
            input.truncatedElements,
            input.sessionId,
            `Captured ${input.candidates.length} of ${input.observedElements} elements from ${pageName(urlPattern)}${input.truncatedElements ? `. ${input.truncatedElements} omitted by the element limit; increase the limit and rescan.` : ""}`,
            input.sessionId,
            input.projectId,
          );
      }
    })();
  }

  finishSession(
    projectId: string,
    sessionId: string,
    status: "completed" | "cancelled" | "failed",
    reason: string,
    message: string,
    incomplete = false,
  ): void {
    this.#database.transaction(() => {
      this.#database
        .query(
          `UPDATE locator_discovery_sessions SET status = ?, termination_reason = ?, message = ?,
            completed_at = ? WHERE id = ? AND project_id = ?`,
        )
        .run(status, reason, message, new Date().toISOString(), sessionId, projectId);
      if (incomplete) {
        this.#database
          .query(
            `UPDATE locator_pages SET incomplete_session = 1, lifecycle_status = 'draft'
             WHERE project_id = ? AND session_id = ?`,
          )
          .run(projectId, sessionId);
      }
    })();
  }

  session(projectId: string, sessionId: string): Record<string, unknown> | null {
    return (
      this.#database
        .query<Record<string, unknown>, [string, string]>(
          "SELECT * FROM locator_discovery_sessions WHERE id = ? AND project_id = ?",
        )
        .get(sessionId, projectId) ?? null
    );
  }

  reviewEntry(input: TestingLocatorEntryReviewInput): void {
    const lifecycle =
      input.decision === "archive"
        ? "archived"
        : input.decision === "restore"
          ? "draft"
          : "accepted";
    const syncStatus = input.decision === "keep-managed" ? "managed-only" : undefined;
    const current = this.#database
      .query<
        {
          locator_key: string;
          page_id: string;
          classification: TestingLocatorEntry["classification"];
          current_version_id: string;
          version_number: number;
          strategy: TestingLocatorEntry["strategy"];
          arguments_json: string;
          semantic_context: string;
          fragile: number;
        },
        [string, string]
      >(
        `SELECT e.locator_key, e.page_id, e.classification, e.current_version_id,
          v.version_number, v.strategy, v.arguments_json, v.semantic_context, v.fragile
         FROM locator_entries e JOIN locator_entry_versions v ON v.id = e.current_version_id
         WHERE e.id = ? AND e.project_id = ?`,
      )
      .get(input.entryId, input.projectId);
    if (!current) throw new Error("Locator entry was not found in this project");
    const nextKey = input.locatorKey?.trim() || current.locator_key;
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/u.test(nextKey)) {
      throw new Error(
        "Locator keys must start with a letter and use only letters, numbers, _ or -",
      );
    }
    const duplicate = this.#database
      .query<{ id: string }, [string, string, string, string]>(
        `SELECT id FROM locator_entries
         WHERE project_id = ? AND page_id = ? AND locator_key = ? AND id != ?
           AND lifecycle_status != 'archived'`,
      )
      .get(input.projectId, current.page_id, nextKey, input.entryId);
    if (duplicate) throw new Error(`Another locator on this page already uses ${nextKey}`);

    const nextClassification = input.classification ?? current.classification;
    const nextStrategy = input.strategy ?? current.strategy;
    const nextArguments =
      input.arguments ??
      (JSON.parse(current.arguments_json) as Record<string, string | number | boolean>);
    const nextSemanticContext = input.semanticContext?.trim() ?? current.semantic_context;
    const sensitiveText = [nextKey, nextSemanticContext, JSON.stringify(nextArguments)].join("\n");
    if (
      redactCredentialLikeText(sensitiveText) !== sensitiveText ||
      tokenizePii(input.projectId, sensitiveText).tokens.length > 0
    ) {
      throw new Error("Remove credentials, high-entropy secrets, or personal data before saving");
    }
    const argumentsJson = JSON.stringify(nextArguments);
    const versionChanged =
      nextStrategy !== current.strategy ||
      argumentsJson !== current.arguments_json ||
      nextSemanticContext !== current.semantic_context;
    const now = new Date().toISOString();
    this.#database.transaction(() => {
      let currentVersionId = current.current_version_id;
      if (versionChanged) {
        currentVersionId = crypto.randomUUID();
        this.#database
          .query("UPDATE locator_entry_versions SET superseded_at = ? WHERE id = ?")
          .run(now, current.current_version_id);
        this.#database
          .query(
            `INSERT INTO locator_entry_versions
              (id, entry_id, version_number, strategy, arguments_json, semantic_context,
               source, fragile, fingerprint, change_reason, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?, 'manual-edit', ?)`,
          )
          .run(
            currentVersionId,
            input.entryId,
            current.version_number + 1,
            nextStrategy,
            argumentsJson,
            nextSemanticContext,
            current.fragile,
            shortDigest(`${nextStrategy}\0${argumentsJson}\0${nextSemanticContext}`),
            now,
          );
      }
      this.#database
        .query(
          `UPDATE locator_entries SET locator_key = ?, classification = ?, lifecycle_status = ?,
            sync_status = COALESCE(?, sync_status), current_version_id = ?, updated_at = ?
           WHERE id = ? AND project_id = ?`,
        )
        .run(
          nextKey,
          nextClassification,
          lifecycle,
          syncStatus ?? null,
          currentVersionId,
          now,
          input.entryId,
          input.projectId,
        );
    })();
  }

  recordVerification(input: {
    readonly projectId: string;
    readonly entryId: string;
    readonly versionId: string;
    readonly environmentLabel: string;
    readonly targetUrl: string;
    readonly status: TestingLocatorVerificationStatus;
    readonly matchCount: number | null;
    readonly pageFingerprint?: string;
    readonly elementFingerprint?: string;
    readonly sourceHash?: string;
    readonly message?: string;
    readonly failureClassification?: string;
    readonly isRepairAttempt?: boolean;
  }): void {
    const now = new Date().toISOString();
    this.#database
      .query(
        `INSERT INTO locator_verifications
          (id, project_id, entry_id, version_id, environment_label, target_url_pattern,
           status, match_count, page_fingerprint, source_hash, message, verified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        input.projectId,
        input.entryId,
        input.versionId,
        input.environmentLabel,
        sanitizePersistedUrl(input.targetUrl),
        input.status,
        input.matchCount,
        input.pageFingerprint ?? null,
        input.sourceHash ?? null,
        input.message ?? "",
        now,
      );

    const current = this.#database
      .query<
        {
          health: TestingLocatorEntry["health"];
          verification_count: number;
          consecutive_repair_attempts: number;
        },
        [string, string]
      >(
        "SELECT health, verification_count, consecutive_repair_attempts FROM locator_entries WHERE id = ? AND project_id = ?",
      )
      .get(input.entryId, input.projectId);

    if (current) {
      let nextHealth = current.health ?? "healthy";
      let consecutiveRepair = current.consecutive_repair_attempts ?? 0;
      let lastFailureClassification: string | null = null;

      const isSelectorActionabilityFailure =
        !input.failureClassification ||
        input.failureClassification === "selector-drift" ||
        input.failureClassification === "actionability-timing" ||
        input.failureClassification === "navigation-readiness" ||
        input.failureClassification === "ambiguous-selector" ||
        input.failureClassification === "stale-dom" ||
        input.failureClassification === "missing-element";

      if (
        input.status === "verified" ||
        (input.matchCount === 1 && input.status !== "invalid" && input.status !== "missing")
      ) {
        nextHealth = "healthy";
        consecutiveRepair = 0;
        lastFailureClassification = null;
      } else if (isSelectorActionabilityFailure) {
        if (input.isRepairAttempt) {
          consecutiveRepair += 1;
        }
        if (consecutiveRepair >= 2) {
          nextHealth = "quarantined";
        } else if (
          input.status === "ambiguous" ||
          (input.matchCount !== null && input.matchCount > 1)
        ) {
          nextHealth = "degraded";
        } else if (input.status === "stale") {
          nextHealth = "degraded";
        } else {
          nextHealth = "broken";
        }
        lastFailureClassification =
          input.failureClassification ??
          (input.status === "ambiguous" ? "ambiguous-selector" : "selector-drift");
      }

      this.#database
        .query(
          `UPDATE locator_entries
           SET health = ?,
               element_fingerprint = COALESCE(?, element_fingerprint),
               target_page_fingerprint = COALESCE(?, target_page_fingerprint),
               verification_count = verification_count + 1,
               consecutive_repair_attempts = ?,
               last_failure_classification = ?,
               updated_at = ?
           WHERE id = ? AND project_id = ?`,
        )
        .run(
          nextHealth,
          input.elementFingerprint ?? null,
          input.pageFingerprint ?? null,
          consecutiveRepair,
          lastFailureClassification,
          now,
          input.entryId,
          input.projectId,
        );
    }
  }

  createStoryImport(input: {
    readonly projectId: string;
    readonly sourceName: string;
    readonly sourceKind: string;
    readonly sanitizedContent: string;
  }): string {
    const id = crypto.randomUUID();
    this.#database
      .query(
        `INSERT INTO story_imports
          (id, project_id, source_name, source_kind, sanitized_content, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.sourceName,
        input.sourceKind,
        input.sanitizedContent,
        new Date().toISOString(),
      );
    return id;
  }

  updateStoryCases(storyImportId: string, caseIds: ReadonlyArray<string>): void {
    this.#database
      .query("UPDATE story_imports SET generated_case_ids_json = ? WHERE id = ?")
      .run(JSON.stringify(caseIds), storyImportId);
  }

  mapCaseLocators(
    caseId: string,
    mappings: ReadonlyArray<{
      readonly entryId: string;
      readonly versionId: string;
      readonly stepIndex: number | null;
      readonly source: "excel" | "story" | "manual";
    }>,
  ): void {
    const statement = this.#database.query(
      `INSERT OR REPLACE INTO case_locator_mappings
        (case_id, locator_entry_id, locator_version_id, step_index, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const now = new Date().toISOString();
    this.#database.transaction(() => {
      for (const mapping of mappings) {
        statement.run(
          caseId,
          mapping.entryId,
          mapping.versionId,
          mapping.stepIndex,
          mapping.source,
          now,
        );
      }
    })();
  }

  replaceCaseLocators(projectId: string, caseId: string, entryIds: ReadonlyArray<string>): void {
    const uniqueIds = [...new Set(entryIds)];
    const entries = this.#entries(projectId).filter(
      (entry) => uniqueIds.includes(entry.id) && entry.lifecycleStatus !== "archived",
    );
    if (entries.length !== uniqueIds.length) {
      throw new Error("One or more selected locators are unavailable in this project");
    }
    const statement = this.#database.query(
      `INSERT INTO case_locator_mappings
        (case_id, locator_entry_id, locator_version_id, step_index, source, created_at)
       VALUES (?, ?, ?, NULL, 'manual', ?)`,
    );
    const now = new Date().toISOString();
    this.#database.transaction(() => {
      this.#database.query("DELETE FROM case_locator_mappings WHERE case_id = ?").run(caseId);
      for (const entry of entries) {
        statement.run(caseId, entry.id, entry.currentVersionId, now);
      }
    })();
  }

  caseLocatorIds(projectId: string, caseId: string): ReadonlyArray<string> {
    return this.caseLocators(projectId, caseId).map((entry) => entry.id);
  }

  caseLocators(projectId: string, caseId: string): ReadonlyArray<TestingLocatorEntry> {
    const mappedIds = new Set(
      this.#database
        .query<{ locator_entry_id: string }, [string]>(
          "SELECT locator_entry_id FROM case_locator_mappings WHERE case_id = ? ORDER BY step_index",
        )
        .all(caseId)
        .map((row) => row.locator_entry_id),
    );
    return this.#entries(projectId).filter((entry) => mappedIds.has(entry.id));
  }

  saveSource(input: {
    readonly projectId: string;
    readonly folderPath: string;
    readonly storageMode: TestingLocatorStorageMode;
    readonly filesScanned: number;
    readonly filesParsed: number;
    readonly recognized: number;
    readonly warnings: number;
    readonly unsupportedDynamic: number;
    readonly details: ReadonlyArray<unknown>;
  }): string {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.#database
      .query(
        `INSERT INTO locator_sources
          (id, project_id, folder_path, storage_mode, files_scanned, files_parsed,
           recognized, warnings, unsupported_dynamic, details_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.folderPath,
        input.storageMode,
        input.filesScanned,
        input.filesParsed,
        input.recognized,
        input.warnings,
        input.unsupportedDynamic,
        JSON.stringify(input.details),
        now,
        now,
      );
    return id;
  }

  markManagedOnly(projectId: string, repositoryEntryIds: ReadonlySet<string>): number {
    const entries = this.#database
      .query<{ id: string; source_file: string | null }, [string]>(
        "SELECT id, source_file FROM locator_entries WHERE project_id = ? AND lifecycle_status != 'archived'",
      )
      .all(projectId);
    let count = 0;
    for (const entry of entries) {
      if (repositoryEntryIds.has(entry.id) || entry.source_file) continue;
      this.#database
        .query("UPDATE locator_entries SET sync_status = 'managed-only' WHERE id = ?")
        .run(entry.id);
      count += 1;
    }
    return count;
  }

  addRepositoryCandidate(input: {
    readonly projectId: string;
    readonly rawUrl: string;
    readonly pageName?: string;
    readonly environmentLabel: string;
    readonly candidate: LocatorCandidate;
    readonly storageMode: TestingLocatorStorageMode;
  }): {
    readonly entryId: string;
    readonly linked: boolean;
    readonly conflict: boolean;
  } {
    const urlPattern = sanitizePersistedUrl(input.rawUrl);
    const now = new Date().toISOString();
    let page = this.#database
      .query<{ id: string }, [string, string, string]>(
        "SELECT id FROM locator_pages WHERE project_id = ? AND url_pattern = ? AND environment_label = ?",
      )
      .get(input.projectId, urlPattern, input.environmentLabel);
    if (!page) {
      const id = crypto.randomUUID();
      this.#database
        .query(
          `INSERT INTO locator_pages
            (id, project_id, name, name_source, url_pattern, environment_label, structural_fingerprint,
             capture_source, lifecycle_status, incomplete_session, created_at, updated_at)
           VALUES (?, ?, ?, 'generated', ?, ?, '', 'repository', 'draft', 0, ?, ?)`,
        )
        .run(
          id,
          input.projectId,
          input.pageName?.trim() || pageName(urlPattern),
          urlPattern,
          input.environmentLabel,
          now,
          now,
        );
      page = { id };
    }
    const existing = this.#database
      .query<{ id: string; arguments_json: string; strategy: string }, [string, string, string]>(
        `SELECT e.id, v.arguments_json, v.strategy FROM locator_entries e
         JOIN locator_entry_versions v ON v.id = e.current_version_id
         WHERE e.project_id = ? AND e.page_id = ? AND e.locator_key = ?`,
      )
      .get(input.projectId, page.id, input.candidate.locatorKey);
    const candidateArguments = JSON.stringify(input.candidate.arguments);
    if (existing) {
      const conflict =
        existing.strategy !== input.candidate.strategy ||
        existing.arguments_json !== candidateArguments;
      this.#database
        .query(
          `UPDATE locator_entries SET source_file = ?, source_line = ?, sync_status = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.candidate.sourceFile ?? null,
          input.candidate.sourceLine ?? null,
          conflict ? "conflict" : "linked",
          now,
          existing.id,
        );
      if (conflict) {
        this.#database
          .query(
            "DELETE FROM locator_sync_conflicts WHERE entry_id = ? AND kind = 'conflict' AND status = 'pending'",
          )
          .run(existing.id);
        this.#database
          .query(
            `INSERT INTO locator_sync_conflicts
              (id, project_id, entry_id, kind, details_json, status, created_at)
             VALUES (?, ?, ?, 'conflict', ?, 'pending', ?)`,
          )
          .run(
            crypto.randomUUID(),
            input.projectId,
            existing.id,
            JSON.stringify({
              strategy: input.candidate.strategy,
              arguments: input.candidate.arguments,
              semanticContext: input.candidate.semanticContext,
              sourceFile: input.candidate.sourceFile ?? null,
              sourceLine: input.candidate.sourceLine ?? null,
            }),
            now,
          );
      }
      return { entryId: existing.id, linked: !conflict, conflict };
    }
    this.#upsertCandidate(input.projectId, page.id, input.candidate, now, "repository-only");
    const entryId = this.#database
      .query<{ id: string }, [string, string, string]>(
        "SELECT id FROM locator_entries WHERE project_id = ? AND page_id = ? AND locator_key = ?",
      )
      .get(input.projectId, page.id, input.candidate.locatorKey)!.id;
    return { entryId, linked: false, conflict: false };
  }

  promoteHealing(input: {
    readonly projectId: string;
    readonly entryId: string;
    readonly strategy: TestingLocatorEntry["strategy"];
    readonly arguments: Readonly<Record<string, string | number | boolean>>;
    readonly semanticContext: string;
    readonly environmentLabel: string;
    readonly targetUrl: string;
    readonly expectedVersionId: string;
  }): string {
    const entry = this.#database
      .query<{ current_version_id: string; version_number: number }, [string, string]>(
        `SELECT e.current_version_id, v.version_number FROM locator_entries e
         JOIN locator_entry_versions v ON v.id = e.current_version_id
         WHERE e.id = ? AND e.project_id = ?`,
      )
      .get(input.entryId, input.projectId);
    if (!entry) throw new Error("Healing locator entry was not found");
    if (entry.current_version_id !== input.expectedVersionId) {
      throw new Error("The locator changed after this healing proposal was created");
    }
    const versionId = crypto.randomUUID();
    const now = new Date().toISOString();
    const argumentsJson = JSON.stringify(input.arguments);
    this.#database.transaction(() => {
      this.#database
        .query("UPDATE locator_entry_versions SET superseded_at = ? WHERE id = ?")
        .run(now, entry.current_version_id);
      this.#database
        .query(
          `INSERT INTO locator_entry_versions
            (id, entry_id, version_number, strategy, arguments_json, semantic_context,
             source, fragile, fingerprint, change_reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'healing', 0, ?, 'accepted-healing', ?)`,
        )
        .run(
          versionId,
          input.entryId,
          entry.version_number + 1,
          input.strategy,
          argumentsJson,
          input.semanticContext,
          shortDigest(`${input.strategy}\0${argumentsJson}`),
          now,
        );
      this.#database
        .query("UPDATE locator_entries SET current_version_id = ?, updated_at = ? WHERE id = ?")
        .run(versionId, now, input.entryId);
      this.#database
        .query(
          `INSERT INTO locator_sync_conflicts
            (id, project_id, entry_id, kind, details_json, status, created_at)
           VALUES (?, ?, ?, 'healing-source-diff', ?, 'pending', ?)`,
        )
        .run(
          crypto.randomUUID(),
          input.projectId,
          input.entryId,
          JSON.stringify({ versionId, applyMode: "reviewed-diff" }),
          now,
        );
    })();
    this.recordVerification({
      projectId: input.projectId,
      entryId: input.entryId,
      versionId,
      environmentLabel: input.environmentLabel,
      targetUrl: input.targetUrl,
      status: "verified",
      matchCount: 1,
      message: "Accepted healing replacement",
    });
    return versionId;
  }

  previewSync(projectId: string): TestingLocatorSyncPreview {
    const entries = this.#entries(projectId);
    const rows = this.#database
      .query<
        {
          id: string;
          entry_id: string;
          kind: string;
          details_json: string;
          status: "pending" | "accepted" | "rejected";
        },
        [string]
      >(
        `SELECT id, entry_id, kind, details_json, status FROM locator_sync_conflicts
         WHERE project_id = ? ORDER BY created_at DESC`,
      )
      .all(projectId);
    const items: Array<TestingLocatorSyncPreview["items"][number]> = rows.flatMap((row) => {
      const entry = entries.find((candidate) => candidate.id === row.entry_id);
      return entry
        ? [
            {
              id: row.id,
              entryId: entry.id,
              locatorKey: entry.locatorKey,
              kind: row.kind as "conflict" | "healing-source-diff",
              sourceFile: entry.sourceFile,
              details: JSON.parse(row.details_json) as Record<string, unknown>,
              status: row.status,
            },
          ]
        : [];
    });
    const represented = new Set(items.map((item) => item.entryId));
    for (const entry of entries) {
      if (
        represented.has(entry.id) ||
        (entry.syncStatus !== "managed-only" && entry.syncStatus !== "repository-only")
      ) {
        continue;
      }
      items.push({
        id: `entry:${entry.id}`,
        entryId: entry.id,
        locatorKey: entry.locatorKey,
        kind: entry.syncStatus,
        sourceFile: entry.sourceFile,
        details: {},
        status: "pending",
      });
    }
    return { items, library: this.library(projectId) };
  }

  resolveSync(input: TestingLocatorSyncDecisionInput): TestingLocatorSyncPreview {
    const conflict = input.conflictId.startsWith("entry:")
      ? null
      : this.#database
          .query<
            {
              entry_id: string;
              details_json: string;
              kind: string;
              status: string;
            },
            [string, string]
          >(
            `SELECT entry_id, details_json, kind, status FROM locator_sync_conflicts
             WHERE id = ? AND project_id = ?`,
          )
          .get(input.conflictId, input.projectId);
    const entryId = conflict?.entry_id ?? input.conflictId.replace(/^entry:/, "");
    const entry = this.#database
      .query<{ current_version_id: string; version_number: number }, [string, string]>(
        `SELECT e.current_version_id, v.version_number FROM locator_entries e
         JOIN locator_entry_versions v ON v.id = e.current_version_id
         WHERE e.id = ? AND e.project_id = ?`,
      )
      .get(entryId, input.projectId);
    if (!entry) throw new Error("Locator synchronization item was not found");
    const now = new Date().toISOString();
    if (input.decision === "archive") {
      this.#database
        .query(
          "UPDATE locator_entries SET lifecycle_status = 'archived', updated_at = ? WHERE id = ?",
        )
        .run(now, entryId);
    } else if (input.decision === "keep-managed") {
      this.#database
        .query(
          "UPDATE locator_entries SET sync_status = 'managed-only', updated_at = ? WHERE id = ?",
        )
        .run(now, entryId);
    } else if (conflict) {
      const details = JSON.parse(conflict.details_json) as {
        strategy?: TestingLocatorEntry["strategy"];
        arguments?: Record<string, string | number | boolean>;
        semanticContext?: string;
      };
      if (!details.strategy || !details.arguments) {
        throw new Error("This synchronization item has no repository locator to accept");
      }
      const versionId = crypto.randomUUID();
      this.#database.transaction(() => {
        this.#database
          .query("UPDATE locator_entry_versions SET superseded_at = ? WHERE id = ?")
          .run(now, entry.current_version_id);
        this.#database
          .query(
            `INSERT INTO locator_entry_versions
              (id, entry_id, version_number, strategy, arguments_json, semantic_context,
               source, fragile, fingerprint, change_reason, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'repository', 0, ?, 'accepted-repository-diff', ?)`,
          )
          .run(
            versionId,
            entryId,
            entry.version_number + 1,
            details.strategy,
            JSON.stringify(details.arguments),
            details.semanticContext ?? "",
            shortDigest(`${details.strategy}\0${JSON.stringify(details.arguments)}`),
            now,
          );
        this.#database
          .query(
            "UPDATE locator_entries SET current_version_id = ?, sync_status = 'linked', updated_at = ? WHERE id = ?",
          )
          .run(versionId, now, entryId);
      })();
    }
    if (conflict) {
      this.#database
        .query("UPDATE locator_sync_conflicts SET status = ?, decided_at = ? WHERE id = ?")
        .run(
          input.decision === "accept-repository" ? "accepted" : "rejected",
          now,
          input.conflictId,
        );
    }
    return this.previewSync(input.projectId);
  }

  disconnectSources(projectId: string): TestingLocatorLibraryResult {
    const now = new Date().toISOString();
    this.#database
      .query(
        `UPDATE locator_entries SET sync_status = 'source-disconnected', updated_at = ?
         WHERE project_id = ? AND source_file IS NOT NULL AND lifecycle_status != 'archived'`,
      )
      .run(now, projectId);
    this.#database
      .query("UPDATE locator_sources SET disconnected_at = ?, updated_at = ? WHERE project_id = ?")
      .run(now, now, projectId);
    return this.library(projectId);
  }

  #entries(projectId: string): ReadonlyArray<TestingLocatorEntry> {
    const rows = this.#database
      .query<EntryRow, [string]>(
        `SELECT e.id, e.page_id, e.locator_key, e.classification, e.source_file, e.source_line,
          e.lifecycle_status, e.sync_status, e.current_version_id, e.health, e.element_fingerprint,
          e.target_page_fingerprint, e.verification_count, e.consecutive_repair_attempts,
          e.last_failure_classification,
          v.version_number, v.strategy,
          v.arguments_json, v.semantic_context, v.source, v.fragile,
          (SELECT status FROM locator_verifications lv WHERE lv.entry_id = e.id
           AND lv.version_id = e.current_version_id ORDER BY lv.verified_at DESC LIMIT 1)
            AS verification_status,
          (SELECT environment_label FROM locator_verifications lv WHERE lv.entry_id = e.id
           AND lv.version_id = e.current_version_id ORDER BY lv.verified_at DESC LIMIT 1)
            AS environment_label,
          (SELECT verified_at FROM locator_verifications lv WHERE lv.entry_id = e.id
           AND lv.version_id = e.current_version_id ORDER BY lv.verified_at DESC LIMIT 1)
            AS verified_at
         FROM locator_entries e JOIN locator_entry_versions v ON v.id = e.current_version_id
         WHERE e.project_id = ? ORDER BY e.updated_at DESC`,
      )
      .all(projectId);
    return rows.map((row) => ({
      id: row.id,
      pageId: row.page_id,
      locatorKey: row.locator_key,
      classification: row.classification,
      strategy: row.strategy,
      arguments: JSON.parse(row.arguments_json) as Record<string, string | number | boolean>,
      semanticContext: row.semantic_context,
      source: row.source,
      sourceFile: row.source_file,
      sourceLine: row.source_line,
      lifecycleStatus: row.lifecycle_status,
      syncStatus: row.sync_status,
      fragile: row.fragile === 1,
      currentVersionId: row.current_version_id,
      versionNumber: row.version_number,
      verificationStatus: row.verification_status ?? "unverified",
      verificationEnvironment: row.environment_label,
      verifiedAt: row.verified_at,
      health: (row.health as TestingLocatorEntry["health"]) ?? "healthy",
      elementFingerprint: row.element_fingerprint,
      targetPageFingerprint: row.target_page_fingerprint,
      verificationCount: row.verification_count ?? 0,
      consecutiveRepairAttempts: row.consecutive_repair_attempts ?? 0,
      lastFailureClassification: row.last_failure_classification,
    }));
  }

  #upsertCandidate(
    projectId: string,
    pageId: string,
    candidate: LocatorCandidate,
    now: string,
    syncStatus: TestingLocatorEntry["syncStatus"] = "managed",
  ): void {
    const tokenized = tokenizePii(projectId, redactCredentialLikeText(candidate.semanticContext));
    this.#storeTokens(projectId, tokenized.tokens, now);
    const containsSensitiveToken = /<PII_|<REDACTED_/u.test(tokenized.tokenized);
    const lifecycleStatus = containsSensitiveToken
      ? "manual-required"
      : (candidate.lifecycleStatus ?? "draft");
    const key = safeName(candidate.locatorKey);
    const existing = this.#database
      .query<{ id: string }, [string, string, string]>(
        "SELECT id FROM locator_entries WHERE project_id = ? AND page_id = ? AND locator_key = ?",
      )
      .get(projectId, pageId, key);
    if (existing) return;
    const entryId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const argumentsJson = JSON.stringify(candidate.arguments);
    this.#database
      .query(
        `INSERT INTO locator_entries
          (id, project_id, page_id, locator_key, classification, source_file, source_line,
           lifecycle_status, sync_status, current_version_id, health, element_fingerprint,
           target_page_fingerprint, verification_count, consecutive_repair_attempts, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'healthy', ?, ?, 0, 0, ?, ?)`,
      )
      .run(
        entryId,
        projectId,
        pageId,
        key,
        candidate.classification,
        candidate.sourceFile ?? null,
        candidate.sourceLine ?? null,
        lifecycleStatus,
        syncStatus,
        versionId,
        candidate.elementFingerprint ?? null,
        candidate.targetPageFingerprint ?? null,
        now,
        now,
      );
    this.#database
      .query(
        `INSERT INTO locator_entry_versions
          (id, entry_id, version_number, strategy, arguments_json, semantic_context, source,
           fragile, fingerprint, change_reason, created_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 'initial', ?)`,
      )
      .run(
        versionId,
        entryId,
        candidate.strategy,
        argumentsJson,
        tokenized.tokenized.slice(0, 1_000),
        candidate.source,
        candidate.fragile ? 1 : 0,
        shortDigest(`${candidate.strategy}\0${argumentsJson}`),
        now,
      );
  }

  #storeTokens(projectId: string, tokens: ReturnType<typeof tokenizePii>["tokens"], now: string) {
    const statement = this.#database.query(
      `INSERT OR IGNORE INTO pii_tokens
        (project_id, token, kind, plaintext, digest, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const token of tokens) {
      statement.run(projectId, token.token, token.kind, token.plaintext, token.digest, now);
    }
  }

  #repositoryTarget(projectId: string, pageId: string): TestingLocatorRepositoryTarget | null {
    const row = this.#database
      .query<
        {
          folder_path: string;
          file_name: string;
          relative_path: string;
          last_applied_artifact_source_hash: string | null;
          updated_at: string;
        },
        [string, string]
      >(
        `SELECT folder_path, file_name, relative_path, last_applied_artifact_source_hash, updated_at
         FROM locator_repository_targets WHERE project_id = ? AND page_id = ?`,
      )
      .get(projectId, pageId);
    return row
      ? {
          folderPath: row.folder_path,
          fileName: row.file_name,
          relativePath: row.relative_path,
          lastAppliedArtifactSourceHash: row.last_applied_artifact_source_hash,
          updatedAt: row.updated_at,
        }
      : null;
  }

  #pageObjectArtifact(projectId: string, page: TestingLocatorPage): TestingPageObjectArtifact {
    const generated = generatePageObject(page);
    const current = this.#database
      .query<
        {
          id: string;
          version_number: number;
          class_name: string;
          file_name: string;
          code: string;
          source_hash: string;
          status: "current" | "stale";
          origin: TestingPageObjectArtifact["origin"];
          base_generated_source_hash: string | null;
          created_at: string;
        },
        [string, string]
      >(
        `SELECT id, version_number, class_name, file_name, code, source_hash, status, origin,
          base_generated_source_hash, created_at
         FROM locator_page_artifacts WHERE project_id = ? AND page_id = ?
         ORDER BY version_number DESC LIMIT 1`,
      )
      .get(projectId, page.id);
    if (
      current?.source_hash === generated.sourceHash ||
      (current?.origin === "manual" && current.base_generated_source_hash === generated.sourceHash)
    ) {
      return {
        id: current.id,
        pageId: page.id,
        versionNumber: current.version_number,
        className: current.class_name,
        fileName: current.file_name,
        code: current.code,
        sourceHash: current.source_hash,
        status: current.status,
        origin: current.origin,
        createdAt: current.created_at,
      };
    }
    const id = crypto.randomUUID();
    const versionNumber = (current?.version_number ?? 0) + 1;
    const createdAt = new Date().toISOString();
    this.#database.transaction(() => {
      this.#database
        .query("UPDATE locator_page_artifacts SET status = 'stale' WHERE page_id = ?")
        .run(page.id);
      this.#database
        .query(
          `INSERT INTO locator_page_artifacts
            (id, project_id, page_id, version_number, class_name, file_name, code,
             source_hash, status, origin, base_generated_source_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'current', 'generated', ?, ?)`,
        )
        .run(
          id,
          projectId,
          page.id,
          versionNumber,
          generated.className,
          generated.fileName,
          generated.code,
          generated.sourceHash,
          generated.sourceHash,
          createdAt,
        );
    })();
    return {
      id,
      pageId: page.id,
      versionNumber,
      className: generated.className,
      fileName: generated.fileName,
      code: generated.code,
      sourceHash: generated.sourceHash,
      status: "current",
      origin: "generated",
      createdAt,
    };
  }

  #ensureFingerprintColumns(): void {
    const columns = this.#database
      .query<{ name: string }, []>("PRAGMA table_info(locator_fingerprints)")
      .all();
    if (!columns.some((column) => column.name === "locator_entry_id")) {
      this.#database.exec("ALTER TABLE locator_fingerprints ADD COLUMN locator_entry_id TEXT");
    }
    if (!columns.some((column) => column.name === "locator_version_id")) {
      this.#database.exec("ALTER TABLE locator_fingerprints ADD COLUMN locator_version_id TEXT");
    }
  }

  #ensureSourceColumns(): void {
    const columns = this.#database
      .query<{ name: string }, []>("PRAGMA table_info(locator_sources)")
      .all();
    if (!columns.some((column) => column.name === "disconnected_at")) {
      this.#database.exec("ALTER TABLE locator_sources ADD COLUMN disconnected_at TEXT");
    }
  }

  #ensurePreferenceColumns(): void {
    const columns = this.#database
      .query<{ name: string }, []>("PRAGMA table_info(testing_project_preferences)")
      .all();
    if (!columns.some((column) => column.name === "case_id_prefix")) {
      this.#database.exec(
        "ALTER TABLE testing_project_preferences ADD COLUMN case_id_prefix TEXT NOT NULL DEFAULT 'TC-'",
      );
    }
    if (!columns.some((column) => column.name === "case_id_padding")) {
      this.#database.exec(
        "ALTER TABLE testing_project_preferences ADD COLUMN case_id_padding INTEGER NOT NULL DEFAULT 5",
      );
    }
    if (!columns.some((column) => column.name === "case_id_next")) {
      this.#database.exec(
        "ALTER TABLE testing_project_preferences ADD COLUMN case_id_next INTEGER NOT NULL DEFAULT 1",
      );
    }
  }

  #ensurePageColumns(): void {
    const columns = this.#database
      .query<{ name: string }, []>("PRAGMA table_info(locator_pages)")
      .all();
    if (!columns.some((column) => column.name === "name_source")) {
      this.#database.exec(
        "ALTER TABLE locator_pages ADD COLUMN name_source TEXT NOT NULL DEFAULT 'generated'",
      );
    }
  }

  #ensureArtifactColumns(): void {
    const columns = this.#database
      .query<{ name: string }, []>("PRAGMA table_info(locator_page_artifacts)")
      .all();
    if (!columns.some((column) => column.name === "origin")) {
      this.#database.exec(
        "ALTER TABLE locator_page_artifacts ADD COLUMN origin TEXT NOT NULL DEFAULT 'generated'",
      );
    }
    if (!columns.some((column) => column.name === "base_generated_source_hash")) {
      this.#database.exec(
        "ALTER TABLE locator_page_artifacts ADD COLUMN base_generated_source_hash TEXT",
      );
      this.#database.exec(
        "UPDATE locator_page_artifacts SET base_generated_source_hash = source_hash WHERE origin = 'generated'",
      );
    }
  }

  #ensureEntryHealthColumns(): void {
    const columns = this.#database
      .query<{ name: string }, []>("PRAGMA table_info(locator_entries)")
      .all();
    const columnNames = new Set(columns.map((c) => c.name));
    if (!columnNames.has("health")) {
      this.#database.exec(
        "ALTER TABLE locator_entries ADD COLUMN health TEXT NOT NULL DEFAULT 'healthy'",
      );
    }
    if (!columnNames.has("element_fingerprint")) {
      this.#database.exec("ALTER TABLE locator_entries ADD COLUMN element_fingerprint TEXT");
    }
    if (!columnNames.has("target_page_fingerprint")) {
      this.#database.exec("ALTER TABLE locator_entries ADD COLUMN target_page_fingerprint TEXT");
    }
    if (!columnNames.has("verification_count")) {
      this.#database.exec(
        "ALTER TABLE locator_entries ADD COLUMN verification_count INTEGER NOT NULL DEFAULT 0",
      );
    }
    if (!columnNames.has("consecutive_repair_attempts")) {
      this.#database.exec(
        "ALTER TABLE locator_entries ADD COLUMN consecutive_repair_attempts INTEGER NOT NULL DEFAULT 0",
      );
    }
    if (!columnNames.has("last_failure_classification")) {
      this.#database.exec(
        "ALTER TABLE locator_entries ADD COLUMN last_failure_classification TEXT",
      );
    }
  }

  #refreshGeneratedPageNames(): void {
    const pages = this.#database
      .query<{ id: string; name: string; url_pattern: string; name_source: string }, []>(
        "SELECT id, name, url_pattern, name_source FROM locator_pages",
      )
      .all();
    const update = this.#database.query(
      "UPDATE locator_pages SET name = ?, updated_at = ? WHERE id = ?",
    );
    const now = new Date().toISOString();
    for (const page of pages) {
      if (page.name_source !== "generated") continue;
      const inferred = pageName(page.url_pattern);
      if (inferred !== page.name) update.run(inferred, now, page.id);
    }
  }

  #recoverSessions(): void {
    const now = new Date().toISOString();
    const featureDisabled = !this.isFeatureEnabled();
    const terminationReason = featureDisabled ? "feature-disabled" : "cancelled";
    this.#database
      .query(
        `UPDATE locator_discovery_sessions SET status = 'cancelled',
          termination_reason = ?, message = 'Interrupted during server restart',
          completed_at = ? WHERE status = 'running'`,
      )
      .run(terminationReason, now);
    if (featureDisabled) {
      this.#database.exec(`
        UPDATE locator_pages SET incomplete_session = 1, lifecycle_status = 'draft'
        WHERE session_id IN (
          SELECT id FROM locator_discovery_sessions WHERE termination_reason = 'feature-disabled'
        );
      `);
    }
  }

  #backfill(): void {
    const edges = this.#database
      .query<
        {
          project_id: string;
          page_url: string;
          role: string;
          name: string;
          state_id: string;
        },
        []
      >(
        `SELECT e.project_id, n.page_url, e.action_role AS role, e.action_name AS name,
          e.from_state_id AS state_id FROM graph_edges e JOIN graph_nodes n
          ON n.project_id = e.project_id AND n.state_id = e.from_state_id`,
      )
      .all();
    for (const edge of edges) {
      try {
        this.saveCapturedPage({
          projectId: edge.project_id,
          sessionId: null,
          rawUrl: edge.page_url,
          environmentLabel: "backfill",
          fingerprint: edge.state_id,
          captureSource: "backfill",
          candidates: [
            {
              locatorKey: `${edge.role}-${edge.name}`,
              classification: "action",
              strategy: "role",
              arguments: { role: edge.role, name: edge.name },
              semanticContext: `${edge.role} ${edge.name}`,
              source: "discovered",
              lifecycleStatus: "accepted",
            },
          ],
          observedElements: 1,
          truncatedElements: 0,
        });
      } catch {
        // Invalid legacy URLs stay in the graph but are not copied into the sanitized library.
      }
    }
  }
}
