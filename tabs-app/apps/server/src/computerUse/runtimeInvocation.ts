import type { ComputerRequest } from "./commands.ts";
import { JXA_RUNTIME } from "./jxaScript.ts";
import { LINUX_RUNTIME } from "./linuxRuntime.ts";
import { BLOCKED_APP_FRAGMENTS, SENSITIVE_LABEL_SOURCE } from "./sensitive.ts";

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
 * Every platform runs a script with no compile step and reads the same request JSON. Each runtime
 * reads it from the environment so text never appears in a command line. Windows receives its hash-verified script from
 * the on-demand runtime cache through stdin.
 */
export function buildRuntimeInvocation(
  platform: NodeJS.Platform,
  request: ComputerRequest,
  windowsRuntime?: string,
): RuntimeInvocation {
  const json = JSON.stringify(request);
  if (platform === "darwin") {
    return {
      command: "osascript",
      args: ["-l", "JavaScript", "-"],
      stdin: JXA_RUNTIME,
      env: { [REQUEST_ENV]: json },
    };
  }
  if (platform === "win32") {
    if (windowsRuntime === undefined) {
      throw new Error("The Windows computer-use runtime has not been installed.");
    }
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-Command", "-"],
      stdin: windowsRuntime,
      env: {
        [REQUEST_ENV]: json,
        TABS_COMPUTER_USE_SENSITIVE_PATTERN: SENSITIVE_LABEL_SOURCE,
        TABS_COMPUTER_USE_BLOCKED_APPS: JSON.stringify(BLOCKED_APP_FRAGMENTS),
      },
    };
  }
  return { command: "python3", args: ["-"], stdin: LINUX_RUNTIME, env: { [REQUEST_ENV]: json } };
}

/** Longest a single runtime call may run; `wait` polls in the service instead of inside a script. */
export const RUNTIME_TIMEOUT_MS = 25_000;
