/**
 * AuditOrchestrationService — Full-Scale AI Code Review & Codebase Audit Coordinator.
 *
 * Coordinates:
 * 1) Review Planner
 * 2) Sandboxed Static Analyzer Registry
 * 3) Repo Intelligence Context Enrichment
 * 4) Specialized Review Passes (Correctness, Security, Performance, Architecture, Test Gap, Refactoring)
 * 5) Disproof Verification Agent
 * 6) Deduplication, Ranking & False-Positive Feedback Memory
 * 7) Safe Patch Repair Planning
 *
 * @module audit/AuditOrchestrationService
 */

import { Effect } from "effect";
import type {
  AuditFinding,
  AuditScanInput,
  AuditScanResult,
  AuditScanSummary,
  ReviewProgressEvent,
  TokenBudgetedContextPack,
} from "@tabs/contracts";
import { executeStaticAnalyzerRegistry } from "./StaticAnalyzerRegistry.ts";
import {
  buildRepositoryInventory,
  buildTokenBudgetedContextPack,
} from "./RepoIntelligenceService.ts";
import { createExecutionPlan } from "./ReviewPlanner.ts";
import { runCorrectnessPass } from "./passes/CorrectnessPass.ts";
import { runSecurityPass } from "./passes/SecurityPass.ts";
import { runPerformancePass } from "./passes/PerformancePass.ts";
import { runArchitecturePass } from "./passes/ArchitecturePass.ts";
import { runTestGapPass } from "./passes/TestGapPass.ts";
import { runRefactoringPass } from "./passes/RefactoringPass.ts";
import { verifyAllFindings } from "./FindingVerifier.ts";
import { deduplicateAndRankFindings } from "./FindingDeduper.ts";
import { attachFixPlans } from "./SafeFixPlanner.ts";

export interface AuditOrchestratorOptions {
  readonly onProgress?:
    | ((event: ReviewProgressEvent) => Effect.Effect<void, never, never>)
    | undefined;
}

export function calculateHealthScore(findings: ReadonlyArray<AuditFinding>): number {
  let score = 100;
  for (const f of findings) {
    if (f.severity === "critical") score -= 20;
    else if (f.severity === "error") score -= 10;
    else if (f.severity === "warning") score -= 3;
    else if (f.severity === "info") score -= 1;
  }
  return Math.max(0, Math.min(100, score));
}

/**
 * Main Orchestration Pipeline Execution Entry Point.
 */
export async function executeAuditScan(
  input: AuditScanInput,
  options?: AuditOrchestratorOptions,
): Promise<AuditScanResult> {
  const startTime = Date.now();
  const repoPath = input.cwd;

  // 1. Repo Inventory & File Building
  const inventory = await buildRepositoryInventory({ cwd: repoPath });

  // 2. Static Analyzer Execution (Gitleaks, OpenGrep, OSV-Scanner, ESLint)
  const staticResult = await executeStaticAnalyzerRegistry({
    cwd: repoPath,
    auditId: "static-init",
    enabledTools: input.enabledTools,
  });

  // 3. Execution Plan
  const plan = createExecutionPlan(input, inventory, staticResult);

  // Build Context Packs per target file
  const contextMap = new Map<string, TokenBudgetedContextPack>();
  for (const filePath of plan.targetFiles) {
    const pack = await buildTokenBudgetedContextPack({
      cwd: repoPath,
      inventory,
      targetFilePath: filePath,
      budgetChars: plan.budgetCharsPerFile,
    });
    contextMap.set(filePath, pack);
  }

  const rawCandidateFindings: AuditFinding[] = [...staticResult.findings];

  // 4. Specialized Review Passes
  for (const filePath of plan.targetFiles) {
    const pack = contextMap.get(filePath);
    if (!pack) continue;

    const passCtx = {
      auditId: plan.auditId,
      repoPath,
      contextPack: pack,
    };

    if (plan.passesToRun.includes("correctness")) {
      rawCandidateFindings.push(...runCorrectnessPass(passCtx));
    }
    if (plan.passesToRun.includes("security")) {
      rawCandidateFindings.push(...runSecurityPass(passCtx));
    }
    if (plan.passesToRun.includes("performance")) {
      rawCandidateFindings.push(...runPerformancePass(passCtx));
    }
    if (plan.passesToRun.includes("architecture")) {
      rawCandidateFindings.push(...runArchitecturePass(passCtx));
    }
    if (plan.passesToRun.includes("test_gap")) {
      rawCandidateFindings.push(...runTestGapPass(passCtx));
    }
    if (plan.passesToRun.includes("refactoring")) {
      rawCandidateFindings.push(...runRefactoringPass(passCtx));
    }
  }

  // 5. Stage 3 Disproof Verification Agent
  const verifiedFindings = verifyAllFindings(rawCandidateFindings, contextMap);

  // 6. Stage 4 Deduplication, False-Positive Discount & Severity Ranking
  const rankedFindings = deduplicateAndRankFindings(verifiedFindings, {
    repoPath,
    minConfidence: 0.6,
  });

  // 7. Stage 5 Safe Patch Plan Generation
  const finalFindings = attachFixPlans(rankedFindings, contextMap);

  // Calculate Health Score & Summary
  const healthScore = calculateHealthScore(finalFindings);
  const criticalCount = finalFindings.filter((f) => f.severity === "critical").length;
  const errorCount = finalFindings.filter((f) => f.severity === "error").length;
  const warningCount = finalFindings.filter((f) => f.severity === "warning").length;
  const infoCount = finalFindings.filter((f) => f.severity === "info").length;

  const summary: AuditScanSummary = {
    auditId: plan.auditId,
    healthScore,
    totalFindings: finalFindings.length,
    criticalCount,
    errorCount,
    warningCount,
    infoCount,
    filesInspected: plan.targetFiles.length,
    durationMs: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  };

  return {
    summary,
    findings: [...finalFindings],
  };
}

/**
 * Effect-TS wrapper for AuditOrchestrationService.
 */
export const runAuditScan = (
  input: AuditScanInput,
  options?: AuditOrchestratorOptions,
): Effect.Effect<AuditScanResult> => Effect.promise(() => executeAuditScan(input, options));
