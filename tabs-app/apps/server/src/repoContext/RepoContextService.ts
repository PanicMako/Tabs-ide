/**
 * RepoContextService — Phase 2 of the AI Review Engine.
 *
 * Provides repo-level context enrichment for diff summaries:
 *  - Per-file git commit history (via `git log --follow`)
 *  - Impact analysis heuristic via `git grep -l` (text-search approximation,
 *    not a real call-graph; labelled as such in all LLM-facing output)
 *  - `.tabs-review.json` project-level review instructions loader
 *
 * All operations are best-effort: individual sub-steps that fail (e.g. a file
 * not found in git history, a symbol producing no grep results) are silently
 * skipped so the overall enrichment never blocks a diff summary.
 *
 * Design doc: Phase 2 — Repo-Context & History Enrichment.
 *
 * @module repoContextService
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Effect } from "effect";

// ---------------------------------------------------------------------------
// Budget constants
// ---------------------------------------------------------------------------

/**
 * Maximum character count for the compressed repo-context section.
 * Conservative 4 chars/token → 4,000 tokens × 4 = 16,000 chars.
 */
export const REPO_CONTEXT_BUDGET_CHARS = 16_000;

// ---------------------------------------------------------------------------
// .tabs-review.json types and loader
// ---------------------------------------------------------------------------

export interface TabsReviewJson {
  readonly instructions?: string | undefined;
  readonly excludedPaths?: ReadonlyArray<string> | undefined;
  readonly muted?: ReadonlyArray<string> | undefined;
}

export interface TabsReviewJsonLoadResult {
  /** Loaded and validated configuration. Undefined when the file is absent. */
  readonly config: TabsReviewJson | undefined;
  /**
   * Non-null when the file exists but failed JSON parsing or schema
   * validation. Callers should surface this as a warning to the user.
   */
  readonly parseError: string | undefined;
}

/**
 * Load `.tabs-review.json` from the repository root.
 *
 * - File absent → `{ config: undefined, parseError: undefined }` (silent)
 * - File present but invalid → `{ config: undefined, parseError: "<reason>" }`
 * - File present and valid → `{ config: {...}, parseError: undefined }`
 */
export function loadTabsReviewJson(cwd: string): TabsReviewJsonLoadResult {
  const filePath = path.join(cwd, ".tabs-review.json");

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    // ENOENT → file simply not present; any other error also treated as absent
    void err;
    return { config: undefined, parseError: undefined };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      config: undefined,
      parseError: `.tabs-review.json at ${filePath} failed JSON parsing: ${detail}`,
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      config: undefined,
      parseError: `.tabs-review.json at ${filePath} must be a JSON object, got ${Array.isArray(parsed) ? "array" : typeof parsed}.`,
    };
  }

  const obj = parsed as Record<string, unknown>;

  // Validate each allowed field
  if (obj["instructions"] !== undefined && typeof obj["instructions"] !== "string") {
    return {
      config: undefined,
      parseError: `.tabs-review.json at ${filePath}: "instructions" must be a string.`,
    };
  }
  if (obj["excludedPaths"] !== undefined) {
    if (
      !Array.isArray(obj["excludedPaths"]) ||
      obj["excludedPaths"].some((v) => typeof v !== "string")
    ) {
      return {
        config: undefined,
        parseError: `.tabs-review.json at ${filePath}: "excludedPaths" must be an array of strings.`,
      };
    }
  }
  if (obj["muted"] !== undefined) {
    if (!Array.isArray(obj["muted"]) || obj["muted"].some((v) => typeof v !== "string")) {
      return {
        config: undefined,
        parseError: `.tabs-review.json at ${filePath}: "muted" must be an array of strings.`,
      };
    }
  }

  return {
    config: {
      instructions: typeof obj["instructions"] === "string" ? obj["instructions"] : undefined,
      excludedPaths: Array.isArray(obj["excludedPaths"])
        ? (obj["excludedPaths"] as string[])
        : undefined,
      muted: Array.isArray(obj["muted"]) ? (obj["muted"] as string[]) : undefined,
    },
    parseError: undefined,
  };
}

// ---------------------------------------------------------------------------
// Symbol extraction from diff patch
// ---------------------------------------------------------------------------

