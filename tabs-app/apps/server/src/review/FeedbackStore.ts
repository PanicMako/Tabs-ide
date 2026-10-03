/**
 * FeedbackStore — Phase 5 of the AI Review Engine.
 *
 * Persists finding feedback (accepted, dismissed, false_positive) per repo:
 * `{ findingFingerprint, repoPath, verdict, category, count }`
 *
 * Implements discount calculations:
 * - 1 FP mark  → 0.80 multiplier
 * - 2 FP marks → 0.65 multiplier
 * - 3+ FP marks → 0.0 multiplier (suppressed completely)
 *
 * @module FeedbackStore
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FindingFeedbackVerdict, GitSubmitFindingFeedbackResult } from "@tabs/contracts";

export interface FeedbackRecord {
  readonly repoPath: string;
  readonly findingFingerprint: string;
  readonly category: string;
  readonly verdict: FindingFeedbackVerdict;
  readonly count: number;
}

export function getDefaultFeedbackStoreDir(): string {
  return path.join(os.homedir(), ".tabs", "dev");
}

function feedbackStoreFilePath(stateDir?: string): string {
  const dir = stateDir ?? getDefaultFeedbackStoreDir();
  return path.join(dir, "feedback_store.json");
}

function normalizeRepoPath(cwd: string): string {
  return path.resolve(cwd).replace(/\\/g, "/");
}

export function loadAllFeedbackRecords(stateDir?: string): FeedbackRecord[] {
  const filePath = feedbackStoreFilePath(stateDir);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as FeedbackRecord[];
    }
    return [];
  } catch {
    return [];
  }
}

export function saveAllFeedbackRecords(records: FeedbackRecord[], stateDir?: string): void {
  const filePath = feedbackStoreFilePath(stateDir);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(records, null, 2), "utf8");
  } catch (err) {
    console.warn(`[FeedbackStore] Failed to save feedback store:`, err);
  }
}

/**
 * Record user feedback for a finding in a repository.
 */
export function recordFeedback(
  cwd: string,
  findingFingerprint: string,
  category: string,
  verdict: FindingFeedbackVerdict,
  stateDir?: string,
): GitSubmitFindingFeedbackResult {
  const normRepo = normalizeRepoPath(cwd);
  const normFingerprint = findingFingerprint.trim();
  const records = loadAllFeedbackRecords(stateDir);

  const existingIndex = records.findIndex(
    (r) =>
      r.repoPath === normRepo && r.findingFingerprint === normFingerprint && r.verdict === verdict,
  );

  let updatedCount = 1;
  if (existingIndex >= 0 && records[existingIndex]) {
    updatedCount = records[existingIndex].count + 1;
    records[existingIndex] = {
      ...records[existingIndex],
      category,
      count: updatedCount,
    };
  } else {
    records.push({
      repoPath: normRepo,
      findingFingerprint: normFingerprint,
      category,
      verdict,
      count: 1,
    });
  }

  saveAllFeedbackRecords(records, stateDir);

  // Compute total false positive count for this fingerprint in this repo
  const fpRecord = records.find(
    (r) =>
      r.repoPath === normRepo &&
      r.findingFingerprint === normFingerprint &&
      r.verdict === "false_positive",
  );
  const falsePositiveCount = fpRecord ? fpRecord.count : 0;
  const isSuppressed = falsePositiveCount >= 3;

  return {
    success: true,
    falsePositiveCount,
    isSuppressed,
  };
}

/**
 * Get false positive count for a specific finding fingerprint in a repository.
 */
export function getFalsePositiveCount(
  cwd: string,
  findingFingerprint: string,
  stateDir?: string,
): number {
  const normRepo = normalizeRepoPath(cwd);
  const normFingerprint = findingFingerprint.trim();
  const records = loadAllFeedbackRecords(stateDir);

  const fpRecord = records.find(
    (r) =>
      r.repoPath === normRepo &&
      r.findingFingerprint === normFingerprint &&
      r.verdict === "false_positive",
  );
  return fpRecord ? fpRecord.count : 0;
}

/**
 * Get the confidence discount factor (0.0 to 1.0) for a finding in a repo.
 * - 0 FPs: 1.0 (no discount)
 * - 1 FP:  0.80
 * - 2 FPs: 0.65
 * - 3+ FPs: 0.0 (suppressed completely)
 */
export function getFeedbackDiscountFactor(
  cwd: string,
  findingFingerprint: string,
  stateDir?: string,
): number {
  const fpCount = getFalsePositiveCount(cwd, findingFingerprint, stateDir);
  if (fpCount === 0) return 1.0;
  if (fpCount === 1) return 0.8;
  if (fpCount === 2) return 0.65;
  return 0.0; // 3 or more FPs completely suppresses the finding
}
