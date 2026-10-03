/**
 * StaticAnalysisService — Phase 1 of the AI Review Engine.
 *
 * Runs a user-configured list of static analysis tool commands against a
 * repository working tree and returns structured, file-scoped findings.
 *
 * Design doc: Phase 1 — Static Analysis Integration.
 *
 * @module staticAnalysis
 */

import { Effect } from "effect";
import { runProcess } from "../processRunner.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Severity as reported by a static analysis tool. */
export type StaticAnalysisSeverity = "error" | "warning" | "info";

/** A single diagnostic finding from a static analysis tool. */
export interface StaticAnalysisFinding {
  /** Relative path to the file (may be absolute; callers should relativise). */
  readonly file: string;
  /** 1-based line number, or 0 if unknown. */
  readonly line: number;
  /** 1-based column number, or 0 if unknown. */
  readonly col: number;
  /** Rule or error code identifier. */
  readonly rule: string;
  /** Human-readable description of the finding. */
  readonly message: string;
  readonly severity: StaticAnalysisSeverity;
  /** Source tool label, e.g. "tsc" or "eslint". */
  readonly tool: string;
}

/** Output of a single tool run. */
export interface StaticAnalysisToolResult {
  readonly tool: string;
  readonly findings: ReadonlyArray<StaticAnalysisFinding>;
  /** Non-fatal reason why the tool run produced no findings (e.g. tool not found). */
  readonly skippedReason?: string | undefined;
}

export interface RunStaticAnalysisInput {
  /** Absolute path to the repository root. */
  readonly cwd: string;
  /** Shell commands to run, e.g. ["tsc --noEmit --pretty false", "eslint --format json ."]. */
  readonly tools: ReadonlyArray<string>;
  /** Timeout per tool in milliseconds (default: 60_000). */
  readonly timeoutMs?: number | undefined;
}

export interface RunStaticAnalysisResult {
  readonly toolResults: ReadonlyArray<StaticAnalysisToolResult>;
  /** Flat union of all findings across all tools. */
  readonly allFindings: ReadonlyArray<StaticAnalysisFinding>;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to parse TypeScript compiler output (plain text, not JSON).
 * tsc --noEmit --pretty false emits lines of the form:
 *   path/to/file.ts(line,col): error TS2322: message text
 */
export function parseTscOutput(
  stdout: string,
  stderr: string,
): ReadonlyArray<StaticAnalysisFinding> {
  const raw = (stdout + "\n" + stderr).trim();
  if (!raw) return [];

  const findings: StaticAnalysisFinding[] = [];
  // Match: path/to/file(line,col): severity TSxxxx: message
  const lineRe = /^(.+?)\((\d+),(\d+)\):\s+(error|warning|info)\s+(TS\d+):\s+(.+)$/;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = lineRe.exec(trimmed);
    if (!m) continue;
    const [, file = "", lineStr = "0", colStr = "0", sev = "error", rule = "", message = ""] = m;
    findings.push({
      file: file.trim(),
      line: parseInt(lineStr, 10),
      col: parseInt(colStr, 10),
      rule: rule.trim(),
      message: message.trim(),
      severity: (sev as StaticAnalysisSeverity) ?? "error",
      tool: "tsc",
    });
  }
  return findings;
}

/**
 * Attempt to parse ESLint JSON output (eslint --format json).
 * ESLint JSON is an array of file objects each with a `messages` array.
 */
export function parseEslintJsonOutput(stdout: string): ReadonlyArray<StaticAnalysisFinding> {
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const findings: StaticAnalysisFinding[] = [];
  for (const fileResult of parsed) {
    if (typeof fileResult !== "object" || fileResult === null) continue;
    const f = fileResult as Record<string, unknown>;
    const filePath = typeof f["filePath"] === "string" ? f["filePath"] : "";
    const messages = Array.isArray(f["messages"]) ? f["messages"] : [];

    for (const msg of messages) {
      if (typeof msg !== "object" || msg === null) continue;
      const m = msg as Record<string, unknown>;
      const severity = m["severity"] === 1 ? "warning" : "error";
      findings.push({
        file: filePath,
        line: typeof m["line"] === "number" ? m["line"] : 0,
        col: typeof m["column"] === "number" ? m["column"] : 0,
        rule: typeof m["ruleId"] === "string" ? m["ruleId"] : "eslint",
        message: typeof m["message"] === "string" ? m["message"] : "",
        severity,
        tool: "eslint",
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Heuristic tool-label detection
// ---------------------------------------------------------------------------

function detectToolLabel(command: string): string {
  const first = command.trim().split(/\s+/)[0] ?? command;
  // Strip path separators to get just the executable name
  return first.split("/").pop()?.split("\\").pop() ?? first;
}

function isTscCommand(command: string): boolean {
  return /\btsc\b/.test(command);
}

function isEslintCommand(command: string): boolean {
  return /\beslint\b/.test(command);
}

// ---------------------------------------------------------------------------
// Tool runner
// ---------------------------------------------------------------------------

async function runOneTool(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<StaticAnalysisToolResult> {
  const toolLabel = detectToolLabel(command);
  const parts = command.trim().split(/\s+/);
  const executable = parts[0] ?? command;
  const args = parts.slice(1);

  let result: Awaited<ReturnType<typeof runProcess>>;
  try {
    result = await runProcess(executable, args, {
      cwd,
      timeoutMs,
      // Static analysis tools exit non-zero when they find errors — allow it.
      allowNonZeroExit: true,
    });
  } catch (err) {
    const reason =
      err instanceof Error && err.message.includes("Command not found")
        ? `Tool '${executable}' not found on PATH — skipping.`
        : `Tool '${executable}' failed to start: ${err instanceof Error ? err.message : String(err)}`;
    return { tool: toolLabel, findings: [], skippedReason: reason };
  }

  if (result.timedOut) {
    return {
      tool: toolLabel,
      findings: [],
      skippedReason: `Tool '${executable}' timed out after ${timeoutMs}ms.`,
    };
  }

  let findings: ReadonlyArray<StaticAnalysisFinding> = [];

  if (isTscCommand(command)) {
    findings = parseTscOutput(result.stdout, result.stderr);
  } else if (isEslintCommand(command)) {
    findings = parseEslintJsonOutput(result.stdout);
  } else {
    // Generic fallback: treat each non-empty stderr/stdout line as an info finding.
    const raw = (result.stderr + "\n" + result.stdout).trim();
    if (raw) {
      findings = raw
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => ({
          file: "",
          line: 0,
          col: 0,
          rule: toolLabel,
          message: l.trim(),
          severity: "info" as StaticAnalysisSeverity,
          tool: toolLabel,
        }));
    }
  }

  return { tool: toolLabel, findings };
}

// ---------------------------------------------------------------------------
// Public Effect entry point
// ---------------------------------------------------------------------------

/**
 * Run all configured static analysis tools for the given cwd.
 * Returns structured findings per tool and a flat allFindings union.
 * Never fails — tools that cannot run are skipped with a skippedReason.
 */
export const runStaticAnalysis = (
  input: RunStaticAnalysisInput,
): Effect.Effect<RunStaticAnalysisResult> =>
  Effect.promise(async () => {
    if (input.tools.length === 0) {
      return { toolResults: [], allFindings: [] };
    }

    const timeoutMs = input.timeoutMs ?? 60_000;
    const toolResults = await Promise.all(
      input.tools.map((cmd) => runOneTool(cmd, input.cwd, timeoutMs)),
    );

    const allFindings: StaticAnalysisFinding[] = [];
    for (const r of toolResults) {
      allFindings.push(...r.findings);
    }

    return { toolResults, allFindings };
  });
