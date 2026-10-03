/**
 * ReviewHistoryStore — Persists historical audit records & reports per repo.
 *
 * Keeps a rolling log of up to 50 past AI Code Review runs per workspace.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ReviewFinding } from "@tabs/contracts";

export interface ReviewHistoryRecord {
  readonly id: string;
  readonly repoPath: string;
  readonly branchName: string;
  readonly timestamp: string;
  readonly modelUsed: string;
  readonly targetScope: string;
  readonly summary: string;
  readonly keyChanges: string;
  readonly notesAndRisk: string;
  readonly findings: ReadonlyArray<ReviewFinding>;
  readonly passesRun: ReadonlyArray<string>;
  readonly isIncremental: boolean;
}

export function getDefaultReviewHistoryDir(): string {
  return path.join(os.homedir(), ".tabs", "dev", "review_history");
}

function historyFileKey(cwd: string): string {
  const normCwd = path.resolve(cwd).replace(/\\/g, "/");
  const hash = crypto.createHash("sha256").update(normCwd).digest("hex").slice(0, 16);
  return `history_${hash}.json`;
}

/**
 * Get all historical review records for a repository (newest first).
 */
export function getReviewHistory(cwd: string, dir?: string): ReadonlyArray<ReviewHistoryRecord> {
  const baseDir = dir ?? getDefaultReviewHistoryDir();
  const filePath = path.join(baseDir, historyFileKey(cwd));
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Add a new review record to the repository history.
 */
export function addReviewHistoryRecord(record: ReviewHistoryRecord, dir?: string): void {
  const baseDir = dir ?? getDefaultReviewHistoryDir();
  try {
    fs.mkdirSync(baseDir, { recursive: true });
    const current = [...getReviewHistory(record.repoPath, baseDir)];
    // Prepend new record & cap at 50 records
    const updated = [record, ...current].slice(0, 50);
    const filePath = path.join(baseDir, historyFileKey(record.repoPath));
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), "utf8");
  } catch (err) {
    console.warn(`[ReviewHistoryStore] Failed to save review record:`, err);
  }
}
