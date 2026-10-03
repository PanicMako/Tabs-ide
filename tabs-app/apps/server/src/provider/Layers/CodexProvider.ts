import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Types from "effect/Types";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as CodexClient from "effect-codex-app-server/client";
import * as CodexSchema from "effect-codex-app-server/schema";
import * as CodexErrors from "effect-codex-app-server/errors";

import type {
  CodexSettings,
  ServerProvider,
  ServerProviderState,
  ModelCapabilities,
  ProviderOptionDescriptor,
  ServerProviderModel,
  ServerProviderSkill,
} from "@tabs/contracts";
import { ServerSettingsError } from "@tabs/contracts";

import { createModelCapabilities } from "@tabs/shared/model";
import {
  AUTH_PROBE_TIMEOUT_MS,
  buildServerProvider,
  type ServerProviderDraft,
} from "../providerSnapshot";
import { expandHomePath } from "../../pathExpansion";
import { codexAppServerArgs, resolveCodexLaunchArgs } from "./codexLaunchArgs";
import packageJson from "../../../package.json" with { type: "json" };
import { makeUnavailableUsageLimits } from "../providerUsageLimits.ts";
import {
  codexRateLimitsFailureMessage,
  codexRateLimitsToLimits,
  type CodexRateLimitSnapshot,
  type CodexResetCreditsSummary,
} from "./codexUsageLimits.ts";

const RATE_LIMITS_PROBE_TIMEOUT_MS = 3_000;

const isCodexAppServerSpawnError = (error: unknown): boolean => {
  if (Schema.is(CodexErrors.CodexAppServerSpawnError)(error)) return true;
  if (typeof error === "object" && error !== null) {
    const err = error as {
      _tag?: string;
      code?: string;
      reason?: string;
      syscall?: string;
      message?: string;
      cause?: unknown;
    };
    if (
      err._tag === "CodexAppServerSpawnError" ||
      err._tag === "ChildProcessSpawnerError" ||
      err._tag === "SystemError" ||
      err._tag === "PlatformError" ||
      err._tag === "BadArgument"
    ) {
      return true;
    }
    if (err.code === "ENOENT" || err.reason === "NotFound" || err.syscall === "spawn") return true;
    if (err.cause && isCodexAppServerSpawnError(err.cause)) return true;
    const str = (String(err.message ?? "") + " " + String(error)).toLowerCase();
    if (
      str.includes("enoent") ||
      str.includes("codexappserverspawnerror") ||
      str.includes("childprocessspawnererror") ||
      str.includes("notfound") ||
      str.includes("systemerror") ||
      str.includes("spawn")
    ) {
      return true;
    }
  }
  const str = String(error).toLowerCase();
  if (
    str.includes("enoent") ||
    str.includes("codexappserverspawnerror") ||
    str.includes("childprocessspawnererror") ||
    str.includes("notfound") ||
    str.includes("systemerror") ||
    str.includes("spawn")
  ) {
    return true;
  }
  return false;
};
const CODEX_APP_SERVER_PROBE_FORCE_KILL_AFTER = "2 seconds" as const;
const DEFAULT_SERVICE_TIER_ID = "default";

const CODEX_PRESENTATION = {
  displayName: "Codex",
  showInteractionModeToggle: true,
} as const;

type CodexRateLimitsProbe =
  | {
      readonly snapshot: CodexRateLimitSnapshot;
      readonly rateLimitsByLimitId?:
        | Readonly<Record<string, CodexRateLimitSnapshot>>
        | null
        | undefined;
      readonly resetCredits?: CodexResetCreditsSummary | null | undefined;
    }
  | { readonly failure: string };

export interface CodexAppServerProviderSnapshot {
  readonly account: CodexSchema.V2GetAccountResponse;
  readonly version: string | undefined;
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
  readonly rateLimits?: CodexRateLimitsProbe;
}

const REASONING_EFFORT_LABELS: Readonly<Record<string, string>> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
  ultra: "Ultra",
};

function codexAccountAuthLabel(account: CodexSchema.V2GetAccountResponse["account"]) {
  if (!account) return undefined;
  if (account.type === "apiKey") return "OpenAI API Key";
  if (account.type === "amazonBedrock") return "Amazon Bedrock";
  if (account.type !== "chatgpt") return undefined;
  return codexPlanLabel(account.planType);
}

