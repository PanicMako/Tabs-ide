/**
 * SARIFNormalizer — Converts SARIF v2.1.0 Logs & Custom Tool Outputs to AuditFinding[].
 *
 * @module audit/SARIFNormalizer
 */

import type {
  AuditCategory,
  AuditFinding,
  AuditSeverity,
  SarifLog,
  SarifResult,
} from "@tabs/contracts";
import { computeFindingFingerprint } from "@tabs/contracts";

export interface NormalizationOptions {
  readonly auditId: string;
  readonly repoPath: string;
  readonly toolName: string;
  readonly defaultCategory?: AuditCategory | undefined;
}

export function mapSarifLevelToSeverity(level?: string): AuditSeverity {
  switch (level) {
    case "error":
      return "error";
    case "warning":
      return "warning";
    case "note":
    case "none":
      return "info";
    default:
      return "warning";
  }
}

export function mapToolCategory(ruleId?: string, toolName?: string): AuditCategory {
  const normRule = (ruleId ?? "").toLowerCase();
  const normTool = (toolName ?? "").toLowerCase();

  if (normTool.includes("gitleaks") || normRule.includes("secret") || normRule.includes("key")) {
    return "dependency_secret";
  }
  if (normTool.includes("osv") || normRule.includes("cve") || normRule.includes("vulnerability")) {
    return "dependency_secret";
  }
  if (
    normTool.includes("semgrep") ||
    normTool.includes("opengrep") ||
    normRule.includes("security")
  ) {
    return "security";
  }
  if (normTool.includes("tsc") || normTool.includes("eslint") || normTool.includes("pyright")) {
    return "correctness";
  }
  return "correctness";
}

/**
 * Parse and normalize a raw SARIF v2.1.0 JSON log into AuditFinding[].
 */
export function normalizeSarifLog(
  sarifJson: string,
  options: NormalizationOptions,
): AuditFinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sarifJson);
  } catch {
    return [];
  }

  if (typeof parsed !== "object" || parsed === null) return [];
  const log = parsed as SarifLog;

  if (!Array.isArray(log.runs)) return [];

  const findings: AuditFinding[] = [];

  for (const run of log.runs) {
    const driverName = run.tool?.driver?.name ?? options.toolName;
    const rulesMap = new Map<string, { shortDesc?: string; helpUri?: string }>();

    if (Array.isArray(run.tool?.driver?.rules)) {
      for (const rule of run.tool.driver.rules) {
        rulesMap.set(rule.id, {
          shortDesc: rule.shortDescription?.text ?? rule.name,
          helpUri: rule.helpUri,
        });
      }
    }

    const results: SarifResult[] = Array.isArray(run.results) ? run.results : [];

    for (let idx = 0; idx < results.length; idx++) {
      const res = results[idx]!;
      const ruleId = res.ruleId ?? `rule-${idx}`;
      const ruleMeta = rulesMap.get(ruleId);

      const messageText = res.message?.text ?? "Diagnostic finding reported.";
      const severity = mapSarifLevelToSeverity(res.level);
      const category = options.defaultCategory ?? mapToolCategory(ruleId, driverName);

      // Extract locations
      const loc = res.locations?.[0]?.physicalLocation;
      const rawUri = loc?.artifactLocation?.uri ?? "repository";
      // Relativise URI against repoPath
      const filePath = rawUri
        .replace(/^file:\/\//, "")
        .replace(options.repoPath, "")
        .replace(/^\//, "");

      const startLine = loc?.region?.startLine ?? 1;
      const endLine = loc?.region?.endLine ?? startLine;
      const startColumn = loc?.region?.startColumn;
      const endColumn = loc?.region?.endColumn;
      const evidenceSnippet = loc?.region?.snippet?.text ?? messageText;

      const title = ruleMeta?.shortDesc ?? `${driverName}: ${ruleId}`;
      const fingerprint = computeFindingFingerprint({
        filePath,
        category,
        title,
      });

      findings.push({
        id: `${options.auditId}-${driverName}-${idx}`,
        fingerprint,
        auditId: options.auditId,
        repoPath: options.repoPath,
        filePath,
        startLine,
        endLine,
        ...(startColumn !== undefined ? { startColumn } : {}),
        ...(endColumn !== undefined ? { endColumn } : {}),
        category,
        severity,
        confidence: 0.95, // Deterministic static analysis tools have high precision confidence
        title,
        explanation: messageText,
        evidenceSnippet,
        sourceTool: driverName,
        ruleId,
        ...(ruleMeta?.helpUri ? { sarifRuleUrl: ruleMeta.helpUri } : {}),
        verificationState: "verified_passed", // Static analyzers are pre-verified deterministic checks
      });
    }
  }

  return findings;
}
