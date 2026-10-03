/**
 * IncrementalDiffBuilder — Phase 4 of the AI Review Engine.
 *
 * Handles incremental delta reviews for Git repositories:
 * 1. Ancestry / Force-Push check: runs `git merge-base --is-ancestor <lastReviewedSha> HEAD`.
 *    If history diverged or force-pushed, invalidates state and falls back to full review,
 *    emitting a `review_info` event.
 * 2. Incremental diff extraction: runs `git diff <lastReviewedSha> HEAD` to obtain delta patch.
 * 3. Finding merge logic: carries unchanged findings forward (`isNew: false`), merges new delta
 *    findings (`isNew: true`), and deduplicates.
 *
 * @module IncrementalDiffBuilder
 */

import { spawnSync } from "node:child_process";
import type { ReviewFinding } from "@tabs/contracts";
import {
  getReviewState,
  clearReviewState,
  saveReviewState,
  type ReviewState,
} from "./ReviewStateStore";
import { filterAndDeduplicateFindings } from "./VerificationFilter";

export interface ReviewInfoEvent {
  readonly message: string;
  readonly reason: "force_push_detected" | "history_changed" | "first_review";
}

export interface IncrementalDiffResult {
  readonly isIncremental: boolean;
  readonly lastReviewedSha?: string | undefined;
  readonly deltaPatch?: string | undefined;
  readonly deltaSummary?: string | undefined;
  readonly previousFindings?: ReadonlyArray<ReviewFinding> | undefined;
  readonly infoEvent?: ReviewInfoEvent | undefined;
}

/**
 * Check if `ancestorSha` is a direct ancestor of `HEAD` using `git merge-base --is-ancestor`.
 */
export function isAncestorCommit(cwd: string, ancestorSha: string): boolean {
  try {
    const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestorSha, "HEAD"], {
      cwd,
      encoding: "utf8",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Extract incremental diff or return fallback full review trigger.
 */
export function prepareIncrementalDiff(
  cwd: string,
  branchName: string,
  currentHeadSha: string,
  stateDir?: string,
): IncrementalDiffResult {
  const priorState = getReviewState(cwd, branchName, stateDir);

  if (!priorState) {
    return { isIncremental: false };
  }

  // Same SHA already reviewed
  if (priorState.lastReviewedSha === currentHeadSha) {
    return {
      isIncremental: true,
      lastReviewedSha: priorState.lastReviewedSha,
      deltaPatch: "",
      deltaSummary: "No changes since last review",
      previousFindings: priorState.findings.map((f) => ({ ...f, isNew: false })),
    };
  }

  // Check if prior SHA is still an ancestor of current HEAD
  const isAncestor = isAncestorCommit(cwd, priorState.lastReviewedSha);

  if (!isAncestor) {
    // Force-push / history rewrite detected — invalidate state
    clearReviewState(cwd, branchName, stateDir);
    return {
      isIncremental: false,
      infoEvent: {
        message: "branch history changed — ran full review",
        reason: "force_push_detected",
      },
    };
  }

  // Prior SHA is ancestor → build incremental delta patch
  try {
    const diffRes = spawnSync("git", ["diff", `${priorState.lastReviewedSha}..HEAD`], {
      cwd,
      encoding: "utf8",
    });
    const deltaPatch = diffRes.stdout ?? "";
    const statRes = spawnSync("git", ["diff", "--stat", `${priorState.lastReviewedSha}..HEAD`], {
      cwd,
      encoding: "utf8",
    });
    const deltaSummary = statRes.stdout?.trim() || "Incremental changes";

    return {
      isIncremental: true,
      lastReviewedSha: priorState.lastReviewedSha,
      deltaPatch,
      deltaSummary,
      previousFindings: priorState.findings.map((f) => ({ ...f, isNew: false })),
    };
  } catch {
    return { isIncremental: false };
  }
}

/**
 * Merge carried-forward previous findings with new incremental findings.
 * - Carried forward findings have `isNew: false`.
 * - New delta findings have `isNew: true`.
 * - Re-runs verification filter to deduplicate.
 */
export function mergeIncrementalFindings(
  previousFindings: ReadonlyArray<ReviewFinding>,
  newDeltaFindings: ReadonlyArray<ReviewFinding>,
): ReadonlyArray<ReviewFinding> {
  const markedPrevious = previousFindings.map((f) => ({ ...f, isNew: false }));
  const markedNew = newDeltaFindings.map((f) => ({ ...f, isNew: true }));

  const combined = [...markedPrevious, ...markedNew];
  return filterAndDeduplicateFindings(combined);
}