/**
 * Extract exported symbol names from a git diff patch.
 *
 * Scans only lines beginning with `+export` (additions in the diff) to avoid
 * picking up removed exports. Only handles direct export forms:
 *   export function Foo
 *   export class Bar
 *   export interface Baz
 *   export type Qux
 *   export const Quux
 *   export async function Corge
 *   export abstract class Grault
 *
 * Returns a deduped list. Does NOT attempt to parse re-exports (`export { x }`)
 * or default exports — those are too noisy for grep-based impact analysis.
 */
export function extractExportedSymbols(diffPatch: string): ReadonlyArray<string> {
  // Match: +export [modifiers] (function|class|interface|type|const|let) <Identifier>
  const symbolRe =
    /^\+export\s+(?:async\s+|abstract\s+|declare\s+)*(?:function|class|interface|type|const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = symbolRe.exec(diffPatch)) !== null) {
    const name = m[1];
    if (name) seen.add(name);
  }
  return [...seen];
}

// ---------------------------------------------------------------------------
// Git log history
// ---------------------------------------------------------------------------

export interface FileCommit {
  readonly sha: string;
  readonly author: string;
  readonly date: string;
  readonly subject: string;
}

export interface FileHistory {
  readonly file: string;
  readonly commits: ReadonlyArray<FileCommit>;
}

/**
 * Run `git log --follow -n <max> --format=... -- <file>` synchronously.
 * Returns an empty commits array on any failure (git not installed, file
 * has no history, etc.).
 */
export function buildFileHistory(cwd: string, file: string, maxCommits: number): FileHistory {
  try {
    const result = spawnSync(
      "git",
      [
        "log",
        "--follow",
        `-n${maxCommits}`,
        "--format=%H\x1f%an\x1f%ad\x1f%s",
        "--date=short",
        "--",
        file,
      ],
      { cwd, encoding: "utf8", timeout: 10_000 },
    );
    if (result.status !== 0 || !result.stdout) {
      return { file, commits: [] };
    }
    const commits: FileCommit[] = [];
    for (const line of result.stdout.trim().split("\n")) {
      const parts = line.split("\x1f");
      if (parts.length < 4) continue;
      const [sha = "", author = "", date = "", ...subjectParts] = parts;
      commits.push({ sha: sha.slice(0, 8), author, date, subject: subjectParts.join("\x1f") });
    }
    return { file, commits };
  } catch {
    return { file, commits: [] };
  }
}

// ---------------------------------------------------------------------------
// git grep caller list
// ---------------------------------------------------------------------------

export interface CallerList {
  readonly symbol: string;
  /** Files that contain the symbol (text-search, may include unrelated matches). */
  readonly files: ReadonlyArray<string>;
}

/**
 * Run `git grep -l "<symbol>"` synchronously.
 * Results are a text-search approximation — they may include unrelated matches
 * (e.g. comments, string literals) and are labelled as such in all LLM output.
 * Capped at `maxCallers` results.
 */
export function buildCallerList(cwd: string, symbol: string, maxCallers: number): CallerList {
  try {
    const result = spawnSync("git", ["grep", "-l", symbol], {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
    });
    // git grep exits 1 when no matches; both 0 and 1 are valid
    if (result.status !== 0 && result.status !== 1) {
      return { symbol, files: [] };
    }
    const files = (result.stdout ?? "")
      .trim()
      .split("\n")
      .filter((f) => f.trim().length > 0)
      .slice(0, maxCallers);
    return { symbol, files };
  } catch {
    return { symbol, files: [] };
  }
}

// ---------------------------------------------------------------------------
// Context compression / budget enforcement
// ---------------------------------------------------------------------------

/**
 * Build the raw serialised repo-context string and compress it to fit within
 * `budgetChars`. Compression is done in two passes:
 *
 * 1. Trim caller lists (keep fewer files per symbol) until fits.
 * 2. Trim history (keep only 1 commit per file) until fits.
 * 3. Hard-slice on a clean line boundary with a truncation marker.
 *
 * The returned string never contains unclosed markdown structure because we
 * always cut at the last `\n` before the limit, so the marker starts fresh.
 */
