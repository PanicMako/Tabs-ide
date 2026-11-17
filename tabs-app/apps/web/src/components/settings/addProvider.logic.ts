import type { ProviderInstanceConfig } from "@tabs/contracts";

const INSTANCE_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const INSTANCE_ID_MAX = 64;

/** Providers whose second account needs its own login folder, not just another name. */
export interface AccountFolderField {
  readonly configKey: "homePath" | "shadowHomePath";
  readonly label: string;
  readonly hint: string;
  /** Prefilled folder for the Nth account; the user can change it. */
  readonly suggest: (instanceId: string) => string;
}

const ACCOUNT_FOLDER_FIELDS: Readonly<Record<string, AccountFolderField>> = {
  codex: {
    configKey: "shadowHomePath",
    label: "Account folder",
    hint: "Where this account keeps its Codex login. Settings and history are shared with your main Codex.",
    suggest: (instanceId) => `~/.codex-tabs/${instanceId}`,
  },
  claudeAgent: {
    configKey: "homePath",
    label: "Account folder",
    hint: "Where this account keeps its Claude login and settings.",
    suggest: (instanceId) => `~/.claude-tabs/${instanceId}`,
  },
};

export function accountFolderFieldFor(driver: string): AccountFolderField | undefined {
  return ACCOUNT_FOLDER_FIELDS[driver];
}

/** Environment variable each driver reads its login folder from. */
const ACCOUNT_FOLDER_ENV: Readonly<Record<string, string>> = {
  codex: "CODEX_HOME",
  claudeAgent: "CLAUDE_CONFIG_DIR",
};

function shellQuote(value: string): string {
  const quote = (text: string) => `'${text.replaceAll("'", `'"'"'`)}'`;
  return value.startsWith("~/") ? `"$HOME"/${quote(value.slice(2))}` : quote(value);
}

/**
 * The sign-in command for one extra instance. Drivers with an account folder
 * run it with that folder, so the login lands in this instance, not the default one.
 */
export function instanceLoginCommand(driver: string, config: unknown, baseCommand: string): string {
  const field = accountFolderFieldFor(driver);
  const envName = ACCOUNT_FOLDER_ENV[driver];
  const folder =
    field && config && typeof config === "object"
      ? (config as Record<string, unknown>)[field.configKey]
      : undefined;
  if (!envName || typeof folder !== "string" || folder.trim() === "") return baseCommand;
  return `${envName}=${shellQuote(folder.trim())} ${baseCommand}`;
}

/** Providers that keep one login per machine, so a second instance shares it. */
const SHARED_LOGIN_DRIVERS: ReadonlySet<string> = new Set(["fx", "kiro", "grok", "cursor"]);

export function sharesLoginAcrossInstances(driver: string): boolean {
  return SHARED_LOGIN_DRIVERS.has(driver);
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function validateInstanceId(id: string, taken: ReadonlySet<string>): string | null {
  if (id.length === 0) return "Give this account a name.";
  if (id.length > INSTANCE_ID_MAX) return "That name is too long.";
  if (!INSTANCE_ID_PATTERN.test(id)) return "Start the name with a letter.";
  if (taken.has(id)) return "An account with that name already exists.";
  return null;
}

/** `codex_work`, `codex_work-2`, ... — always a valid, unused instance id. */
export function availableInstanceId(
  driver: string,
  label: string,
  taken: ReadonlySet<string>,
): string {
  const base = `${driver}_${slug(label) || "account"}`.slice(0, INSTANCE_ID_MAX - 4);
  let candidate = base;
  for (let suffix = 2; taken.has(candidate); suffix += 1) candidate = `${base}-${suffix}`;
  return candidate;
}

/** "Codex 2", "Codex 3": the first label not already used for this provider. */
export function suggestAccountLabel(
  providerName: string,
  existingLabels: ReadonlyArray<string>,
): string {
  const used = new Set(existingLabels.map((label) => label.trim().toLowerCase()));
  for (let n = 2; ; n += 1) {
    const candidate = `${providerName} ${n}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

export function buildBuiltInInstance(input: {
  readonly driver: string;
  readonly label: string;
  readonly accountFolder: string;
  readonly binaryPath: string;
}): ProviderInstanceConfig {
  const folderField = accountFolderFieldFor(input.driver);
  const config: Record<string, unknown> = { enabled: true };
  const folder = input.accountFolder.trim();
  if (folderField && folder) config[folderField.configKey] = folder;
  const binaryPath = input.binaryPath.trim();
  if (binaryPath) config.binaryPath = binaryPath;
  return {
    driver: input.driver,
    displayName: input.label.trim(),
    enabled: true,
    config,
  } as ProviderInstanceConfig;
}

export function buildRegistryInstance(input: {
  readonly agentId: string;
  readonly label: string;
  readonly iconUrl?: string | null;
}): ProviderInstanceConfig {
  return {
    driver: "acpRegistry",
    displayName: input.label.trim(),
    enabled: true,
    config: {
      source: "registry",
      agentId: input.agentId,
      distribution: "auto",
      ...(input.iconUrl ? { registryIconUrl: input.iconUrl } : {}),
    },
  } as ProviderInstanceConfig;
}

/** Splits a command line on whitespace, keeping quoted segments together. */
export function splitCommandArgs(value: string): string[] {
  return [...value.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  );
}

export function buildLocalAcpInstance(input: {
  readonly label: string;
  readonly command: string;
  readonly args: string;
}): ProviderInstanceConfig {
  return {
    driver: "acpRegistry",
    displayName: input.label.trim(),
    enabled: true,
    config: {
      source: "local",
      commandPath: input.command.trim(),
      commandArgs: splitCommandArgs(input.args),
    },
  } as ProviderInstanceConfig;
}

/** True when this registry agent already has an instance, so the list can say "Added". */
export function configuredRegistryAgentIds(
  instances: Readonly<Record<string, { readonly driver: string; readonly config?: unknown }>>,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const instance of Object.values(instances)) {
    if (instance.driver !== "acpRegistry" || typeof instance.config !== "object") continue;
    const config = instance.config as { source?: unknown; agentId?: unknown } | null;
    if (config && config.source !== "local" && typeof config.agentId === "string") {
      ids.add(config.agentId);
    }
  }
  return ids;
}