/** Shared with usage-limit sources, which report the same `planType` slugs. */
export function codexPlanLabel(planType: string | null | undefined): string | undefined {
  switch (planType) {
    case "free":
      return "ChatGPT Free Subscription";
    case "go":
      return "ChatGPT Go Subscription";
    case "plus":
      return "ChatGPT Plus Subscription";
    case "pro":
      return "ChatGPT Pro 20x Subscription";
    case "prolite":
      return "ChatGPT Pro 5x Subscription";
    case "team":
      return "ChatGPT Team Subscription";
    case "self_serve_business_prolite":
    case "self_serve_business_usage_based":
    case "business":
      return "ChatGPT Business Subscription";
    case "ent26":
    case "enterprise_cbp_automation":
    case "enterprise_cbp_usage_based":
    case "enterprise":
      return "ChatGPT Enterprise Subscription";
    case "edu":
    case "edu_plus":
    case "edu_pro":
      return "ChatGPT Edu Subscription";
    case "unknown":
      return "ChatGPT Subscription";
    default:
      return undefined;
  }
}

function codexAccountEmail(account: CodexSchema.V2GetAccountResponse["account"]) {
  if (!account || account.type !== "chatgpt") return undefined;
  return account.email;
}

export function mapCodexModelCapabilities(
  model: CodexSchema.V2ModelListResponse__Model,
): ModelCapabilities {
  const reasoningOptions = model.supportedReasoningEfforts.map(({ reasoningEffort }) =>
    reasoningEffort === model.defaultReasoningEffort
      ? {
          id: reasoningEffort,
          label: REASONING_EFFORT_LABELS[reasoningEffort] ?? reasoningEffort,
          isDefault: true,
        }
      : {
          id: reasoningEffort,
          label: REASONING_EFFORT_LABELS[reasoningEffort] ?? reasoningEffort,
        },
  );
  const defaultReasoning = reasoningOptions.find((option) => option.isDefault)?.id;
  const rawServiceTiers =
    model.serviceTiers && model.serviceTiers.length > 0
      ? model.serviceTiers
      : (model.additionalSpeedTiers ?? []).map((id) => ({
          id,
          name: id === "fast" ? "Fast" : id,
          description: "",
        }));
  const hasFastTier = rawServiceTiers.some((tier) => tier.id === "fast");
  const modelSlug = (model.model || "").toLowerCase();
  const supportsFast =
    hasFastTier ||
    Boolean((model as any).supportsFastMode) ||
    Boolean((model as any).supports_fast_mode) ||
    Boolean((model as any).fastMode) ||
    modelSlug.includes("gpt-5") ||
    modelSlug.includes("codex") ||
    modelSlug.includes("gpt-4");

  const serviceTiers = hasFastTier
    ? rawServiceTiers
    : supportsFast
      ? [
          { id: "fast", name: "Fast", description: "" },
          ...rawServiceTiers.filter((t) => t.id !== "fast"),
        ]
      : rawServiceTiers;
  const defaultServiceTierFromModel = (model as any).defaultServiceTier;
  const catalogDefaultServiceTier =
    typeof defaultServiceTierFromModel === "string" &&
    serviceTiers.some((tier) => tier.id === defaultServiceTierFromModel)
      ? defaultServiceTierFromModel
      : null;
  const defaultServiceTier = catalogDefaultServiceTier ?? DEFAULT_SERVICE_TIER_ID;
  const optionDescriptors: ProviderOptionDescriptor[] = [];

  if (reasoningOptions.length > 0) {
    optionDescriptors.push({
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select" as const,
      options: reasoningOptions,
      ...(defaultReasoning ? { currentValue: defaultReasoning } : {}),
    });
  }
  if (serviceTiers.length > 0) {
    optionDescriptors.push({
      id: "serviceTier",
      label: "Service Tier",
      type: "select" as const,
      options: [
        {
          id: DEFAULT_SERVICE_TIER_ID,
          label: "Standard",
          ...(defaultServiceTier === DEFAULT_SERVICE_TIER_ID ? { isDefault: true } : {}),
        },
        ...serviceTiers.map((tier) => ({
          id: tier.id,
          label: tier.name,
          ...(tier.description ? { description: tier.description } : {}),
          ...(defaultServiceTier === tier.id ? { isDefault: true } : {}),
        })),
      ],
      currentValue: defaultServiceTier,
    });
  }

  return createModelCapabilities({
    optionDescriptors,
  });
}

