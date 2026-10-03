/**
 * Unit tests for FeedbackStore and Feedback Discount Integration — Phase 5.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import type { ReviewFinding } from "@tabs/contracts";
import { recordFeedback, getFeedbackDiscountFactor, getFalsePositiveCount } from "./FeedbackStore";
import { filterAndDeduplicateFindings } from "./VerificationFilter";

describe("FeedbackStore & VerificationFilter Discount Integration", () => {
  let tempStateDir: string;

  beforeEach(() => {
    tempStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabs-fb-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempStateDir, { recursive: true, force: true });
  });

  it("0 FPs -> 1.0 discount factor (no reduction)", () => {
    const factor = getFeedbackDiscountFactor("/tmp/repo", "src/auth.ts:10:security", tempStateDir);
    expect(factor).toBe(1.0);
  });

  it("1 FP -> 0.80 discount factor (confidence reduced)", () => {
    const cwd = "/tmp/repo";
    const fingerprint = "src/auth.ts:10:security";

    const res = recordFeedback(cwd, fingerprint, "security", "false_positive", tempStateDir);
    expect(res.falsePositiveCount).toBe(1);
    expect(res.isSuppressed).toBe(false);

    const factor = getFeedbackDiscountFactor(cwd, fingerprint, tempStateDir);
    expect(factor).toBe(0.8);
  });

  it("2 FPs -> 0.65 discount factor (confidence further reduced)", () => {
    const cwd = "/tmp/repo";
    const fingerprint = "src/auth.ts:10:security";

    recordFeedback(cwd, fingerprint, "security", "false_positive", tempStateDir);
    recordFeedback(cwd, fingerprint, "security", "false_positive", tempStateDir);

    const factor = getFeedbackDiscountFactor(cwd, fingerprint, tempStateDir);
    expect(factor).toBe(0.65);
  });

  it("3 FPs -> 0.0 discount factor (finding completely suppressed)", () => {
    const cwd = "/tmp/repo";
    const fingerprint = "src/auth.ts:10:security";

    recordFeedback(cwd, fingerprint, "security", "false_positive", tempStateDir);
    recordFeedback(cwd, fingerprint, "security", "false_positive", tempStateDir);
    const res = recordFeedback(cwd, fingerprint, "security", "false_positive", tempStateDir);

    expect(res.falsePositiveCount).toBe(3);
    expect(res.isSuppressed).toBe(true);

    const factor = getFeedbackDiscountFactor(cwd, fingerprint, tempStateDir);
    expect(factor).toBe(0.0);
  });

  it("End-to-End Filtering: Before FP, 1 FP (confidence reduced), 3 FPs (finding completely omitted)", () => {
    const cwd = "/tmp/repo_e2e";
    const fingerprint = "src/controller.ts:25:correctness";

    const sampleFindings: ReviewFinding[] = [
      {
        id: "f-1",
        file: "src/controller.ts",
        line: 25,
        category: "correctness",
        severity: "error",
        title: "Potential Null Dereference",
        body: "Check req.user before accessing id",
        confidence: 0.9,
        isInDiff: true,
      },
    ];

    // BEFORE FP feedback: full confidence (0.90)
    const initialRun = filterAndDeduplicateFindings(sampleFindings, {
      cwd,
      stateDir: tempStateDir,
    });
    console.log(`[Feedback E2E Test] Initial confidence: ${initialRun[0]?.confidence}`);
    expect(initialRun).toHaveLength(1);
    expect(initialRun[0]?.confidence).toBe(0.9);

    // AFTER 1 FP feedback: confidence discounted (0.90 * 0.80 = 0.72)
    recordFeedback(cwd, fingerprint, "correctness", "false_positive", tempStateDir);
    const afterOneFp = filterAndDeduplicateFindings(sampleFindings, {
      cwd,
      stateDir: tempStateDir,
    });
    console.log(`[Feedback E2E Test] After 1 FP confidence: ${afterOneFp[0]?.confidence}`);
    expect(afterOneFp).toHaveLength(1);
    expect(afterOneFp[0]?.confidence).toBeCloseTo(0.72);

    // AFTER 3 FPs feedback: discount factor 0.0 -> effective confidence 0.0 -> dropped below 0.60 threshold
    recordFeedback(cwd, fingerprint, "correctness", "false_positive", tempStateDir);
    recordFeedback(cwd, fingerprint, "correctness", "false_positive", tempStateDir);

    const afterThreeFps = filterAndDeduplicateFindings(sampleFindings, {
      cwd,
      stateDir: tempStateDir,
    });
    console.log(`[Feedback E2E Test] After 3 FPs findings count: ${afterThreeFps.length}`);
    expect(afterThreeFps).toHaveLength(0); // Finding is no longer present at all!
  });
});
