/**
 * Unit tests for ReviewPassRunner and VerificationFilter — Phase 3.
 */

import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import type { ReviewFinding } from "@tabs/contracts";
import {
  filterAndDeduplicateFindings,
  getFindingFingerprint,
  MIN_CONFIDENCE_THRESHOLD,
} from "./VerificationFilter";
import {
  estimateReviewCost,
  resolvePassesToRun,
  runReviewPasses,
  DEFAULT_REVIEW_PASSES,
} from "./ReviewPassRunner";

describe("VerificationFilter", () => {
  it("generates consistent fingerprints", () => {
    const f1 = getFindingFingerprint({ file: "./src/auth.ts", line: 42, category: "Security" });
    const f2 = getFindingFingerprint({ file: "src/auth.ts", line: 42, category: "security" });
    expect(f1).toBe("src/auth.ts:42:security");
    expect(f2).toBe("src/auth.ts:42:security");
  });

  it("filters out findings where isInDiff is false", () => {
    const raw: ReviewFinding[] = [
      {
        id: "1",
        file: "src/a.ts",
        line: 10,
        category: "correctness",
        severity: "error",
        title: "Bug inside diff",
        body: "Inside diff",
        confidence: 0.9,
        isInDiff: true,
      },
      {
        id: "2",
        file: "src/a.ts",
        line: 50,
        category: "correctness",
        severity: "warning",
        title: "Bug outside diff",
        body: "Outside diff",
        confidence: 0.9,
        isInDiff: false,
      },
    ];

    const filtered = filterAndDeduplicateFindings(raw);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("1");
  });

  it("filters out low confidence findings below threshold (0.60)", () => {
    const raw: ReviewFinding[] = [
      {
        id: "1",
        file: "src/a.ts",
        line: 10,
        category: "correctness",
        severity: "error",
        title: "High confidence bug",
        body: "Good finding",
        confidence: 0.85,
        isInDiff: true,
      },
      {
        id: "2",
        file: "src/a.ts",
        line: 20,
        category: "security",
        severity: "warning",
        title: "Low confidence noise",
        body: "Maybe bug",
        confidence: 0.4,
        isInDiff: true,
      },
    ];

    const filtered = filterAndDeduplicateFindings(raw);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("1");
  });

  it("deduplicates findings with the same fingerprint, retaining the highest confidence", () => {
    const raw: ReviewFinding[] = [
      {
        id: "1",
        file: "src/a.ts",
        line: 10,
        category: "security",
        severity: "error",
        title: "SQL injection (pass 1)",
        body: "Lower confidence match",
        confidence: 0.7,
        isInDiff: true,
      },
      {
        id: "2",
        file: "src/a.ts",
        line: 10,
        category: "security",
        severity: "error",
        title: "SQL injection (pass 2)",
        body: "Higher confidence match",
        confidence: 0.95,
        isInDiff: true,
      },
    ];

    const filtered = filterAndDeduplicateFindings(raw);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("2");
    expect(filtered[0]?.confidence).toBe(0.95);
  });
});

describe("ReviewPassRunner", () => {
  it("defaults to 2 passes ceiling (correctness, security) unless explicitly configured", () => {
    const defaultPasses = resolvePassesToRun(undefined);
    expect(defaultPasses).toEqual(["correctness", "security"]);

    const customPasses = resolvePassesToRun(["correctness", "security", "api_compatibility"]);
    expect(customPasses).toEqual(["correctness", "security", "api_compatibility"]);
  });

  it("emits onCostPreview callback before any pass fires", async () => {
    const costEvents: Array<{ estimatedPassCount: number; estimatedInputTokens: number }> = [];

    const mockTextGen: any = {
      generateDiffSummary: () =>
        Effect.succeed({
          summary: "Pass finished.",
          keyChanges: "- Updated code",
          notesAndRisk: "",
          findings: [],
        }),
    };

    const program = runReviewPasses(
      {
        cwd: "/tmp",
        diffSummary: "1 file changed",
        diffPatch: "diff --git a/a.ts b/a.ts\n+const x = 1;",
        modelSelection: { instanceId: "gemini" as any, model: "gemini-3.6-flash" },
        onCostPreview: (preview) =>
          Effect.sync(() => {
            costEvents.push(preview);
          }),
      },
      mockTextGen,
    );

    const result = await Effect.runPromise(program);

    expect(costEvents).toHaveLength(1);
    expect(costEvents[0]?.estimatedPassCount).toBe(2);
    expect(costEvents[0]?.estimatedInputTokens).toBeGreaterThan(0);
    expect(result.passesRun).toEqual(["correctness", "security"]);
  });
});