export function compressRepoContext(
  histories: ReadonlyArray<FileHistory>,
  callerLists: ReadonlyArray<CallerList>,
  budgetChars: number,
): string {
  const attempt = (
    hists: ReadonlyArray<FileHistory>,
    callers: ReadonlyArray<CallerList>,
  ): string => {
    const lines: string[] = [];

    if (hists.length > 0) {
      lines.push("### File Commit History");
      for (const h of hists) {
        if (h.commits.length === 0) continue;
        lines.push(`**${h.file}**`);
        for (const c of h.commits) {
          lines.push(`- ${c.date} [${c.sha}] ${c.author}: ${c.subject}`);
        }
        lines.push("");
      }
    }

    if (callers.length > 0) {
      lines.push("### Potential Callers (text-search, may include unrelated matches)");
      for (const cl of callers) {
        if (cl.files.length === 0) continue;
        lines.push(`**${cl.symbol}**: ${cl.files.join(", ")}`);
      }
      lines.push("");
    }

    return lines.join("\n").trimEnd();
  };

  // Pass 1: try with full data
  let result = attempt(histories, callerLists);
  if (result.length <= budgetChars) return result;

  // Pass 2: trim caller lists to max 3 files each
  const trimmedCallers = callerLists.map((cl) => ({
    ...cl,
    files: cl.files.slice(0, 3),
  }));
  result = attempt(histories, trimmedCallers);
  if (result.length <= budgetChars) return result;

  // Pass 3: trim caller lists to 1 file each
  const minCallers = callerLists.map((cl) => ({ ...cl, files: cl.files.slice(0, 1) }));
  result = attempt(histories, minCallers);
  if (result.length <= budgetChars) return result;

  // Pass 4: trim history to 1 commit per file
  const shortHistories = histories.map((h) => ({
    ...h,
    commits: h.commits.slice(0, 1),
  }));
  result = attempt(shortHistories, minCallers);
  if (result.length <= budgetChars) return result;

  // Pass 5: hard-slice on line boundary
  const MARKER = "\n[... context trimmed to fit 4,000-token budget ...]";
  const sliceAt = budgetChars - MARKER.length;
  const lastNewline = result.lastIndexOf("\n", sliceAt);
  const cutPoint = lastNewline > 0 ? lastNewline : sliceAt;
  return result.slice(0, cutPoint) + MARKER;
}

// ---------------------------------------------------------------------------
// Public API types and main entry point
// ---------------------------------------------------------------------------

export interface RepoContextInput {
  /** Absolute path to the git repository root. */
  readonly cwd: string;
  /** Changed file paths extracted from the diff patch. */
  readonly changedFiles: ReadonlyArray<string>;
  /** Raw diff patch (used for exported symbol extraction). */
  readonly diffPatch: string;
  readonly maxCallersPerSymbol: number;
  readonly maxCommitHistoryPerFile: number;
  /** Pre-computed budget in chars (default: REPO_CONTEXT_BUDGET_CHARS). */
  readonly budgetChars?: number | undefined;
}

export interface RepoContextResult {
  /**
   * Formatted markdown block for the `## Repo Context & Impact Analysis`
   * section, or empty string when no useful context could be gathered.
   */
  readonly contextSection: string;
  readonly fileHistories: ReadonlyArray<FileHistory>;
  readonly callerLists: ReadonlyArray<CallerList>;
}

/**
 * Gather repo context for a diff summary prompt.
 * Pure synchronous operation wrapped in Effect.sync for composability.
 * Never fails — all sub-steps are best-effort.
 */
export function buildRepoContext(input: RepoContextInput): RepoContextResult {
  const budgetChars = input.budgetChars ?? REPO_CONTEXT_BUDGET_CHARS;

  // Per-file commit history — cap at top 30 files to avoid blocking on large diffs
  const targetFiles = input.changedFiles.slice(0, 30);
  const fileHistories = targetFiles.map((f) =>
    buildFileHistory(input.cwd, f, input.maxCommitHistoryPerFile),
  );

  // Exported symbol → caller list
  const symbols = extractExportedSymbols(input.diffPatch);
  const callerLists = symbols.map((sym) =>
    buildCallerList(input.cwd, sym, input.maxCallersPerSymbol),
  );

  const hasHistory = fileHistories.some((h) => h.commits.length > 0);
  const hasCallers = callerLists.some((cl) => cl.files.length > 0);

  if (!hasHistory && !hasCallers) {
    return { contextSection: "", fileHistories, callerLists };
  }

  const body = compressRepoContext(fileHistories, callerLists, budgetChars);

  const contextSection = ["## Repo Context & Impact Analysis", body].join("\n");

  return { contextSection, fileHistories, callerLists };
}

/**
 * Effect wrapper for `buildRepoContext`. Never fails.
 */
export const runRepoContext = (input: RepoContextInput): Effect.Effect<RepoContextResult> =>
  Effect.sync(() => buildRepoContext(input));
