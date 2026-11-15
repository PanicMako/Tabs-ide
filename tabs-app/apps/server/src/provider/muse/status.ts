import { ServerProviderModel } from "@tabs/contracts";
import { MuseSettings } from "@tabs/contracts";
import { resolveSpawnCommand } from "@tabs/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as ChildProcess from "effect/unstable/process/ChildProcess";

import { createMuseSdkHost, makeMuseEnvironment } from "./sdk.ts";
import { discoverMuseModels, museModelCapabilities } from "./modelCatalog.ts";
import {
  buildServerProvider,
  COMPACT_SLASH_COMMAND,
  DEFAULT_TIMEOUT_MS,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ProviderProbeResult,
} from "../providerSnapshot.ts";

/** Muse prints release builds as `1.2.3-R4`; fall back to a plain semver. */
export function parseMuseVersion(output: string): string | null {
  return output.match(/\b\d+\.\d+\.\d+-R\d+(?:\.\d+)?\b/)?.[0] ?? parseGenericCliVersion(output);
}

// Keep version managers such as mise from reaching the network during a probe.
const providerProbeEnvironment = (environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...environment,
  MISE_OFFLINE: "1",
});

const parseCliVersionResult = (
  result: { readonly code: number; readonly stdout: string; readonly stderr: string },
  parse: (output: string) => string | null,
): string | null => (result.code === 0 ? parse(`${result.stdout}\n${result.stderr}`) : null);

const MUSE_PRESENTATION = {
  displayName: "Muse Code",
  showInteractionModeToggle: false,
  reportsContextWindow: true,
  // Muse has no accept-edits mode; map only :ask-me and :unrestricted.
  supportedRuntimeModes: ["approval-required", "full-access"],
} as const;

const FALLBACK_CAPABILITIES = museModelCapabilities();

export const makePendingMuseProvider = Effect.fn("makePendingMuseProvider")(function* (
  settings: MuseSettings,
) {
  return buildServerProvider({
    presentation: MUSE_PRESENTATION,
    enabled: settings.enabled,
    checkedAt: DateTime.formatIso(yield* DateTime.now),
    models: providerModelsFromSettings([], settings.customModels, FALLBACK_CAPABILITIES),
    slashCommands: settings.enabled ? [COMPACT_SLASH_COMMAND] : [],
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: settings.enabled
        ? "Checking Muse Code CLI availability..."
        : "Muse Code is disabled in Tabs settings.",
    },
  });
});

export const checkMuseProviderStatus = Effect.fn("checkMuseProviderStatus")(function* (
  settings: MuseSettings,
  environment?: NodeJS.ProcessEnv,
  cwd?: string,
  createHost: typeof createMuseSdkHost = createMuseSdkHost,
) {
  if (!settings.enabled) return yield* makePendingMuseProvider(settings);
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const museEnvironment = providerProbeEnvironment(environment ?? makeMuseEnvironment());
  const snapshot = (probe: ProviderProbeResult, models: ReadonlyArray<ServerProviderModel> = []) =>
    buildServerProvider({
      presentation: MUSE_PRESENTATION,
      enabled: true,
      checkedAt,
      models: providerModelsFromSettings(models, settings.customModels, FALLBACK_CAPABILITIES),
      slashCommands: [COMPACT_SLASH_COMMAND],
      probe,
    });
  const versionResult = yield* Effect.gen(function* () {
    const spawnCommand = yield* resolveSpawnCommand(settings.binaryPath, ["--version"], {
      env: museEnvironment,
    });
    return yield* spawnAndCollect(
      settings.binaryPath,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: museEnvironment,
        shell: spawnCommand.shell,
        ...(cwd ? { cwd } : {}),
      }),
    );
  }).pipe(Effect.timeoutOption(DEFAULT_TIMEOUT_MS), Effect.result);

  if (Result.isFailure(versionResult)) {
    const missing = isCommandMissingCause(versionResult.failure);
    return snapshot({
      installed: !missing,
      version: null,
      status: "error",
      auth: { status: "unknown" },
      message: missing
        ? "Muse Code CLI (`muse`) was not found. Install Muse Code and run `muse login` on this Tabs server host."
        : "Failed to execute Muse Code CLI. Check its binary path on this Tabs server host.",
    });
  }
  if (Option.isNone(versionResult.success)) {
    return snapshot({
      installed: true,
      version: null,
      status: "error",
      auth: { status: "unknown" },
      message: "Muse Code CLI version check timed out.",
    });
  }
  const versionOutput = versionResult.success.value;
  const version = parseCliVersionResult(versionOutput, parseMuseVersion);
  if (versionOutput.code !== 0) {
    return snapshot({
      installed: true,
      version,
      status: "error",
      auth: { status: "unknown" },
      // T3 runs Muse with MUSE_NO_AUTO_UPDATE=1, so a launcher whose runtime was never fetched
      // (common after a mise upgrade) refuses to install it; a manual run completes setup.
      message: versionOutput.stderr.includes("installed binary is missing")
        ? "Muse Code has not finished installing. Run `muse --version` on this Tabs server host, then refresh its status."
        : "Muse Code CLI is installed but failed to run.",
    });
  }

  const catalog = yield* discoverMuseModels(settings, museEnvironment, cwd, createHost).pipe(
    Effect.scoped,
    Effect.timeoutOption(12_000),
    Effect.result,
  );
  if (Result.isFailure(catalog) || Option.isNone(catalog.success)) {
    return snapshot({
      installed: true,
      version,
      status: "error",
      auth: { status: "unknown" },
      message:
        "Muse Code SDK could not read the model catalog. Check your Muse installation and run `muse login` on this Tabs server host.",
    });
  }
  const models = catalog.success.value;
  // MSP has no auth signal and serves cached models while logged out; failures surface on first turn.
  return snapshot(
    {
      installed: true,
      version,
      auth: { status: "unknown" },
      ...(models.length > 0
        ? { status: "ready" }
        : {
            status: "warning",
            message:
              "Muse Code returned no models. Run `muse login` on this Tabs server host and refresh its status.",
          }),
    },
    models,
  );
});
