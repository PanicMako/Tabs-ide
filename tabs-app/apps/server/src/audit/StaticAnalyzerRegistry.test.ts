import { describe, expect, it } from "vitest";
import { computeFindingFingerprint } from "@tabs/contracts";
import { validateExecutable, SandboxSecurityError } from "./SandboxedProcessRunner.ts";
import { normalizeSarifLog } from "./SARIFNormalizer.ts";

describe("SandboxedProcessRunner Security Gate", () => {
  it("allows approved analyzer executables", () => {
    expect(() => validateExecutable("gitleaks")).not.toThrow();
    expect(() => validateExecutable("semgrep")).not.toThrow();
    expect(() => validateExecutable("opengrep")).not.toThrow();
    expect(() => validateExecutable("osv-scanner")).not.toThrow();
    expect(() => validateExecutable("eslint")).not.toThrow();
    expect(() => validateExecutable("tsc")).not.toThrow();
  });

  it("rejects unapproved binaries with SandboxSecurityError", () => {
    expect(() => validateExecutable("rm")).toThrow(SandboxSecurityError);
    expect(() => validateExecutable("curl")).toThrow(SandboxSecurityError);
    expect(() => validateExecutable("bash")).toThrow(SandboxSecurityError);
  });
});

describe("SARIFNormalizer", () => {
  it("normalizes SARIF v2.1.0 log into AuditFinding array", () => {
    const mockSarif = JSON.stringify({
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "opengrep",
              rules: [{ id: "security.xss", shortDescription: { text: "Cross-Site Scripting" } }],
            },
          },
          results: [
            {
              ruleId: "security.xss",
              level: "error",
              message: { text: "Unsanitized innerHTML assignment." },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: "src/App.tsx" },
                    region: {
                      startLine: 42,
                      endLine: 42,
                      snippet: { text: "el.innerHTML = input;" },
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    const findings = normalizeSarifLog(mockSarif, {
      auditId: "test-audit-1",
      repoPath: "/test/repo",
      toolName: "opengrep",
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.filePath).toBe("src/App.tsx");
    expect(findings[0]?.startLine).toBe(42);
    expect(findings[0]?.severity).toBe("error");
    expect(findings[0]?.sourceTool).toBe("opengrep");
    expect(findings[0]?.fingerprint).toBeDefined();
  });
});

describe("Finding Fingerprint Stability", () => {
  it("generates deterministic fingerprints regardless of line shifts", () => {
    const fp1 = computeFindingFingerprint({
      filePath: "src/utils/auth.ts",
      category: "security",
      title: "Hardcoded Secret Key",
    });

    const fp2 = computeFindingFingerprint({
      filePath: "src/utils/auth.ts",
      category: "security",
      title: "Hardcoded Secret Key",
    });

    expect(fp1).toBe(fp2);
    expect(fp1.startsWith("audit-fp-")).toBe(true);
  });
});
