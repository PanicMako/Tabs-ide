import * as FS from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const TIMEOUT_MS = 5_000;

/** Git receives only an authoritative project root and fixed read-only arguments. */
export async function readExtensionGitStatus(
  workspaceRoot: string,
): Promise<{ readonly branch: string; readonly dirty: boolean }> {
  const root = await FS.realpath(workspaceRoot);
  if (!(await FS.stat(root)).isDirectory()) throw new Error("Project root is not a directory.");
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? (process.platform === "win32" ? "" : "/usr/bin:/bin"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_OPTIONAL_LOCKS: "0",
  };
  if (process.env.SystemRoot) environment.SystemRoot = process.env.SystemRoot;
  const options = {
    cwd: root,
    env: environment,
    timeout: TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  };
  const fixed = [
    "-c",
    "core.fsmonitor=false",
    "-c",
    `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
    "-C",
    root,
  ];
  const [branch, status] = await Promise.all([
    execute("git", [...fixed, "symbolic-ref", "--quiet", "--short", "HEAD"], options).catch(
      (error: unknown) => {
        if ((error as { code?: unknown }).code === 1) return { stdout: "HEAD" };
        throw error;
      },
    ),
    execute(
      "git",
      [...fixed, "status", "--porcelain=v1", "--untracked-files=normal", "--", "."],
      options,
    ),
  ]);
  const name = branch.stdout.trim();
  if (!name || name.length > 200 || name.includes("\0") || name.includes("\n")) {
    throw new Error("Invalid Git branch name.");
  }
  return { branch: name, dirty: status.stdout.length > 0 };
}
