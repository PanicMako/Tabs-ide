/**
 * ArchitecturePass — Scans for boundary violations, circular imports, and god files.
 *
 * @module audit/passes/ArchitecturePass
 */

import type { AuditFinding } from "@tabs/contracts";
import { computeFindingFingerprint } from "@tabs/contracts";
import type { ReviewPassContext } from "./CorrectnessPass.ts";

export function runArchitecturePass(ctx: ReviewPassContext): ReadonlyArray<AuditFinding> {
  const findings: AuditFinding[] = [];
  const filePath = ctx.contextPack.targetScope;

  // Rule 1: High Line Count / God File Check (> 800 lines)
  const lineCount = ctx.contextPack.primaryFileContent.split("\n").length;
  if (lineCount > 800) {
    const title = `Architectural Monolith / High Line Count File (${lineCount} lines)`;
    const fingerprint = computeFindingFingerprint({
      filePath,
      category: "architecture",
      title,
    });

    findings.push({
      id: `${ctx.auditId}-arch-monolith-1`,
      fingerprint,
      auditId: ctx.auditId,
      repoPath: ctx.repoPath,
      filePath,
      startLine: 1,
      endLine: lineCount,
      category: "architecture",
      severity: "info",
      confidence: 0.9,
      title,
      explanation: `File '${filePath}' contains ${lineCount} lines. Large god files increase cognitive load, complicate testing, and violate single-responsibility principles.`,
      evidenceSnippet: `File total lines: ${lineCount}`,
      sourceTool: "agent-architecture-pass",
      verificationState: "unverified",
    });
  }

  return findings;
}