const toDisplayName = (model: CodexSchema.V2ModelListResponse__Model): string => {
  // Capitalize 'gpt' to 'GPT-' and capitalize any letter following a dash
  return model.displayName
    .replace(/^gpt/i, "GPT") // Handle start with 'gpt' or 'GPT'
    .replace(/-([a-z])/g, (_, c) => "-" + c.toUpperCase());
};

function parseCodexModelListResponse(
  response: CodexSchema.V2ModelListResponse,
): ReadonlyArray<ServerProviderModel> {
  return response.data.map((model) => ({
    slug: model.model,
    name: toDisplayName(model),
    isCustom: false,
    capabilities: mapCodexModelCapabilities(model),
  }));
}

function appendCustomCodexModels(
  models: ReadonlyArray<ServerProviderModel>,
  customModels: ReadonlyArray<string>,
): ReadonlyArray<ServerProviderModel> {
  if (customModels.length === 0) {
    return models;
  }

  const seen = new Set(models.map((model) => model.slug));
  const fallbackCapabilities = models.find((model) => model.capabilities)?.capabilities ?? null;
  const customEntries: ServerProviderModel[] = [];
  for (const rawModel of customModels) {
    const slug = rawModel.trim();
    if (!slug || seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    customEntries.push({
      slug,
      name: slug,
      isCustom: true,
      capabilities: fallbackCapabilities,
    });
  }
  return customEntries.length === 0 ? models : [...models, ...customEntries];
}

function parseCodexSkillsListResponse(
  response: CodexSchema.V2SkillsListResponse,
  cwd: string,
): ReadonlyArray<ServerProviderSkill> {
  const matchingEntry = response.data.find((entry) => entry.cwd === cwd);
  const skills = matchingEntry
    ? matchingEntry.skills
    : response.data.flatMap((entry) => entry.skills);

  return skills.map((skill) => {
    const shortDescription =
      skill.shortDescription ?? skill.interface?.shortDescription ?? undefined;

    const parsedSkill: Types.Mutable<ServerProviderSkill> = {
      name: skill.name,
      path: skill.path,
      enabled: skill.enabled,
    };

    if (skill.description) {
      parsedSkill.description = skill.description;
    }
    if (skill.scope) {
      parsedSkill.scope = skill.scope;
    }
    if (skill.interface?.displayName) {
      parsedSkill.displayName = skill.interface.displayName;
    }
    if (shortDescription) {
      parsedSkill.shortDescription = shortDescription;
    }

    return parsedSkill;
  });
}

const requestAllCodexModels = Effect.fn("requestAllCodexModels")(function* (
  client: CodexClient.CodexAppServerClientShape,
) {
  const models: ServerProviderModel[] = [];
  let cursor: string | null | undefined = undefined;

  do {
    const response: CodexSchema.V2ModelListResponse = yield* client.request(
      "model/list",
      cursor ? { cursor } : {},
    );
    models.push(...parseCodexModelListResponse(response));
    cursor = response.nextCursor;
  } while (cursor);

  return models;
});

export function buildCodexInitializeParams(): CodexSchema.V1InitializeParams {
  return {
    clientInfo: {
      name: "t3code_desktop",
      title: "Tabs Desktop",
      version: packageJson.version,
    },
    capabilities: {
      experimentalApi: true,
    },
  };
}

export const withCodexAppServerClient = Effect.fn("withCodexAppServerClient")(function* (input: {
  readonly binaryPath: string;
  readonly homePath?: string | undefined;
  readonly launchArgs?: string | undefined;
  readonly cwd: string;
  readonly environment?: NodeJS.ProcessEnv | undefined;
}) {
  const resolvedHomePath = input.homePath ? expandHomePath(input.homePath) : undefined;
  const clientContext = yield* Layer.build(
    CodexClient.layerCommand({
      command: input.binaryPath,
      args: codexAppServerArgs(input.launchArgs),
      cwd: input.cwd,
      env: {
        ...(input.environment ?? process.env),
        ...(resolvedHomePath ? { CODEX_HOME: resolvedHomePath } : {}),
      },
    }),
  );
  const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
    Effect.provide(clientContext),
  );

  const initialize = yield* client.request("initialize", {
    clientInfo: {
      name: "tabs_desktop",
      title: "Tabs Desktop",
      version: packageJson.version,
    },
    capabilities: {
      experimentalApi: true,
    },
  });
  yield* client.notify("initialized", undefined);

  return { client, initialize };
});

