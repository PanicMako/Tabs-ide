import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import type { AuditFinding, AuditScanInput } from "@tabs/contracts";
import { executeAuditScan, calculateHealthScore } from "./AuditOrchestrationService.ts";
import { verifyFinding } from "./FindingVerifier.ts";
import { deduplicateAndRankFindings } from "./FindingDeduper.ts";
import { generateFixPlan } from "./SafeFixPlanner.ts";
import type { TokenBudgetedContextPack } from "@tabs/contracts";

describe("FindingVerifier (Stage 3 Disproof Agent)", () => {
  it("disproves null dereference finding when preceding lines contain explicit guard check", () => {
    const finding: AuditFinding = {
      id: "f-1",
      fingerprint: "fp-1",
      auditId: "audit-1",
      repoPath: "/repo",
      filePath: "src/order.ts",
      startLine: 10,
      endLine: 10,
      category: "correctness",
      severity: "warning",
      confidence: 0.8,
      title: "Potential Null Dereference in 'order' chain",
      explanation: "Unchecked access",
      evidenceSnippet: "order.customer.name()",
      sourceTool: "agent-correctness-pass",
      verificationState: "unverified",
    };

    const contextMap = new Map<string, TokenBudgetedContextPack>();
    contextMap.set("src/order.ts", {
      targetScope: "src/order.ts",
      packedChars: 100,
      budgetChars: 1000,
      estimatedTokens: 25,
      primaryFileContent: `function process(order) {\n  if (!order) return;\n  console.log("processing");\n  const name = order.customer.name();\n}`,
      symbolDefinitionsText: "",
      importedContextText: "",
      callerReferencesText: "",
      isComplete: true,
      coverageRatio: 1.0,
    });

    const verified = verifyFinding(finding, contextMap);

    expect(verified.verificationState).toBe("verified_disproven");
    expect(verified.disproofReason).toContain("Disproven: Found null check guard condition");
  });

  it("verifies finding when no guard condition exists", () => {
    const finding: AuditFinding = {
      id: "f-2",
      fingerprint: "fp-2",
      auditId: "audit-1",
      repoPath: "/repo",
      filePath: "src/order.ts",
      startLine: 5,
      endLine: 5,
      category: "correctness",
      severity: "warning",
      confidence: 0.8,
      title: "Potential Null Dereference in 'order' chain",
      explanation: "Unchecked access",
      evidenceSnippet: "order.customer.name()",
      sourceTool: "agent-correctness-pass",
      verificationState: "unverified",
    };

    const contextMap = new Map<string, TokenBudgetedContextPack>();
    contextMap.set("src/order.ts", {
      targetScope: "src/order.ts",
      packedChars: 100,
      budgetChars: 1000,
      estimatedTokens: 25,
      primaryFileContent: `function process(order) {\n  const name = order.customer.name();\n}`,
      symbolDefinitionsText: "",
      importedContextText: "",
      callerReferencesText: "",
      isComplete: true,
      coverageRatio: 1.0,
    });

    const verified = verifyFinding(finding, contextMap);
    expect(verified.verificationState).toBe("verified_passed");
  });
});

describe("FindingDeduper & Ranking", () => {
  it("deduplicates findings by fingerprint and ranks critical above warning", () => {
    const f1: AuditFinding = {
      id: "f-1",
      fingerprint: "same-fp",
      auditId: "audit-1",
      repoPath: "/repo",
      filePath: "src/app.ts",
      startLine: 1,
      endLine: 1,
      category: "security",
      severity: "warning",
      confidence: 0.7,
      title: "Issue",
      explanation: "Low conf",
      evidenceSnippet: "code",
      sourceTool: "tool-a",
      verificationState: "verified_passed",
    };

    const f2: AuditFinding = {
      id: "f-2",
      fingerprint: "same-fp",
      auditId: "audit-1",
      repoPath: "/repo",
      filePath: "src/app.ts",
      startLine: 1,
      endLine: 1,
      category: "security",
      severity: "critical",
      confidence: 0.95,
      title: "Issue",
      explanation: "High conf critical",
      evidenceSnippet: "code",
      sourceTool: "tool-b",
      verificationState: "verified_passed",
    };

    const result = deduplicateAndRankFindings([f1, f2], { repoPath: "/repo" });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("f-2");
    expect(result[0]?.severity).toBe("critical");
  });
});

describe("SafeFixPlanner", () => {
  it("generates a previewable unified diff patch for unawaited async call", () => {
    const finding: AuditFinding = {
      id: "f-async",
      fingerprint: "fp-async",
      auditId: "audit-1",
      repoPath: "/repo",
      filePath: "src/api.ts",
      startLine: 2,
      endLine: 2,
      category: "correctness",
      severity: "warning",
      confidence: 0.8,
      title: "Unawaited Async Promise Execution",
      explanation: "Unawaited promise",
      evidenceSnippet: "fetch('/data');",
      sourceTool: "agent-correctness-pass",
      verificationState: "verified_passed",
    };

    const contextMap = new Map<string, TokenBudgetedContextPack>();
    contextMap.set("src/api.ts", {
      targetScope: "src/api.ts",
      packedChars: 100,
      budgetChars: 1000,
      estimatedTokens: 25,
      primaryFileContent: `function getData() {\n  fetch('/data');\n}`,
      symbolDefinitionsText: "",
      importedContextText: "",
      callerReferencesText: "",
      isComplete: true,
      coverageRatio: 1.0,
    });

    const fixPlan = generateFixPlan(finding, contextMap);

    expect(fixPlan).toBeDefined();
    expect(fixPlan?.replacementPatch).toContain("+  await fetch('/data');");
    expect(fixPlan?.isAutomatedSafe).toBe(true);
  });
});

describe("AuditOrchestrationService End-to-End Execution", () => {
  it("executes full audit scan and calculates repository health score", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "orchestrator-test-"));
    const srcDir = path.join(tempDir, "src");
    await fs.mkdir(srcDir, { recursive: true });

    await fs.writeFile(
      path.join(srcDir, "vulnerable.ts"),
      `
export function badEval(code: string) {
  eval(code);
}
export function asyncCall() {
  fetch('/data');
}
`,
    );

    const scanInput: AuditScanInput = {
      cwd: tempDir,
      scope: { kind: "full_repository" },
      depth: "standard",
    };

    const scanResult = await executeAuditScan(scanInput);

    expect(scanResult.summary.auditId).toBeDefined();
    expect(scanResult.summary.filesInspected).toBeGreaterThan(0);
    expect(scanResult.findings.length).toBeGreaterThan(0);

    const health = calculateHealthScore(scanResult.findings);
    expect(health).toBeLessThan(100);

    await fs.rm(tempDir, { recursive: true, force: true });
  });
});
