/**
 * Unit tests for IncrementalDiffBuilder and ReviewStateStore — Phase 4.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import type { ReviewFinding } from "@tabs/contracts";
import { getReviewState, saveReviewState, clearReviewState } from "./ReviewStateStore";
import {
  prepareIncrementalDiff,
  isAncestorCommit,
  mergeIncrementalFindings,
} from "./IncrementalDiffBuilder";
import { estimateReviewCost } from "./ReviewPassRunner";

describe("ReviewStateStore", () => {
  let tempStateDir: string;

  beforeEach(() => {
    tempStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabs-state-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempStateDir, { recursive: true, force: true });
  });

  it("saves and retrieves review state per repo and branch", () => {
    const findings: ReviewFinding[] = [
      {
        id: "1",
        file: "src/a.ts",
        line: 10,
        category: "security",
        severity: "error",
        title: "SQL Injection",
        body: "Fix query",
        confidence: 0.9,
        isInDiff: true,
      },
    ];

    saveReviewState(
      {
        repoPath: "/tmp/myrepo",
        branchName: "feature/auth",
        lastReviewedSha: "sha123",
        findings,
        updatedAt: "2026-08-04T00:00:00Z",
      },
      tempStateDir,
    );

    const loaded = getReviewState("/tmp/myrepo", "feature/auth", tempStateDir);
    expect(loaded).toBeDefined();
    expect(loaded?.lastReviewedSha).toBe("sha123");
    expect(loaded?.findings).toHaveLength(1);
    expect(loaded?.findings[0]?.id).toBe("1");
  });

  it("clears review state when requested", () => {
    saveReviewState(
      {
        repoPath: "/tmp/myrepo",
        branchName: "feature/auth",
        lastReviewedSha: "sha123",
        findings: [],
        updatedAt: "2026-08-04T00:00:00Z",
      },
      tempStateDir,
    );

    clearReviewState("/tmp/myrepo", "feature/auth", tempStateDir);
    const loaded = getReviewState("/tmp/myrepo", "feature/auth", tempStateDir);
    expect(loaded).toBeNull();
  });
});

describe("IncrementalDiffBuilder (Real Git Repo Tests)", () => {
  let tempRepo: string;
  let tempStateDir: string;

  beforeEach(() => {
    tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "tabs-inc-repo-"));
    tempStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabs-inc-state-"));

    execSync("git init --initial-branch=main", { cwd: tempRepo });
    execSync('git config user.email "test@example.com"', { cwd: tempRepo });
    execSync('git config user.name "Test User"', { cwd: tempRepo });
    fs.writeFileSync(path.join(tempRepo, "root.txt"), "root");
    execSync("git add .", { cwd: tempRepo });
    execSync('git commit -m "Root commit"', { cwd: tempRepo });
  });

  afterEach(() => {
    fs.rmSync(tempRepo, { recursive: true, force: true });
    fs.rmSync(tempStateDir, { recursive: true, force: true });
  });

  it("Commit A -> full review, Commit B -> incremental review token cost <= 30% of full review", () => {
    // Commit A: Realistic PR codebase (30 files)
    for (let i = 1; i <= 30; i++) {
      fs.writeFileSync(
        path.join(tempRepo, `file${i}.ts`),
        `// File ${i} content\nexport function func${i}() {\n  // Implementation of func${i}\n  const val = ${i} * 42;\n  return val;\n}\n`,
      );
    }
    execSync("git add .", { cwd: tempRepo });
    execSync('git commit -m "Commit A: initial files"', { cwd: tempRepo });
    const commitASha = execSync("git rev-parse HEAD", { cwd: tempRepo }).toString().trim();

    // Full review cost estimation at Commit A
    const fullDiffPatch = execSync("git diff HEAD~1", { cwd: tempRepo }).toString();
    const fullCost = estimateReviewCost(
      {
        cwd: tempRepo,
        diffSummary: "10 files changed",
        diffPatch: fullDiffPatch,
        modelSelection: { instanceId: "gemini" as any, model: "gemini-3.6-flash" },
      },
      ["correctness", "security"],
    );

    // Save full review state for Commit A
    saveReviewState(
      {
        repoPath: tempRepo,
        branchName: "main",
        lastReviewedSha: commitASha,
        findings: [
          {
            id: "f1",
            file: "file1.ts",
            line: 2,
            category: "correctness",
            severity: "warning",
            title: "Existing finding in file1",
            body: "Body",
            confidence: 0.8,
            isInDiff: true,
          },
        ],
        updatedAt: new Date().toISOString(),
      },
      tempStateDir,
    );

    // Commit B: Small single-line edit in file1.ts
    fs.writeFileSync(
      path.join(tempRepo, "file1.ts"),
      `// File 1 content\nexport function func1() {\n  return 100;\n}\n`,
    );
    execSync("git add file1.ts", { cwd: tempRepo });
    execSync('git commit -m "Commit B: update func1"', { cwd: tempRepo });
    const commitBSha = execSync("git rev-parse HEAD", { cwd: tempRepo }).toString().trim();

    // Prepare incremental diff
    const incResult = prepareIncrementalDiff(tempRepo, "main", commitBSha, tempStateDir);

    expect(incResult.isIncremental).toBe(true);
    expect(incResult.lastReviewedSha).toBe(commitASha);
    expect(incResult.previousFindings).toHaveLength(1);
    expect(incResult.previousFindings![0]?.isNew).toBe(false);

    // Incremental cost estimation
    const incCost = estimateReviewCost(
      {
        cwd: tempRepo,
        diffSummary: incResult.deltaSummary!,
        diffPatch: incResult.deltaPatch!,
        modelSelection: { instanceId: "gemini" as any, model: "gemini-3.6-flash" },
      },
      ["correctness", "security"],
    );

    console.log(`[Phase 4 Cost Test] Full tokens: ${fullCost.estimatedInputTokens}`);
    console.log(`[Phase 4 Cost Test] Incremental tokens: ${incCost.estimatedInputTokens}`);
    const costRatio = incCost.estimatedInputTokens / fullCost.estimatedInputTokens;
    console.log(`[Phase 4 Cost Test] Ratio: ${(costRatio * 100).toFixed(1)}%`);

    // Verify incremental is <= 30% of full review cost (per design doc)
    expect(costRatio).toBeLessThanOrEqual(0.3);
  });

  it("Force-push scenario: history rewrite triggers fallback and emits review_info event", () => {
    // Commit A
    fs.writeFileSync(path.join(tempRepo, "a.ts"), "const a = 1;");
    execSync("git add a.ts", { cwd: tempRepo });
    execSync('git commit -m "Commit A"', { cwd: tempRepo });
    const commitASha = execSync("git rev-parse HEAD", { cwd: tempRepo }).toString().trim();

    // Save state for Commit A
    saveReviewState(
      {
        repoPath: tempRepo,
        branchName: "main",
        lastReviewedSha: commitASha,
        findings: [],
        updatedAt: new Date().toISOString(),
      },
      tempStateDir,
    );

    // Force-push / history rewrite: git reset --hard HEAD~1 and make new Commit C
    execSync("git reset --hard HEAD~1", { cwd: tempRepo });
    fs.writeFileSync(path.join(tempRepo, "c.ts"), "const c = 3;");
    execSync("git add c.ts", { cwd: tempRepo });
    execSync('git commit -m "Commit C (rewritten history)"', { cwd: tempRepo });
    const commitCSha = execSync("git rev-parse HEAD", { cwd: tempRepo }).toString().trim();

    // Prepare incremental diff for rewritten branch
    const result = prepareIncrementalDiff(tempRepo, "main", commitCSha, tempStateDir);

    expect(result.isIncremental).toBe(false);
    expect(result.infoEvent).toBeDefined();
    expect(result.infoEvent?.reason).toBe("force_push_detected");
    expect(result.infoEvent?.message).toBe("branch history changed — ran full review");

    // State should now be cleared
    const clearedState = getReviewState(tempRepo, "main", tempStateDir);
    expect(clearedState).toBeNull();
  });
});
