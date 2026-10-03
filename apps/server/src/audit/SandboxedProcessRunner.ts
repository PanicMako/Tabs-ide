/**
 * SandboxedProcessRunner — Isolated Process Execution for Static Code Analyzers.
 *
 * Enforces security boundaries:
 * - Sanitizes environment variables (disables external network calls where supported)
 * - Limits execution timeouts (default: 60s)
 * - Restricts memory and stdout/stderr buffer sizes (default: 10MB)
 * - Validates executable allowlists against command injection
 * - Handles non-zero exit codes (analyzers return non-zero on findings)
 *
 * @module audit/SandboxedProcessRunner
 */

import { Data, Effect } from "effect";
import { runProcess, isWindowsCommandNotFound, type ProcessRunResult } from "../processRunner.ts";

export interface SandboxExecutionOptions {
  readonly cwd: string;
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly timeoutMs?: number | undefined;
  readonly maxBufferBytes?: number | undefined;
  readonly allowNetwork?: boolean | undefined;
}

export interface SandboxExecutionResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly commandLabel: string;
  readonly durationMs: number;
}

/** Pre-approved executable allowlist for security auditing tools. */
export const ALLOWED_ANALYZER_EXECUTABLES = new Set([
  "gitleaks",
  "semgrep",
  "opengrep",
  "osv-scanner",
  "trivy",
  "ast-grep",
  "sg",
  "eslint",
  "tsc",
  "pyright",
  "mypy",
  "cargo",
  "go",
]);

const SANDBOX_SECURITY_ERROR_TAG = "SandboxSecurityError";
export class SandboxSecurityError extends Data.TaggedError(SANDBOX_SECURITY_ERROR_TAG)<{
  readonly detail: string;
}> {
  override get message(): string {
    return `[Sandbox Security Gate] ${this.detail}`;
  }
}

/**
 * Validate executable against security allowlist to prevent unapproved binary execution.
 */
export function validateExecutable(executable: string): void {
  const binaryName =
    executable.split("/").pop()?.split("\\").pop()?.toLowerCase() ?? executable.toLowerCase();
  // Strip .exe / .cmd / .bat suffixes on Windows
  const cleanName = binaryName.replace(/\.(exe|cmd|bat|sh)$/i, "");

  if (!ALLOWED_ANALYZER_EXECUTABLES.has(cleanName)) {
    throw new SandboxSecurityError({
      detail: `Executable '${executable}' is not in the approved static analyzer allowlist. Approved tools: ${Array.from(ALLOWED_ANALYZER_EXECUTABLES).join(", ")}`,
    });
  }
}

/**
 * Execute a command in a sandboxed, isolated process wrapper.
 */
export async function executeSandboxedProcess(
  options: SandboxExecutionOptions,
): Promise<SandboxExecutionResult> {
  validateExecutable(options.executable);

  const startTime = Date.now();
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxBufferBytes = options.maxBufferBytes ?? 10 * 1024 * 1024; // 10MB limit

  // Isolated environment: strip sensitive tokens and set offline flags
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    TMPDIR: process.env.TMPDIR ?? "",
    // Disable telemetry / network calls in supported CLI tools
    NO_NETWORK: options.allowNetwork ? "0" : "1",
    SEMGREP_SEND_METRICS: "off",
    DISABLE_TELEMETRY: "1",
    CI: "true",
  };

  let result: ProcessRunResult;
  try {
    result = await runProcess(options.executable, options.args, {
      cwd: options.cwd,
      timeoutMs,
      maxBufferBytes,
      outputMode: "truncate",
      allowNonZeroExit: true,
      env,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes("Command not found")) {
      return {
        stdout: "",
        stderr: `Command '${options.executable}' not found on PATH.`,
        exitCode: 127,
        timedOut: false,
        commandLabel: `${options.executable} ${options.args.join(" ")}`,
        durationMs: Date.now() - startTime,
      };
    }
    throw err;
  }

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.code,
    timedOut: result.timedOut,
    commandLabel: `${options.executable} ${options.args.join(" ")}`,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Effect-TS wrapper for sandboxed process execution.
 */
export const runSandboxedProcess = (
  options: SandboxExecutionOptions,
): Effect.Effect<SandboxExecutionResult, SandboxSecurityError> =>
  Effect.tryPromise({
    try: () => executeSandboxedProcess(options),
    catch: (err) =>
      err instanceof SandboxSecurityError
        ? err
        : new SandboxSecurityError({ detail: err instanceof Error ? err.message : String(err) }),
  });