export const probeCodexSkillsForCwd = Effect.fn("probeCodexSkillsForCwd")(function* (input: {
  readonly binaryPath: string;
  readonly homePath?: string;
  readonly launchArgs?: string;
  readonly cwd: string;
  readonly environment?: NodeJS.ProcessEnv;
}) {
  const { client } = yield* withCodexAppServerClient(input);
  const skillsResponse = yield* client.request("skills/list", { cwds: [input.cwd] });
  return parseCodexSkillsListResponse(skillsResponse, input.cwd);
});

const probeCodexAppServerProvider = Effect.fn("probeCodexAppServerProvider")(function* (input: {
  readonly binaryPath: string;
  readonly homePath?: string;
  readonly launchArgs?: string;
  readonly cwd: string;
  readonly customModels?: ReadonlyArray<string>;
  readonly environment?: NodeJS.ProcessEnv;
}) {
  const { client, initialize } = yield* withCodexAppServerClient(input);

  // Extract the version string after the first '/' in userAgent, up to the next space or the end
  const versionMatch = initialize.userAgent.match(/\/([^\s]+)/);
  const version = versionMatch ? versionMatch[1] : undefined;

  const accountResponse = yield* client.request("account/read", {});
  if (!accountResponse.account && accountResponse.requiresOpenaiAuth) {
    return {
      account: accountResponse,
      version,
      models: appendCustomCodexModels([], input.customModels ?? []),
      skills: [],
    } satisfies CodexAppServerProviderSnapshot;
  }

  const [skillsResponse, models, rateLimits] = yield* Effect.all(
    [
      client.request("skills/list", {
        cwds: [input.cwd],
      }),
      requestAllCodexModels(client),
      client.request("account/rateLimits/read", undefined).pipe(
        Effect.map(
          (response: any): CodexRateLimitsProbe => ({
            snapshot: response.rateLimits,
            rateLimitsByLimitId: response.rateLimitsByLimitId,
            resetCredits: response.rateLimitResetCredits,
          }),
        ),
        Effect.timeoutOption(Duration.millis(RATE_LIMITS_PROBE_TIMEOUT_MS)),
        Effect.map(
          Option.getOrElse(
            (): CodexRateLimitsProbe => ({
              failure: "Codex did not answer the usage request.",
            }),
          ),
        ),
        Effect.catch((error: unknown) =>
          Effect.logDebug("Codex rate-limit read failed.", { cause: error }).pipe(
            Effect.as<CodexRateLimitsProbe>({ failure: codexRateLimitsFailureMessage(error) }),
          ),
        ),
      ),
    ],
    { concurrency: "unbounded" },
  );

  return {
    account: accountResponse,
    version,
    models: appendCustomCodexModels(models, input.customModels ?? []),
    skills: parseCodexSkillsListResponse(skillsResponse, input.cwd),
    rateLimits,
  } satisfies CodexAppServerProviderSnapshot;
});

const emptyCodexModelsFromSettings = (codexSettings: CodexSettings): ServerProvider["models"] => {
  const models = new Set<string>();
  for (const model of codexSettings.customModels) {
    const trimmed = model.trim();
    if (trimmed.length > 0) {
      models.add(trimmed);
    }
  }
  return Array.from(models, (model) => ({
    slug: model,
    name: model,
    isCustom: true,
    capabilities: null,
  }));
};

const makePendingCodexProvider = (
  codexSettings: CodexSettings,
): Effect.Effect<ServerProviderDraft> =>
  Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = emptyCodexModelsFromSettings(codexSettings);

    if (!codexSettings.enabled) {
      return buildServerProvider({
        presentation: CODEX_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        skills: [],
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Codex is disabled in Tabs settings.",
        },
      });
    }

    return buildServerProvider({
      presentation: CODEX_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      skills: [],
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Codex provider status has not been checked in this session yet.",
      },
    });
  });

function accountProbeStatus(account: CodexAppServerProviderSnapshot["account"]): {
  readonly status: Exclude<ServerProviderState, "disabled">;
  readonly auth: ServerProvider["auth"];
  readonly message?: string;
} {
  const authLabel = codexAccountAuthLabel(account.account);
  const authEmail = codexAccountEmail(account.account);
  const auth = {
    status: account.account ? ("authenticated" as const) : ("unknown" as const),
    ...(account.account?.type ? { type: account.account?.type } : {}),
    ...(authLabel ? { label: authLabel } : {}),
    ...(authEmail ? { email: authEmail } : {}),
  } satisfies ServerProvider["auth"];

  if (account.account) {
    return { status: "ready", auth };
  }

  if (account.requiresOpenaiAuth) {
    return {
      status: "error",
      auth: { status: "unauthenticated" },
      message: "Codex CLI is not authenticated. Run `codex login` and try again.",
    };
  }

  return { status: "ready", auth };
}

