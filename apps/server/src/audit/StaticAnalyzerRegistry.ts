/**
 * StaticAnalyzerRegistry — Orchestrates sandboxed static analyzers (Gitleaks, OpenGrep, OSV-Scanner, ESLint, TSC).
 *
 * Runs all enabled static tools concurrently within isolated process limits and normalizes findings into AuditFinding[].
 *
 * @module audit/StaticAnalyzerRegistry
 */

import { Effect } from "effect";
import type { AuditFinding } from "@tabs/contracts";
import { runGitleaksScan } from "./adapters/GitleaksAdapter.ts";
import { runOpenGrepScan } from "./adapters/OpenGrepAdapter.ts";
import { runOSVScanner } from "./adapters/OSVScannerAdapter.ts";
import { runStaticAnalysis } from "../staticAnalysis/StaticAnalysisService.ts";
import { computeFindingFingerprint } from "@tabs/contracts";

export interface RunAnalyzerRegistryInput {
  readonly cwd: string;
  readonly auditId: string;
  readonly enabledTools?: ReadonlyArray<string> | undefined;
}

export interface AnalyzerToolRunSummary {
  readonly toolName: string;
  readonly findingCount: number;
  readonly skippedReason?: string | undefined;
}

export interface StaticAnalyzerRegistryResult {
  readonly findings: ReadonlyArray<AuditFinding>;
  readonly toolSummaries: ReadonlyArray<AnalyzerToolRunSummary>;
}

/**
 * Execute all enabled static code analyzers against repository working tree.
 */
export async function executeStaticAnalyzerRegistry(
  input: RunAnalyzerRegistryInput,
): Promise<StaticAnalyzerRegistryResult> {
  const tools = input.enabledTools ?? ["gitleaks", "opengrep", "osv-scanner", "tsc", "eslint"];
  const toolSummaries: AnalyzerToolRunSummary[] = [];
  const allFindings: AuditFinding[] = [];

  const promises: Promise<void>[] = [];

  if (tools.includes("gitleaks")) {
    promises.push(
      runGitleaksScan(input.cwd, input.auditId).then((res) => {
        allFindings.push(...res.findings);
        toolSummaries.push({
          toolName: "gitleaks",
          findingCount: res.findings.length,
          skippedReason: res.skippedReason,
        });
      }),
    );
  }

  if (tools.includes("opengrep") || tools.includes("semgrep")) {
    promises.push(
      runOpenGrepScan(input.cwd, input.auditId).then((res) => {
        allFindings.push(...res.findings);
        toolSummaries.push({
          toolName: "opengrep",
          findingCount: res.findings.length,
          skippedReason: res.skippedReason,
        });
      }),
    );
  }

  if (tools.includes("osv-scanner") || tools.includes("osv")) {
    promises.push(
      runOSVScanner(input.cwd, input.auditId).then((res) => {
        allFindings.push(...res.findings);
        toolSummaries.push({
          toolName: "osv-scanner",
          findingCount: res.findings.length,
          skippedReason: res.skippedReason,
        });
      }),
    );
  }

  // Legacy fallback: run tsc / eslint if configured
  const legacyTools = tools.filter(
    (t) => t === "tsc" || t === "eslint" || t.includes("tsc ") || t.includes("eslint "),
  );
  if (legacyTools.length > 0) {
    promises.push(
      Effect.runPromise(
        runStaticAnalysis({
          cwd: input.cwd,
          tools: legacyTools,
        }),
      ).then((res) => {
        for (const tr of res.toolResults) {
          toolSummaries.push({
            toolName: tr.tool,
            findingCount: tr.findings.length,
            skippedReason: tr.skippedReason,
          });
        }
        for (let i = 0; i < res.allFindings.length; i++) {
          const f = res.allFindings[i]!;
          const fingerprint = computeFindingFingerprint({
            filePath: f.file,
            category: "correctness",
            title: `${f.tool}: ${f.rule}`,
          });
          allFindings.push({
            id: `${input.auditId}-${f.tool}-${i}`,
            fingerprint,
            auditId: input.auditId,
            repoPath: input.cwd,
            filePath: f.file,
            startLine: f.line || 1,
            endLine: f.line || 1,
            ...(f.col ? { startColumn: f.col } : {}),
            category: "correctness",
            severity: f.severity,
            confidence: 0.9,
            title: `${f.tool}: ${f.rule}`,
            explanation: f.message,
            evidenceSnippet: f.message,
            sourceTool: f.tool,
            ruleId: f.rule,
            verificationState: "verified_passed",
          });
        }
      }),
    );
  }

  await Promise.all(promises);

  return {
    findings: allFindings,
    toolSummaries,
  };
}

/**
 * Effect-TS wrapper for StaticAnalyzerRegistry execution.
 */
export const runStaticAnalyzerRegistry = (
  input: RunAnalyzerRegistryInput,
): Effect.Effect<StaticAnalyzerRegistryResult> =>
  Effect.promise(() => executeStaticAnalyzerRegistry(input));
