import {
  type CopilotSettings,
  ProviderDriverKind,
  type ServerProvider,
  type ServerProviderModel,
} from "@tabs/contracts";
import { CopilotClient, RuntimeConnection, type ModelInfo } from "@github/copilot-sdk";
import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import { HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { createModelCapabilities } from "@tabs/shared/model";

import {
  buildServerProvider,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  type ProviderMaintenanceCapabilities,
} from "../providerMaintenance";
import { buildCopilotEnvironment } from "../acp/CopilotAcpSupport";
import { getCopilotToken } from "../CopilotCredentialStore";

export const COPILOT_PRESENTATION = {
  displayName: "GitHub Copilot",
  badgeLabel: "ACP",
  showInteractionModeToggle: true,
  requiresNewThreadForModelChange: false,
} as const;

export const COPILOT_DRIVER_KIND = "copilot" as ProviderDriverKind;

const VERSION_PROBE_TIMEOUT_MS = 4_000;
const COPILOT_MODEL_DISCOVERY_TIMEOUT_MS = 12_000;

export function buildInitialCopilotProviderSnapshot(
  copilotSettings: CopilotSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models: ReadonlyArray<ServerProviderModel> = [];

    if (!copilotSettings.enabled) {
      return buildServerProvider({
        presentation: COPILOT_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        catalogStatus: "empty",
        catalogSource: "copilot.models.list",
        catalogCheckedAt: checkedAt,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "GitHub Copilot is disabled in Tabs settings.",
        },
      });
    }

    return buildServerProvider({
      presentation: COPILOT_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      catalogStatus: "loading",
      catalogSource: "copilot.models.list",
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Checking GitHub Copilot CLI availability...",
      },
    });
  });
}

export function buildCopilotModelsFromCatalog(
  catalog: ReadonlyArray<ModelInfo>,
): ReadonlyArray<ServerProviderModel> {
  const seen = new Set<string>();
  const models: ServerProviderModel[] = [];
  for (const descriptor of catalog) {
    const slug = typeof descriptor.id === "string" ? descriptor.id.trim() : "";
    const name = typeof descriptor.name === "string" ? descriptor.name.trim() : "";
    if (!slug || !name || seen.has(slug)) continue;
    seen.add(slug);
    const efforts = Array.isArray(descriptor.supportedReasoningEfforts)
      ? descriptor.supportedReasoningEfforts.filter((effort) => typeof effort === "string")
      : [];
    models.push({
      slug,
      name,
      isCustom: false,
      source: "known",
      capabilities: createModelCapabilities({
        optionDescriptors:
          efforts.length > 0
            ? [
                {
                  id: "reasoningEffort",
                  label: "Reasoning effort",
                  type: "select",
                  options: efforts.map((effort) => ({
                    id: effort,
                    label: effort,
                    ...(effort === descriptor.defaultReasoningEffort ? { isDefault: true } : {}),
                  })),
                },
              ]
            : [],
      }),
    });
  }
  return models;
}

