import {
  readEnvironmentFromLoginShellAsync,
  AsyncShellEnvironmentReader,
} from "@tabs/shared/shell";

export async function syncShellEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  options: {
    platform?: NodeJS.Platform;
    readEnvironment?: AsyncShellEnvironmentReader;
  } = {},
): Promise<boolean> {
  if ((options.platform ?? process.platform) !== "darwin") return true;

  try {
    const shell = env.SHELL ?? "/bin/zsh";
    const shellEnvironment = await (options.readEnvironment ?? readEnvironmentFromLoginShellAsync)(
      shell,
      ["PATH", "SSH_AUTH_SOCK"],
    );

    if (shellEnvironment.PATH) {
      env.PATH = shellEnvironment.PATH;
    }

    if (!env.SSH_AUTH_SOCK && shellEnvironment.SSH_AUTH_SOCK) {
      env.SSH_AUTH_SOCK = shellEnvironment.SSH_AUTH_SOCK;
    }
    return Boolean(shellEnvironment.PATH);
  } catch {
    // Keep inherited environment if shell lookup fails.
    return false;
  }
}
