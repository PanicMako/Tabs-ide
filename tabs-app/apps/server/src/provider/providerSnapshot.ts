import type {
  CustomModelSetting,
  ProviderDriverKind,
  RuntimeMode,
  ModelCapabilities,
  ServerProvider,
  ServerProviderAuth,
  ProviderCredentialSource,
  ServerProviderSkill,
  ServerProviderSlashCommand,
  ServerProviderModel,
  ServerProviderState,
  ServerProviderUsageLimits,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Data from "effect/Data";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { normalizeModelSlug, readCustomModelEntries } from "@tabs/shared/model";
import { isWindowsCommandNotFound } from "../processRunner.ts";
import { createProviderVersionAdvisory } from "./providerMaintenance.ts";
import { collectUint8StreamText } from "../stream/collectUint8StreamText.ts";

export const DEFAULT_TIMEOUT_MS = 4_000;
// Auth status checks involve disk/network lookups and can be slow on first run (especially Windows)
export const AUTH_PROBE_TIMEOUT_MS = 10_000;

export const COMPACT_SLASH_COMMAND = {
  name: "compact",
  description: "Summarize the conversation and reduce context usage",
} satisfies ServerProviderSlashCommand;

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export class ProviderCommandExecutionError extends Data.TaggedError(
  "ProviderCommandExecutionError",
)<{
  readonly message: string;
}> {}

export interface ProviderProbeResult {
  readonly installed: boolean;
  readonly version: string | null;
  readonly status: Exclude<ServerProviderState, "disabled">;
  readonly auth: ServerProviderAuth;
  readonly message?: string;
  readonly usageLimits?: ServerProviderUsageLimits;
}

export interface ServerProviderPresentation {
  readonly displayName: string;
  readonly badgeLabel?: string;
  readonly showInteractionModeToggle?: boolean;
  readonly requiresNewThreadForModelChange?: boolean;
  readonly supportsConversationRollback?: boolean;
  readonly supportsTextGeneration?: boolean;
  readonly reportsContextWindow?: boolean;
  readonly supportedRuntimeModes?: ReadonlyArray<RuntimeMode>;
}

function inferCredentialSource(auth: ServerProviderAuth): ProviderCredentialSource {
  const type = auth.type?.trim().toLowerCase();
  if (!type) return auth.status === "authenticated" ? "account" : "unknown";
  if (["apikey", "api_key", "api-key", "gemini-api-key"].includes(type)) return "api_key";
  if (type === "byok") return "byok";
  if (type === "amazonbedrock" || type === "googlevertex" || type === "cloudcredential") {
    return "cloud_credential";
  }
  if (type === "freelocal" || type === "local") return "free_local";
  return "account";
}

export function normalizeProviderAuth(auth: ServerProviderAuth): ServerProviderAuth {
  const credentialSource = auth.credentialSource ?? inferCredentialSource(auth);
  return {
    ...auth,
    credentialSource,
    ...(auth.billingLabel
      ? { billingLabel: auth.billingLabel }
      : auth.label
        ? { billingLabel: auth.label }
        : {}),
  };
}

export type ServerProviderDraft = Omit<ServerProvider, "instanceId" | "driver">;

export function nonEmptyTrimmed(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isCommandMissingCause(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as any).message === "string"
  ) {
    const lower = (error as any).message.toLowerCase();
    return lower.includes("enoent") || lower.includes("notfound");
  }
  return false;
}

export const spawnAndCollect = (binaryPath: string, command: ChildProcess.Command) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(command);
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectStreamAsString(child.stdout),
        collectStreamAsString(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );

    const result: CommandResult = { stdout, stderr, code: exitCode };
    if (yield* isWindowsCommandNotFound(exitCode, stderr)) {
      return yield* new ProviderCommandExecutionError({ message: `spawn ${binaryPath} ENOENT` });
    }
    return result;
  }).pipe(Effect.scoped);

