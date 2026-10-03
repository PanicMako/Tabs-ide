/**
 * GitleaksAdapter — Secret & Credential Scanning Tool Adapter.
 *
 * Runs `gitleaks detect --no-git --report-format json` in a sandboxed process.
 *
 * @module audit/adapters/GitleaksAdapter
 */

import type { AuditFinding } from "@tabs/contracts";
import { computeFindingFingerprint } from "@tabs/contracts";
import { executeSandboxedProcess } from "../SandboxedProcessRunner.ts";

export interface GitleaksReportItem {
  readonly Description: string;
  readonly StartLine: number;
  readonly EndLine: number;
  readonly StartColumn: number;
  readonly EndColumn: number;
  readonly Match: string;
  readonly Secret: string;
  readonly File: string;
  readonly SymlinkFile: string;
  readonly Commit: string;
  readonly Entropy: number;
  readonly Author: string;
  readonly Email: string;
  readonly Date: string;
  readonly Message: string;
  readonly RuleID: string;
  readonly Fingerprint: string;
}

export async function runGitleaksScan(
  cwd: string,
  auditId: string,
): Promise<{
  readonly findings: ReadonlyArray<AuditFinding>;
  readonly skippedReason?: string | undefined;
}> {
  const result = await executeSandboxedProcess({
    cwd,
    executable: "gitleaks",
    args: ["detect", "--no-git", "--report-format", "json", "--report-path", "stdout", "--redact"],
    timeoutMs: 60_000,
  });

  if (result.exitCode === 127 || result.stderr.includes("not found")) {
    return {
      findings: [],
      skippedReason: "Gitleaks not installed on PATH — skipping secret scan.",
    };
  }

  const rawJson = result.stdout.trim();
  if (!rawJson || rawJson === "[]" || rawJson === "null") {
    return { findings: [] };
  }

  let items: unknown;
  try {
    items = JSON.parse(rawJson);
  } catch {
    return { findings: [] };
  }

  if (!Array.isArray(items)) return { findings: [] };

  const findings: AuditFinding[] = [];

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx] as Partial<GitleaksReportItem>;
    const file = item.File ?? "unknown";
    const startLine = item.StartLine ?? 1;
    const endLine = item.EndLine ?? startLine;
    const ruleId = item.RuleID ?? "generic-secret";
    const description = item.Description ?? `Exposed secret detected (${ruleId}).`;

    const title = `Exposed Secret: ${ruleId}`;
    const fingerprint = computeFindingFingerprint({
      filePath: file,
      category: "dependency_secret",
      title,
    });

    findings.push({
      id: `${auditId}-gitleaks-${idx}`,
      fingerprint,
      auditId,
      repoPath: cwd,
      filePath: file,
      startLine,
      endLine,
      ...(item.StartColumn ? { startColumn: item.StartColumn } : {}),
      ...(item.EndColumn ? { endColumn: item.EndColumn } : {}),
      category: "dependency_secret",
      severity: "critical", // Hardcoded secrets are always critical security risks
      confidence: 0.98,
      title,
      explanation: `${description} Sanitized match: '${item.Match ?? "REDACTED"}'`,
      evidenceSnippet: item.Match ?? item.Secret ?? "REDACTED_SECRET",
      sourceTool: "gitleaks",
      ruleId,
      verificationState: "verified_passed",
    });
  }

  return { findings };
}
