import type { DesktopBackendBootstrap } from "@tabs/contracts";

/** Apply only the login-shell fields from the trusted desktop bootstrap pipe. */
export function applyDesktopShellEnvironment(
  environment: DesktopBackendBootstrap["shellEnvironment"],
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!environment?.PATH) return;
  env.PATH = environment.PATH;
  if (!env.SSH_AUTH_SOCK && environment.SSH_AUTH_SOCK) {
    env.SSH_AUTH_SOCK = environment.SSH_AUTH_SOCK;
  }
  env.TABS_DESKTOP_SHELL_ENV_READY = "1";
}
