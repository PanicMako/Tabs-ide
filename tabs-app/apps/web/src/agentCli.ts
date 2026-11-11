/**
 * Agent CLI launch planning for the CLI mode of the companion panel.
 *
 * The GUI conversation in the sidebar talks to a provider through Tabs'
 * orchestrator; CLI mode runs that same provider's own command-line agent in
 * a real terminal in the thread's working tree, with the provider instance's
 * environment (accounts, CODEX_HOME, Claude config dir) applied by the server.
 *
 * Everything here is pure so the command lines can be unit tested.
 */
import type {
  OrchestrationV2ThreadProjection,
  ProviderDriverKind,
  ServerProvider,
  ServerSettings,
} from "@tabs/contracts";

interface AgentCliDefinition {
  /** Executable used when the instance has no binary path configured. */
  readonly binary: string;
  /** Flag that selects a model, when the CLI understands Tabs' model slugs. */
  readonly modelFlag?: string;
  /**
   * Arguments that start a *fork* of an existing native session. Forking (not
   * resuming) keeps the CLI from writing into the session Tabs itself drives.
   */
  readonly forkArgs?: (sessionId: string) => ReadonlyArray<string>;
}

const AGENT_CLIS: Readonly<Record<string, AgentCliDefinition>> = {
  claudeAgent: {
    binary: "claude",
    modelFlag: "--model",
    forkArgs: (sessionId) => ["--resume", sessionId, "--fork-session"],
  },
  codex: {
    binary: "codex",
    modelFlag: "-m",
    forkArgs: (sessionId) => ["fork", sessionId],
  },
  cursor: { binary: "cursor-agent" },
  copilot: { binary: "copilot" },
  grok: { binary: "grok" },
  opencode: { binary: "opencode" },
  droid: { binary: "droid" },
  pi: { binary: "pi" },
  kilo: { binary: "kilo" },
};

export function agentCliSupportsDriver(driver: string): boolean {
  return driver in AGENT_CLIS;
}

export function agentCliSupportsFork(driver: string): boolean {
  return AGENT_CLIS[driver]?.forkArgs !== undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POSIX-quote one argument, leaving plain words readable in the terminal. */
export function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The executable for a provider instance: the instance's configured binary
 * path, then the legacy per-driver setting (default instances only), then the
 * CLI's usual name on PATH.
 */
export function resolveAgentCliBinary(input: {
  driver: string;
  instanceId: string;
  settings: Pick<ServerSettings, "providerInstances" | "providers"> | null | undefined;
}): string | null {
  const definition = AGENT_CLIS[input.driver];
  if (!definition) return null;
  const instanceConfig = input.settings?.providerInstances?.[
    input.instanceId as keyof ServerSettings["providerInstances"]
  ]?.config as { binaryPath?: unknown } | undefined;
  if (typeof instanceConfig?.binaryPath === "string" && instanceConfig.binaryPath.trim())
    return instanceConfig.binaryPath.trim();
  if (input.instanceId === input.driver) {
    const legacy = (
      input.settings?.providers as Record<string, { binaryPath?: unknown }> | undefined
    )?.[input.driver];
    if (typeof legacy?.binaryPath === "string" && legacy.binaryPath.trim())
      return legacy.binaryPath.trim();
  }
  return definition.binary;
}

export interface AgentCliLaunch {
  readonly command: string;
  /** True when the command continues an existing conversation as a fork. */
  readonly forked: boolean;
}

export function buildAgentCliCommand(input: {
  driver: string;
  binary: string;
  model?: string | null | undefined;
  /** Native session to fork from; ignored for CLIs that cannot fork. */
  forkFromSessionId?: string | null | undefined;
}): AgentCliLaunch | null {
  const definition = AGENT_CLIS[input.driver];
  if (!definition) return null;
  const args: string[] = [];
  const forkId = input.forkFromSessionId?.trim();
  const forked = Boolean(forkId && definition.forkArgs);
  if (forkId && definition.forkArgs) args.push(...definition.forkArgs(forkId));
  const model = input.model?.trim();
  if (model && definition.modelFlag) args.push(definition.modelFlag, model);
  return {
    command: [input.binary, ...args].map(quoteShellArg).join(" "),
    forked,
  };
}

/**
 * The native session id of the provider conversation behind a Tabs thread,
 * if the provider has started one. Pending placeholders are ignored.
 */
export function findNativeSessionId(
  projection: Pick<OrchestrationV2ThreadProjection, "providerThreads">,
  input: { threadId: string; driver: string },
): string | null {
  const candidates = projection.providerThreads
    .filter(
      (thread) =>
        thread.appThreadId === input.threadId &&
        thread.driver === input.driver &&
        thread.nativeThreadRef?.strength !== "none" &&
        typeof thread.nativeThreadRef?.nativeId === "string" &&
        UUID_PATTERN.test(thread.nativeThreadRef.nativeId),
    )
    .toSorted((left, right) => (right.lastRunOrdinal ?? 0) - (left.lastRunOrdinal ?? 0));
  return candidates[0]?.nativeThreadRef?.nativeId ?? null;
}

export interface AgentCliOption {
  readonly instanceId: string;
  readonly driver: ProviderDriverKind;
  readonly label: string;
}

/** Enabled, installed provider instances that have a CLI Tabs can launch. */
export function listAgentCliOptions(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<AgentCliOption> {
  return providers
    .filter(
      (provider) =>
        provider.enabled && provider.installed && agentCliSupportsDriver(provider.driver),
    )
    .map((provider) => ({
      instanceId: provider.instanceId,
      driver: provider.driver,
      label: provider.displayName ?? provider.driver,
    }));
}
