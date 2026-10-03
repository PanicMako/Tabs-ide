/**
 * SafeFixPlanner — Stage 5 Reversible Patch & Repair Plan Generator.
 *
 * Generates previewable unified diff patches for actionable findings.
 *
 * @module audit/SafeFixPlanner
 */

import type { AuditFinding, AuditSuggestedFix } from "@tabs/contracts";
import type { TokenBudgetedContextPack } from "@tabs/contracts";

export function generateFixPlan(
  finding: AuditFinding,
  contextMap: Map<string, TokenBudgetedContextPack>,
): AuditSuggestedFix | undefined {
  const pack = contextMap.get(finding.filePath);
  if (!pack) return undefined;

  const lines = pack.primaryFileContent.split("\n");
  const targetIdx = Math.max(0, finding.startLine - 1);
  const targetLine = lines[targetIdx];

  if (!targetLine) return undefined;

  // 1. Fix for unawaited promise calls
  if (finding.title.includes("Unawaited Async")) {
    const fixedLine = targetLine.replace(
      /(\b(?:fetch|fs\.promises|axios|api\.[A-Za-z0-9_$]+)\s*\()/,
      "await $1",
    );
    const patch = `--- a/${finding.filePath}\n+++ b/${finding.filePath}\n@@ -${finding.startLine},1 +${finding.startLine},1 @@\n-${targetLine}\n+${fixedLine}`;

    return {
      description: `Add 'await' operator to async promise call on line ${finding.startLine}.`,
      replacementPatch: patch,
      affectedFiles: [finding.filePath],
      isAutomatedSafe: true,
    };
  }

  // 2. Fix for innerHTML XSS assignment
  if (finding.title.includes("Cross-Site Scripting")) {
    const fixedLine = targetLine.replace(/\.innerHTML\s*=/, ".textContent =");
    const patch = `--- a/${finding.filePath}\n+++ b/${finding.filePath}\n@@ -${finding.startLine},1 +${finding.startLine},1 @@\n-${targetLine}\n+${fixedLine}`;

    return {
      description: `Replace vulnerable '.innerHTML' with safe '.textContent' assignment on line ${finding.startLine}.`,
      replacementPatch: patch,
      affectedFiles: [finding.filePath],
      isAutomatedSafe: true,
    };
  }

  return undefined;
}

export function attachFixPlans(
  findings: ReadonlyArray<AuditFinding>,
  contextMap: Map<string, TokenBudgetedContextPack>,
): ReadonlyArray<AuditFinding> {
  return findings.map((finding) => {
    const fixPlan = generateFixPlan(finding, contextMap);
    return fixPlan ? { ...finding, suggestedFix: fixPlan } : finding;
  });
}
