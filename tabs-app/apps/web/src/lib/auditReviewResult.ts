import {
  computeFindingFingerprint,
  type AuditCategory,
  type AuditScanResult,
  type GitGenerateReviewResult,
} from "@tabs/contracts";

/** Adapt the real review response without inventing verification or coverage. */
export function auditReviewResult(
  result: GitGenerateReviewResult,
  cwd: string,
  startedAt: number,
): AuditScanResult {
  const auditId = `review-${startedAt}`;
  const categories = new Set([
    "correctness",
    "security",
    "performance",
    "architecture",
    "test_gap",
    "dependency_secret",
    "refactoring",
  ]);
  const findings = result.findings.map((finding, index) => {
    const category = (
      categories.has(finding.category) ? finding.category : "correctness"
    ) as AuditCategory;
    const fingerprint = computeFindingFingerprint({
      filePath: finding.file,
      category,
      title: finding.title,
    });
    return {
      id: `${auditId}-${index}`,
      fingerprint,
      auditId,
      repoPath: cwd,
      filePath: finding.file,
      startLine: finding.line,
      endLine: finding.line,
      category,
      severity: finding.severity,
      confidence: finding.confidence,
      title: finding.title,
      explanation: finding.body,
      evidenceSnippet: "",
      sourceTool: "ai-review",
      verificationState: "unverified" as const,
    };
  });
  const count = (severity: string) =>
    findings.filter((finding) => finding.severity === severity).length;
  return {
    summary: {
      auditId,
      healthScore: Math.max(0, 100 - count("error") * 10 - count("warning") * 3 - count("info")),
      totalFindings: findings.length,
      criticalCount: 0,
      errorCount: count("error"),
      warningCount: count("warning"),
      infoCount: count("info"),
      filesInspected: result.filesInspected ?? 0,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
    findings,
  };
}
