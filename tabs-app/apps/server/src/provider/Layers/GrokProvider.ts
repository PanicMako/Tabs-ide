import {
  type GrokSettings,
  type ModelCapabilities,
  ProviderDriverKind,
  type ServerProvider,
  type ServerProviderModel,
} from "@tabs/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { createModelCapabilities } from "@tabs/shared/model";

import {
  buildServerProvider,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  type ProviderMaintenanceCapabilities,
} from "../providerMaintenance";

const GROK_PRESENTATION = {
  displayName: "Grok",
  badgeLabel: "Early Access",
  showInteractionModeToggle: false,
  requiresNewThreadForModelChange: true,
} as const;
const PROVIDER = "grok" as ProviderDriverKind;
const DEFAULT_GROK_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

const VERSION_PROBE_TIMEOUT_MS = 4_000;
const GROK_MODEL_DISCOVERY_TIMEOUT_MS = 8_000;
const ANSI_ESCAPE_SEQUENCE = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "gu");

export function buildInitialGrokProviderSnapshot(
  grokSettings: GrokSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = grokModelsFromSettings(grokSettings.customModels);

    if (!grokSettings.enabled) {
      return buildServerProvider({
        presentation: GROK_PRESENTATION,
        enabled: false,
        checkedAt,
        catalogStatus: "empty",
        catalogSource: "grok-acp",
        catalogCheckedAt: checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Grok is disabled in Tabs settings.",
        },
      });
    }

    return buildServerProvider({
      presentation: GROK_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Checking Grok CLI availability...",
      },
    });
  });
}

function grokModelsFromSettings(
  customModels: ReadonlyArray<string> | undefined,
  builtInModels: ReadonlyArray<ServerProviderModel> = [],
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(
    builtInModels,
    PROVIDER,
    customModels ?? [],
    DEFAULT_GROK_MODEL_CAPABILITIES,
  );
}

export function parseGrokModelsOutput(output: string): ReadonlyArray<ServerProviderModel> {
  const seen = new Set<string>();
  const models: ServerProviderModel[] = [];
  const plain = output.replace(ANSI_ESCAPE_SEQUENCE, "");
  for (const line of plain.split(/\r?\n/u)) {
    const match = /^\s*\*?\s*([a-z0-9][a-z0-9._-]*)(?:\s+\(default\))?\s*$/iu.exec(line);
    if (!match) continue;
    const slug = match[1]?.trim();
    if (!slug || seen.has(slug) || slug.toLowerCase() === "models") continue;
    seen.add(slug);
    models.push({
      slug,
      name: slug,
      isCustom: false,
      capabilities: DEFAULT_GROK_MODEL_CAPABILITIES,
    });
  }
  return models;
}

const runGrokModelsCommand = (
  grokSettings: GrokSettings,
  environment: NodeJS.ProcessEnv = process.env,
) => {
  const command = grokSettings.binaryPath || "grok";
  return spawnAndCollect(
    command,
    ChildProcess.make(command, ["models"], {
      env: environment,
      shell: process.platform === "win32",
    }),
  );
};

const runGrokVersionCommand = (
  grokSettings: GrokSettings,
  environment: NodeJS.ProcessEnv = process.env,
) => {
  const command = grokSettings.binaryPath || "grok";
  return spawnAndCollect(
    command,
    ChildProcess.make(command, ["--version"], {
      env: environment,
      shell: process.platform === "win32",
    }),
  );
};

