/**
 * SecurityPass — Scans for injection risks, unsafe input validation, command execution,
 * and authorization/authentication bypasses.
 *
 * @module audit/passes/SecurityPass
 */

import type { AuditFinding } from "@tabs/contracts";
import { computeFindingFingerprint } from "@tabs/contracts";
import type { ReviewPassContext } from "./CorrectnessPass.ts";

export function runSecurityPass(ctx: ReviewPassContext): ReadonlyArray<AuditFinding> {
  const findings: AuditFinding[] = [];
  const lines = ctx.contextPack.primaryFileContent.split("\n");
  const filePath = ctx.contextPack.targetScope;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!;
    const lineNum = idx + 1;

    // Pattern 1: eval() / new Function() execution
    if (/\beval\(|\bnew Function\(/.test(line) && !line.includes("// safe")) {
      const title = "Unsafe Dynamic Code Execution (eval)";
      const fingerprint = computeFindingFingerprint({
        filePath,
        category: "security",
        title,
      });

      findings.push({
        id: `${ctx.auditId}-security-eval-${lineNum}`,
        fingerprint,
        auditId: ctx.auditId,
        repoPath: ctx.repoPath,
        filePath,
        startLine: lineNum,
        endLine: lineNum,
        category: "security",
        severity: "critical",
        confidence: 0.95,
        title,
        explanation: `Use of 'eval()' or 'new Function()' allows arbitrary code execution and introduces severe remote code execution (RCE) vulnerabilities.`,
        evidenceSnippet: line.trim(),
        sourceTool: "agent-security-pass",
        verificationState: "unverified",
      });
    }

    // Pattern 2: Insecure innerHTML assignment (XSS)
    if (/\.innerHTML\s*=/.test(line) && !line.includes("sanitize") && !line.includes("DOMPurify")) {
      const title = "Potential Cross-Site Scripting (innerHTML)";
      const fingerprint = computeFindingFingerprint({
        filePath,
        category: "security",
        title,
      });

      findings.push({
        id: `${ctx.auditId}-security-xss-${lineNum}`,
        fingerprint,
        auditId: ctx.auditId,
        repoPath: ctx.repoPath,
        filePath,
        startLine: lineNum,
        endLine: lineNum,
        category: "security",
        severity: "error",
        confidence: 0.85,
        title,
        explanation: `Direct assignment to '.innerHTML' without HTML sanitization can lead to Cross-Site Scripting (XSS) if input contains user-controlled content.`,
        evidenceSnippet: line.trim(),
        sourceTool: "agent-security-pass",
        verificationState: "unverified",
      });
    }
  }

  return findings;
}
