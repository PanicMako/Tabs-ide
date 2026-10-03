import {
  GeminiSettings,
  ProviderDriverKind,
  validateServerProviderModelList,
  type ServerProvider,
} from "@tabs/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { makeGeminiTextGeneration } from "../../textGeneration/GeminiTextGeneration";
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

const decodeGeminiSettings = Schema.decodeSync(GeminiSettings);

const DRIVER_KIND = "gemini" as ProviderDriverKind;
const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);

export async function discoverGeminiModels(apiKey: string, fetchImpl: typeof fetch = fetch) {
  const normalizedKey = apiKey.trim();
  if (!normalizedKey) return { kind: "missing" as const, models: [] };
  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(normalizedKey)}`,
  );
  if (!response.ok) return { kind: "rejected" as const, status: response.status, models: [] };
  const payload = (await response.json()) as {
    models?: ReadonlyArray<{
      name?: unknown;
      displayName?: unknown;
      supportedGenerationMethods?: unknown;
    }>;
  };
  const models = validateServerProviderModelList(
    (payload.models ?? []).flatMap((model) => {
      const name = typeof model.name === "string" ? model.name.trim() : "";
      if (!name || !name.startsWith("models/")) return [];
      if (
        Array.isArray(model.supportedGenerationMethods) &&
        !model.supportedGenerationMethods.includes("generateContent")
      ) {
        return [];
      }
      const slug = name.slice("models/".length);
      const displayName =
        typeof model.displayName === "string" && model.displayName.trim()
          ? model.displayName.trim()
          : slug;
      return [{ slug, name: displayName, isCustom: false, capabilities: null }];
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

export const GeminiDriver: ProviderDriver<GeminiSettings, never> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Google Gemini",
    supportsMultipleInstances: true,
  },
  configSchema: GeminiSettings,
  defaultConfig: (): GeminiSettings => decodeGeminiSettings({}),
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
      const secureApiKey = yield* Effect.tryPromise(() => getProviderSecret("gemini.api-key")).pipe(
        Effect.orElseSucceed(() => null),
      );
      const effectiveConfig = {
        ...config,
        enabled,
        apiKey: secureApiKey ?? config.apiKey,
      } satisfies GeminiSettings;
      const maintenanceCapabilities = makeManualOnlyProviderMaintenanceCapabilities({
        provider: DRIVER_KIND,
        packageName: null,
      });

      const textGeneration = yield* makeGeminiTextGeneration(effectiveConfig);

      const checkProvider = Effect.tryPromise(() =>
        discoverGeminiModels(effectiveConfig.apiKey),
      ).pipe(
        Effect.map((discovery) =>
          stampIdentity(
            buildServerProvider({
              presentation: { displayName: displayName || "Google Gemini" },
              enabled: effectiveConfig.enabled,
              checkedAt: new Date().toISOString(),
              catalogStatus: discovery.kind === "authenticated" ? "ready" : "failed",
              catalogSource: "gemini-models-api",
              catalogCheckedAt: new Date().toISOString(),
              models: discovery.models,
              probe: {
                installed: true,
                version: "2.5",
                status: discovery.kind === "authenticated" ? "ready" : "warning",
                auth: {
                  status: discovery.kind === "authenticated" ? "authenticated" : "unauthenticated",
                  ...(discovery.kind === "authenticated"
                    ? { type: "apiKey", label: "Gemini API Key (usage-based)" }
                    : {}),
                },
                ...(discovery.kind === "missing"
                  ? { message: "Gemini API key is not configured." }
                  : discovery.kind === "rejected"
                    ? {
                        message: `Gemini rejected the configured API key (HTTP ${discovery.status}).`,
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
                presentation: { displayName: displayName || "Google Gemini" },
                enabled: effectiveConfig.enabled,
                checkedAt: new Date().toISOString(),
                catalogStatus: "failed",
                catalogSource: "gemini-models-api",
                models: [],
                probe: {
                  installed: true,
                  version: null,
                  status: "error",
                  auth: { status: "unknown" },
                  message: `Gemini model discovery failed: ${cause instanceof Error ? cause.message : String(cause)}`,
                },
              }),
            ),
          ),
        ),
      );

      const snapshot = yield* makeManagedServerProvider<GeminiSettings>({
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
              detail: `Failed to build Gemini snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      // Gemini is a text-generation-only provider (Code Review). It does NOT
      // support interactive Agent Chat sessions. Every agent-protocol method
      // returns a typed ProviderAdapterRequestError so the error bubbles
      // through ProviderService cleanly instead of producing a
      // `yield* undefined` TypeError that crashes the turn handler.
      const geminiUnsupportedError = (method: string) =>
        new ProviderAdapterRequestError({
          provider: DRIVER_KIND,
          method,
          detail:
            "Google Gemini does not support interactive Agent Chat. " +
            "Select a different provider in the Agents tab. " +
            "Gemini is available for Git Code Review text generation only.",
        });

      const geminiAdapter = {
        provider: DRIVER_KIND,
        capabilities: {
          sessionModelSwitch: "unsupported" as const,
          agentChat: "unsupported" as const,
        },
        streamEvents: Stream.empty,
        startSession: () => Effect.fail(geminiUnsupportedError("startSession")),
        sendTurn: () => Effect.fail(geminiUnsupportedError("sendTurn")),
        interruptTurn: () => Effect.fail(geminiUnsupportedError("interruptTurn")),
        respondToRequest: () => Effect.fail(geminiUnsupportedError("respondToRequest")),
        respondToUserInput: () => Effect.fail(geminiUnsupportedError("respondToUserInput")),
        stopSession: () => Effect.void,
        listSessions: () => Effect.succeed([] as const),
        hasSession: () => Effect.succeed(false),
        readThread: () => Effect.fail(geminiUnsupportedError("readThread")),
        rollbackThread: () => Effect.fail(geminiUnsupportedError("rollbackThread")),
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
        adapter: geminiAdapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
