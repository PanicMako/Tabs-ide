import {
  ProviderDriverKind,
  type OpenRouterSettings,
  type ProviderInstanceId,
  type ServerProviderModel,
} from "@tabs/contracts";
import { resolveSelfInvocation } from "@tabs/shared/nodeRuntime";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/unstable/process";
import { AcpSpawnError } from "effect-acp/errors";
import { deepSeekHarnessHome } from "../../provider/deepSeekProfiles";
import * as ServerSettings from "../../serverSettings";
import { parseDeepSeekPluginOverrides } from "@tabs/shared/deepSeekPlugins";
import * as Path from "node:path";
import { ServerConfig } from "../../config";
import * as AcpSessionRuntime from "../../provider/acp/AcpSessionRuntime";
import { IdAllocatorV2 } from "../IdAllocator";
import { AcpProviderCapabilitiesV2, makeAcpAdapterV2 } from "./AcpAdapterV2";

/** A data-only overlay selecting an upstream provider plugin; never contains credentials. */
export function deepSeekOpenRouterOverlay(
  baseUrl: string,
  models: ReadonlyArray<
    Pick<ServerProviderModel, "slug" | "name"> & { contextWindow?: number; maxTokens?: number }
  >,
  pluginPatch = "[]",
): string {
  const first = models[0]?.slug;
  if (!first) throw new Error("No tool-capable OpenRouter models are available for this account.");
  return JSON.stringify(
    [
      ...parseDeepSeekPluginOverrides(pluginPatch),
      {
        id: "llm-pi-ai",
        config: {
          providers: {
            openrouter: {
              apiKeyEnv: "OPENROUTER_API_KEY",
              api: "openai-completions",
              baseURL: baseUrl,
              models: models.map((model) => ({
                id: model.slug,
                name: model.name,
                contextWindow: model.contextWindow ?? 32_768,
                maxTokens: model.maxTokens ?? 4_096,
              })),
            },
          },
        },
      },
      { id: "acp", config: { provider: "openrouter", model: first } },
      { id: "agent-default-model", config: { provider: "openrouter", model: first } },
    ],
    null,
    2,
  );
}

export const makeDeepSeekOpenRouterAdapterV2 = (options: {
  instanceId: ProviderInstanceId;
  settings: OpenRouterSettings;
  environment: NodeJS.ProcessEnv;
  models: () => ReadonlyArray<ServerProviderModel & { contextWindow?: number; maxTokens?: number }>;
}) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const crypto = yield* Crypto.Crypto;
    const idAllocator = yield* IdAllocatorV2;
    const serverConfig = yield* ServerConfig;
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const selfInvocation = yield* resolveSelfInvocation();
    const home = deepSeekHarnessHome(serverConfig.stateDir, options.instanceId);
    const settingsService = yield* ServerSettings.ServerSettingsService;
    return makeAcpAdapterV2({
      instanceId: options.instanceId,
      crypto,
      fileSystem,
      idAllocator,
      serverConfig,
      selfInvocation,
      flavor: {
        driver: ProviderDriverKind.make("openrouter"),
        capabilities: AcpProviderCapabilitiesV2,
        preferResumeSession: true,
        applyModelSelection: ({ runtime, modelSelection }) =>
          runtime
            .setModel(JSON.stringify(["openrouter", modelSelection.model]))
            .pipe(Effect.as(modelSelection.model)),
        makeRuntime: (input) =>
          Effect.gen(function* () {
            const { processEnvironment, ...runtimeInput } = input;
            const overlay = Path.join(home, "openrouter.patch.yml");
            yield* fileSystem.makeDirectory(home, { recursive: true });
            yield* fileSystem.writeFileString(
              overlay,
              deepSeekOpenRouterOverlay(
                options.settings.baseUrl,
                options.models(),
                (yield* settingsService.getSettings).deepSeekPluginPatches?.[options.instanceId] ??
                  "[]",
              ),
            );
            const context = yield* Layer.build(
              AcpSessionRuntime.layer({
                ...runtimeInput,
                resumeMethod: "resume",
                spawn: {
                  command: options.settings.deepseekBinaryPath || "dsh",
                  args: ["acp", "--patch", overlay],
                  cwd: input.cwd,
                  shell: false,
                  env: {
                    ...options.environment,
                    ...processEnvironment,
                    DSH_HOME: home,
                    DSH_TELEMETRY_DISABLED: "1",
                    // Preserve upstream workspace boundaries and interactive approval handling.
                    DSH_PERMISSION_MODE:
                      input.runtimePolicy.interactionMode === "plan"
                        ? "read-only"
                        : "workspace-write",
                    OPENROUTER_API_KEY: options.settings.apiKey,
                  },
                },
              }).pipe(
                Layer.provide(
                  Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
                ),
              ),
            );
            return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
              Effect.provide(context),
            );
          }).pipe(
            Effect.mapError(
              (cause) => new AcpSpawnError({ command: options.settings.deepseekBinaryPath, cause }),
            ),
          ),
      },
    });
  });
