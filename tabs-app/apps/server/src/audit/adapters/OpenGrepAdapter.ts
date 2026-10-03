/**
 * OpenGrepAdapter — AST Pattern & SAST Static Analyzer Adapter.
 *
 * Runs `opengrep scan --sarif` or `semgrep scan --sarif` in a sandboxed process.
 *
 * @module audit/adapters/OpenGrepAdapter
 */

import type { AuditFinding } from "@tabs/contracts";
import { executeSandboxedProcess } from "../SandboxedProcessRunner.ts";
import { normalizeSarifLog } from "../SARIFNormalizer.ts";

export async function runOpenGrepScan(
  cwd: string,
  auditId: string,
): Promise<{
  readonly findings: ReadonlyArray<AuditFinding>;
  readonly skippedReason?: string | undefined;
}> {
  // Try opengrep first, fallback to semgrep
  let executable = "opengrep";
  let result = await executeSandboxedProcess({
    cwd,
    executable,
    args: ["scan", "--sarif", "--quiet", "."],
    timeoutMs: 60_000,
  });

  if (result.exitCode === 127 || result.stderr.includes("not found")) {
    executable = "semgrep";
    result = await executeSandboxedProcess({
      cwd,
      executable,
      args: ["scan", "--sarif", "--quiet", "."],
      timeoutMs: 60_000,
    });
  }

  if (result.exitCode === 127 || result.stderr.includes("not found")) {
    return {
      findings: [],
      skippedReason: "Neither OpenGrep nor Semgrep installed on PATH — skipping SAST scan.",
    };
  }

  const rawJson = result.stdout.trim();
  if (!rawJson) return { findings: [] };

  const findings = normalizeSarifLog(rawJson, {
    auditId,
    repoPath: cwd,
    toolName: executable,
    defaultCategory: "security",
  });

  return { findings };
}
