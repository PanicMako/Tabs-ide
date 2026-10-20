import * as OS from "node:os";
import { Effect, Path } from "effect";
import { readPathFromLoginShell } from "@tabs/shared/shell";

export function fixPath(): void {
  // The desktop parent already resolved PATH/SSH_AUTH_SOCK before spawning us.
  // Re-running an interactive login shell here serializes another full shell boot.
  if (process.platform !== "darwin" || process.env.TABS_DESKTOP_SHELL_ENV_READY === "1") return;

  try {
    const shell = process.env.SHELL ?? "/bin/zsh";
    const result = readPathFromLoginShell(shell);
    if (result) {
      process.env.PATH = result;
    }
  } catch {
    // Silently ignore — keep default PATH
  }
}

export const expandHomePath = Effect.fn(function* (input: string) {
  const { join } = yield* Path.Path;
  if (input === "~") {
    return OS.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return join(OS.homedir(), input.slice(2));
  }
  return input;
});

export const resolveBaseDir = Effect.fn(function* (raw: string | undefined) {
  const { join, resolve } = yield* Path.Path;
  if (!raw || raw.trim().length === 0) {
    return join(OS.homedir(), ".tabs");
  }
  return resolve(yield* expandHomePath(raw.trim()));
});

export function hydratePosixHome(
  env: NodeJS.ProcessEnv,
  homedirResolver: () => string = () => OS.userInfo().homedir,
): void {
  if (typeof env.HOME === "string" && env.HOME.trim().length > 0) {
    return;
  }
  try {
    env.HOME = homedirResolver();
  } catch {
    // ignore
  }
}
