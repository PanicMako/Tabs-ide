import {
  ProviderDriverKind,
  type KiloSettings,
  type ModelCapabilities,
  type ServerProviderModel,
} from "@tabs/contracts";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { createModelCapabilities } from "@tabs/shared/model";
import {
  buildServerProvider,
  nonEmptyTrimmed,
  parseGenericCliVersion,
  providerModelsFromSettings,
  type ServerProviderDraft,
} from "../providerSnapshot";
import {
  OpenCodeRuntime,
  openCodeRuntimeErrorDetail,
  type OpenCodeInventory,
} from "../opencodeRuntime";
import type { Agent, ProviderListResponse } from "@opencode-ai/sdk/v2";

const PROVIDER = "kilo" as ProviderDriverKind;
const KILO_PRESENTATION = {
  displayName: "Kilo",
  showInteractionModeToggle: false,
} as const;

class KiloProbeError extends Data.TaggedError("KiloProbeError")<{
  readonly cause: unknown;
  readonly detail: string;
}> {}

function normalizeProbeMessage(message: string): string | undefined {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (
    trimmed === "An error occurred in Effect.tryPromise" ||
    trimmed === "An error occurred in Effect.try"
  ) {
    return undefined;
  }
  return trimmed;
}

function normalizedErrorMessage(cause: unknown): string | undefined {
  if (cause instanceof KiloProbeError) {
    return normalizeProbeMessage(cause.detail);
  }

  if (!(cause instanceof Error)) {
    return undefined;
  }

  return normalizeProbeMessage(cause.message);
}

function formatKiloProbeError(input: {
  readonly cause: unknown;
  readonly isExternalServer: boolean;
  readonly serverUrl: string;
}): { readonly installed: boolean; readonly message: string } {
  const detail = normalizedErrorMessage(input.cause);
  const lower = detail?.toLowerCase() ?? "";

  if (input.isExternalServer) {
    if (
      lower.includes("401") ||
      lower.includes("403") ||
      lower.includes("unauthorized") ||
      lower.includes("forbidden")
    ) {
      return {
        installed: true,
        message: "Kilo server rejected authentication. Check the server URL and password.",
      };
    }

    if (
      lower.includes("econnrefused") ||
      lower.includes("enotfound") ||
      lower.includes("fetch failed") ||
      lower.includes("networkerror") ||
      lower.includes("timed out") ||
      lower.includes("timeout") ||
      lower.includes("socket hang up")
    ) {
      return {
        installed: true,
        message: `Couldn't reach the configured Kilo server at ${input.serverUrl}. Check that the server is running and the URL is correct.`,
      };
    }

    return {
      installed: true,
      message: detail ?? "Failed to connect to the configured Kilo server.",
    };
  }

  if (lower.includes("enoent") || lower.includes("notfound")) {
    return {
      installed: false,
      message: "Kilo CLI (`kilo`) is not installed or not on PATH.",
    };
  }

  return {
    installed: true,
    message: detail
      ? `Failed to execute Kilo CLI health check: ${detail}`
      : "Failed to execute Kilo CLI health check.",
  };
}

function titleCaseSlug(value: string): string {
  const segments: Array<string> = [];
  for (const segment of value.split(/[-_/]+/)) {
    if (segment.length > 0) {
      segments.push(segment.charAt(0).toUpperCase() + segment.slice(1));
    }
  }
  return segments.join(" ");
}

function inferDefaultVariant(
  providerID: string,
  variants: ReadonlyArray<string>,
): string | undefined {
  if (variants.length === 1) {
    return variants[0];
  }
  if (providerID === "anthropic" || providerID.startsWith("google")) {
    return variants.includes("high") ? "high" : undefined;
  }
  if (providerID === "openai" || providerID === "opencode" || providerID === "kilo") {
    return variants.includes("medium") ? "medium" : variants.includes("high") ? "high" : undefined;
  }
  return undefined;
}

