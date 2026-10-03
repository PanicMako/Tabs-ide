/**
 * RefactoringPass — Identifies structural refactoring opportunities and code quality improvements.
 *
 * @module audit/passes/RefactoringPass
 */

import type { AuditFinding } from "@tabs/contracts";
import { computeFindingFingerprint } from "@tabs/contracts";
import type { ReviewPassContext } from "./CorrectnessPass.ts";

export function runRefactoringPass(ctx: ReviewPassContext): ReadonlyArray<AuditFinding> {
  const findings: AuditFinding[] = [];
  const lines = ctx.contextPack.primaryFileContent.split("\n");
  const filePath = ctx.contextPack.targetScope;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!;
    const lineNum = idx + 1;

    // Pattern: Deeply nested conditional statements (complexity smell)
    if (/^\s{12,}(if|for|while|switch)\b/.test(line)) {
      const title = "High Cyclomatic Complexity / Deep Control Nesting";
      const fingerprint = computeFindingFingerprint({
        filePath,
        category: "refactoring",
        title,
      });

      findings.push({
        id: `${ctx.auditId}-refactor-nesting-${lineNum}`,
        fingerprint,
        auditId: ctx.auditId,
        repoPath: ctx.repoPath,
        filePath,
        startLine: lineNum,
        endLine: lineNum,
        category: "refactoring",
        severity: "info",
        confidence: 0.85,
        title,
        explanation: `Deep control nesting (4+ indentation levels) on line ${lineNum}. Consider extracting nested blocks into helper functions or using early returns.`,
        evidenceSnippet: line.trim(),
        sourceTool: "agent-refactoring-pass",
        verificationState: "unverified",
      });
    }
  }

  return findings;
}
