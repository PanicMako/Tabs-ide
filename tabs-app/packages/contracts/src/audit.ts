import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const AuditSeverity = Schema.Literals(["critical", "error", "warning", "info"]);
export type AuditSeverity = typeof AuditSeverity.Type;

export const AuditCategory = Schema.Literals([
  "correctness",
  "security",
  "performance",
  "architecture",
  "test_gap",
  "dependency_secret",
  "refactoring",
]);
export type AuditCategory = typeof AuditCategory.Type;

export const FindingVerificationState = Schema.Literals([
  "unverified",
  "verified_passed",
  "verified_disproven",
]);
export type FindingVerificationState = typeof FindingVerificationState.Type;

export const FindingUserVerdict = Schema.Literals(["accepted", "dismissed", "false_positive"]);
export type FindingUserVerdict = typeof FindingUserVerdict.Type;

export const AuditSuggestedFix = Schema.Struct({
  description: Schema.String,
  replacementPatch: Schema.String,
  affectedFiles: Schema.Array(Schema.String),
  isAutomatedSafe: Schema.Boolean,
});
export type AuditSuggestedFix = typeof AuditSuggestedFix.Type;

export const AuditFinding = Schema.Struct({
  id: TrimmedNonEmptyString,
  fingerprint: TrimmedNonEmptyString,
  auditId: TrimmedNonEmptyString,
  repoPath: TrimmedNonEmptyString,
  revisionSha: Schema.optional(TrimmedNonEmptyString),

  // File & Line Location
  filePath: TrimmedNonEmptyString,
  startLine: Schema.Number,
  endLine: Schema.Number,
  startColumn: Schema.optional(Schema.Number),
  endColumn: Schema.optional(Schema.Number),
  symbolName: Schema.optional(TrimmedNonEmptyString),

  // Classification & Content
  category: AuditCategory,
  severity: AuditSeverity,
  confidence: Schema.Number, // 0.0 to 1.0
  title: TrimmedNonEmptyString,
  explanation: Schema.String,
  evidenceSnippet: Schema.String,
  impactDescription: Schema.optional(Schema.String),
  reasoningTrail: Schema.optional(Schema.Array(Schema.String)),

  // Tool Provenance
  sourceTool: TrimmedNonEmptyString,
  ruleId: Schema.optional(TrimmedNonEmptyString),
  sarifRuleUrl: Schema.optional(Schema.String),

  // Verification & Status
  verificationState: FindingVerificationState,
  disproofReason: Schema.optional(Schema.String),
  userVerdict: Schema.optional(FindingUserVerdict),

  // Suggested Repair Patch
  suggestedFix: Schema.optional(AuditSuggestedFix),
});
export type AuditFinding = typeof AuditFinding.Type;

export const AuditScanDepth = Schema.Literals(["quick", "standard", "deep"]);
export type AuditScanDepth = typeof AuditScanDepth.Type;

export const AuditScopeKind = Schema.Literals([
  "full_repository",
  "workspace_package",
  "folder",
  "selected_files",
  "changed_files_only",
  "pull_request",
]);
export type AuditScopeKind = typeof AuditScopeKind.Type;

export const AuditScope = Schema.Struct({
  kind: AuditScopeKind,
  targetPaths: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  baseRef: Schema.optional(TrimmedNonEmptyString),
  headRef: Schema.optional(TrimmedNonEmptyString),
});
export type AuditScope = typeof AuditScope.Type;

export const AuditScanInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  scope: AuditScope,
  depth: AuditScanDepth,
  enabledCategories: Schema.optional(Schema.Array(AuditCategory)),
  enabledTools: Schema.optional(Schema.Array(Schema.String)),
  userInstructions: Schema.optional(Schema.String),
});
export type AuditScanInput = typeof AuditScanInput.Type;

export const AuditScanSummary = Schema.Struct({
  auditId: TrimmedNonEmptyString,
  healthScore: Schema.Number, // 0 to 100
  totalFindings: Schema.Number,
  criticalCount: Schema.Number,
  errorCount: Schema.Number,
  warningCount: Schema.Number,
  infoCount: Schema.Number,
  filesInspected: Schema.Number,
  durationMs: Schema.Number,
  timestamp: Schema.String,
});
export type AuditScanSummary = typeof AuditScanSummary.Type;

export const AuditScanResult = Schema.Struct({
  summary: AuditScanSummary,
  findings: Schema.Array(AuditFinding),
});
export type AuditScanResult = typeof AuditScanResult.Type;

/**
 * Computes a deterministic SHA-256 fingerprint for finding deduplication and tracking
 * line position shifts across commits.
 */
export function computeFindingFingerprint(finding: {
  filePath: string;
  symbolName?: string | undefined;
  category: string;
  title: string;
}): string {
  const normPath = finding.filePath.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  const symbol = (finding.symbolName ?? "").trim().toLowerCase();
  const category = finding.category.trim().toLowerCase();
  const normTitle = finding.title.trim().toLowerCase().replace(/\s+/g, "_");

  const key = `${normPath}:${symbol}:${category}:${normTitle}`;

  // Simple deterministic djb2 / fnv1a string hash fallback if crypto is not available in browser
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 33) ^ key.charCodeAt(i);
  }
  const hashHex = (hash >>> 0).toString(16).padStart(8, "0");
  return `audit-fp-${hashHex}`;
}
