/**
 * FindingVerifier — Stage 3 Disproof Agent.
 *
 * Re-evaluates candidate findings against full file context and surrounding symbols
 * to attempt to disprove false positives before presenting findings to the user.
 *
 * @module audit/FindingVerifier
 */

import type { AuditFinding } from "@tabs/contracts";
import type { TokenBudgetedContextPack } from "@tabs/contracts";

export interface VerificationContext {
  readonly contextPackMap: Map<string, TokenBudgetedContextPack>;
}

export function verifyFinding(
  finding: AuditFinding,
  contextMap: Map<string, TokenBudgetedContextPack>,
): AuditFinding {
  // Pre-verified static analyzer findings remain verified
  if (
    finding.verificationState === "verified_passed" &&
    finding.sourceTool !== "agent-correctness-pass" &&
    finding.sourceTool !== "agent-security-pass"
  ) {
    return finding;
  }

  const pack = contextMap.get(finding.filePath);
  if (!pack) {
    // If context pack is missing, mark as unverified but keep
    return {
      ...finding,
      verificationState: "unverified",
    };
  }

  const lines = pack.primaryFileContent.split("\n");
  const targetLineIdx = Math.max(0, finding.startLine - 1);

  // Inspect 15 lines preceding the target line for guard checks
  const startCheckIdx = Math.max(0, targetLineIdx - 15);
  const precedingLines = lines.slice(startCheckIdx, targetLineIdx).join("\n");

  // Rule 1: Disprove Null Dereference if preceding code contains explicit check
  if (finding.title.includes("Null Dereference")) {
    const objNameMatch = /in '([^']+)'/.exec(finding.title);
    const objName = objNameMatch?.[1];
    if (
      objName &&
      (precedingLines.includes(`if (${objName})`) ||
        precedingLines.includes(`if (!${objName}) return`) ||
        precedingLines.includes(`${objName}?.`) ||
        precedingLines.includes(`assert(`))
    ) {
      return {
        ...finding,
        verificationState: "verified_disproven",
        disproofReason: `Disproven: Found null check guard condition for '${objName}' in preceding lines.`,
      };
    }
  }

  // Rule 2: Disprove XSS if preceding code includes DOMPurify or sanitize call
  if (finding.title.includes("Cross-Site Scripting")) {
    if (
      precedingLines.includes("sanitize") ||
      precedingLines.includes("DOMPurify") ||
      precedingLines.includes("escapeHtml")
    ) {
      return {
        ...finding,
        verificationState: "verified_disproven",
        disproofReason: "Disproven: Found sanitization function call in preceding lines.",
      };
    }
  }

  // Otherwise, verified passed
  return {
    ...finding,
    verificationState: "verified_passed",
  };
}

export function verifyAllFindings(
  findings: ReadonlyArray<AuditFinding>,
  contextMap: Map<string, TokenBudgetedContextPack>,
): ReadonlyArray<AuditFinding> {
  return findings.map((f) => verifyFinding(f, contextMap));
}
