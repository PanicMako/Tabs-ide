/**
 * VerificationFilter — Phase 3 of the AI Review Engine.
 *
 * Filters, deduplicates, and validates raw findings emitted by multi-pass analysis:
 * 1. Scope filter: drops findings where `isInDiff` is false (line is not in modified diff scope).
 * 2. Fingerprint dedup: deduplicates by `${file}:${line}:${category}`, retaining the finding
 *    with the highest confidence score.
 * 3. Confidence threshold: drops findings below `MIN_CONFIDENCE_THRESHOLD` (default: 0.60).
 * 4. FeedbackStore discount: placeholder stub for Phase 5 integration.
 *
 * @module VerificationFilter
 */

import type { ReviewFinding } from "@tabs/contracts";
import { getFeedbackDiscountFactor } from "./FeedbackStore";

export const MIN_CONFIDENCE_THRESHOLD = 0.6;

/** Generate a deterministic fingerprint for a finding. */
export function getFindingFingerprint(finding: {
  file: string;
  line: number;
  category: string;
}): string {
  const normFile = finding.file.replace(/\\/g, "/").replace(/^\.\//, "");
  return `${normFile}:${finding.line}:${finding.category.toLowerCase()}`;
}

export interface VerificationFilterOptions {
  /** Repository working directory to look up feedback discounts. */
  cwd?: string | undefined;
  /** Minimum confidence score required to retain a finding (default: 0.60). */
  minConfidence?: number | undefined;
  /**
   * Optional feedback discount lookup.
   * Returns a discount factor between 0.0 and 1.0 (1.0 = no discount).
   */
  feedbackDiscountProvider?: ((fingerprint: string) => number) | undefined;
  stateDir?: string | undefined;
}

/**
 * Filter and deduplicate raw review findings across passes.
 */
export function filterAndDeduplicateFindings(
  findings: ReadonlyArray<ReviewFinding>,
  options?: VerificationFilterOptions,
): ReadonlyArray<ReviewFinding> {
  const minConfidence = options?.minConfidence ?? MIN_CONFIDENCE_THRESHOLD;
  const getDiscount =
    options?.feedbackDiscountProvider ??
    (options?.cwd
      ? (fp: string) => getFeedbackDiscountFactor(options.cwd!, fp, options.stateDir)
      : () => 1.0);

  // Group by fingerprint
  const bestByFingerprint = new Map<string, ReviewFinding>();

  for (const finding of findings) {
    // 1. Scope filter: must be in diff
    if (!finding.isInDiff) {
      continue;
    }

    const fingerprint = getFindingFingerprint(finding);
    const discount = getDiscount(fingerprint);
    const effectiveConfidence = finding.confidence * discount;

    // 2. Confidence filter
    if (effectiveConfidence < minConfidence) {
      continue;
    }

    const existing = bestByFingerprint.get(fingerprint);
    if (
      !existing ||
      effectiveConfidence > existing.confidence * getDiscount(getFindingFingerprint(existing))
    ) {
      bestByFingerprint.set(fingerprint, {
        ...finding,
        confidence: effectiveConfidence,
      });
    }
  }

  return [...bestByFingerprint.values()];
}
