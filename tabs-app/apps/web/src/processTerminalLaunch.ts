import { projectScriptRuntimeEnv } from "./projectScripts";

/**
 * Where and with what environment a Dock preset / process terminal starts.
 *
 * Both the code that runs a preset and every view that shows its terminal open
 * the same server session. The server restarts a session whose cwd or env
 * changes between opens — killing the commands just typed into it — so they
 * must all derive the launch context from this one function.
 */
export function processTerminalLaunch(input: {
  projectCwd: string;
  process: { readonly cwd: string; readonly env?: Readonly<Record<string, string>> | undefined };
}): { cwd: string; env: Record<string, string> } {
  const cwd = input.process.cwd.trim().length > 0 ? input.process.cwd : input.projectCwd;
  const extraEnv = input.process.env ?? {};
  return {
    cwd,
    env: projectScriptRuntimeEnv({
      project: { cwd: input.projectCwd },
      worktreePath: null,
      ...(Object.keys(extraEnv).length > 0 ? { extraEnv: { ...extraEnv } } : {}),
    }),
  };
}