function resolveCopilotExecutable(
  binaryPath: string | undefined,
  environment: NodeJS.ProcessEnv,
): string {
  const command = binaryPath?.trim() || "copilot";
  if (isAbsolute(command) || command.includes("/") || command.includes("\\")) return command;
  const extensions =
    process.platform === "win32" ? (environment.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  for (const directory of (environment.PATH ?? "").split(delimiter)) {
    for (const extension of extensions) {
      const candidate = join(directory, `${command}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return command;
}

interface CopilotAcpProbeResult {
  readonly models: ReadonlyArray<ServerProviderModel>;
}

export function classifyCopilotCatalogFailure(
  detail: string,
): "unauthenticated" | "unentitled" | "unknown" {
  const normalized = detail.toLowerCase();
  // @github/copilot-sdk currently exposes models.list failures as generic JSON-RPC errors without
  // typed authentication or entitlement codes. These wording-dependent fallbacks may need updates
  // when Copilot CLI changes its error messages or publishes structured failure data.
  if (
    ["unauthorized", "authentication required", "not logged in", "copilot login", "-32001"].some(
      (marker) => normalized.includes(marker),
    )
  ) {
    return "unauthenticated";
  }
  if (
    ["no active seat", "no copilot seat", "subscription required", "not entitled"].some((marker) =>
      normalized.includes(marker),
    )
  ) {
    return "unentitled";
  }
  return "unknown";
}

export const discoverCopilotModelsViaAcp = (
  copilotSettings: CopilotSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.Effect<
  CopilotAcpProbeResult,
  unknown,
  Scope.Scope | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const executable = resolveCopilotExecutable(copilotSettings.binaryPath, environment);
    const secureToken = yield* Effect.tryPromise(() => getCopilotToken());
    const client = new CopilotClient({
      connection: RuntimeConnection.forStdio({ path: executable }),
      workingDirectory: process.cwd(),
      env: buildCopilotEnvironment(copilotSettings, environment, secureToken),
      ...(secureToken ? { gitHubToken: secureToken } : {}),
      logLevel: "none",
    });
    yield* Effect.acquireRelease(
      Effect.tryPromise(() => client.start()).pipe(Effect.as(client)),
      (activeClient) => Effect.promise(() => activeClient.stop()).pipe(Effect.asVoid),
    );
    const catalog = yield* Effect.tryPromise(() => client.listModels());
    return { models: buildCopilotModelsFromCatalog(catalog) };
  });

const runCopilotVersionCommand = (
  copilotSettings: CopilotSettings,
  environment: NodeJS.ProcessEnv = process.env,
) => {
  const command = copilotSettings.binaryPath || "copilot";
  return spawnAndCollect(
    command,
    ChildProcess.make(command, ["--version"], {
      env: environment,
      shell: process.platform === "win32",
    }),
  );
};

export const checkCopilotProviderStatus = Effect.fn("checkCopilotProviderStatus")(function* (
  copilotSettings: CopilotSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const emptyFallbackModels: ReadonlyArray<ServerProviderModel> = [];

  if (!copilotSettings.enabled) {
    return buildServerProvider({
      presentation: COPILOT_PRESENTATION,
      enabled: false,
      checkedAt,
      models: emptyFallbackModels,
      catalogStatus: "empty",
      catalogSource: "copilot.models.list",
      catalogCheckedAt: checkedAt,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "GitHub Copilot is disabled in Tabs settings.",
      },
    });
  }

  // 1. Version probe / binary installation check
  const versionResult = yield* runCopilotVersionCommand(copilotSettings, environment).pipe(
    Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionResult)) {
    const error = versionResult.failure;
    return buildServerProvider({
      presentation: COPILOT_PRESENTATION,
      enabled: copilotSettings.enabled,
      checkedAt,
      models: emptyFallbackModels,
      catalogStatus: "failed",
      catalogSource: "copilot.models.list",
      catalogCheckedAt: checkedAt,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "GitHub Copilot CLI (`copilot`) is not installed or not on PATH."
          : `Failed to execute Copilot CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      },
    });
  }

  if (Option.isNone(versionResult.success)) {
    return buildServerProvider({
      presentation: COPILOT_PRESENTATION,
      enabled: copilotSettings.enabled,
      checkedAt,
      models: emptyFallbackModels,
      catalogStatus: "failed",
      catalogSource: "copilot.models.list",
      catalogCheckedAt: checkedAt,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "GitHub Copilot CLI is installed but timed out while running `copilot --version`.",
      },
    });
  }

  const versionOutput = versionResult.success.value;
  const version = parseGenericCliVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`);
  if (versionOutput.code !== 0) {
    const detail = detailFromResult(versionOutput);
    return buildServerProvider({
      presentation: COPILOT_PRESENTATION,
      enabled: copilotSettings.enabled,
      checkedAt,
      models: emptyFallbackModels,
      catalogStatus: "failed",
      catalogSource: "copilot.models.list",
      catalogCheckedAt: checkedAt,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: detail
          ? `GitHub Copilot CLI is installed but failed to run. ${detail}`
          : "GitHub Copilot CLI is installed but failed to run.",
      },
    });
  }

  // 2. Dynamic catalog discovery through Copilot CLI server mode. Chat sessions
  // continue to use ACP; models.list is a server-scoped SDK RPC.
  const discoveryExit = yield* discoverCopilotModelsViaAcp(copilotSettings, environment).pipe(
    Effect.scoped,
    Effect.timeoutOption(COPILOT_MODEL_DISCOVERY_TIMEOUT_MS),
    Effect.exit,
  );

  if (Exit.isFailure(discoveryExit)) {
    const detail = Cause.pretty(discoveryExit.cause);
    yield* Effect.logWarning("GitHub Copilot model catalog discovery failed", { cause: detail });
    const failureKind = classifyCopilotCatalogFailure(detail);

    return buildServerProvider({
      presentation: COPILOT_PRESENTATION,
      enabled: copilotSettings.enabled,
      checkedAt,
      models: emptyFallbackModels,
      catalogStatus: "failed",
      catalogSource: "copilot.models.list",
      catalogCheckedAt: checkedAt,
      probe: {
        installed: true,
        version,
        status: failureKind === "unentitled" ? "warning" : "error",
        auth: {
          status:
            failureKind === "unauthenticated"
              ? "unauthenticated"
              : failureKind === "unentitled"
                ? "authenticated_unentitled"
                : "unknown",
        },
        message:
          failureKind === "unauthenticated"
            ? "GitHub Copilot authentication is required. Sign in, then retry model discovery."
            : failureKind === "unentitled"
              ? "GitHub account connected, but Copilot reported that this account has no active entitlement."
              : "GitHub Copilot is available, but its model catalog could not be loaded. Retry discovery.",
      },
    });
  }

  if (Option.isNone(discoveryExit.value)) {
    yield* Effect.logWarning(
      `GitHub Copilot model discovery timed out after ${COPILOT_MODEL_DISCOVERY_TIMEOUT_MS}ms.`,
    );
    return buildServerProvider({
      presentation: COPILOT_PRESENTATION,
      enabled: copilotSettings.enabled,
      checkedAt,
      models: emptyFallbackModels,
      catalogStatus: "failed",
      catalogSource: "copilot.models.list",
      catalogCheckedAt: checkedAt,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: `GitHub Copilot is available, but model discovery timed out after ${COPILOT_MODEL_DISCOVERY_TIMEOUT_MS}ms. Retry discovery.`,
      },
    });
  }

  const probeResult = discoveryExit.value.value;
  const discoveredModels = probeResult.models;

  // A successful empty catalog is not evidence of an entitlement failure.
  if (discoveredModels.length === 0) {
    return buildServerProvider({
      presentation: COPILOT_PRESENTATION,
      enabled: copilotSettings.enabled,
      checkedAt,
      models: emptyFallbackModels,
      catalogStatus: "empty",
      catalogSource: "copilot.models.list",
      catalogCheckedAt: checkedAt,
      probe: {
        installed: true,
        version,
        status: "ready",
        auth: { status: "authenticated" },
        message:
          "GitHub Copilot returned an empty model catalog. No selectable models are currently advertised.",
      },
    });
  }

  // Active entitlement confirmed — models available
  const models = discoveredModels;

  return buildServerProvider({
    presentation: COPILOT_PRESENTATION,
    enabled: copilotSettings.enabled,
    checkedAt,
    models,
    catalogStatus: "ready",
    catalogSource: "copilot.models.list",
    catalogCheckedAt: checkedAt,
    probe: {
      installed: true,
      version,
      status: "ready",
      auth: { status: "authenticated" },
    },
  });
});

export const enrichCopilotSnapshot = (input: {
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
      Effect.logWarning("GitHub Copilot version advisory enrichment failed", {
        cause: Cause.pretty(cause),
      }),
    ),
    Effect.asVoid,
  );
};