export const checkCodexProviderStatus = Effect.fn("checkCodexProviderStatus")(function* (
  codexSettings: CodexSettings,
  probe: (input: {
    readonly binaryPath: string;
    readonly homePath?: string;
    readonly cwd: string;
    readonly customModels: ReadonlyArray<string>;
    readonly environment?: NodeJS.ProcessEnv;
  }) => Effect.Effect<
    CodexAppServerProviderSnapshot,
    CodexErrors.CodexAppServerError,
    ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
  > = probeCodexAppServerProvider,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<
  ServerProviderDraft,
  ServerSettingsError,
  ChildProcessSpawner.ChildProcessSpawner
> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const emptyModels = emptyCodexModelsFromSettings(codexSettings);

  if (!codexSettings.enabled) {
    return buildServerProvider({
      presentation: CODEX_PRESENTATION,
      enabled: false,
      checkedAt,
      models: emptyModels,
      skills: [],
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Codex is disabled in Tabs settings.",
      },
    });
  }

  const probeExit = yield* probe({
    binaryPath: codexSettings.binaryPath,
    homePath: codexSettings.homePath,
    cwd: process.cwd(),
    customModels: codexSettings.customModels,
    environment,
  }).pipe(Effect.scoped, Effect.timeoutOption(Duration.millis(AUTH_PROBE_TIMEOUT_MS)), Effect.exit);

  if (Exit.isFailure(probeExit)) {
    const cause = probeExit.cause;
    const error = Cause.squash(cause);
    const installed = !isCodexAppServerSpawnError(error) && !isCodexAppServerSpawnError(cause);
    const errorMessage = (error as { message?: string })?.message ?? Cause.pretty(cause);
    return buildServerProvider({
      presentation: CODEX_PRESENTATION,
      enabled: codexSettings.enabled,
      checkedAt,
      models: emptyModels,
      skills: [],
      probe: {
        installed,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: installed
          ? `Codex app-server provider probe failed: ${errorMessage}.`
          : "Codex CLI (`codex`) is not installed or not on PATH.",
      },
    });
  }

  const probeResultValue = probeExit.value;
  if (Option.isNone(probeResultValue)) {
    return buildServerProvider({
      presentation: CODEX_PRESENTATION,
      enabled: codexSettings.enabled,
      checkedAt,
      models: emptyModels,
      skills: [],
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Timed out while checking Codex app-server provider status.",
      },
    });
  }

  const snapshot = probeResultValue.value;
  const accountStatus = accountProbeStatus(snapshot.account);
  const usageLimits =
    snapshot.account.account?.type === "apiKey"
      ? makeUnavailableUsageLimits({ checkedAt, reason: "unsupported" })
      : snapshot.rateLimits === undefined || "failure" in snapshot.rateLimits
        ? makeUnavailableUsageLimits({
            checkedAt,
            reason: "probeFailed",
            ...(snapshot.rateLimits ? { message: snapshot.rateLimits.failure } : {}),
          })
        : codexRateLimitsToLimits({
            snapshot: snapshot.rateLimits.snapshot,
            rateLimitsByLimitId: snapshot.rateLimits.rateLimitsByLimitId,
            resetCredits: snapshot.rateLimits.resetCredits,
            checkedAt,
          });

  return buildServerProvider({
    presentation: CODEX_PRESENTATION,
    enabled: codexSettings.enabled,
    checkedAt,
    models: snapshot.models,
    skills: snapshot.skills,
    probe: {
      installed: true,
      version: snapshot.version ?? null,
      status: accountStatus.status,
      auth: accountStatus.auth,
      ...(accountStatus.message ? { message: accountStatus.message } : {}),
      usageLimits,
    },
  });
});

// NOTE: the singleton `CodexProviderLive` Layer has been removed as part of
// the per-instance-driver refactor. `CodexDriver.create()` builds a managed
// snapshot per instance (each with its own `CodexSettings`) and hands the
// resulting `ServerProviderShape` back as `ProviderInstance.snapshot`.
//
// The `makePendingCodexProvider` and `checkCodexProviderStatus` helpers are
// re-exported for use by `CodexDriver`.
export { makePendingCodexProvider };
