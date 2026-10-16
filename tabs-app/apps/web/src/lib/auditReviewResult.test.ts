import { describe, expect, it } from "vitest";
import { auditReviewResult } from "./auditReviewResult";

describe("audit review result", () => {
  it("preserves real findings and does not invent successful verification", () => {
    const result = auditReviewResult(
      {
        summary: "A real issue",
        keyChanges: "",
        notesAndRisk: "",
        findings: [
          {
            id: "finding-1",
            file: "src/app.ts",
            line: 12,
            category: "security",
            severity: "error",
            title: "Unsafe input",
            body: "Details",
            confidence: 0.8,
            isInDiff: true,
          },
        ],
        passesRun: ["security"],
        wasTruncated: false,
        filesInspected: 3,
      },
      "/repo",
      Date.now() - 100,
    );
    expect(result.summary.totalFindings).toBe(1);
    expect(result.summary.filesInspected).toBe(3);
    expect(result.summary.healthScore).toBeLessThan(100);
    expect(result.findings[0]).toMatchObject({
      filePath: "src/app.ts",
      startLine: 12,
      explanation: "Details",
      verificationState: "unverified",
      sourceTool: "ai-review",
    });
  });
});
