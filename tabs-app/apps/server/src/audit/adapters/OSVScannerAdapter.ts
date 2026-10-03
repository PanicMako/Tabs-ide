/**
 * OSVScannerAdapter — Dependency Vulnerability Scanner Tool Adapter.
 *
 * Runs `osv-scanner --format json -r .` in a sandboxed process to audit lockfiles.
 *
 * @module audit/adapters/OSVScannerAdapter
 */

import type { AuditFinding } from "@tabs/contracts";
import { computeFindingFingerprint } from "@tabs/contracts";
import { executeSandboxedProcess } from "../SandboxedProcessRunner.ts";

export interface OSVResult {
  readonly package: { readonly name: string; readonly version: string; readonly ecosystem: string };
  readonly vulnerabilities: ReadonlyArray<{
    readonly id: string;
    readonly summary?: string;
    readonly details?: string;
    readonly aliases?: ReadonlyArray<string>;
  }>;
}

export async function runOSVScanner(
  cwd: string,
  auditId: string,
): Promise<{
  readonly findings: ReadonlyArray<AuditFinding>;
  readonly skippedReason?: string | undefined;
}> {
  const result = await executeSandboxedProcess({
    cwd,
    executable: "osv-scanner",
    args: ["--format", "json", "-r", "."],
    timeoutMs: 60_000,
  });

  if (result.exitCode === 127 || result.stderr.includes("not found")) {
    return {
      findings: [],
      skippedReason: "OSV-Scanner not installed on PATH — skipping dependency vulnerability audit.",
    };
  }

  const rawJson = result.stdout.trim();
  if (!rawJson) return { findings: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { findings: [] };
  }

  if (typeof parsed !== "object" || parsed === null) return { findings: [] };
  const obj = parsed as Record<string, unknown>;
  const resultsArray = Array.isArray(obj["results"]) ? obj["results"] : [];

  const findings: AuditFinding[] = [];
  let idx = 0;

  for (const resItem of resultsArray) {
    if (typeof resItem !== "object" || resItem === null) continue;
    const itemObj = resItem as Record<string, unknown>;
    const sourceObj =
      typeof itemObj["source"] === "object" && itemObj["source"] !== null
        ? (itemObj["source"] as Record<string, unknown>)
        : {};
    const lockfilePath =
      typeof sourceObj["path"] === "string"
        ? sourceObj["path"].replace(cwd, "").replace(/^\//, "")
        : "package.json";

    const packages = Array.isArray(itemObj["packages"]) ? itemObj["packages"] : [];

    for (const pkgItem of packages) {
      if (typeof pkgItem !== "object" || pkgItem === null) continue;
      const pkg = pkgItem as Record<string, unknown>;
      const pkgInfo = (pkg["package"] as Record<string, string>) ?? {};
      const pkgName = pkgInfo["name"] ?? "unknown-pkg";
      const pkgVersion = pkgInfo["version"] ?? "";
      const vulns = Array.isArray(pkg["vulnerabilities"]) ? pkg["vulnerabilities"] : [];

      for (const vuln of vulns) {
        if (typeof vuln !== "object" || vuln === null) continue;
        const v = vuln as Record<string, unknown>;
        const cveId = typeof v["id"] === "string" ? v["id"] : "CVE-UNKNOWN";
        const summary =
          typeof v["summary"] === "string"
            ? v["summary"]
            : `Vulnerability ${cveId} in ${pkgName}@${pkgVersion}`;

        const title = `Dependency CVE: ${cveId} (${pkgName}@${pkgVersion})`;
        const fingerprint = computeFindingFingerprint({
          filePath: lockfilePath,
          category: "dependency_secret",
          title,
        });

        findings.push({
          id: `${auditId}-osv-${idx++}`,
          fingerprint,
          auditId,
          repoPath: cwd,
          filePath: lockfilePath,
          startLine: 1,
          endLine: 1,
          category: "dependency_secret",
          severity: "error",
          confidence: 0.99,
          title,
          explanation: `${summary}. Package ${pkgName} (${pkgInfo["ecosystem"] ?? "npm"}) version ${pkgVersion} contains known vulnerability ${cveId}.`,
          evidenceSnippet: `"${pkgName}": "${pkgVersion}"`,
          sourceTool: "osv-scanner",
          ruleId: cveId,
          verificationState: "verified_passed",
        });
      }
    }
  }

  return { findings };
}
