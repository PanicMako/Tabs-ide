import {
  OpenRouterSettings,
  ProviderDriverKind,
  validateServerProviderModelList,
  type ServerProvider,
} from "@tabs/contracts";
import { makeDeepSeekOpenRouterAdapterV2 } from "../../orchestration-v2/Adapters/DeepSeekOpenRouterAdapterV2";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { makeOpenRouterTextGeneration } from "../../textGeneration/OpenRouterTextGeneration.ts";
import { ProviderAdapterRequestError, ProviderDriverError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  makeProviderInstanceCapabilities,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { buildServerProvider } from "../providerSnapshot.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import { getProviderSecret } from "../ProviderSecretStore.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { ProviderAdapterOpenSessionError } from "../../orchestration-v2/ProviderAdapter.ts";
import { ProviderRuntimeGeneration } from "../ProviderRuntimeGeneration.ts";

const decodeOpenRouterSettings = Schema.decodeSync(OpenRouterSettings);

const DRIVER_KIND = "openrouter" as ProviderDriverKind;
const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);

export async function discoverOpenRouterModels(
  settings: OpenRouterSettings,
  fetchImpl: typeof fetch = fetch,
) {
  const apiKey = settings.apiKey.trim();
  if (!apiKey) return { kind: "missing" as const, models: [] };
  const baseUrl = (settings.baseUrl.trim() || "https://openrouter.ai/api/v1").replace(/\/+$/u, "");
  // The user-scoped endpoint applies the account's provider preferences,
  // privacy policy, and routing restrictions before Tabs filters capabilities.
  const response = await fetchImpl(`${baseUrl}/models/user`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    return { kind: "rejected" as const, status: response.status, models: [] };
  }
  const payload = (await response.json()) as {
    data?: ReadonlyArray<{
      id?: unknown;
      name?: unknown;
      supported_parameters?: unknown;
      context_length?: number;
      top_provider?: { max_completion_tokens?: number };
    }>;
  };
  const models = validateServerProviderModelList(
    (payload.data ?? []).flatMap((model) => {
      const slug = typeof model.id === "string" ? model.id.trim() : "";
      if (!slug) return [];
      // Agent sessions need native tool calling. Keep the account's route and
      // model slug intact; a model name alone does not imply tool support.
      if (
        !Array.isArray(model.supported_parameters) ||
        !model.supported_parameters.includes("tools")
      ) {
        return [];
      }
      const name = typeof model.name === "string" && model.name.trim() ? model.name.trim() : slug;
      return [{ slug, name, isCustom: false, capabilities: null }];
    }),
  );
  return {
    kind: "authenticated" as const,
    models: models.map((model) => {
      const metadata = payload.data?.find((item) => item.id === model.slug);
      return {
        ...model,
        ...(typeof metadata?.context_length === "number" && metadata.context_length > 0
          ? { contextWindow: metadata.context_length }
          : {}),
        ...(typeof metadata?.top_provider?.max_completion_tokens === "number" &&
        metadata.top_provider.max_completion_tokens > 0
          ? { maxTokens: metadata.top_provider.max_completion_tokens }
          : {}),
      };
    }),
  };
}

const withInstanceIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationGroupKey: string;
  }) =>
  (snapshot: ReturnType<typeof buildServerProvider>): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });

