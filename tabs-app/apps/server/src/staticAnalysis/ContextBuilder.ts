/**
 * ContextBuilder — Phase 1 of the AI Review Engine.
 *
 * Merges static analysis findings into the diff prompt context, scoped only
 * to files that appear in the current diff. Findings for unchanged files are
 * excluded to avoid scope creep.
 *
 * Design doc: Phase 1 — Static Analysis Integration, ContextBuilder.
 *
 * @module contextBuilder
 */

import type { StaticAnalysisFinding } from "./StaticAnalysisService.ts";

// ---------------------------------------------------------------------------
// Path normalisation helpers (pure, testable)
// ---------------------------------------------------------------------------

/**
 * Returns true when `findingPath` refers to the same file as `changedPath`.
 * Both paths may be absolute or relative; we compare by normalised basename
 * and then suffix, which handles the common case where tsc/eslint return
 * absolute paths but the diff uses relative ones.
 */
export function findingMatchesChangedFile(findingPath: string, changedPath: string): boolean {
  if (!findingPath || !changedPath) return false;
  // Normalise separators to forward slashes for cross-platform safety.
  const normFinding = findingPath.replace(/\\/g, "/").replace(/\/$/, "");
  const normChanged = changedPath.replace(/\\/g, "/").replace(/\/$/, "");
  // Direct match (both relative or both same absolute)
  if (normFinding === normChanged) return true;
  // Either ends with the other (handles absolute-vs-relative)
  if (normFinding.endsWith(`/${normChanged}`)) return true;
  if (normChanged.endsWith(`/${normFinding}`)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Finding formatter
// ---------------------------------------------------------------------------

const SEVERITY_LABEL: Record<string, string> = {
  error: "ERROR",
  warning: "WARN ",
  info: "INFO ",
};

function formatFinding(f: StaticAnalysisFinding): string {
  const loc = f.line > 0 ? `:${f.line}${f.col > 0 ? `:${f.col}` : ""}` : "";
  const sev = SEVERITY_LABEL[f.severity] ?? "INFO ";
  const rule = f.rule ? ` [${f.rule}]` : "";
  return `  ${sev}${loc}${rule}: ${f.message}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BuildStaticAnalysisContextInput {
  /** Relative or absolute paths of files in the current diff. */
  readonly changedFiles: ReadonlyArray<string>;
  /** All findings from all static analysis tools. */
  readonly allFindings: ReadonlyArray<StaticAnalysisFinding>;
}

export interface BuildStaticAnalysisContextResult {
  /**
   * Formatted markdown block to be injected into the diff prompt, or empty
   * string when no relevant findings exist.
   */
  readonly contextSection: string;
  /** Number of findings that were relevant to the changed files. */
  readonly relevantFindingCount: number;
  /** Number of findings that were excluded (not in diff scope). */
  readonly excludedFindingCount: number;
}

/**
 * Build the static analysis context section for a diff prompt.
 * Only includes findings whose file appears in `changedFiles`.
 * Returns an empty contextSection when there are no relevant findings.
 */
export function buildStaticAnalysisContext(
  input: BuildStaticAnalysisContextInput,
): BuildStaticAnalysisContextResult {
  const { changedFiles, allFindings } = input;

  if (allFindings.length === 0 || changedFiles.length === 0) {
    return { contextSection: "", relevantFindingCount: 0, excludedFindingCount: 0 };
  }

  // Group findings by their changed-file match
  const relevantByFile = new Map<string, StaticAnalysisFinding[]>();

  for (const finding of allFindings) {
    const matchedFile = changedFiles.find((cf) => findingMatchesChangedFile(finding.file, cf));
    if (matchedFile !== undefined) {
      const existing = relevantByFile.get(matchedFile);
      if (existing) {
        existing.push(finding);
      } else {
        relevantByFile.set(matchedFile, [finding]);
      }
    }
  }

  const relevantFindingCount = [...relevantByFile.values()].reduce(
    (sum, arr) => sum + arr.length,
    0,
  );
  const excludedFindingCount = allFindings.length - relevantFindingCount;

  if (relevantFindingCount === 0) {
    return {
      contextSection: "",
      relevantFindingCount: 0,
      excludedFindingCount: allFindings.length,
    };
  }

  // Build the markdown section
  const lines: string[] = [
    "## Static Analysis Issues (in changed files)",
    "The following diagnostics were found in files modified by this diff.",
    "Use them as additional context when generating the summary.",
    "",
  ];

  for (const [file, findings] of relevantByFile.entries()) {
    lines.push(`**${file}**`);
    for (const f of findings) {
      lines.push(formatFinding(f));
    }
    lines.push("");
  }

  return {
    contextSection: lines.join("\n").trimEnd(),
    relevantFindingCount,
    excludedFindingCount,
  };
}

/**
 * Extract changed file paths from a raw git diff patch string.
 * Scans for `diff --git a/<path> b/<path>` headers.
 */
export function extractChangedFilesFromPatch(patch: string): ReadonlyArray<string> {
  const files: string[] = [];
  const headerRe = /^diff --git a\/.+? b\/(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(patch)) !== null) {
    const file = m[1]?.trim();
    if (file && !files.includes(file)) {
      files.push(file);
    }
  }
  return files;
}
