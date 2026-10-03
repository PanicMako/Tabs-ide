/**
 * FindingDeduper — Stage 4 Deduplication, False-Positive Discount & Severity Ranking Layer.
 *
 * Merges duplicate findings by stable fingerprint, discounts confidence using FeedbackStore memory,
 * filters disproven candidates, and ranks findings by severity.
 *
 * @module audit/FindingDeduper
 */

import type { AuditFinding, AuditSeverity } from "@tabs/contracts";
import { getFeedbackDiscountFactor } from "../review/FeedbackStore.ts";

export const MIN_CONFIDENCE_THRESHOLD = 0.6;

export const SEVERITY_WEIGHTS: Record<AuditSeverity, number> = {
  critical: 4,
  error: 3,
  warning: 2,
  info: 1,
};

export interface DeduperOptions {
  readonly repoPath: string;
  readonly minConfidence?: number | undefined;
  readonly includeDisproven?: boolean | undefined;
}

export function deduplicateAndRankFindings(
  findings: ReadonlyArray<AuditFinding>,
  options: DeduperOptions,
): ReadonlyArray<AuditFinding> {
  const minConfidence = options.minConfidence ?? MIN_CONFIDENCE_THRESHOLD;
  const bestByFingerprint = new Map<string, AuditFinding>();

  for (const finding of findings) {
    // 1. Filter disproven findings unless explicitly requested
    if (!options.includeDisproven && finding.verificationState === "verified_disproven") {
      continue;
    }

    const discount = getFeedbackDiscountFactor(options.repoPath, finding.fingerprint);
    const effectiveConfidence = finding.confidence * discount;

    // 2. Confidence threshold filter
    if (effectiveConfidence < minConfidence) {
      continue;
    }

    const existing = bestByFingerprint.get(finding.fingerprint);
    if (!existing || effectiveConfidence > existing.confidence) {
      bestByFingerprint.set(finding.fingerprint, {
        ...finding,
        confidence: effectiveConfidence,
      });
    }
  }

  // 3. Sort by severity weight descending, then confidence descending
  const result = Array.from(bestByFingerprint.values()).sort((a, b) => {
    const weightDiff = SEVERITY_WEIGHTS[b.severity] - SEVERITY_WEIGHTS[a.severity];
    if (weightDiff !== 0) return weightDiff;
    return b.confidence - a.confidence;
  });

  return result;
}