export const OpenRouterDriver: ProviderDriver<OpenRouterSettings, any> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "OpenRouter",
    supportsMultipleInstances: true,
  },
  configSchema: OpenRouterSettings,
  defaultConfig: (): OpenRouterSettings => decodeOpenRouterSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const baseIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const continuationIdentity = {
        ...baseIdentity,
        continuationKey: `${baseIdentity.continuationKey}:deepseek`,
      };
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const secureApiKey = yield* Effect.tryPromise(() =>
        getProviderSecret("openrouter.api-key"),
      ).pipe(Effect.orElseSucceed(() => null));
      const effectiveConfig = {
        ...config,
        harness: "deepseek" as const,
        enabled,
        apiKey: secureApiKey ?? config.apiKey,
      } satisfies OpenRouterSettings;
      const generation = yield* ProviderRuntimeGeneration;
      const processEnv = mergeProviderInstanceEnvironment(environment);
      let catalogModels: Awaited<ReturnType<typeof discoverOpenRouterModels>>["models"] = [];
      const nativeAdapter = yield* makeDeepSeekOpenRouterAdapterV2({
        instanceId,
        settings: effectiveConfig,
        environment: processEnv,
        models: () => catalogModels,
      });
      const probeEngine = Effect.tryPromise(async () => {
        const { stdout } = await promisify(execFile)(
          effectiveConfig.deepseekBinaryPath || "dsh",
          ["--version"],
          { env: processEnv, timeout: 10_000, maxBuffer: 32_768 },
        );
        return { generation: "deepseek", version: stdout.trim() };
      });
      const engineIsReady = (engine: { generation: string } | null) =>
        engine?.generation === "deepseek";
      const orchestrationAdapter = {
        ...nativeAdapter,
        openSession: (input: Parameters<typeof nativeAdapter.openSession>[0]) =>
          Effect.gen(function* () {
            if (!effectiveConfig.apiKey.trim()) {
              return yield* new ProviderAdapterOpenSessionError({
                driver: DRIVER_KIND,
                providerSessionId: input.providerSessionId,
                cause: "Configure an OpenRouter API key in Settings > Providers.",
              });
            }
            const probed = yield* probeEngine.pipe(
              Effect.mapError(
                (cause) =>
                  new ProviderAdapterOpenSessionError({
                    driver: DRIVER_KIND,
                    providerSessionId: input.providerSessionId,
                    cause,
                  }),
              ),
            );
            if (!engineIsReady(probed)) {
              return yield* new ProviderAdapterOpenSessionError({
                driver: DRIVER_KIND,
                providerSessionId: input.providerSessionId,
                cause:
                  "Install DeepSeek Harness (@deepseek-ai/dsh@0.2.1-rc.2) and configure its executable in Providers > OpenRouter.",
              });
            }
            if (catalogModels.length === 0) {
              const discovery = yield* Effect.tryPromise({
                try: () => discoverOpenRouterModels(effectiveConfig),
                catch: () =>
                  new ProviderAdapterOpenSessionError({
                    driver: DRIVER_KIND,
                    providerSessionId: input.providerSessionId,
                    cause: "OpenRouter model discovery failed. Refresh Providers and retry.",
                  }),
              });
              catalogModels = discovery.models;
            }
            if (!catalogModels.some((model) => model.slug === input.modelSelection.model)) {
              return yield* new ProviderAdapterOpenSessionError({
                driver: DRIVER_KIND,
                providerSessionId: input.providerSessionId,
                cause:
                  "The selected OpenRouter model is not in this account's tool-capable catalog. Refresh Providers and select an available model.",
              });
            }
            return yield* nativeAdapter.openSession(input);
          }),
      };
      const maintenanceCapabilities = makeManualOnlyProviderMaintenanceCapabilities({
        provider: DRIVER_KIND,
        packageName: null,
      });

      const textGeneration = yield* makeOpenRouterTextGeneration(effectiveConfig);

      const checkProvider = Effect.all(
        {
          discovery: Effect.tryPromise(() => discoverOpenRouterModels(effectiveConfig)).pipe(
            Effect.tap((discovery) =>
              Effect.sync(() => {
                catalogModels = discovery.models;
              }),
            ),
          ),
          engine:
            effectiveConfig.enabled && effectiveConfig.apiKey.trim()
              ? probeEngine.pipe(Effect.orElseSucceed(() => null))
              : Effect.succeed(null),
        },
        { concurrency: "unbounded" },
      ).pipe(
        Effect.map(({ discovery, engine }) =>
          stampIdentity(
            buildServerProvider({
              presentation: { displayName: displayName || "OpenRouter" },
              enabled: effectiveConfig.enabled,
              checkedAt: new Date().toISOString(),
              catalogStatus: discovery.kind === "authenticated" ? "ready" : "failed",
              catalogSource: "openrouter-api",
              catalogCheckedAt: new Date().toISOString(),
              models: discovery.models,
              probe: {
                installed: engineIsReady(engine),
                version: engine?.version ?? null,
                status:
                  discovery.kind === "authenticated" && engineIsReady(engine)
                    ? "ready"
                    : discovery.kind === "missing"
                      ? "warning"
                      : "error",
                auth: {
                  status: discovery.kind === "authenticated" ? "authenticated" : "unauthenticated",
                  ...(discovery.kind === "authenticated"
                    ? { type: "apiKey", label: "OpenRouter API Key (usage-based)" }
                    : {}),
                },
                ...(discovery.kind === "missing"
                  ? { message: "OpenRouter API key is not configured." }
                  : discovery.kind === "rejected"
                    ? {
                        message: `OpenRouter rejected the configured API key (HTTP ${discovery.status}).`,
                      }
                    : !engineIsReady(engine)
                      ? {
                          message:
                            "Install DeepSeek Harness with npm install -g @deepseek-ai/dsh@0.2.1-rc.2, then set its executable path. Node.js 24.9 or newer is required.",
                        }
                      : {
                          message:
                            "Agent sessions use DeepSeek Harness with your OpenRouter API key.",
                        }),
              },
            }),
          ),
        ),
        Effect.catch((cause) =>
          Effect.succeed(
            stampIdentity(
              buildServerProvider({
                presentation: { displayName: displayName || "OpenRouter" },
                enabled: effectiveConfig.enabled,
                checkedAt: new Date().toISOString(),
                models: [],
                probe: {
                  installed: false,
                  version: null,
                  status: "error",
                  auth: {
                    status: "unknown",
                    type: "apiKey",
                    label: "OpenRouter API Key (usage-based)",
                  },
                  message: `OpenRouter model discovery failed: ${cause instanceof Error ? cause.message : String(cause)}`,
                },
              }),
            ),
          ),
        ),
      );

      const snapshot = yield* makeManagedServerProvider<OpenRouterSettings>({
        maintenanceCapabilities,
        getSettings: Effect.succeed(effectiveConfig),
        streamSettings: Stream.never,
        haveSettingsChanged: () => false,
        initialSnapshot: () => checkProvider,
        checkProvider,
        enrichSnapshot: ({ snapshot: currentSnapshot }) => Effect.succeed(currentSnapshot),
        refreshInterval: SNAPSHOT_REFRESH_INTERVAL,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build OpenRouter snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      // Legacy orchestration has no OpenRouter agent bridge. Retain its typed
      // rejection; V2 uses orchestrationAdapter above for native agent sessions.
      const OpenRouterUnsupportedError = (method: string) =>
        new ProviderAdapterRequestError({
          provider: DRIVER_KIND,
          method,
          detail:
            "OpenRouter agent sessions require orchestration V2 and DeepSeek Harness. " +
            "Code Review remains available through the API in legacy orchestration.",
        });

      const OpenRouterAdapter = {
        provider: DRIVER_KIND,
        capabilities: {
          sessionModelSwitch: "unsupported" as const,
          agentChat: "unsupported" as const,
        },
        streamEvents: Stream.empty,
        startSession: () => Effect.fail(OpenRouterUnsupportedError("startSession")),
        sendTurn: () => Effect.fail(OpenRouterUnsupportedError("sendTurn")),
        interruptTurn: () => Effect.fail(OpenRouterUnsupportedError("interruptTurn")),
        respondToRequest: () => Effect.fail(OpenRouterUnsupportedError("respondToRequest")),
        respondToUserInput: () => Effect.fail(OpenRouterUnsupportedError("respondToUserInput")),
        stopSession: () => Effect.void,
        listSessions: () => Effect.succeed([] as const),
        hasSession: () => Effect.succeed(false),
        readThread: () => Effect.fail(OpenRouterUnsupportedError("readThread")),
        rollbackThread: () => Effect.fail(OpenRouterUnsupportedError("rollbackThread")),
        stopAll: () => Effect.void,
      } satisfies ProviderAdapterShape<ProviderAdapterRequestError>;

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        capabilities: makeProviderInstanceCapabilities({
          modelDiscovery: "runtime",
          agentSessions: generation === "v2" ? "supported" : "unsupported",
          textGeneration: "supported",
          structuredGeneration: "supported",
          login: "supported",
          logout: "supported",
          accountSwitch: "supported",
        }),
        lifecycle: { actions: [] },
        snapshot,
        adapter: OpenRouterAdapter,
        orchestrationAdapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
