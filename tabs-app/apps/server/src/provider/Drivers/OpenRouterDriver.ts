import {
  OpenRouterSettings,
  ProviderDriverKind,
  validateServerProviderModelList,
  type ServerProvider,
} from "@tabs/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { makeOpenRouterTextGeneration } from "../../textGeneration/OpenRouterTextGeneration";
import { ProviderAdapterRequestError, ProviderDriverError } from "../Errors";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter";
import { makeManagedServerProvider } from "../makeManagedServerProvider";
import {
  defaultProviderContinuationIdentity,
  makeProviderInstanceCapabilities,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver";
import { buildServerProvider } from "../providerSnapshot";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance";
import { getProviderSecret } from "../ProviderSecretStore";

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
  });
  if (!response.ok) {
    return { kind: "rejected" as const, status: response.status, models: [] };
  }
  const payload = (await response.json()) as {
    data?: ReadonlyArray<{
      id?: unknown;
      name?: unknown;
      supported_parameters?: unknown;
    }>;
  };
  const models = validateServerProviderModelList(
    (payload.data ?? []).flatMap((model) => {
      const slug = typeof model.id === "string" ? model.id.trim() : "";
      if (!slug) return [];
      // Every OpenRouter text-generation request made by Tabs asks for a JSON
      // object via response_format. Do not advertise models that the catalog
      // says cannot accept that parameter.
      if (
        Array.isArray(model.supported_parameters) &&
        !model.supported_parameters.includes("response_format")
      ) {
        return [];
      }
      const name = typeof model.name === "string" && model.name.trim() ? model.name.trim() : slug;
      return [{ slug, name, isCustom: false, capabilities: null }];
    }),
  );
  return { kind: "authenticated" as const, models };
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

export const OpenRouterDriver: ProviderDriver<OpenRouterSettings, never> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "OpenRouter",
    supportsMultipleInstances: true,
  },
  configSchema: OpenRouterSettings,
  defaultConfig: (): OpenRouterSettings => decodeOpenRouterSettings({}),
  create: ({ instanceId, displayName, accentColor, enabled, config }) =>
    Effect.gen(function* () {
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
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
        enabled,
        apiKey: secureApiKey ?? config.apiKey,
      } satisfies OpenRouterSettings;
      const maintenanceCapabilities = makeManualOnlyProviderMaintenanceCapabilities({
        provider: DRIVER_KIND,
        packageName: null,
      });

      const textGeneration = yield* makeOpenRouterTextGeneration(effectiveConfig);

      const checkProvider = Effect.tryPromise(() => discoverOpenRouterModels(effectiveConfig)).pipe(
        Effect.map((discovery) =>
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
                installed: true,
                version: "2.5",
                status:
                  discovery.kind === "authenticated"
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
                    : {}),
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
                  installed: true,
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

      // OpenRouter is a text-generation-only provider (Code Review). It does NOT
      // support interactive Agent Chat sessions. Every agent-protocol method
      // returns a typed ProviderAdapterRequestError so the error bubbles
      // through ProviderService cleanly instead of producing a
      // `yield* undefined` TypeError that crashes the turn handler.
      const OpenRouterUnsupportedError = (method: string) =>
        new ProviderAdapterRequestError({
          provider: DRIVER_KIND,
          method,
          detail:
            "OpenRouter does not support interactive Agent Chat. " +
            "Select a different provider in the Agents tab. " +
            "OpenRouter is available for Git Code Review text generation only.",
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
          textGeneration: "supported",
          structuredGeneration: "supported",
          login: "supported",
          logout: "supported",
          accountSwitch: "supported",
        }),
        lifecycle: { actions: [] },
        snapshot,
        adapter: OpenRouterAdapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
