import { describe, expect, it } from "vitest";
import { applyDesktopShellEnvironment } from "./desktopShellEnvironment.ts";

describe("desktop shell environment", () => {
  it("hydrates provider PATH and SSH after the bootstrap pipe arrives", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
    applyDesktopShellEnvironment({ PATH: "/tools/bin:/usr/bin", SSH_AUTH_SOCK: "/agent" }, env);
    expect(env).toEqual({
      PATH: "/tools/bin:/usr/bin",
      SSH_AUTH_SOCK: "/agent",
      TABS_DESKTOP_SHELL_ENV_READY: "1",
    });
  });

  it("keeps the inherited SSH agent and copies no unrelated environment fields", () => {
    const env: NodeJS.ProcessEnv = { SSH_AUTH_SOCK: "/inherited" };
    const shell = { PATH: "/tools/bin", SSH_AUTH_SOCK: "/shell-agent", NODE_OPTIONS: "ignored" };
    applyDesktopShellEnvironment(shell, env);
    expect(env.SSH_AUTH_SOCK).toBe("/inherited");
    expect(env.NODE_OPTIONS).toBeUndefined();
  });

  it("retains the backend fallback if the parent did not resolve its shell", () => {
    const env = { PATH: "/usr/bin" };
    applyDesktopShellEnvironment(undefined, env);
    expect(env).toEqual({ PATH: "/usr/bin" });
  });
});
