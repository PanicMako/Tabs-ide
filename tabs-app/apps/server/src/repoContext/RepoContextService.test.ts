/**
 * Unit tests for RepoContextService — Phase 2 of the AI Review Engine.
 *
 * Tests cover:
 *  1. 4,000-token budget enforcement under worst-case load (50 callers, many history entries)
 *  2. Symbol extraction — only exported symbols, not every identifier
 *  3. File history formatting
 *  4. Budget compression with line-boundary slicing
 *  5. .tabs-review.json loading: valid, missing, and malformed cases
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";

import {
  extractExportedSymbols,
  buildFileHistory,
  compressRepoContext,
  loadTabsReviewJson,
  REPO_CONTEXT_BUDGET_CHARS,
  type FileHistory,
  type CallerList,
} from "./RepoContextService";
import { buildDiffSummaryPrompt } from "../textGeneration/TextGenerationPrompts";

// ---------------------------------------------------------------------------
// Helper: build synthetic data
// ---------------------------------------------------------------------------

function makeFileHistory(file: string, numCommits: number): FileHistory {
  const commits = Array.from({ length: numCommits }, (_, i) => ({
    sha: `abc${String(i).padStart(5, "0")}`,
    author: `Author ${i}`,
    date: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`,
    subject: `Fix issue #${i} in ${file} with a long descriptive subject line`,
  }));
  return { file, commits };
}

function makeCallerList(symbol: string, numFiles: number): CallerList {
  const files = Array.from({ length: numFiles }, (_, i) => `src/components/Component${i}.tsx`);
  return { symbol, files };
}

// ---------------------------------------------------------------------------
// 1. Budget enforcement — worst-case load
// ---------------------------------------------------------------------------

describe("compressRepoContext — budget enforcement", () => {
  it("keeps output within REPO_CONTEXT_BUDGET_CHARS under worst-case load (50 callers, 5 files of history per file)", () => {
    const histories = Array.from({ length: 5 }, (_, i) => makeFileHistory(`src/module${i}.ts`, 8));
    const callers = Array.from({ length: 5 }, (_, i) => makeCallerList(`exportedSymbol${i}`, 50));

    const result = compressRepoContext(histories, callers, REPO_CONTEXT_BUDGET_CHARS);

    console.log(
      `[budget test] result.length = ${result.length} / ${REPO_CONTEXT_BUDGET_CHARS} chars (budget)`,
    );

    // The actual length MUST be reported on failure so the claim is verifiable.
    expect(
      result.length,
      `Context length ${result.length} exceeds budget ${REPO_CONTEXT_BUDGET_CHARS}`,
    ).toBeLessThanOrEqual(REPO_CONTEXT_BUDGET_CHARS);
  });

  it("returns full content unchanged when well within budget", () => {
    const histories = [makeFileHistory("src/a.ts", 2)];
    const callers = [makeCallerList("doThing", 2)];

    const result = compressRepoContext(histories, callers, REPO_CONTEXT_BUDGET_CHARS);

    expect(result).toContain("src/a.ts");
    expect(result).toContain("doThing");
    expect(result.length).toBeLessThanOrEqual(REPO_CONTEXT_BUDGET_CHARS);
  });

  it("hard-slice on worst-case always lands on a line boundary (no mid-word cut)", () => {
    // Force a tiny budget so hard-slice always triggers
    const tinyBudget = 200;
    const histories = [makeFileHistory("src/big.ts", 20)];
    const callers = [makeCallerList("bigExport", 50)];

    const result = compressRepoContext(histories, callers, tinyBudget);

    expect(result.length).toBeLessThanOrEqual(tinyBudget);
    // The truncation marker must be present on its own line
    if (result.includes("[... context trimmed")) {
      const markerIndex = result.indexOf("[... context trimmed");
      // Character before marker should be a newline
      expect(result[markerIndex - 1]).toBe("\n");
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Symbol extraction
// ---------------------------------------------------------------------------

describe("extractExportedSymbols", () => {
  it("extracts only exported symbols from added lines", () => {
    const patch = [
      "diff --git a/src/api.ts b/src/api.ts",
      "@@ -0,0 +1,10 @@",
      "+export function createSession(opts: Options): Session {",
      "+export class SessionManager {",
      "+export interface SessionOptions {",
      "+export type SessionId = string;",
      "+export const DEFAULT_TIMEOUT = 30_000;",
      "+function internalHelper() {}", // not exported, should not appear
      "+const privateVar = 1;", // not exported, should not appear
    ].join("\n");

    const symbols = extractExportedSymbols(patch);

    expect(symbols).toContain("createSession");
    expect(symbols).toContain("SessionManager");
    expect(symbols).toContain("SessionOptions");
    expect(symbols).toContain("SessionId");
    expect(symbols).toContain("DEFAULT_TIMEOUT");
    expect(symbols).not.toContain("internalHelper");
    expect(symbols).not.toContain("privateVar");
  });

  it("does not pick up removed (-) export lines", () => {
    const patch = [
      "diff --git a/src/old.ts b/src/old.ts",
      "-export function removedFn() {}",
      "+export function replacedFn() {}",
    ].join("\n");

    const symbols = extractExportedSymbols(patch);
    expect(symbols).not.toContain("removedFn");
    expect(symbols).toContain("replacedFn");
  });

  it("deduplicates symbols appearing in multiple hunks", () => {
    const patch = [
      "+export function doThing() {}",
      "+export function doThing() {}", // duplicate
    ].join("\n");

    const symbols = extractExportedSymbols(patch);
    expect(symbols.filter((s) => s === "doThing")).toHaveLength(1);
  });

  it("returns empty array for patches with no exported symbols", () => {
    const patch = "diff --git a/README.md b/README.md\n+# Hello World";
    expect(extractExportedSymbols(patch)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. File history formatting
// ---------------------------------------------------------------------------

describe("buildFileHistory", () => {
  it("returns empty commits for a non-existent path gracefully", () => {
    // Use a directory that exists as a git repo but a file that doesn't
    // This tests the graceful failure path
    const result = buildFileHistory(process.cwd(), "this-file-does-not-exist.xyz", 3);
    expect(result.file).toBe("this-file-does-not-exist.xyz");
    expect(result.commits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. .tabs-review.json loading
// ---------------------------------------------------------------------------

describe("loadTabsReviewJson", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const d of tempDirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
    tempDirs.length = 0;
  });

  function makeTempDir(): string {
    const d = mkdtempSync(path.join(tmpdir(), "tabs-rc-test-"));
    tempDirs.push(d);
    return d;
  }

  it("returns undefined config and no error when file is absent", () => {
    const dir = makeTempDir();
    const result = loadTabsReviewJson(dir);
    expect(result.config).toBeUndefined();
    expect(result.parseError).toBeUndefined();
  });

  it("loads valid .tabs-review.json and returns instructions", () => {
    const dir = makeTempDir();
    writeFileSync(
      path.join(dir, ".tabs-review.json"),
      JSON.stringify({
        instructions: "Never change auth contracts without a migration note.",
        excludedPaths: ["dist/", "node_modules/"],
        muted: ["no-console"],
      }),
    );

    const result = loadTabsReviewJson(dir);
    expect(result.parseError).toBeUndefined();
    expect(result.config).toBeDefined();
    expect(result.config!.instructions).toBe(
      "Never change auth contracts without a migration note.",
    );
    expect(result.config!.excludedPaths).toEqual(["dist/", "node_modules/"]);
    expect(result.config!.muted).toEqual(["no-console"]);
  });

  it("returns a parseError for malformed JSON (file exists but broken)", () => {
    const dir = makeTempDir();
    writeFileSync(path.join(dir, ".tabs-review.json"), "{ this is not json }");

    const result = loadTabsReviewJson(dir);
    expect(result.config).toBeUndefined();
    expect(result.parseError).toBeDefined();
    expect(result.parseError).toContain("failed JSON parsing");
  });

  it("returns a parseError when file exists but top-level is not an object", () => {
    const dir = makeTempDir();
    writeFileSync(path.join(dir, ".tabs-review.json"), JSON.stringify([1, 2, 3]));

    const result = loadTabsReviewJson(dir);
    expect(result.config).toBeUndefined();
    expect(result.parseError).toBeDefined();
    expect(result.parseError).toContain("must be a JSON object");
  });

  it("returns a parseError when instructions is not a string", () => {
    const dir = makeTempDir();
    writeFileSync(path.join(dir, ".tabs-review.json"), JSON.stringify({ instructions: 42 }));

    const result = loadTabsReviewJson(dir);
    expect(result.config).toBeUndefined();
    expect(result.parseError).toBeDefined();
    expect(result.parseError).toContain('"instructions" must be a string');
  });

  it("returns a parseError when excludedPaths contains non-strings", () => {
    const dir = makeTempDir();
    writeFileSync(
      path.join(dir, ".tabs-review.json"),
      JSON.stringify({ excludedPaths: ["dist/", 42] }),
    );

    const result = loadTabsReviewJson(dir);
    expect(result.config).toBeUndefined();
    expect(result.parseError).toBeDefined();
    expect(result.parseError).toContain('"excludedPaths" must be an array of strings');
  });
});

// ---------------------------------------------------------------------------
// 5. Section coexistence and order (4 sections: userHint, staticAnalysis,
//    repoContext, projectRules) — same index-order approach as Phase 1
// ---------------------------------------------------------------------------

describe("buildDiffSummaryPrompt — all 4 sections coexist without collision", () => {
  it("places userHint < staticAnalysisContext < repoContext < projectRules in that order", () => {
    const result = buildDiffSummaryPrompt({
      diffSummary: "1 file changed",
      diffPatch: "diff --git a/src/auth.ts b/src/auth.ts\n+export function login() {}",
      userHint: "Focus on security implications.",
      staticAnalysisContext:
        "Static Analysis Tool Findings:\n- ESLint: [warning] no-console in src/auth.ts",
      repoContext:
        "## Repo Context & Impact Analysis\n### File Commit History\n**src/auth.ts**\n- 2024-01-01 [abc00001] Alice: Add login function\n\n### Potential Callers (text-search, may include unrelated matches)\n**login**: src/pages/Login.tsx, src/tests/auth.test.ts",
      projectRules:
        "Never change auth contracts without a migration note. Always add tests for auth changes.",
    });

    // All four sections must be present
    const customIndex = result.prompt.indexOf("Custom Review Instructions:");
    const staticIndex = result.prompt.indexOf("Static Analysis Tool Findings:");
    const repoIndex = result.prompt.indexOf("## Repo Context & Impact Analysis");
    const projectIndex = result.prompt.indexOf("## Project Review Rules (.tabs-review.json)");

    console.log("[section-order test] Indices:", {
      customIndex,
      staticIndex,
      repoIndex,
      projectIndex,
    });

    expect(customIndex, "userHint section must be present").toBeGreaterThan(-1);
    expect(staticIndex, "staticAnalysisContext section must be present").toBeGreaterThan(-1);
    expect(repoIndex, "repoContext section must be present").toBeGreaterThan(-1);
    expect(projectIndex, "projectRules section must be present").toBeGreaterThan(-1);

    // Strict ordering
    expect(staticIndex, "staticAnalysis must come after userHint").toBeGreaterThan(customIndex);
    expect(repoIndex, "repoContext must come after staticAnalysis").toBeGreaterThan(staticIndex);
    expect(projectIndex, "projectRules must come after repoContext").toBeGreaterThan(repoIndex);
  });

  it("still works correctly with only userHint and projectRules (middle sections absent)", () => {
    const result = buildDiffSummaryPrompt({
      diffSummary: "1 file changed",
      diffPatch: "diff --git a/src/b.ts b/src/b.ts\n+const x = 1;",
      userHint: "Check for performance issues.",
      projectRules: "All functions must have JSDoc.",
    });

    const customIndex = result.prompt.indexOf("Custom Review Instructions:");
    const projectIndex = result.prompt.indexOf("## Project Review Rules (.tabs-review.json)");

    expect(customIndex).toBeGreaterThan(-1);
    expect(projectIndex).toBeGreaterThan(-1);
    expect(projectIndex).toBeGreaterThan(customIndex);

    // Middle sections absent
    expect(result.prompt).not.toContain("## Repo Context & Impact Analysis");
    expect(result.prompt).not.toContain("Static Analysis Tool Findings:");
  });
});
