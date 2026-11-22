import type { ComputerRequest } from "./commands.ts";
import { JXA_RUNTIME } from "./jxaScript.ts";
import { LINUX_RUNTIME } from "./linuxRuntime.ts";
import { WINDOWS_RUNTIME } from "./windowsRuntime.ts";

/** How to start the script runtime for one request on one platform. */
export interface RuntimeInvocation {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly stdin: string;
  readonly env: Readonly<Record<string, string>>;
}

export const REQUEST_ENV = "COMPUTER_USE_REQUEST";

export function runtimePlatformSupported(platform: NodeJS.Platform): boolean {
  return platform === "darwin" || platform === "win32" || platform === "linux";
}

/**
 * Every platform runs a script with no compile step and reads the same request JSON. macOS passes
 * it as an argument to JXA's run(); Windows and Linux read it from the environment so it never
 * touches a command line another user could list.
 */
export function buildRuntimeInvocation(
  platform: NodeJS.Platform,
  request: ComputerRequest,
): RuntimeInvocation {
  const json = JSON.stringify(request);
  if (platform === "darwin") {
    return {
      command: "osascript",
      args: ["-l", "JavaScript", "-", json],
      stdin: JXA_RUNTIME,
      env: {},
    };
  }
  if (platform === "win32") {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "-"],
      stdin: WINDOWS_RUNTIME,
      env: { [REQUEST_ENV]: json },
    };
  }
  return { command: "python3", args: ["-"], stdin: LINUX_RUNTIME, env: { [REQUEST_ENV]: json } };
}

/** Longest a single runtime call may run; `wait` polls in the service instead of inside a script. */
export const RUNTIME_TIMEOUT_MS = 25_000;