function inferDefaultAgent(agents: ReadonlyArray<Agent>): string | undefined {
  return (
    agents.find((agent) => agent.name === "code" || agent.name === "build")?.name ??
    agents[0]?.name ??
    undefined
  );
}

const DEFAULT_KILO_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

function kiloCapabilitiesForModel(input: {
  readonly providerID: string;
  readonly model: ProviderListResponse["all"][number]["models"][string];
  readonly agents: ReadonlyArray<Agent>;
}): ModelCapabilities {
  const variantValues = Object.keys(input.model.variants ?? {});
  const defaultVariant = inferDefaultVariant(input.providerID, variantValues);
  const variantOptions = variantValues.map((value) =>
    defaultVariant === value
      ? { id: value, label: titleCaseSlug(value), isDefault: true as const }
      : { id: value, label: titleCaseSlug(value) },
  );
  const primaryAgents = input.agents.filter(
    (agent) => !agent.hidden && (agent.mode === "primary" || agent.mode === "all"),
  );
  const defaultAgent = inferDefaultAgent(primaryAgents);
  const agentOptions = primaryAgents.map((agent) =>
    defaultAgent === agent.name
      ? {
          id: agent.name,
          label: titleCaseSlug(agent.name),
          isDefault: true as const,
        }
      : { id: agent.name, label: titleCaseSlug(agent.name) },
  );
  return createModelCapabilities({
    optionDescriptors: [
      ...(variantOptions.length > 0
        ? [
            {
              id: "variant",
              label: "Variant",
              type: "select" as const,
              options: variantOptions,
              ...(defaultVariant ? { currentValue: defaultVariant } : {}),
            },
          ]
        : []),
      ...(agentOptions.length > 0
        ? [
            {
              id: "agent",
              label: "Agent",
              type: "select" as const,
              options: agentOptions,
              ...(defaultAgent ? { currentValue: defaultAgent } : {}),
            },
          ]
        : []),
    ],
  });
}

export function flattenKiloModels(input: OpenCodeInventory): ReadonlyArray<ServerProviderModel> {
  const models: Array<ServerProviderModel> = [];

  for (const provider of input.providerList.all) {
    // The native Kilo provider is account-scoped by the authenticated Kilo
    // runtime. Keep every model it returns: `isFree` describes billing, not
    // entitlement, and filtering on it hides paid models from paid accounts.
    // Other connected OpenCode providers may use separate credentials and
    // belong to the standalone OpenCode provider instead.
    if (provider.id !== "kilo") {
      continue;
    }

    for (const model of Object.values(provider.models)) {
      const name = nonEmptyTrimmed(model.name);
      if (!name) {
        continue;
      }

      const subProvider = nonEmptyTrimmed(provider.name);
      models.push({
        slug: `${provider.id}/${model.id}`,
        name,
        ...(subProvider ? { subProvider } : {}),
        isCustom: false,
        capabilities: kiloCapabilitiesForModel({
          providerID: provider.id,
          model,
          agents: input.agents,
        }),
      });
    }
  }

  return models.toSorted((left, right) => left.name.localeCompare(right.name));
}

export const makePendingKiloProvider = (
  kiloSettings: KiloSettings,
): Effect.Effect<ServerProviderDraft> =>
  Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = providerModelsFromSettings(
      [],
      PROVIDER,
      kiloSettings.customModels,
      DEFAULT_KILO_MODEL_CAPABILITIES,
    );

    if (!kiloSettings.enabled) {
      return buildServerProvider({
        presentation: KILO_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message:
            kiloSettings.serverUrl.trim().length > 0
              ? "Kilo is disabled in Tabs settings. A server URL is configured."
              : "Kilo is disabled in Tabs settings.",
        },
      });
    }

    return buildServerProvider({
      presentation: KILO_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Kilo provider status has not been checked in this session yet.",
      },
    });
  });

