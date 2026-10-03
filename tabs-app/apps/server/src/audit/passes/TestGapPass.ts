/**
 * TestGapPass — Identifies exported functions and critical modules missing test coverage.
 *
 * @module audit/passes/TestGapPass
 */

import type { AuditFinding } from "@tabs/contracts";
import { computeFindingFingerprint } from "@tabs/contracts";
import type { ReviewPassContext } from "./CorrectnessPass.ts";

export function runTestGapPass(ctx: ReviewPassContext): ReadonlyArray<AuditFinding> {
  const findings: AuditFinding[] = [];
  const filePath = ctx.contextPack.targetScope;

  // Skip test files themselves
  if (filePath.includes(".test.") || filePath.includes(".spec.")) {
    return [];
  }

  // Check if file has exported symbols but no caller or test reference
  const hasExportedSymbols = ctx.contextPack.symbolDefinitionsText.includes("[exported]");
  const hasTestCaller =
    ctx.contextPack.callerReferencesText.includes(".test.") ||
    ctx.contextPack.callerReferencesText.includes(".spec.");

  if (hasExportedSymbols && !hasTestCaller) {
    const title = "Exported Module Missing Unit Tests";
    const fingerprint = computeFindingFingerprint({
      filePath,
      category: "test_gap",
      title,
    });

    findings.push({
      id: `${ctx.auditId}-testgap-1`,
      fingerprint,
      auditId: ctx.auditId,
      repoPath: ctx.repoPath,
      filePath,
      startLine: 1,
      endLine: 1,
      category: "test_gap",
      severity: "warning",
      confidence: 0.8,
      title,
      explanation: `Module '${filePath}' exports public API symbols but has no referencing unit tests in the repository graph.`,
      evidenceSnippet:
        ctx.contextPack.symbolDefinitionsText.split("\n")[0] ?? "Exported API symbols",
      sourceTool: "agent-testgap-pass",
      verificationState: "unverified",
    });
  }

  return findings;
}