export function detailFromResult(
  result: CommandResult & { readonly timedOut?: boolean },
): string | undefined {
  if (result.timedOut) return "Timed out while running command.";
  const stderr = nonEmptyTrimmed(result.stderr);
  if (stderr) return stderr;
  const stdout = nonEmptyTrimmed(result.stdout);
  if (stdout) return stdout;
  if (result.code !== 0) {
    return `Command exited with code ${result.code}.`;
  }
  return undefined;
}

export function extractAuthBoolean(value: unknown): boolean | undefined {
  if (globalThis.Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractAuthBoolean(entry);
      if (nested !== undefined) return nested;
    }
    return undefined;
  }

  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ["authenticated", "isAuthenticated", "loggedIn", "isLoggedIn"] as const) {
    if (typeof record[key] === "boolean") return record[key];
  }
  for (const key of ["auth", "status", "session", "account"] as const) {
    const nested = extractAuthBoolean(record[key]);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function parseGenericCliVersion(output: string): string | null {
  const match = output.match(/\bv?(\d+\.\d+\.\d+)\b/);
  return match?.[1] ?? null;
}

export function providerModelsFromSettings(
  builtInModels: ReadonlyArray<ServerProviderModel>,
  customModels: ReadonlyArray<CustomModelSetting>,
  customModelCapabilities: ModelCapabilities,
): ReadonlyArray<ServerProviderModel>;
export function providerModelsFromSettings(
  builtInModels: ReadonlyArray<ServerProviderModel>,
  provider: ProviderDriverKind,
  customModels: ReadonlyArray<CustomModelSetting>,
  customModelCapabilities: ModelCapabilities,
): ReadonlyArray<ServerProviderModel>;
export function providerModelsFromSettings(
  builtInModels: ReadonlyArray<ServerProviderModel>,
  arg2: ReadonlyArray<CustomModelSetting> | ProviderDriverKind,
  arg3: ModelCapabilities | ReadonlyArray<CustomModelSetting>,
  arg4?: ModelCapabilities,
): ReadonlyArray<ServerProviderModel> {
  const resolvedBuiltInModels = [...builtInModels];
  const seen = new Set(resolvedBuiltInModels.map((model) => model.slug));
  const customEntries: ServerProviderModel[] = [];

  if (typeof arg2 === "string") {
    const provider = arg2 as ProviderDriverKind;
    const customModels = arg3 as ReadonlyArray<CustomModelSetting>;
    const customModelCapabilities = arg4!;
    for (const candidate of customModels) {
      const slugCandidate = typeof candidate === "string" ? candidate : candidate.slug;
      const normalized = normalizeModelSlug(slugCandidate, provider);
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      const name = typeof candidate === "string" ? normalized : (candidate.name ?? normalized);
      customEntries.push({
        slug: normalized,
        name,
        isCustom: true,
        capabilities: customModelCapabilities,
      });
    }
  } else {
    const customModels = arg2 as ReadonlyArray<CustomModelSetting>;
    const customModelCapabilities = arg3 as ModelCapabilities;
    for (const entry of readCustomModelEntries(customModels)) {
      if (seen.has(entry.slug)) {
        continue;
      }
      seen.add(entry.slug);
      customEntries.push({
        slug: entry.slug,
        name: entry.name,
        isCustom: true,
        capabilities: entry.capabilities ?? customModelCapabilities,
      });
    }
  }

  return [...resolvedBuiltInModels, ...customEntries];
}

export function buildSelectOptionDescriptor(input: {
  readonly id: string;
  readonly label: string;
  readonly options:
    | ReadonlyArray<{ value: string; label: string; isDefault?: boolean | undefined }>
    | undefined;
  readonly description?: string;
  readonly promptInjectedValues?: ReadonlyArray<string>;
}) {
  const options = (input.options ?? []).map((option) =>
    option.isDefault
      ? { id: option.value, label: option.label, isDefault: true }
      : { id: option.value, label: option.label },
  );
  const currentValue = options.find((option) => option.isDefault)?.id;
  return {
    id: input.id,
    label: input.label,
    type: "select" as const,
    options,
    ...(currentValue ? { currentValue } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.promptInjectedValues && input.promptInjectedValues.length > 0
      ? { promptInjectedValues: [...input.promptInjectedValues] }
      : {}),
  };
}

export function buildBooleanOptionDescriptor(input: {
  readonly id: string;
  readonly label: string;
  readonly currentValue?: boolean;
  readonly description?: string;
}) {
  return {
    id: input.id,
    label: input.label,
    type: "boolean" as const,
    ...(input.description ? { description: input.description } : {}),
    ...(typeof input.currentValue === "boolean" ? { currentValue: input.currentValue } : {}),
  };
}

export function buildServerProvider(input: {
  driver?: ProviderDriverKind;
  presentation: ServerProviderPresentation;
  enabled: boolean;
  checkedAt: string;
  catalogStatus?: ServerProviderDraft["catalogStatus"];
  catalogSource?: string;
  catalogCheckedAt?: string;
  models: ReadonlyArray<ServerProviderModel>;
  slashCommands?: ReadonlyArray<ServerProviderSlashCommand>;
  skills?: ReadonlyArray<ServerProviderSkill>;
  probe: ProviderProbeResult;
}): ServerProviderDraft {
  const versionAdvisory = input.driver
    ? createProviderVersionAdvisory({
        driver: input.driver,
        currentVersion: input.probe.version,
        checkedAt: input.checkedAt,
      })
    : undefined;
  return {
    displayName: input.presentation.displayName,
    ...(input.presentation.badgeLabel ? { badgeLabel: input.presentation.badgeLabel } : {}),
    ...(typeof input.presentation.showInteractionModeToggle === "boolean"
      ? { showInteractionModeToggle: input.presentation.showInteractionModeToggle }
      : {}),
    ...(typeof input.presentation.requiresNewThreadForModelChange === "boolean"
      ? { requiresNewThreadForModelChange: input.presentation.requiresNewThreadForModelChange }
      : {}),
    ...(input.presentation.supportsConversationRollback === undefined
      ? {}
      : { supportsConversationRollback: input.presentation.supportsConversationRollback }),
    ...(input.presentation.supportsTextGeneration === undefined
      ? {}
      : { supportsTextGeneration: input.presentation.supportsTextGeneration }),
    ...(input.presentation.reportsContextWindow === undefined
      ? {}
      : { reportsContextWindow: input.presentation.reportsContextWindow }),
    ...(input.presentation.supportedRuntimeModes === undefined
      ? {}
      : { supportedRuntimeModes: [...input.presentation.supportedRuntimeModes] }),
    enabled: input.enabled,
    installed: input.probe.installed,
    version: input.probe.version,
    status: input.enabled ? input.probe.status : "disabled",
    auth: normalizeProviderAuth(input.probe.auth),
    checkedAt: input.checkedAt,
    catalogStatus: input.catalogStatus ?? (input.models.length > 0 ? "ready" : "empty"),
    catalogSource: input.catalogSource ?? "provider-snapshot",
    catalogCheckedAt: input.catalogCheckedAt ?? input.checkedAt,
    ...(input.probe.message ? { message: input.probe.message } : {}),
    ...(input.probe.usageLimits ? { usageLimits: input.probe.usageLimits } : {}),
    models: input.models,
    slashCommands: [...(input.slashCommands ?? [])],
    skills: [...(input.skills ?? [])],
    ...(versionAdvisory ? { versionAdvisory } : {}),
  };
}

export const collectStreamAsString = <E>(
  stream: Stream.Stream<Uint8Array, E>,
  options?: { readonly maxBytes?: number | undefined },
): Effect.Effect<string, E> =>
  collectUint8StreamText({ stream, ...options }).pipe(Effect.map((collected) => collected.text));