export const checkKiloProviderStatus = Effect.fn("checkKiloProviderStatus")(function* (
  kiloSettings: KiloSettings,
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<ServerProviderDraft, never, OpenCodeRuntime> {
  const openCodeRuntime = yield* OpenCodeRuntime;
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const customModels = kiloSettings.customModels;
  const isExternalServer = kiloSettings.serverUrl.trim().length > 0;

  const fallback = (cause: unknown, version: string | null = null) => {
    const failure = formatKiloProbeError({
      cause,
      isExternalServer,
      serverUrl: kiloSettings.serverUrl,
    });
    return buildServerProvider({
      presentation: KILO_PRESENTATION,
      enabled: kiloSettings.enabled,
      checkedAt,
      models: providerModelsFromSettings(
        [],
        PROVIDER,
        customModels,
        DEFAULT_KILO_MODEL_CAPABILITIES,
      ),
      probe: {
        installed: failure.installed,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: failure.message,
      },
    });
  };

  if (!kiloSettings.enabled) {
    return buildServerProvider({
      presentation: KILO_PRESENTATION,
      enabled: false,
      checkedAt,
      models: providerModelsFromSettings(
        [],
        PROVIDER,
        customModels,
        DEFAULT_KILO_MODEL_CAPABILITIES,
      ),
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: isExternalServer
          ? "Kilo is disabled in Tabs settings. A server URL is configured."
          : "Kilo is disabled in Tabs settings.",
      },
    });
  }

  let version: string | null = null;
  if (!isExternalServer) {
    const versionExit = yield* Effect.exit(
      openCodeRuntime
        .runOpenCodeCommand({
          binaryPath: kiloSettings.binaryPath,
          args: ["--version"],
          environment,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new KiloProbeError({
                cause,
                detail: openCodeRuntimeErrorDetail(cause),
              }),
          ),
        ),
    );
    if (versionExit._tag === "Failure") {
      return fallback(Cause.squash(versionExit.cause));
    }
    version = parseGenericCliVersion(versionExit.value.stdout) ?? null;
  }

  const inventoryExit = yield* Effect.exit(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* openCodeRuntime.connectToOpenCodeServer({
          binaryPath: kiloSettings.binaryPath,
          serverUrl: kiloSettings.serverUrl,
          environment,
          retryKiloCredentialStartup: true,
        });
        return yield* openCodeRuntime.loadOpenCodeInventory(
          openCodeRuntime.createOpenCodeSdkClient({
            baseUrl: server.url,
            directory: cwd,
            ...(isExternalServer && kiloSettings.serverPassword
              ? { serverPassword: kiloSettings.serverPassword }
              : {}),
          }),
        );
      }).pipe(
        Effect.mapError(
          (cause) =>
            new KiloProbeError({
              cause,
              detail: openCodeRuntimeErrorDetail(cause),
            }),
        ),
      ),
    ),
  );
  if (inventoryExit._tag === "Failure") {
    return fallback(Cause.squash(inventoryExit.cause), version);
  }

  const models = providerModelsFromSettings(
    flattenKiloModels(inventoryExit.value),
    PROVIDER,
    customModels,
    DEFAULT_KILO_MODEL_CAPABILITIES,
  );
  const connectedCount = inventoryExit.value.providerList.connected.length;
  return buildServerProvider({
    presentation: KILO_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version,
      status: connectedCount > 0 ? "ready" : "warning",
      auth: {
        status: connectedCount > 0 ? "authenticated" : "unknown",
        type: "kilo",
      },
      message:
        connectedCount > 0
          ? `${connectedCount} upstream provider${connectedCount === 1 ? "" : "s"} connected through ${isExternalServer ? "the configured Kilo server" : "Kilo"}.`
          : isExternalServer
            ? "Connected to the configured Kilo server, but it did not report any connected upstream providers."
            : "Kilo is available, but it did not report any connected upstream providers.",
    },
  });
});
