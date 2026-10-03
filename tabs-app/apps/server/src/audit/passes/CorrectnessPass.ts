/**
 * CorrectnessPass — Scans code for logic bugs, null dereferences, unhandled exceptions,
 * and edge case failures.
 *
 * @module audit/passes/CorrectnessPass
 */

import type { AuditFinding } from "@tabs/contracts";
import { computeFindingFingerprint } from "@tabs/contracts";
import type { TokenBudgetedContextPack } from "@tabs/contracts";

export interface ReviewPassContext {
  readonly auditId: string;
  readonly repoPath: string;
  readonly contextPack: TokenBudgetedContextPack;
}

export function runCorrectnessPass(ctx: ReviewPassContext): ReadonlyArray<AuditFinding> {
  const findings: AuditFinding[] = [];
  const lines = ctx.contextPack.primaryFileContent.split("\n");
  const filePath = ctx.contextPack.targetScope;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!;
    const lineNum = idx + 1;

    // Pattern 1: Potential null pointer dereference on optional property access without check
    if (
      /\b([A-Za-z0-9_$]+)\.([A-Za-z0-9_$]+)\.([A-Za-z0-9_$]+)\(/.test(line) &&
      !line.includes("?.") &&
      !line.includes("if (") &&
      !line.includes("&&")
    ) {
      const match = /\b([A-Za-z0-9_$]+)\.([A-Za-z0-9_$]+)\.([A-Za-z0-9_$]+)\(/.exec(line);
      const targetObj = match?.[1] ?? "object";

      const title = `Potential Null Dereference in '${targetObj}' chain`;
      const fingerprint = computeFindingFingerprint({
        filePath,
        category: "correctness",
        title,
      });

      findings.push({
        id: `${ctx.auditId}-correctness-null-${lineNum}`,
        fingerprint,
        auditId: ctx.auditId,
        repoPath: ctx.repoPath,
        filePath,
        startLine: lineNum,
        endLine: lineNum,
        category: "correctness",
        severity: "warning",
        confidence: 0.75,
        title,
        explanation: `Unchecked nested property access '${line.trim()}'. Accessing properties on '${targetObj}' without optional chaining ('?.') or guard check may throw TypeError if null/undefined.`,
        evidenceSnippet: line.trim(),
        sourceTool: "agent-correctness-pass",
        verificationState: "unverified",
      });
    }

    // Pattern 2: Unhandled Promise rejection (async call without await/catch)
    if (
      /\b(fetch|fs\.promises|axios|api\.[A-Za-z0-9_$]+)\(/.test(line) &&
      !line.includes("await") &&
      !line.includes(".then") &&
      !line.includes(".catch") &&
      !line.includes("return")
    ) {
      const title = "Unawaited Async Promise Execution";
      const fingerprint = computeFindingFingerprint({
        filePath,
        category: "correctness",
        title,
      });

      findings.push({
        id: `${ctx.auditId}-correctness-async-${lineNum}`,
        fingerprint,
        auditId: ctx.auditId,
        repoPath: ctx.repoPath,
        filePath,
        startLine: lineNum,
        endLine: lineNum,
        category: "correctness",
        severity: "warning",
        confidence: 0.8,
        title,
        explanation: `Async promise call on line ${lineNum} is neither awaited nor handled with .catch(). Unhandled rejections can crash the process or leave state inconsistent.`,
        evidenceSnippet: line.trim(),
        sourceTool: "agent-correctness-pass",
        verificationState: "unverified",
      });
    }
  }

  return findings;
}