export const checkGrokProviderStatus = Effect.fn("checkGrokProviderStatus")(function* (
  grokSettings: GrokSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fallbackModels = grokModelsFromSettings(grokSettings.customModels);

  if (!grokSettings.enabled) {
    return buildServerProvider({
      presentation: GROK_PRESENTATION,
      enabled: false,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Grok is disabled in Tabs settings.",
      },
    });
  }

  const versionResult = yield* runGrokVersionCommand(grokSettings, environment).pipe(
    Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionResult)) {
    const error = versionResult.failure;
    return buildServerProvider({
      presentation: GROK_PRESENTATION,
      enabled: grokSettings.enabled,
      checkedAt,
      catalogStatus: "failed",
      catalogSource: "grok-acp",
      catalogCheckedAt: checkedAt,
      models: fallbackModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "Grok CLI (`grok`) is not installed or not on PATH."
          : `Failed to execute Grok CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      },
    });
  }

  if (Option.isNone(versionResult.success)) {
    return buildServerProvider({
      presentation: GROK_PRESENTATION,
      enabled: grokSettings.enabled,
      checkedAt,
      catalogStatus: "failed",
      catalogSource: "grok-acp",
      catalogCheckedAt: checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Grok CLI is installed but timed out while running `grok --version`.",
      },
    });
  }

  const versionOutput = versionResult.success.value;
  const version = parseGenericCliVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`);
  if (versionOutput.code !== 0) {
    const detail = detailFromResult(versionOutput);
    return buildServerProvider({
      presentation: GROK_PRESENTATION,
      enabled: grokSettings.enabled,
      checkedAt,
      catalogStatus: "failed",
      catalogSource: "grok-acp",
      catalogCheckedAt: checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: detail
          ? `Grok CLI is installed but failed to run. ${detail}`
          : "Grok CLI is installed but failed to run.",
      },
    });
  }

  const discoveryExit = yield* runGrokModelsCommand(grokSettings, environment).pipe(
    Effect.timeoutOption(GROK_MODEL_DISCOVERY_TIMEOUT_MS),
    Effect.exit,
  );
  if (Exit.isFailure(discoveryExit)) {
    // Grok exposes an ACP entrypoint (`grok agent stdio`) but its ACP session
    // requires the CLI to be signed in; an unauthenticated probe fails (or times
    // out on the blocking `authenticate` call). Surface a clean, actionable status
    // instead of the raw RpcClientDefect stack (kept in the logs for debugging).
    const detail = Cause.pretty(discoveryExit.cause);
    yield* Effect.logWarning("Grok model discovery failed", { cause: detail });
    return buildServerProvider({
      presentation: GROK_PRESENTATION,
      enabled: grokSettings.enabled,
      checkedAt,
      catalogStatus: "failed",
      catalogSource: "grok-acp",
      catalogCheckedAt: checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message:
          "Grok CLI is installed but `grok models` failed. " +
          "Sign in with `grok login`, then retry.",
      },
    });
  }
  if (Option.isNone(discoveryExit.value)) {
    yield* Effect.logWarning(
      `Grok model discovery timed out after ${GROK_MODEL_DISCOVERY_TIMEOUT_MS}ms.`,
    );
    return buildServerProvider({
      presentation: GROK_PRESENTATION,
      enabled: grokSettings.enabled,
      checkedAt,
      catalogStatus: "failed",
      catalogSource: "grok-acp",
      catalogCheckedAt: checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message:
          `Grok CLI is installed but \`grok models\` timed out after ${GROK_MODEL_DISCOVERY_TIMEOUT_MS}ms, ` +
          "which usually means it isn't signed in. Run `grok login`, then retry.",
      },
    });
  }
  const discoveryOutput = discoveryExit.value.value;
  if (discoveryOutput.code !== 0) {
    const detail = detailFromResult(discoveryOutput);
    return buildServerProvider({
      presentation: GROK_PRESENTATION,
      enabled: grokSettings.enabled,
      checkedAt,
      catalogStatus: "failed",
      catalogSource: "grok-models",
      catalogCheckedAt: checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unauthenticated" },
        message: detail
          ? `Grok model discovery failed. ${detail}`
          : "Grok model discovery failed. Run `grok login`, then retry.",
      },
    });
  }
  const discoveredModels = parseGrokModelsOutput(
    `${discoveryOutput.stdout}\n${discoveryOutput.stderr}`,
  );
  const models =
    discoveredModels.length > 0
      ? grokModelsFromSettings(grokSettings.customModels, discoveredModels)
      : fallbackModels;

  return buildServerProvider({
    presentation: GROK_PRESENTATION,
    enabled: grokSettings.enabled,
    checkedAt,
    catalogStatus: models.length > 0 ? "ready" : "empty",
    catalogSource: "grok-models",
    catalogCheckedAt: checkedAt,
    models,
    probe: {
      installed: true,
      version,
      status: "ready",
      auth: { status: "authenticated", type: "account", label: "Grok account allowance" },
    },
  });
});

export const enrichGrokSnapshot = (input: {
  readonly snapshot: ServerProvider;
  readonly maintenanceCapabilities: ProviderMaintenanceCapabilities;
  readonly publishSnapshot: (snapshot: ServerProvider) => Effect.Effect<void>;
  readonly httpClient: HttpClient.HttpClient;
}): Effect.Effect<void> => {
  const { snapshot, publishSnapshot } = input;

  return enrichProviderSnapshotWithVersionAdvisory(snapshot, input.maintenanceCapabilities).pipe(
    Effect.provideService(HttpClient.HttpClient, input.httpClient),
    Effect.flatMap((enrichedSnapshot) => publishSnapshot(enrichedSnapshot)),
    Effect.catchCause((cause) =>
      Effect.logWarning("Grok version advisory enrichment failed", {
        cause: Cause.pretty(cause),
      }),
    ),
    Effect.asVoid,
  );
};
