/**
 * ReviewStateStore — Phase 4 of the AI Review Engine.
 *
 * Persists `{ repoPath, branchName, lastReviewedSha, findings, updatedAt }`
 * per repo and branch in the local server state directory.
 *
 * Used by IncrementalDiffBuilder to check if a prior review exists for the
 * current branch before performing incremental delta analysis.
 *
 * @module ReviewStateStore
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ReviewFinding } from "@tabs/contracts";

export interface ReviewState {
  readonly repoPath: string;
  readonly branchName: string;
  readonly lastReviewedSha: string;
  readonly findings: ReadonlyArray<ReviewFinding>;
  readonly updatedAt: string;
}

export function getDefaultReviewStateDir(): string {
  return path.join(os.homedir(), ".tabs", "dev", "review_state");
}

function stateFileKey(cwd: string, branchName: string): string {
  const normCwd = path.resolve(cwd).replace(/\\/g, "/");
  const normBranch = branchName.trim();
  const hash = crypto
    .createHash("sha256")
    .update(`${normCwd}::${normBranch}`)
    .digest("hex")
    .slice(0, 16);
  return `review_${hash}.json`;
}

/**
 * Load saved ReviewState for a repo and branch. Returns null if missing or invalid.
 */
export function getReviewState(
  cwd: string,
  branchName: string,
  stateDir?: string,
): ReviewState | null {
  const dir = stateDir ?? getDefaultReviewStateDir();
  const filePath = path.join(dir, stateFileKey(cwd, branchName));

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.lastReviewedSha === "string" &&
      Array.isArray(parsed.findings)
    ) {
      return {
        repoPath: cwd,
        branchName,
        lastReviewedSha: parsed.lastReviewedSha,
        findings: parsed.findings,
        updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Save ReviewState for a repo and branch.
 */
export function saveReviewState(state: ReviewState, stateDir?: string): void {
  const dir = stateDir ?? getDefaultReviewStateDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, stateFileKey(state.repoPath, state.branchName));
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        {
          repoPath: state.repoPath,
          branchName: state.branchName,
          lastReviewedSha: state.lastReviewedSha,
          findings: state.findings,
          updatedAt: state.updatedAt,
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch (err) {
    // Best-effort persistence
    console.warn(`[ReviewStateStore] Failed to save review state:`, err);
  }
}

/**
 * Clear saved ReviewState for a repo and branch (e.g. when force-push detected).
 */
export function clearReviewState(cwd: string, branchName: string, stateDir?: string): void {
  const dir = stateDir ?? getDefaultReviewStateDir();
  const filePath = path.join(dir, stateFileKey(cwd, branchName));
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Best-effort cleanup
  }
}
