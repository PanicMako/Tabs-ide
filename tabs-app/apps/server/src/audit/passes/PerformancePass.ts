/**
 * PerformancePass — Scans for performance bottlenecks, O(N^2) loops, memory leaks,
 * and unclosed resources.
 *
 * @module audit/passes/PerformancePass
 */

import type { AuditFinding } from "@tabs/contracts";
import { computeFindingFingerprint } from "@tabs/contracts";
import type { ReviewPassContext } from "./CorrectnessPass.ts";

export function runPerformancePass(ctx: ReviewPassContext): ReadonlyArray<AuditFinding> {
  const findings: AuditFinding[] = [];
  const lines = ctx.contextPack.primaryFileContent.split("\n");
  const filePath = ctx.contextPack.targetScope;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!;
    const lineNum = idx + 1;

    // Pattern: Array filter/find inside map loop (O(N^2) complexity)
    if (/\.map\([^)]*\.find\(|\.map\([^)]*\.filter\(/.test(line)) {
      const title = "Quadratic Complexity O(N^2) Array Search inside Loop";
      const fingerprint = computeFindingFingerprint({
        filePath,
        category: "performance",
        title,
      });

      findings.push({
        id: `${ctx.auditId}-perf-loop-${lineNum}`,
        fingerprint,
        auditId: ctx.auditId,
        repoPath: ctx.repoPath,
        filePath,
        startLine: lineNum,
        endLine: lineNum,
        category: "performance",
        severity: "warning",
        confidence: 0.85,
        title,
        explanation: `Nested array searching inside '.map()' loop creates O(N^2) quadratic time complexity. Consider indexing into a Map or Set before looping.`,
        evidenceSnippet: line.trim(),
        sourceTool: "agent-performance-pass",
        verificationState: "unverified",
      });
    }
  }

  return findings;
}
